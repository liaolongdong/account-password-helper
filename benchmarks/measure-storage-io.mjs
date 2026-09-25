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
 *   分键（E1/S1）决策性审计（M-1/M-3/M-5 + 配额常量，以及 M-2 的原始字节账）：
 *   node benchmarks/measure-storage-io.mjs --sizes 100,1000,2000,5000 --steps audit
 *   M-2 的磁盘字节账目（Node 侧快照 leveldb 目录，须单独一趟）：
 *   node benchmarks/measure-storage-io.mjs --sizes 100,1000,2000,5000 --steps disk
 *
 * 输出：`benchmarks/results/storage-io-<label>.json` + stderr 摘要
 *
 * 审计口径（`--steps audit`，为「该不该分键」这个问题专门采的三条判据）：
 * - **M-1 千级键名一次写入的语义**：`set` 掉 100/1000/2000/5000 个键，再按键名读回 **并**
 *   全区域扫描读回，比对落到多少个。三种结果里只有「全部落地」能放行分键：显式拒绝
 *   （`rejected`）尚可捕获处理，**静默截断或部分成功（`partial`）直接否决 S1**——
 *   密码条目少落一条就是用户数据丢失，而 `chrome.storage` 没有任何文档保证键数上限。
 * - **M-2 配额账目**：`chrome.storage.local.getUsage()` 在本机 Chrome 153 上已不存在
 *   （实测 `is not a function`），`navigator.storage.estimate().usage` 又完全不涵盖
 *   `chrome.storage.local`（写 900 KB 前后恒为同一个数）——所以字节账目只能从磁盘侧取：
 *   `--steps disk` 由 Node 侧快照扩展的 leveldb 目录（`Local Extension Settings/<extId>`）
 *   在「写入 n 个分片键」前后的目录字节总和，与同一批条目的 JSON 字节对照，
 *   差值即每键固定开销（键名 + 记录框 + 预写日志）。`remove` 之后再快照一次，用于确认
 *   分片形态没有把数据留在库里——注意 leveldb 在墓碑与未合并 SST 上不会立刻回落到基线，
 *   该值不清零属常态，照实记录不作判据（compaction 跑过时甚至会倒降，见 09-25 批次）。
 *   运行时能直接读到的硬数字是 `QUOTA_BYTES`（本机 10 MiB）与 `QUOTA_BYTES_PER_ITEM`
 *   （MV3 下为 `null`，即无单条上限），配额是否吃紧由这两者加磁盘账目共同判断。
 * - **M-3 单键变更的 `onChanged` 投递延迟**：分键后一次保存只改一个键，跨上下文刷新
 *   能否跟上取决于这一条。同一测量在**空库**与**已有 N 个键**两种状态下各跑一遍——
 *   如果区域里键的总量本身会拖慢投递，那分键就把「整包 211~245ms」换成了另一种慢。
 *   对照值由 io 步的整包 `onChanged` 延迟提供。
 * - **M-5 索引键写入成本**：§5.1 方案 1 让每次保存都同批重写索引键，所以热路径写成本
 *   不是 `setSmall` 那一档。id 用真实的 41 字符形态造（`generateId()` = `'uuid-' + UUID`），
 *   分别量「只写索引键」与「条目键 + 索引键一次 set」，用于预检设计稿 §6.4 闸 1（< 20 ms）。
 * - **M-4（Windows 慢磁盘 / 杀软）本机测不了**：这台机器只有 macOS。分键方案的收益与
 *   风险在 Windows 上都会放大，任何 Windows 结论必须由该平台上重跑本脚本得到。
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
 *    审计步的分键夹具写在 `aph_pwd_*`，同样避开真实键；每组测量开头与结尾都 `remove`
 *    一遍（含 `bench_blob`），所以 `usage` 增量归因到本组写入，不会跨组累积。
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
/**
 * 要跑的测量步：`io` 是既有的整包 / 分键成本探针，`audit` 是分键决策审计（M-1/M-3 +
 * 配额常量），`disk` 是 M-2 的磁盘字节账目。默认只跑 `io`，保持既有批次的口径与耗时不变。
 */
