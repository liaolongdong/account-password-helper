#!/usr/bin/env node
/**
 * 管理页大 Vault 渲染性能测量脚本（真机 + 真实构建产物，非单测、非复刻探针）
 *
 * 为什么需要它：AGENTS.md 要求性能结论给出「同一方法获得的前后数据」。
 * 管理页的卡顿在渲染层（真实 el-table + Vue patch + 样式与布局），
 * jsdom 量不出布局、复刻探针只能证明机制——两者都无法证明「改的是真代码」。
 * 本脚本驱动 e2e 同款 Chrome for Testing 加载 `.output/chrome-mv3`，
 * 在真实 options.html 上按场景测量。
 *
 * 每个场景同时产出三类信号，全部按「同一次交互的增量」结算：
 *   wall         交互开始 → 该场景的完成条件满足（对话框可见 / 行数变化 / …）
 *   longtask*    交互窗口内主线程长任务条数与超出 50ms 的部分（阻塞感直接口径）
 *   Layout/RecalcStyle/Script（CDP Performance 域，秒）—— 与 Node 往返无关，最稳
 *
 * 数据是合成的，且只在临时 profile 里以「全明文直通」形态存在
 * （`utils/storage/passwordCrud.ts` 里 `hasEncryptedEntries === false` 分支），
 * 目的是把解密成本从测量里剥掉、只留渲染层。profile 用完即删，不落任何真实凭据。
 *
 * 用法：
 *   pnpm build
 *   export E2E_EXECUTABLE_PATH="/tmp/cft/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
 *   node benchmarks/measure-options-perf.mjs --rows 600 --repeat 3 --label before
 *   node benchmarks/measure-options-perf.mjs --rows 600 --repeat 3 --label after --only addClick,tagHover
 *
 *   首屏口径（渐进渲染的 A/B）：`mount` 一次采两个时间——`firstPaintMs`（第 15 行进 DOM）
 *   与 `wallMs`（当前页铺满，见 `--page-cap`），外加 `maxLongMs`（单个最长任务）。窗口化只应该
 *   动这两个首屏口径与最长任务，不该动总耗时，因此两者必须同时看。
 *   node benchmarks/measure-options-perf.mjs --rows 600 --repeat 5 --only mount --label window
 *   渐进放开靠 requestAnimationFrame：实测无头（HeadlessChrome 153，新无头实现）同样会派发 rAF
 *   ——60 行与 600 行两次窗口化跑批都在无头下把全部行放开了。无头可作为 A/B 口径，
 *   但要复现"用户实际看到的那一屏"仍建议 E2E_HEADLESS=0 再跑一遍。
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const EXTENSION_PATH = process.env.E2E_EXT ?? path.join(REPO, '.output/chrome-mv3');
const PASSWORDS_KEY = 'account_passwords';
/** 仅存在于临时测试 profile，不涉及任何真实凭据 */
const TEST_MASTER_PASSWORD = 'Aph-perf-fixture-2026';
/** 交互完成后额外留出的渲染落地时间（ms），两批测量保持一致 */
const SETTLE_MS = Number(process.env.PERF_SETTLE ?? 400);
/** 600 行首屏在慢机器上会明显超时，导航类等待统一放宽到 3 分钟 */
const MOUNT_TIMEOUT_MS = Number(process.env.PERF_MOUNT_TIMEOUT ?? 180_000);
/** 主线程静默判据：连续多久没有新的长任务即认为页面不再忙 */
const QUIESCE_MS = Number(process.env.PERF_QUIESCE ?? 700);
/**
 * 单次交互的完成条件等待上限。
 *
 * 600 行实测：保存一条要 23s、对话框关闭偶发超过 30s，`until` 一旦超时整个样本作废，
 * 而"完成得慢"本身就是要测的量，不该被当成测量失败。默认放宽到 90s。
 */
const ACTION_TIMEOUT_MS = Number(process.env.PERF_ACTION_TIMEOUT ?? 90_000);
/** 等待静默的上限，避免异常场景把整批测量吊死 */
const QUIESCE_TIMEOUT_MS = Number(process.env.PERF_QUIESCE_TIMEOUT ?? 120_000);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ROWS = Number(arg('rows', 600));
const REPEAT = Number(arg('repeat', 3));
const LABEL = arg('label', 'run');
const ONLY = String(arg('only', '')).split(',').filter(Boolean);
/**
 * 首屏行数判据：窗口化渐进渲染（P2）之后，「整表铺开完成」不再是用户感知的首屏时间——
 * 首屏口径是「看得见的那一屏进 DOM」，全量口径保留下来用于证明总耗时没有被拉长。
 * 两个口径必须在同一批测量里一起采，否则换定义会被读成"变快了"。
 */
const PAINT_ROWS = Math.min(Number(arg('first-paint-rows', 15)), ROWS);
/**
 * 每页上限（管理页分页落地后的口径修正）
 *
 * 分页之后「整表进 DOM」这个条件永远等不到——`el-table` 每轮只拿一页，
 * 等全量会把 `wallMs` 变成一次 180 秒超时而不是一个读数。因此全量口径改为
 * **「当前页铺满」**：`MOUNT_ROWS = min(ROWS, PAGE_CAP)`。
 *
 * 默认取 `useVaultListPagination.ts` 的 `DEFAULT_PAGE_SIZE`（100）。要复现分页前的
 * 整表口径做同机对照，把它抬到不小于 `--rows` 即可（`--page-cap 600`），
 * 此时 `MOUNT_ROWS == ROWS`，判据退回旧定义。
 *
 * 首屏口径（`PAINT_ROWS` = 第 15 行进 DOM）不受分页影响，前后两批数据可直接对比。
 */
