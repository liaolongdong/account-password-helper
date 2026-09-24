/**
 * chrome.storage 层 IO 成本探针（issue #89 大 Vault 评估配套测量）
 *
 * 回答的问题：**分页/虚拟滚动完全治不到**的那一半——
 * 「保存 1 条要把整包 N 条重新写一遍」到底值多少毫秒，
 * 以及按条目分键（E1 写结构改造）的收益上限是多少。
 *
 * 结果（`--repeat 5`，原始数据 `benchmarks/results/storage-io-io3.json`）：
 *   options 侧 600/2000/5000 条的整包读改写在 16.7/63.7/245.9 ms，一次保存的读写全貌 66.8/263.1/941.8 ms，
 *   `onChanged` 投递 43~55 / 211~245 / 538~852 ms；单条分键写 0.6/0.8/1.6 ms。
 *
 * 运行：
 *   pnpm build
 *   export E2E_EXECUTABLE_PATH="/tmp/cft/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
 *   node benchmarks/measure-storage-io.mjs --sizes 600,2000,5000 --repeat 5
 *
 * 输出：`benchmarks/results/storage-io-<label>.json` + stderr 摘要
 *
 * 口径与限制（读结果前必看）：
 * 1. 夹具为**密文形状的合成条目**（字段值取自真实密文长度分布），profile 是 `mkdtemp` 临时目录、
 *    用完即删，不含任何真实凭据。
 * 2. 测量在两个上下文各跑一遍：Service Worker（纯 IO + 结构化克隆，无渲染干扰）与
 *    options 页面（真实调用方，主线程还要付一次整包克隆）。**SW 数字是数据层成本的下限，
 *    options 数字是用户实际付的价**。
 * 3. `setSmall`（写一个约 500B 独立键）是**按条目分键方案的单条写入成本**，`shardsAll` 是它的
 *    最坏情况（整库重写）。**实测结论与本脚本初版的预判相反**：分键并没有"收益必然薄"，
 *    单条保存 245.9 → 1.6 ms（约 150×），而整库重写 240.0 vs 整包 245.9 ms 几乎等价、不倒退，
 *    全库读只贵约 16%（13.3/66.7/202.8 vs 10.9/43.8/175.1）。真实实现还要付索引键写入与跨键一致性，
 *    那是**风险成本**而非**收益折扣**——见 `docs/PERF_ISSUE89_DATA_LAYER_EVALUATION.md` 4.2 与第十节。
 * 4. 绝对值受磁盘状态、杀软扫描、整机负载影响（同一命令两次可差数倍）。
 *    **只在同一串行窗口内做相对比较**，跑前先确认 `top -l 2` 的 CPU idle 足够高。
 * 5. 夹具写在 `bench_blob` 而非 `account_passwords`：后者会触发扩展自身的 `onChanged` 扇出
 *    （SW 重预热、侧栏重载），把非 IO 成本混进计时。`onChanged` 延迟因此是**同上下文内**的投递延迟。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const log = (...parts) => process.stderr.write(`${parts.join(' ')}\n`);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const median = vs => {
  const xs = [...vs].sort((a, b) => a - b);
  if (!xs.length) return NaN;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
};

const SIZES = String(arg('sizes', '600,2000,5000')).split(',').map(Number).filter(Boolean);
const REPEAT = Number(arg('repeat', 5));
const LABEL = arg('label', 'run');
const EXTENSION_PATH = path.resolve(process.cwd(), arg('ext', '.output/chrome-mv3'));
/** 单规模探针的看门狗：超过即记为 failed，避免整轮挂死 */
const PROBE_TIMEOUT_MS = Number(arg('timeout-ms', 180000));