const STEPS = String(arg('steps', 'io'))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
for (const step of STEPS) {
  if (!['io', 'audit', 'disk'].includes(step)) {
    log(`未知 --steps 值：${step}（可用：io,audit,disk）`);
    process.exit(1);
  }
}
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

/**
 * 分键（E1/S1）决策性审计：M-1 键数语义 / M-3 单键投递延迟 / M-2 的配额常量与原始字节
 *
 * 与 `runProbe` 一样是「序列化进页面执行」的自包含函数：不能引用 Node 侧闭包，
 * 中位数与计时工具必须自带。夹具沿用 io 步的密文形状（约 500 B/条），
 * 落在 `aph_pwd_*` 键上，测完（含异常路径）一律 `remove`，不碰 `account_passwords`。
 *
 * @param sizes 单一元素数组 [n]，与 `runProbe` 同形状，便于复用 probeOne 的超时保护
 */
async function runShardAudit([sizes]) {
  const prefix = 'aph_pwd_';
  /** 投递延迟探针键：刻意**不**带分片前缀，否则会被 M-1 的落库计数算进分片里 */
  const singleKey = 'bench_single_probe';
  /** 索引键探针：真实提案键名是 `account_passwords_index`（23 B），此处 29 B，被 88 KB 载荷淹没，不影响结论 */
  const indexKey = 'bench_account_passwords_index';
  const out = {};

  const median = vs => {
    const xs = [...vs].sort((a, b) => a - b);
    if (!xs.length) return NaN;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };

  /** 与 io 步同形状的密文条目（字段长度取自真实密文分布），保证两条路径量的是同一种字节 */
  const buildItem = i => ({
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
  });

  /** 配额运行时对象（比引用文档数字更硬：这台 Chrome 对本扩展实际生效的上限） */
  const quota = {
    localTotalBytes: chrome.storage.local.QUOTA_BYTES ?? null,
    localPerItemBytes: chrome.storage.local.QUOTA_BYTES_PER_ITEM ?? null,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    hasUnlimitedStorage: (chrome.runtime.getManifest().permissions || []).includes('unlimitedStorage'),
  };

  /**
   * `navigator.storage.estimate()` 口径（**实测已被证伪，保留只为留下证据**）：
   * 100/1000/2000/5000 四档写入前后 `usage` 增量恒为 0，说明该 API 在本上下文不涵盖
   * `chrome.storage.local`。`chrome.storage.local.getUsage()` 也不存在（Chrome 153），
   * 因此字节账目改由 `--steps disk` 从磁盘侧（leveldb 目录）取。
   */
  const estimate = async () => {
    try {
      const e = await navigator.storage.estimate();
      return { quota: e.quota ?? null, usage: e.usage ?? null };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  };

  /** 单键 `onChanged` 投递延迟：写入值每轮必须不同，否则 Chrome 不派发、Promise 永不 settle */
  const singleKeyLatency = async rounds => {
    await chrome.storage.local.set({ [singleKey]: { id: 'probe', updateTime: 1760000000000 } });
    const latencies = [];
    for (let r = 0; r < rounds; r++) {
      const t = await Promise.race([
        new Promise(resolve => {
          const listener = (changes, area) => {
            if (area !== 'local' || !(singleKey in changes)) return;
            chrome.storage.onChanged.removeListener(listener);
            resolve(performance.now() - start);
          };
          chrome.storage.onChanged.addListener(listener);
          const start = performance.now();
          void chrome.storage.local.set({ [singleKey]: { id: 'probe', updateTime: 1760000000001 + r } });
        }),
        new Promise(resolve => setTimeout(() => resolve(-1), 8000)),
      ]);
      latencies.push(+t.toFixed(1));
    }
    return latencies;
  };

  /**
   * M-5：索引键与「条目键 + 索引键」同批写的成本
   *
   * §5.1 方案 1 要求每次保存都同批改索引键，因此热路径的写成本不是 `setSmall` 的 0.8 ms，
   * 而是「条目键 + 索引键」这一批的实际开销。索引键体积按真实 id 形态造
   * （`generateId()` 产出 `'uuid-' + UUID` = 41 字符），不用短 id —— 短 id 会把 88 KB 量级低估成 20 KB。
   */
  const indexKeyCost = async (n, items, entryKey) => {
    const fakeId = i => {
      const hex = x => (x >>> 0).toString(16).padStart(8, '0');
      const a = hex(i * 2654435761) + hex(i * 40503 + 7) + hex(i * 9781 + 13) + hex(i * 31337 + 29);
      return `uuid-${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-8${a.slice(17, 20)}-${a.slice(20, 32)}`;
    };
    const buildIndex = rev => ({ v: 1, ids: Array.from({ length: n }, (_, i) => fakeId(i)), count: n, rev });
    const time = async rounds => {
      const ts = [];
      for (let r = 0; r < rounds; r++) {
        const t0 = performance.now();
        await chrome.storage.local.set({ [indexKey]: buildIndex(r) });
        ts.push(+(performance.now() - t0).toFixed(1));
      }
      return ts;
    };
    const timePair = async rounds => {
      const ts = [];
      for (let r = 0; r < rounds; r++) {
        const item = { ...items[r % items.length], updateTime: 1760000000000 + r };
        const t0 = performance.now();
        await chrome.storage.local.set({ [entryKey]: item, [indexKey]: buildIndex(r) });
        ts.push(+(performance.now() - t0).toFixed(1));
      }
      return ts;
    };
    const indexOnly = await time(5);
    const withEntry = await timePair(5);
    return {
      idBytes: fakeId(0).length,
      indexBytes: JSON.stringify(buildIndex(0)).length,
      indexOnlySamples: indexOnly,
      indexOnlyMs: +median(indexOnly).toFixed(1),
      withEntrySamples: withEntry,
      withEntryMs: +median(withEntry).toFixed(1),
    };
  };

  for (const n of sizes) {
    const keys = Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, '0')}`);
    const rec = { keys: n };
    const cleanup = async () => {
      try {
        await chrome.storage.local.remove([...keys, singleKey, indexKey, 'bench_blob']);
      } catch {
        /* 清理失败不影响后续判据，M-1 的读回比对会如实反映落库数量 */
      }
    };

    try {
      await cleanup();
      rec.quota = quota;

      // ── M-3（空库对照）：区域里几乎没有键时的单键投递延迟 ──
      rec.m3EmptyVaultMs = await singleKeyLatency(5);

      const items = Array.from({ length: n }, (_, i) => buildItem(i));
      const rawBytes = items.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
      rec.m2 = {
        rawBytes,
        rawBytesPerEntry: Math.round(rawBytes / n),
        keyNameBytes: keys.reduce((sum, k) => sum + k.length, 0),
        quotaBytes: quota.localTotalBytes,
        perItemQuotaBytes: quota.localPerItemBytes,
      };

      // ── M-1：一次 set 写 n 个键，再按键名读回 + 全区域扫描读回比对 ──
      /** 账目基线在 M-3 空库跑完之后取：探针键因此落在基线里，前后差分只反映这批分片 */
      const estBefore = await estimate();
      const setTimes = [];
      let setError = null;
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        try {
          await chrome.storage.local.set(Object.fromEntries(items.map((item, i) => [keys[i], item])));
        } catch (error) {
          setError = String(error?.message ?? error);
        }
        setTimes.push(+(performance.now() - t0).toFixed(1));
        if (setError) break;
      }
      const estAfter = await estimate();
      const tGet = performance.now();
      const byName = await chrome.storage.local.get(keys);
      const getByNameMs = +(performance.now() - tGet).toFixed(1);
      const tNull = performance.now();
      const all = await chrome.storage.local.get(null);
      const getNullMs = +(performance.now() - tNull).toFixed(1);

      /**
       * 两种读回口径都只数**本次写入的键**：扫描式（`get(null)`）必须按期望键集合过滤，
       * 否则区域里任何同名前缀的残留（包括探针自己的键）都会把计数抬到 n+1，
       * 把「全部落地」误判成「部分成功」——那是足以否决分键方案的假阳性。
       */
      const expected = new Set(keys);
      const landedByName = Object.keys(byName).filter(k => expected.has(k)).length;
      const landedByScan = Object.keys(all).filter(k => expected.has(k)).length;
      const missingSample = keys.filter(k => !(k in byName)).slice(0, 5);
      rec.m1 = {
        setSamplesMs: setTimes,
        setMedianMs: +median(setTimes).toFixed(1),
        setError,
        lastError: chrome.runtime.lastError?.message ?? null,
        landedByName,
        landedByScan,
        getByNameMs,
        getNullMs,
        totalKeysInArea: Object.keys(all).length,
        missingSample,
        verdict: setError ? 'rejected' : landedByName === n && landedByScan === n ? 'all-landed' : 'partial',
      };
      rec.m2.estimateBefore = estBefore;
      rec.m2.estimateAfter = estAfter;
      rec.m2.estimateUsageDeltaBytes =
        typeof estBefore.usage === 'number' && typeof estAfter.usage === 'number'
          ? estAfter.usage - estBefore.usage
          : null;

      // ── M-3（分库对照）：区域已有 n 个键时的单键投递延迟 ──
      rec.m3ShardedMs = await singleKeyLatency(5);

      // ── M-5：索引键写入与「条目键 + 索引键」同批写（§5.1 方案 1 的热路径真实成本）──
      rec.m5 = await indexKeyCost(n, items, keys[0]);

      await cleanup();
    } catch (error) {
      rec.failed = String(error?.stack ?? error);
      await cleanup();
    }

    out[`n${n}`] = rec;
  }

  return out;
}

/**
 * 磁盘账目的写盘步（M-2 第一段）：写 n 个分片键并**留在库里**，
 * 由 Node 侧在两次 evaluate 之间快照 leveldb 目录，页面侧只回报写入耗时与 JSON 字节。
 *
 * @param sizes 单一元素数组 [n]
 */
async function runDiskWrite([sizes]) {
  const prefix = 'aph_pwd_';
  const out = {};
  for (const n of sizes) {
    try {
      await chrome.storage.local.remove(['bench_blob']);
      const items = Array.from({ length: n }, (_, i) => ({
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
      const payload = Object.fromEntries(items.map((item, i) => [`${prefix}${String(i).padStart(5, '0')}`, item]));
      const rawBytes = items.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
      const t0 = performance.now();
      await chrome.storage.local.set(payload);
      out[`n${n}`] = {
        setMs: +(performance.now() - t0).toFixed(1),
        rawBytes,
        rawBytesPerEntry: Math.round(rawBytes / n),
      };
    } catch (error) {
      out[`n${n}`] = { failed: String(error?.message ?? error) };
    }
  }
  return out;
}

/**
 * 磁盘账目的清库步（M-2 第二段）：按键名读回确认落库数量，然后删除这批键
 *
 * @param sizes 单一元素数组 [n]
 */
async function runDiskVerify([sizes]) {
  const prefix = 'aph_pwd_';
  const out = {};
  for (const n of sizes) {
    const keys = Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(5, '0')}`);
    try {
      const all = await chrome.storage.local.get(null);
      const landed = keys.filter(k => k in all).length;
      await chrome.storage.local.remove(keys);
      out[`n${n}`] = { landed, keysInAreaAfter: Object.keys(all).length };
    } catch (error) {
      out[`n${n}`] = { failed: String(error?.message ?? error) };
    }
  }
  return out;
}