const PAGE_CAP = Number(arg('page-cap', 100));
const MOUNT_ROWS = Math.min(ROWS, PAGE_CAP);
/**
 * 关掉每行的站点图标（`url` 置空，`SiteFavicon` 直接走降级插槽）。
 *
 * 用途是 A/B 归因：`_favicon` 端点会为不存在的 `.test` 域名发起真实抓取并逐条回报失败，
 * 600 个 `<img>` 的加载/失败/`@error` 反应式写入会不会吃掉主线程，只能靠同机同口径对比排除。
 * 若这一项占了大头，说明基线被夹具产物污染，结论要重做。
 */
const NO_FAVICON = process.argv.includes('--no-favicon');
/**
 * 每个样本前重开页面做隔离。
 *
 * 为什么需要：一次交互留下的工作常排在几秒后的独立任务里（收藏点击后的重绘、健康报告、
 * 空闲预热…），静默判据只能保证「当下不忙」，挡不住它污染下一个场景。
 * 实测同一份产物、同样的「收藏」点击，在「刚跑完 26s 首屏」和「单独跑」两种前置状态下
 * 分别得到 36s 与 22s 的阻塞——差的就是这份串扰。加了 --fresh 之后各场景才互相独立。
 */
const FRESH = process.argv.includes('--fresh');
/** 额外为这些场景采一份 CPU profile（self time Top-N），如 --profile save,favorite */
const PROFILE = String(arg('profile', '')).split(',').filter(Boolean);
/** 当前正在采样的场景名，仅用于 PERF_DUMP_PROFILE 的落盘文件名 */
let PROFILE_TARGET = 'run';

const log = (...parts) => process.stderr.write(`${parts.join(' ')}\n`);
const median = vs => {
  const xs = [...vs].sort((a, b) => a - b);
  if (!xs.length) return NaN;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
};
const round = (v, p = 3) => (Number.isFinite(v) ? Number(v.toFixed(p)) : v);

/** 合成条目：用户名 / 网址 / 标签全部可预测，不含真实凭据 */
function buildFixture(count, { noFavicon = false } = {}) {
  const now = Date.now();
  const TAGS = ['工作', '个人', 'banking', 'dev', 'travel'];
  return Array.from({ length: count }, (_, i) => {
    const n = String(i).padStart(4, '0');
    const tagCount = i % 4 === 0 ? 3 : i % 3 === 0 ? 2 : 1;
    const tag = Array.from({ length: tagCount }, (_, k) => TAGS[(i + k) % TAGS.length]).join(',');
    return {
      id: `perf-${n}`,
      username: `perf-user-${n}`,
      password: `Perf#${n}example`,
      url: noFavicon ? '' : `perf-site-${n}.test`,
      tag,
      remark: `合成压测条目 ${n}，用于渲染层测量`,
      totp: i % 5 === 0 ? 'JBSWY3DPEHPK3PXP' : '',
      favorite: i % 7 === 0,
      createTime: now - i * 60_000,
      updateTime: now - i * 60_000,
      showPassword: false,
    };
  });
}

async function launch() {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`扩展产物不存在：${EXTENSION_PATH}（先 pnpm build）`);
  }
  const executablePath = process.env.E2E_EXECUTABLE_PATH;
  if (!executablePath) {
    throw new Error(
      '需要 E2E_EXECUTABLE_PATH 指向 Chromium 系构建（品牌版 Chrome ≥135 忽略 --load-extension），命令见 e2e/README.md',
    );
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-perf-profile-'));
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
  return { context, userDataDir };
}

/**
 * 长任务采集用 addInitScript 注册：reload / 导航后自动重装。
 *
 * 若只在当前文档里 evaluate 安装，mount 场景的 reload 会把探针清掉，
 * 后续场景直接 `window.__longHere is not a function` 全废。
 */