/** 由加载路径推导 packed-app 扩展 ID（`--load-extension` 的纯函数规则） */
function packagedIdFromPath(absPath) {
  const hex = createHash('sha256').update(absPath).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/**
 * 在扩展上下文里执行的测量体（参数：[sizes, repeat]，playwright evaluate 只传一个参数）
 *
 * 夹具刻意写在 `bench_blob` 而不是真实的 `account_passwords`：体积、字节数、序列化路径
 * 完全一致，但真实键会触发扩展自身的 machinery（SW `invalidate + warmPasswordCache`
 * 的 5N 次解密、options/侧栏的 `loadPasswords` 全量重载），那些工作会与本次计时
 * 抢同一块磁盘和同一个进程，测出来的"IO 成本"就成了混合成本。要测 IO 就只测 IO。
 */
async function runProbe([sizes, repeat]) {
  const key = 'bench_blob';
  const out = {};

  /**
   * 配额常量：本扩展未声明 `unlimitedStorage`，`chrome.storage.local.QUOTA_BYTES`
   * 直接给出这台 Chrome 对当前扩展生效的总配额 —— 比引用文档数字更硬，
   * 因为它是「读运行时对象」而不是「读网页」（离线文档镜像与真实值可能不同步）。
   * 每个规模都记一次，成本 0，避免为拿数字单独再跑一轮。
   */
  out.__quota = {
    local: chrome.storage.local.QUOTA_BYTES ?? null,
    session: chrome.storage.session?.QUOTA_BYTES ?? null,
    sync: chrome.storage.sync.QUOTA_BYTES ?? null,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    hasUnlimitedStorage: (chrome.runtime.getManifest().permissions || []).includes('unlimitedStorage'),
  };

  /** 中位数（evaluate 体内不可引用 Node 侧工具，必须自带） */
  const median = vs => {
    const xs = [...vs].sort((a, b) => a - b);
    if (!xs.length) return NaN;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };

  /** 计时工具：performance.now + 至少一次 await */
  const timed = async fn => {
    const t0 = performance.now();
    await fn();
    return performance.now() - t0;
  };

  for (const n of sizes) {
    const blob = Array.from({ length: n }, (_, i) => ({
      id: `io-${String(i).padStart(5, '0')}`,
      username: 'B'.repeat(56),
      password: 'C'.repeat(64),
      url: i % 7 === 0 ? '' : 'D'.repeat(80),
      remark: i % 2 === 0 ? '' : 'E'.repeat(92),
      totp: i % 5 === 0 ? 'F'.repeat(120) : '',
      tag: i % 3 === 0 ? 'group-1,team-2' : i % 2 === 0 ? 'region-1' : '',
      favorite: i % 11 === 0,
      createTime: 1700000000000 + i,
      updateTime: 1760000000000 - i,
      order: i,
      encrypted: true,
    }));
    const bytes = JSON.stringify(blob).length;
    const rec = { bytes };

    // 1) 整包写（现状：保存 1 条 = 重写整包）
    const setAll = [];
    for (let r = 0; r < repeat; r++) setAll.push(await timed(() => chrome.storage.local.set({ [key]: blob })));
    rec.setAllMs = +median(setAll).toFixed(1);
    rec.setAllSamples = setAll.map(v => +v.toFixed(1));

    // 2) 整包读
    const getAll = [];
    for (let r = 0; r < repeat; r++) getAll.push(await timed(() => chrome.storage.local.get(key)));
    rec.getAllMs = +median(getAll).toFixed(1);
    rec.getAllSamples = getAll.map(v => +v.toFixed(1));

    // 3) 读 + 改 1 条 + 写（一次保存的完整 read-modify-write）
    const rmw = [];
    for (let r = 0; r < repeat; r++) {
      rmw.push(
        await timed(async () => {
          const cur = await chrome.storage.local.get(key);
          const list = cur[key];
          list[0] = { ...list[0], updateTime: Date.now() };
          await chrome.storage.local.set({ [key]: list });
        }),
      );
    }
    rec.rmwMs = +median(rmw).toFixed(1);

    // 4) 按条目分键的上限：写一个 500B 独立键
    const one = { aph_pwd_io_00000: blob[0] };
    const setSmall = [];
    for (let r = 0; r < repeat; r++) setSmall.push(await timed(() => chrome.storage.local.set(one)));
    rec.setSmallMs = +median(setSmall).toFixed(1);

    // 5) 分键方案的整库重写成本（改主密码 / 全量导入 / 排序重编号的最坏情况）
    const shards = {};
    for (let i = 0; i < n; i++) shards[`aph_pwd_${i}`] = blob[i];
    const setShards = [];
    for (let r = 0; r < 3; r++) setShards.push(await timed(() => chrome.storage.local.set(shards)));
    rec.setShardsAllMs = +median(setShards).toFixed(1);

    // 6) 分键方案的全库读（打开管理页 / 预热缓存）
    const getShards = [];
    for (let r = 0; r < 3; r++) getShards.push(await timed(() => chrome.storage.local.get(Object.keys(shards))));
    rec.getShardsAllMs = +median(getShards).toFixed(1);

    // 7) storage.session 加密快照写入（侧边栏冷启动快路径）
    const snapshot = 'S'.repeat(Math.round(bytes * 0.8));
    const setSession = [];
    for (let r = 0; r < repeat; r++)
      setSession.push(await timed(() => chrome.storage.session.set({ bench_snapshot: snapshot })));
    rec.sessionBytes = snapshot.length;
    rec.setSessionMs = +median(setSession).toFixed(1);
    const getSession = [];
    for (let r = 0; r < repeat; r++) getSession.push(await timed(() => chrome.storage.session.get('bench_snapshot')));
    rec.getSessionMs = +median(getSession).toFixed(1);

    // 8) onChanged 投递延迟（同上下文）：set 落地后多久收到回调
    //
    // 两个必须避开的坑（第一个曾让整轮探针在 150 s 看门狗上静默挂死）：
    // - **写入值必须每轮都不同**：`chrome.storage.local.set` 写入与现状相等的值时
    //   不派发 onChanged，于是等待回调的 Promise 永不 settle。这里给最后一条的
    //   updateTime 打上轮次标记，保证每轮都是一次真实变更。
    // - **等待必须自带兜底**：回调因任何原因没来（值被判等、监听被别处摘走）时，
    //   记 -1 而不是让整轮卡住；-1 在摘要里一眼可辨。
    const latencies = [];
    for (let r = 0; r < 3; r++) {
      const probe = structuredClone(blob);
      probe[probe.length - 1] = { ...probe[probe.length - 1], updateTime: 1760000000000 - r };
      const t = await Promise.race([
        new Promise(resolve => {
          const listener = (changes, area) => {
            if (area !== 'local' || !(key in changes)) return;
            chrome.storage.onChanged.removeListener(listener);
            resolve(performance.now() - start);
          };
          chrome.storage.onChanged.addListener(listener);
          const start = performance.now();
          void chrome.storage.local.set({ [key]: probe });
        }),
        new Promise(resolve => setTimeout(() => resolve(-1), 8000)),
      ]);
      latencies.push(+t.toFixed(1));
    }
    rec.onChangedLatencyMs = latencies;

    out[`n${n}`] = rec;
  }

  return out;
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`扩展产物不存在：${EXTENSION_PATH}（先 pnpm build）`);
  }
  const executablePath = process.env.E2E_EXECUTABLE_PATH;
  if (!executablePath) throw new Error('需要 E2E_EXECUTABLE_PATH 指向 Chrome for Testing');

  const extId = packagedIdFromPath(EXTENSION_PATH);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-io-probe-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: process.env.E2E_HEADLESS !== '0',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--mute-audio',
    ],
  });

  const results = { meta: { extId, at: new Date().toISOString(), sizes: SIZES, repeat: REPEAT } };
  /**
   * 逐规模单独 evaluate：一次调用跑完 600/2000/5000 × 8 组动作会在大 N 处分键写入
   * 处挂死（实测 5 分钟无输出且看不到进程退出）。拆成「每个 N 一次调用 + 超时保护」后，
   * 已完成的规模照样落盘，卡住的规模记为 `failed` 而不是拖垮整轮。
   */
  const probeOne = async (target, n) => {
    let timer;
    try {
      return await Promise.race([
        target.evaluate(runProbe, [[n], REPEAT]),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`N=${n} 超过 ${PROBE_TIMEOUT_MS / 1000}s 未完成`)),
            PROBE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      // 按规模记失败，避免多个规模的失败互相覆盖成一条
      return { [`n${n}`]: { failed: String(error?.message ?? error) } };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // 先开一个扩展页把 SW 拉起来
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/options.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // ── options 页面上下文（真实调用方）──
    results.options = {};
    for (const n of SIZES) {
      log(`[options] N=${n} …`);
      Object.assign(results.options, await probeOne(page, n));
    }
    results.options.__ua = await page.evaluate(() => navigator.userAgent);

    // ── Service Worker 上下文（纯 IO，无渲染干扰）──
    const workers = context.serviceWorkers();
    if (workers.length) {
      results.sw = {};
      for (const n of SIZES) {
        log(`[sw] N=${n} …`);
        Object.assign(results.sw, await probeOne(workers[0], n));
      }
    } else {
      results.sw = { skipped: '未捕获到 service worker，仅页面上下文数据可用' };
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const file = new URL(`./results/storage-io-${LABEL}.json`, import.meta.url);
  fs.writeFileSync(file, JSON.stringify({ ...results, sizes: SIZES, repeat: REPEAT }, null, 2));
  log(`\n已写入 ${file.pathname}`);

  for (const ctx of ['sw', 'options']) {
    const r = results[ctx];
    if (!r || r.skipped) {
      log(`\n[${ctx}] ${r?.skipped ?? '无数据'}`);
      continue;
    }
    log(`\n[${ctx}]  整包写 / 整包读 / RMW / 分键写 / 分键全读 / session 快照写，单位 ms`);
    for (const n of SIZES) {
      const x = r[`n${n}`];
      if (!x) {
        log(`  N=${String(n).padStart(5)} 无数据`);
        continue;
      }
      if (x.failed) {
        log(`  N=${String(n).padStart(5)} 未完成：${x.failed}`);
        continue;
      }
      log(
        `  N=${String(n).padStart(5)} bytes=${String(x.bytes).padStart(8)} ` +
          `setAll=${x.setAllMs} getAll=${x.getAllMs} rmw=${x.rmwMs} small=${x.setSmallMs} ` +
          `shardsAll=${x.setShardsAllMs} getShards=${x.getShardsAllMs} session(${x.sessionBytes}B)=${x.setSessionMs}/${x.getSessionMs} ` +
          `onChanged=${x.onChangedLatencyMs.join('/')}`,
      );
    }
  }
}

main().catch(err => {
  log(`失败：${err?.stack ?? err}`);
  process.exitCode = 1;
});