/** 递归求目录内文件字节总和；目录不存在（还没首次写入）时返回 null */
function dirBytes(dir) {
  if (!dir) return null;
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
      const abs = path.join(dir, entry.name);
      return sum + (entry.isDirectory() ? (dirBytes(abs) ?? 0) : fs.statSync(abs).size);
    }, 0);
  } catch {
    return null;
  }
}

/** 在临时 profile 里定位本扩展的 `Local Extension Settings` 目录（leveldb 落盘处） */
function extStorageDir(userDataDir, extId) {
  for (const entry of fs.readdirSync(userDataDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cand = path.join(userDataDir, entry.name, 'Local Extension Settings', extId);
    if (fs.existsSync(cand)) return cand;
  }
  return null;
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

  const results = { meta: { extId, at: new Date().toISOString(), sizes: SIZES, repeat: REPEAT, steps: STEPS } };
  /**
   * 逐规模单独 evaluate：一次调用跑完 600/2000/5000 × 8 组动作会在大 N 处分键写入
   * 处挂死（实测 5 分钟无输出且看不到进程退出）。拆成「每个 N 一次调用 + 超时保护」后，
   * 已完成的规模照样落盘，卡住的规模记为 `failed` 而不是拖垮整轮。
   */
  const probeOne = async (target, n, probe) => {
    let timer;
    try {
      return await Promise.race([
        target.evaluate(probe, [[n], REPEAT]),
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

    const runAcrossSizes = async (label, target, probe, sink) => {
      for (const n of SIZES) {
        log(`[${label}] N=${n} …`);
        Object.assign(sink, await probeOne(target, n, probe));
      }
    };

    // ── options 页面上下文（真实调用方）──
    if (STEPS.includes('io')) {
      results.options = {};
      await runAcrossSizes('options', page, runProbe, results.options);
    }
    if (STEPS.includes('audit')) {
      results.optionsAudit = {};
      await runAcrossSizes('options-audit', page, runShardAudit, results.optionsAudit);
    }
    /**
     * 磁盘账目（M-2）：写入与清库拆成两次 evaluate，Node 侧在中间快照 leveldb 目录。
     * 每次快照前等 600 ms，让预写日志落盘；`before` 含上一档留下的墓碑与已合并数据，
     * 因此采信 `during - before`（本档新增字节）而不是 `during` 绝对值。
     */
    if (STEPS.includes('disk')) {
      results.disk = {};
      for (const n of SIZES) {
        const before = dirBytes(extStorageDir(userDataDir, extId));
        const write = await probeOne(page, n, runDiskWrite);
        await page.waitForTimeout(600);
        const during = dirBytes(extStorageDir(userDataDir, extId));
        const verify = await probeOne(page, n, runDiskVerify);
        await page.waitForTimeout(600);
        const after = dirBytes(extStorageDir(userDataDir, extId));
        results.disk[`n${n}`] = {
          dirBytesBefore: before,
          dirBytesAfterWrite: during,
          dirBytesAfterRemove: after,
          ...write[`n${n}`],
          ...verify[`n${n}`],
        };
        log(`[disk] N=${n} 目录字节 ${before} → ${during} → ${after}`);
      }
    }
    results.options = { ...(results.options ?? {}), __ua: await page.evaluate(() => navigator.userAgent) };

    // ── Service Worker 上下文（纯 IO，无渲染干扰）──
    const workers = context.serviceWorkers();
    if (!workers.length) {
      results.sw = { skipped: '未捕获到 service worker，仅页面上下文数据可用' };
    } else {
      if (STEPS.includes('io')) {
        results.sw = {};
        await runAcrossSizes('sw', workers[0], runProbe, results.sw);
      }
      if (STEPS.includes('audit')) {
        results.swAudit = {};
        await runAcrossSizes('sw-audit', workers[0], runShardAudit, results.swAudit);
      }
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const file = new URL(`./results/storage-io-${LABEL}.json`, import.meta.url);
  fs.writeFileSync(file, JSON.stringify({ ...results, sizes: SIZES, repeat: REPEAT }, null, 2));
  log(`\n已写入 ${file.pathname}`);

  for (const ctx of STEPS.includes('io') ? ['sw', 'options'] : []) {
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

  /**
   * 审计摘要：一行一个规模，`M-1` 的 verdict 直接给结论，`partial` 即否决分键
   */
  for (const ctx of ['swAudit', 'optionsAudit']) {
    const r = results[ctx];
    if (!r) continue;
    log(`\n[${ctx}]  M-1 键数语义 / M-2 配额账目 / M-3 单键 onChanged 投递延迟，单位 ms`);
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
      const m1 = x.m1 ?? {};
      const m2 = x.m2 ?? {};
      log(
        `  N=${String(n).padStart(5)} M-1 ${m1.verdict} 落地 ${m1.landedByName}/${n}（扫描 ${m1.landedByScan}，` +
          `区域内总键数 ${m1.totalKeysInArea}） set=${m1.setMedianMs}ms 读回 byName=${m1.getByNameMs} null=${m1.getNullMs}` +
          `${m1.setError ? ` 错误=${m1.setError}` : ''}`,
      );
      log(
        `             M-2 原始 ${m2.rawBytesPerEntry}B/条 键名 ${((m2.keyNameBytes ?? 0) / n).toFixed(1)}B/条 ` +
          `配额 ${m2.quotaBytes}B（单条上限 ${m2.perItemQuotaBytes}）；estimate 口径增量 ${m2.estimateUsageDeltaBytes}B` +
          `（恒 0＝该 API 不涵盖 chrome.storage，磁盘账目见 [disk] 段）`,
      );
      log(
        `             M-3 单键投递 中位数 空库=${median(x.m3EmptyVaultMs)} / 分库=${median(x.m3ShardedMs)} ` +
          `原始 ${JSON.stringify(x.m3EmptyVaultMs ?? [])} / ${JSON.stringify(x.m3ShardedMs ?? [])}`,
      );
      const m5 = x.m5 ?? {};
      log(
        `             M-5 索引键 ${m5.indexBytes}B（id ${m5.idBytes}B×${n}）单独写 中位数=${m5.indexOnlyMs} / ` +
          `与条目键同批写=${m5.withEntryMs} 原始 ${JSON.stringify(m5.indexOnlySamples ?? [])} / ${JSON.stringify(m5.withEntrySamples ?? [])}`,
      );
    }
  }

  if (results.disk) {
    log('\n[disk]  M-2 字节账目：扩展 Local Extension Settings 目录（leveldb）字节总和的三处快照');
    for (const n of SIZES) {
      const x = results.disk[`n${n}`];
      if (!x) continue;
      if (x.failed) {
        log(`  N=${String(n).padStart(5)} 未完成：${x.failed}`);
        continue;
      }
      const grew =
        typeof x.dirBytesBefore === 'number' && typeof x.dirBytesAfterWrite === 'number'
          ? x.dirBytesAfterWrite - x.dirBytesBefore
          : null;
      log(
        `  N=${String(n).padStart(5)} JSON ${x.rawBytesPerEntry}B/条 磁盘增量 ${grew}B=${(grew / n).toFixed(1)}B/条 ` +
          `清理后残留增长 ${typeof x.dirBytesBefore === 'number' && typeof x.dirBytesAfterRemove === 'number' ? x.dirBytesAfterRemove - x.dirBytesBefore : 'n/a'}B ` +
          `落库 ${x.landed}/${n} set=${x.setMs}ms`,
      );
    }
  }
}

main().catch(err => {
  log(`失败：${err?.stack ?? err}`);
  process.exitCode = 1;
});