const LONG_TASK_INIT = () => {
  const w = window;
  w.__long = [];
  w.__from = 0;
  w.__observer?.disconnect();
  // longtask 条目是延迟上报的：只按数组清空会把上一个场景的任务算进本场景
  // （实测出现过"阻塞时长之和 > 测量窗口"的不可能值），因此连 startTime 一起存，
  // 每次测量前把 __from 推到当前时刻，结算时只取窗口内开始的任务。
  w.__observer = new PerformanceObserver(list => {
    for (const e of list.getEntries()) w.__long.push({ d: e.duration, s: e.startTime });
  });
  w.__observer.observe({ entryTypes: ['longtask'] });
  w.__longHere = () => w.__long.filter(x => x.s >= w.__from).map(x => x.d);

  /**
   * DOM 流失（churn）探针：区分「就地 patch」与「整棵子树卸载重建」。
   *
   * 净节点增量（`nodes`）看不出这两种情况——600 行整表重建的净变化接近 0，
   * 但 Vue 侧要为每个被摘掉的组件实例跑一遍 effect/scope 拆除循环，
   * 实测那是 save / favorite 自身时间的一半（压缩名 Ps）。
   * 这里同时统计「移除的元素数 / 含后代的总节点数」，并给首行打标记：
   * 标记在动作后消失 = 行组件被换过，而不是被就地更新。
   */
  const subtreeSize = el => {
    let n = 1;
    const stack = [el];
    while (stack.length) {
      const cur = stack.pop();
      for (const child of cur.children) {
        n++;
        stack.push(child);
      }
    }
    return n;
  };
  w.__churn = { add: 0, rem: 0, addNodes: 0, remNodes: 0, pending: 0 };
  w.__churnOn = false;
  const consumeRecords = list => {
    for (const m of list) {
      for (const n of m.addedNodes) if (n.nodeType === 1) (w.__churn.add++, (w.__churn.addNodes += subtreeSize(n)));
      for (const n of m.removedNodes) if (n.nodeType === 1) (w.__churn.rem++, (w.__churn.remNodes += subtreeSize(n)));
    }
  };
  w.__observer2?.disconnect();
  w.__observer2 = new MutationObserver(list => {
    if (w.__churnOn) consumeRecords(list);
  });
  w.__churnStart = () => {
    w.__churn = { add: 0, rem: 0, addNodes: 0, remNodes: 0, pending: 0 };
    const firstRow = document.querySelector('.el-table__body-wrapper .el-table__row');
    if (firstRow) firstRow.dataset.perfMark = '1';
    w.__churnOn = true;
  };
  w.__churnStop = () => {
    // 观察器回调是微任务，末批变更记录可能还没投递；先 takeRecords 兜底，
    // 否则"刚发生完就结算"会稳定读到 0（这个坑实测让 churn 全场景为 0）。
    const pending = w.__observer2.takeRecords();
    if (w.__churnOn) consumeRecords(pending);
    w.__churnOn = false;
    return {
      ...w.__churn,
      pending: pending.length,
      rowMarkSurvived: !!document.querySelector('[data-perf-mark]'),
    };
  };
};

const CDP_COUNTERS = [
  'LayoutDuration',
  'RecalcStyleDuration',
  'ScriptDuration',
  'TaskDuration',
  /**
   * 绘制与提交。
   *
   * 必须单独采：600 行实测 favorite 一次的主线程 TaskDuration 约 39s，而
   * Script+Layout+RecalcStyle 合计不到 0.5s——差值几乎全在绘制上。
   * 少了这两个计数器，会把「大表重绘」误读成「JS 慢」，改错地方。
   */
  'PaintDuration',
  'CommitDuration',
  'LayoutCount',
  'RecalcStyleCount',
  'JSEventListeners',
];

/**
 * 由加载路径推导 packed-app 扩展 ID：`--load-extension` 的 ID 是
 * 「绝对路径 sha256 前 32 个 hex 位，0-f 映射到 a-p」。
 *
 * 为什么自己算而不等 service worker：无头模式下 SW 目标出现与否取决于扩展首次被"使用"的时机，
 * 实测同一份产物 `waitForEvent('serviceworker')` 会在 30s/90s 上时灵时不灵，
 * 而 ID 是纯函数、不会失败——脚本只拿它拼 options.html 的 URL。
 */
function packagedIdFromPath(absPath) {
  const hex = createHash('sha256').update(absPath).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

async function readCounters(client) {
  const { metrics } = await client.send('Performance.getMetrics');
  const out = {};
  for (const m of metrics) {
    if (CDP_COUNTERS.includes(m.name)) out[m.name] = m.value;
  }
  return out;
}

/**
 * 统一测量原语：清长任务 → 记录基线（CDP 计数器 + 页面内活节点数）→ 执行动作 →
 * 等完成条件 → 落地 → 取增量
 *
 * wall 含 Node 往返，因此只作辅助；跨批次可比的主口径是 CDP 增量与长任务。
 * 节点数刻意不用 CDP 的 `Nodes`：它按快照统计、会包含 detached 节点，实测与
 * `document.getElementsByTagName('*').length` 差 3～7 倍，用它会把"整表重建"读成噪声。
 */
async function measure(page, client, action, until) {
  const before = await readCounters(client);
  const nodesBefore = await pageCount(page);
  const resBefore = await resourceCount(page);
  await page.evaluate(() => {
    window.__from = performance.now();
  });
  await page.evaluate(() => window.__churnStart());
  const t0 = Date.now();
  await action();
  let wallMs = Date.now() - t0;
  if (until) {
    await until();
    wallMs = Date.now() - t0;
  }
  await page.waitForTimeout(SETTLE_MS);
  const quietMs = (await quiesce(page)) + SETTLE_MS;
  const after = await readCounters(client);
  const longs = await page.evaluate(() => window.__longHere());
  const churn = await page.evaluate(() => window.__churnStop());
  const delta = key => (after[key] ?? 0) - (before[key] ?? 0);
  return {
    churn,
    quietMs,
    wallMs,
    blockingMs: round(
      longs.reduce((a, dur) => a + Math.max(0, dur - 50), 0),
      1,
    ),
    longtasks: longs.filter(d => d > 50).length,
    layoutS: round(delta('LayoutDuration')),
    styleS: round(delta('RecalcStyleDuration')),
    scriptS: round(delta('ScriptDuration')),
    paintS: round(delta('PaintDuration')),
    commitS: round(delta('CommitDuration')),
    taskS: round(delta('TaskDuration')),
    layoutCount: delta('LayoutCount'),
    styleCount: delta('RecalcStyleCount'),
    nodes: (await pageCount(page)) - nodesBefore,
    reqs: (await resourceCount(page)) - resBefore,
  };
}

/** 页面内活元素数（不含 detached），用于区分"整表重建"与"就地更新" */
async function pageCount(page) {
  return page.evaluate(() => document.getElementsByTagName('*').length);
}

/** 页面内已记录的子资源请求数（`_favicon`、图片等），用于判断主线程时间是否伴随网络活动 */
async function resourceCount(page) {
  return page.evaluate(() => performance.getEntriesByType('resource').length);
}

/**
 * 等到主线程静默：连续 QUIESCE_MS 没有新的长任务即结束。
 *
 * 为什么必须有这一步：长任务的 `duration` 是在它**结束上报时**才知道的，
 * 而交互的后续工作常被排到几秒后的独立任务里。实测 600 行「收藏」点击后
 * 约 2 秒才起一个持续 ~20s 的任务，而当时的窗口只跑到 2.3s 就去读计数器——
 * 于是出现「blocking=20s 但 layout+style+script 只有 0.2s」这种自相矛盾的读数。
 * 等到静默之后，长任务之和与 CDP 计数器才落在同一个区间里，两个口径才可比。
 *
 * 期间 `page.evaluate` 本身要排队等主线程，所以轮询天然会跟随阻塞一起等待。
 */
async function quiesce(page) {
  const t0 = Date.now();
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() - t0 < QUIESCE_TIMEOUT_MS) {
    const count = await page.evaluate(() => window.__long.length);
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= QUIESCE_MS) {
      return Date.now() - t0;
    }
    await page.waitForTimeout(150);
  }
  return Date.now() - t0;
}

/**
 * 崩溃恢复：600 行实测出现过「reload 超时 → 之后所有场景 Not attached to an active page」，
 * 说明渲染进程已经没了。这里用一次极轻的 evaluate 探测活性，并在页面已死时重建
 * page + CDP session——数据在 chrome.storage.local 里，重建后直接 goto 就能回到同一状态，
 * 因此单个场景把渲染进程搞崩不会连带废掉整批测量。
 */
async function alive(page) {
  try {
    await page.evaluate(() => 1);
    return true;
  } catch {
    return false;
  }
}

const PROFILE_BUCKET_COUNT = 14;

/**
 * 把一段交互的 CPU profile 归因成「自身占比 Top-N 函数桶」
 *
 * 长任务与布局/样式增量只说"卡了多少"，不说"卡在谁身上"。改代码前要能点名，
 * 因此按 self time 聚合（total time 会把 main / 守卫这类外层框架算成瓶颈）。
 * approxMs 用「样本占比 × profile 采样跨度」估算，只用于排序与量级判断。
 */
async function profileWindow(client, run) {
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 100 });
  await client.send('Profiler.start');
  const wallMs = await run();
  return finishProfile(client, wallMs);
}

/**
 * 停止采样并按 self time 归因（从 profileWindow 抽出，供 mount 的导航口径复用同一套结算）
 *
 * PERF_DUMP_PROFILE=1 时另存原始 `.cpuprofile`：self time Top-N 只能点名"哪个函数忙"，
 * 回答不了"是谁在按行调它"（压缩后的 i18n 内部函数尤其如此）。原始文件既能离线走父链
 * 聚合，也能直接丢进 DevTools Performance 面板看火焰图，避免为同一个问题反复重跑
 * 一次 20 秒的真机采样。
 */
async function finishProfile(client, wallMs) {
  const { profile } = await client.send('Profiler.stop');
  if (process.env.PERF_DUMP_PROFILE) {
    const dir = path.join(REPO, 'benchmarks', 'results');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `profile-${LABEL}-${PROFILE_TARGET}.cpuprofile`);
    fs.writeFileSync(file, JSON.stringify(profile));
    log(`    原始 profile → ${file}`);
  }
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const samples = profile.samples.length || 1;
  for (const id of profile.samples) {
    const node = byId.get(id);
    if (!node) continue;
    const cf = node.callFrame;
    const file = (cf.url || '').replace(/^chrome-extension:\/\/[^/]+\//, '').split('?')[0];
    const name = `${cf.functionName || '(anonymous)'} @ ${file}:${cf.lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + 1);
  }
  const spanMs = Math.max(0, (profile.endTime - profile.startTime) / 1000);
  return {
    wallMs,
    profileSpanMs: round(spanMs, 1),
    samples,
    top: [...self.entries()]
      .map(([name, count]) => {
        const share = count / samples;
        return { name, share: round(share, 3), approxMs: round(share * spanMs, 1) };
      })
      .sort((a, b) => b.share - a.share)
      .slice(0, PROFILE_BUCKET_COUNT),
  };
}

/** 把一次批量交互（如连击 4 键）折算成单事件口径；长任务条数不做除法 */
function divideSample(sample, divide) {
  if (!divide || divide === 1) return sample;
  const scaled = { ...sample };
  for (const key of [
    'wallMs',
    'quietMs',
    'blockingMs',
    'layoutS',
    'styleS',
    'scriptS',
    'paintS',
    'commitS',
    'taskS',
    'layoutCount',
    'styleCount',
    'nodes',
    'reqs',
  ]) {
    scaled[key] = round(sample[key] / divide, key === 'nodes' ? 0 : key.endsWith('Ms') ? 1 : 3);
  }
  return scaled;
}

function summarize(name, samples) {
  const num = k => {
    // 交互类样本没有首屏/最长任务口径，缺失时如实给 null，不当成 0 参与对比
    if (!samples.some(s => Number.isFinite(s[k]))) return null;
    return round(median(samples.map(s => s[k])), k === 'nodes' || k === 'longtasks' ? 0 : k.endsWith('Ms') ? 1 : 3);
  };
  return {
    wallMs: num('wallMs'),
    firstPaintMs: num('firstPaintMs'),
    maxLongMs: num('maxLongMs'),
    quietMs: num('quietMs'),
    blockingMs: num('blockingMs'),
    longtasks: num('longtasks'),
    layoutS: num('layoutS'),
    styleS: num('styleS'),
    scriptS: num('scriptS'),
    paintS: num('paintS'),
    commitS: num('commitS'),
    taskS: num('taskS'),
    layoutCount: num('layoutCount'),
    styleCount: num('styleCount'),
    nodes: num('nodes'),
    reqs: num('reqs'),
    churn: {
      remElements: round(median(samples.map(x => x.churn?.rem ?? 0)), 0),
      remNodes: round(median(samples.map(x => x.churn?.remNodes ?? 0)), 0),
      addElements: round(median(samples.map(x => x.churn?.add ?? 0)), 0),
      addNodes: round(median(samples.map(x => x.churn?.addNodes ?? 0)), 0),
      rowReplaced: samples.filter(x => x.churn && !x.churn.rowMarkSurvived).length,
    },
    churnSamples: samples.map(x => x.churn ?? null),
    wallSamples: samples.map(s => round(s.wallMs, 1)),
    blockingSamples: samples.map(s => round(s.blockingMs, 1)),
  };
}

const ROW_COUNT_FN = n => document.querySelectorAll('.el-table__body-wrapper .el-table__row').length >= n;
const DIALOG_OPEN = () =>
  [...document.querySelectorAll('.el-dialog')].some(d => d.offsetParent !== null && d.querySelector('input'));
const DIALOG_CLOSED = () => ![...document.querySelectorAll('.el-dialog')].some(d => d.offsetParent !== null);

async function main() {
  const { context, userDataDir } = await launch();
  // 动作超时对齐 `PERF_ACTION_TIMEOUT`：600 行页面在主线程被整机负载挤压时，一次重排可让
  // Playwright 的「元素稳定」判定超过其 30s 默认值，击键/悬浮类样本会直接作废（实测两侧都触发）。
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  const out = {};
  try {
    const extensionId = packagedIdFromPath(EXTENSION_PATH);
    log(`扩展 ID ${extensionId}`);

    // 可变而非 const：渲染进程崩掉时 recover() 会换掉 page / client / 三个 locator。
    // ACTIONS 里的闭包读的是变量本身，因此重建后各场景自动指向新页面。
    let page = await context.newPage();
    let client = null;
    let rows = null;
    let tags = null;
    let searchBox = null;
    /** pageFlip 用：点击前首行的文本，作为「这一页真的换掉了」的判据 */
    let flippedFrom = '';

    /** 打开 options.html 并重建该页绑定的 CDP session 与 locator 集合 */
    const openManagedPage = async () => {
      page = await context.newPage();
      await page.addInitScript(LONG_TASK_INIT);
      // 600 行文档首次加载本身就要几十秒，goto 的 30s 默认值会先于此把导航判死
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
        timeout: MOUNT_TIMEOUT_MS,
      });
      await page.waitForSelector('.header-actions', { timeout: MOUNT_TIMEOUT_MS });
      await page.waitForFunction(ROW_COUNT_FN, MOUNT_ROWS, { timeout: MOUNT_TIMEOUT_MS });
      client = await context.newCDPSession(page);
      await client.send('Performance.enable');
      rows = page.locator('.el-table__body-wrapper .el-table__row');
      tags = page.locator('.el-table__body-wrapper .el-tag.tag-item');
      searchBox = page.locator('.filters input').first();
    };

    await page.addInitScript(LONG_TASK_INIT);
    await page.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: 'domcontentloaded',
      timeout: MOUNT_TIMEOUT_MS,
    });
    // 扩展页首次渲染需要 SW 起来；空列表/ERR_BLOCKED 说明包没被加载，给一条明确错误
    await page
      .waitForSelector('.el-button--primary:visible, .setup-page, .verify-page', { timeout: 45_000 })
      .catch(() => {
        throw new Error(
          `options.html 未渲染（扩展 ID ${extensionId}）——确认 ${EXTENSION_PATH} 是 pnpm build 产物、且用的是 Chromium 系构建`,
        );
      });

    // 全新 profile 停在「设置主密码」：两个密码框 + 主按钮。
    // 提交按钮必须从可见的登录/设置卡片里取——页面同时挂着多个隐藏的 primary 按钮（对话框未打开时也在 DOM 里），
    // 不加 :visible 会命中其中一个，表现为 30s 点击超时。
    const pwdFields = page.locator('input[type="password"]:visible');
    await pwdFields.first().waitFor({ state: 'visible', timeout: 30_000 });
    if ((await pwdFields.count()) >= 2) {
      await pwdFields.nth(0).fill(TEST_MASTER_PASSWORD);
      await pwdFields.nth(1).fill(TEST_MASTER_PASSWORD);
    } else {
      await pwdFields.first().fill(TEST_MASTER_PASSWORD);
    }
    await page.locator('.el-button--primary:visible').last().click();
    await page.waitForSelector('.header-actions', { timeout: MOUNT_TIMEOUT_MS });

    await page.evaluate(
      async ({ key, entries }) => {
        await chrome.storage.local.set({ [key]: entries });
      },
      { key: PASSWORDS_KEY, entries: buildFixture(ROWS, { noFavicon: NO_FAVICON }) },
    );
    await page.close().catch(() => {});
    await openManagedPage();

    log(`行数=${ROWS} 重复=${REPEAT} 标签=${LABEL} settle=${SETTLE_MS}ms`);

    /**
     * 首屏结构探针：只回答"这些 DOM 到底存不存在"，不参与前后对比。
     *
     * 存在两个必须用真机否证的假设：
     * 1) el-tooltip 的 `persistent`（element-plus/es/components/tooltip/src/content.mjs
     *    里是 `persistent: Boolean`、无 default，按 Vue 的布尔缺省规则取 false）
     *    若不成立，600 行 × 每行 5 个操作按钮会挂出约 3000 个隐藏 popper；
     * 2) 首屏成本落在 DOM 节点数上还是 Vue 组件实例数上——前者指向虚拟滚动，
     *    后者只要减少每行的组件实例就能解决。
     */
    out.__probe = await page.evaluate(() => ({
      domNodes: document.getElementsByTagName('*').length,
      poppers: document.querySelectorAll('.el-popper').length,
      tooltipsTriggered: document.querySelectorAll('[aria-describedby]').length,
      tableRows: document.querySelectorAll('.el-table__body-wrapper .el-table__row').length,
      /** el-table v1 的 fixed 列会另起一份 tbody：这一项若非 0，绘制成本按行数翻倍算 */
      allRows: document.querySelectorAll('.el-table__row').length,
      fixedRightRows: document.querySelectorAll('.el-table__fixed-right .el-table__row').length,
      fixedLeftRows: document.querySelectorAll('.el-table__fixed-left .el-table__row').length,
      tableCells: document.querySelectorAll('.el-table__body-wrapper td').length,
      tags: document.querySelectorAll('.el-tag').length,
      buttons: document.querySelectorAll('.el-button').length,
      inputsWithValue: [...document.querySelectorAll('input')].filter(i => i.value).length,
    }));
    log(`  probe: ${JSON.stringify(out.__probe)}`);

    /**
     * 场景表：trigger 只负责"发起这一次交互"，until 定义"这一交互算完成"，
     * restore 把页面恢复到可重复测量的初态。
     *
     * 测量与 CPU Profile 共用同一份定义，保证"归因到的就是量到的那次交互"。
     * divide 用于把一次批量交互（如连击 4 键）折算成单事件口径。
     */
    const ACTIONS = {
      addClick: {
        guard: () => page.waitForFunction(DIALOG_CLOSED, undefined, { timeout: ACTION_TIMEOUT_MS }),
        trigger: () => page.locator('.header-actions .el-button').first().click(),
        until: () => page.waitForFunction(DIALOG_OPEN, undefined, { timeout: ACTION_TIMEOUT_MS }),
        restore: async () => {
          await page.keyboard.press('Escape');
          await page.waitForFunction(DIALOG_CLOSED, undefined, { timeout: ACTION_TIMEOUT_MS }).catch(() => {});
        },
      },
      tagHover: {
        trigger: async i => {
          const target = tags.nth(i * 3);
          await target.waitFor({ state: 'visible', timeout: 10_000 });
          await target.hover({ force: true });
        },
        until: () => page.waitForTimeout(500),
        restore: async () => {
          await page.mouse.move(4, 4);
          await page.waitForTimeout(150);
        },
      },
      rowHover: {
        trigger: async i => {
          const target = rows.nth(i * 5 + 1);
          await target.waitFor({ state: 'visible', timeout: 10_000 });
          await target.hover({ force: true });
        },
        until: () => page.waitForTimeout(500),
        restore: async () => {
          await page.mouse.move(4, 4);
          await page.waitForTimeout(150);
        },
      },
      // 连击 4 键、每键间隔 90ms：整体刻意短于 200ms 防抖窗口，
      // 以便把「即时高亮 patch」与「延后一步的过滤重排」分开计量
      keystroke: {
        guard: async () => {
          await searchBox.click();
          await searchBox.fill('');
          await page.waitForTimeout(400);
        },
        trigger: async () => {
          for (const ch of 'perf') {
            await searchBox.press(ch);
            await page.waitForTimeout(90);
          }
        },
        until: () => page.waitForTimeout(120),
        divide: 4,
        restore: async () => {
          await searchBox.fill('');
          await page.waitForTimeout(400);
        },
      },
      favorite: {
        trigger: () => rows.nth(11).locator('.operation-buttons .el-button').nth(3).click({ force: true }),
        until: () => page.waitForTimeout(1500),
      },
      save: {
        guard: async () => {
          await searchBox.fill('');
          await page.waitForTimeout(400);
          await page.waitForFunction(DIALOG_CLOSED, undefined, { timeout: ACTION_TIMEOUT_MS });
        },
        trigger: async i => {
          await page.locator('.header-actions .el-button').first().click();
          await page.waitForFunction(DIALOG_OPEN, undefined, { timeout: ACTION_TIMEOUT_MS });
          // 按表单顺序取输入框（0=用户名、1=密码），避免依赖随语言与插值变化的 placeholder 文案
          const dlg = page.locator('.el-dialog:visible').last();
          await dlg.locator('input').nth(0).fill(`perf-save-${i}`);
          await dlg.locator('input').nth(1).fill('Perf#save-example');
          await dlg.locator('.el-button--primary').last().click();
        },
        until: async () => {
          await page.waitForFunction(DIALOG_CLOSED, undefined, { timeout: ACTION_TIMEOUT_MS });
          await page.waitForTimeout(1500);
        },
      },
      scroll: {
        trigger: () =>
          page.evaluate(() => {
            const el =
              document.querySelector('.el-table__body-wrapper .el-scrollbar__wrap') ??
              document.querySelector('.el-table__body-wrapper');
            if (el) el.scrollTop += 700;
          }),
      },
      /**
       * 翻页：分页落地后新引入的交互，用户每看一页要做一次
       *
       * 完成判据用「表格首行的文本换了」而不是「页码读数变了」：读数由组件同步更新，
       * 真正的成本在 `el-table` 换 `data` 之后整批行的重挂，只有行内容跟上才算铺完。
       * 与 mount 场景同理，这一项在分页前不存在对应口径，只作为分页后的绝对成本记录。
       */
      pageFlip: {
        /** `--fresh` 之外还要防"上一次样本停在第 2 页"，因此显式把页码复位到第 1 页 */
        guard: async () => {
          // 已经是当前页时这个按钮是 `disabled` 的，点它会把动作挂到超时——先读 `aria-current` 再决定
          const page1 = page.locator('.password-pagination .pagination__page').first();
          if (!(await page1.getAttribute('aria-current'))) {
            await page1.click();
            await page.waitForFunction(ROW_COUNT_FN, MOUNT_ROWS, { timeout: ACTION_TIMEOUT_MS });
          }
        },
        trigger: async () => {
          flippedFrom = await rows.first().innerText();
          await page.locator('.password-pagination .pagination__page').nth(1).click();
        },
        until: async () => {
          await page.waitForFunction(
            prev => {
              const el = document.querySelector('.el-table__body-wrapper .el-table__row');
              return !!el && el.innerText !== prev;
            },
            flippedFrom,
            { timeout: ACTION_TIMEOUT_MS },
          );
          // 与 hover 类场景同样留一小段，把换页后紧跟着的重绘收进窗口
          await page.waitForTimeout(300);
        },
      },
    };

    /** 交互发生前把表格/对话框恢复到可测初态，避免上一场景的后效串进来 */
    const settleTo = async name => {
      const act = ACTIONS[name];
      if (name === 'mount') return;
      await page.waitForFunction(DIALOG_CLOSED, undefined, { timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      await page.waitForFunction(ROW_COUNT_FN, MOUNT_ROWS, { timeout: ACTION_TIMEOUT_MS * 2 });
      await act?.guard?.();
    };

    /**
     * 采样之间的健康检查：600 行实测会把渲染进程跑到 OOM，
     * 届时后续每个动作都以「Not attached to an active page」失败、整批数据全废。
     * 条目在 chrome.storage.local 里，重建页面即可回到同一状态，所以崩一次只丢一个样本。
     */
    const ensureAlive = async () => {
      if (await alive(page)) return false;
      log('    ! 渲染进程已丢失，重建页面后继续');
      await page.close().catch(() => {});
      await openManagedPage();
      return true;
    };

    const run = async (name, fn) => {
      if (ONLY.length && !ONLY.includes(name)) return;
      const samples = [];
      let crashes = 0;
      for (let i = 0; i < REPEAT; i++) {
        if (FRESH && name !== 'mount') {
          await page.close().catch(() => {});
          await openManagedPage();
        }
        try {
          samples.push(await fn(i));
        } catch (err) {
          log(`  ${name}[#${i}] 失败: ${err?.message ?? err}`);
          if (await ensureAlive()) crashes++;
        }
        await page.waitForTimeout(250).catch(async () => {
          if (await ensureAlive()) crashes++;
        });
      }
      if (!samples.length) {
        out[name] = { error: '所有重复均失败', crashes };
        return;
      }
      out[name] = Object.assign(summarize(name, samples), { crashes });
      log(
        `  ${name}: firstPaint=${out[name].firstPaintMs}ms wall=${out[name].wallMs}ms maxLong=${out[name].maxLongMs}ms ` +
          `quiet=${out[name].quietMs}ms blocking=${out[name].blockingMs}ms ` +
          `layout=${out[name].layoutS}s style=${out[name].styleS}s script=${out[name].scriptS}s nodes=${out[name].nodes} ` +
          `churn(-${out[name].churn.remNodes}n/+${out[name].churn.addNodes}n rowReplaced=${out[name].churn.rowReplaced})`,
      );
    };

    /** 表驱动场景：mount 单独实现（导航口径），其余走 ACTIONS */
    const runTable = async name => {
      const act = ACTIONS[name];
      await run(name, async i => {
        await settleTo(name);
        const r = await measure(page, client, () => act.trigger(i), act.until);
        const d = act.divide ?? 1;
        await act.restore?.();
        return divideSample(r, d);
      });
    };

    // 1) 首屏：reload → 第 PAINT_ROWS 行出现（首屏口径）→ 第 ROWS 行出现（全量口径）
    //    长任务在 reload 后由 addInitScript 重装，`__long` 只含新文档的条目，
    //    因此首屏的「最长单个任务」可以直接结算——它是渐进分帧是否生效的直接判据。
    await run('mount', async () => {
      const t0 = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: MOUNT_TIMEOUT_MS });
      await page.waitForFunction(ROW_COUNT_FN, PAINT_ROWS, { timeout: MOUNT_TIMEOUT_MS });
      const firstPaintMs = Date.now() - t0;
      await page.waitForFunction(ROW_COUNT_FN, MOUNT_ROWS, { timeout: MOUNT_TIMEOUT_MS });
      const wallMs = Date.now() - t0;
      // 长任务的 duration 要到它结束上报时才知道，留一秒钟把尾巴上的任务收进来
      await page.waitForTimeout(1000);
      const longs = await page.evaluate(() => window.__longHere());
      return {
        firstPaintMs,
        wallMs,
        maxLongMs: round(longs.length ? Math.max(...longs) : 0, 1),
        blockingMs: round(
          longs.reduce((a, dur) => a + Math.max(0, dur - 50), 0),
          1,
        ),
        longtasks: longs.filter(d => d > 50).length,
        // 导航窗口内的 CDP 计数器不可靠（跨文档重置），mount 只给时长与长任务三类口径；
        // 缺键由 summarize() 结算成 null，写成 0 会被读成"实测为 0 秒"
      };
    });

    for (const name of Object.keys(ACTIONS)) await runTable(name);

    // 9) 归因：对指定场景额外采一份 CPU profile（self time Top-N），只跑一次。
    //    `mount` 单独走导航口径：交互场景的 profileWindow 假设页面不换，
    //    首屏要的是「reload → 第 N 行出现」这一整段，且 client 绑的是页面 target、跨导航仍在。
    if (PROFILE.length) {
      out.__profiles = {};
      for (const name of PROFILE) {
        PROFILE_TARGET = name;
        if (name === 'mount') {
          try {
            await client.send('Profiler.enable');
            await client.send('Profiler.setSamplingInterval', { interval: 100 });
            await client.send('Profiler.start');
            const t0 = Date.now();
            await page.reload({ waitUntil: 'domcontentloaded', timeout: MOUNT_TIMEOUT_MS });
            await page.waitForFunction(ROW_COUNT_FN, MOUNT_ROWS, { timeout: MOUNT_TIMEOUT_MS });
            const wallMs = Date.now() - t0;
            const p = await finishProfile(client, wallMs);
            out.__profiles.mount = p;
            log(`  profile mount: wall=${wallMs}ms span=${p.profileSpanMs}ms samples=${p.samples}`);
            for (const b of p.top.slice(0, 10)) log(`      ${(b.share * 100).toFixed(1)}% ~${b.approxMs}ms  ${b.name}`);
          } catch (err) {
            log(`  profile mount 失败: ${err?.message ?? err}`);
            await ensureAlive();
          }
          continue;
        }
        const act = ACTIONS[name];
        if (!act) {
          log(`  profile: 未知场景 ${name}`);
          continue;
        }
        await settleTo(name);
        try {
          const p = await profileWindow(client, async () => {
            const t = Date.now();
            await act.trigger(0);
            await act.until?.();
            await page.waitForTimeout(600);
            return Date.now() - t;
          });
          out.__profiles[name] = p;
          log(`  profile ${name}: span=${p.profileSpanMs}ms samples=${p.samples}`);
          for (const b of p.top.slice(0, 8)) log(`      ${(b.share * 100).toFixed(1)}% ~${b.approxMs}ms  ${b.name}`);
        } catch (err) {
          log(`  profile ${name} 失败: ${err?.message ?? err}`);
        }
        await act.restore?.().catch(() => {});
      }
    }

    out.__meta = {
      label: LABEL,
      rows: ROWS,
      paintRows: PAINT_ROWS,
      /** 全量口径的分母：分页后 DOM 里最多这么多行，`wallMs` 等的是「当前页铺满」 */
      pageCap: PAGE_CAP,
      mountRows: MOUNT_ROWS,
      repeat: REPEAT,
      settleMs: SETTLE_MS,
      executable: process.env.E2E_EXECUTABLE_PATH,
      userAgent: await page.evaluate(() => navigator.userAgent),
      domNodes: await page.evaluate(() => document.querySelectorAll('*').length),
      renderedRows: await page.evaluate(
        () => document.querySelectorAll('.el-table__body-wrapper .el-table__row').length,
      ),
      buildHead: process.env.PERF_HEAD ?? '',
    };
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(REPO, 'benchmarks', 'results'), { recursive: true });
  const file = path.join(REPO, 'benchmarks', 'results', `options-${LABEL}-${ROWS}rows.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  log(`写入 ${file}`);
}

main().catch(err => {
  log(`失败: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
