#!/usr/bin/env node
/**
 * 侧边栏「秒开」六场景真机计时脚本（真停靠面板 + 真实构建产物）
 *
 * 为什么需要它：AGENTS.md 要求性能结论给出「同一方法获得的前后数据」，而
 * `docs/reports/GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md` §5.3 的六场景矩阵此前只有一句
 * 「量不出来」——依据是 `e2e/harness.ts:342` 用标签页代替停靠面板（面板目标不在
 * `Target.getTargets` 里）。本脚本否证了那个前提：用 Chrome for Testing 有头模式
 * 驱动真实手势路径（popup 卡片 / 引导卡内按钮），`chrome.sidePanel.open()` 之后
 * 面板确实会以 `type:'page'` 出现在目标列表里，并且能被 CDP 附加读取它自己的时间线。
 *
 * 两种形态的分工（都在本脚本里，各自标注）：
 * - **停靠形态（权威）**：用户在浏览器右侧看到的那一条。FCP、首个非白屏帧（first-paint）、
 *   生产埋点分段（clickToDoc / doc→main / main→i18n / i18n→mounted / mounted→data）
 *   全部来自这里。无头模式**不能**用于这三项：实测无头下面板 `visibilityState:'hidden'`、
 *   `innerWidth/Height` 为 0、无 paint 条目，即「不存在绘制表面」而不是「没测到」。
 * - **标签页形态（补充）**：把 `sidepanel.html` 当普通标签页打开，能拿到 DOM 层判据
 *   （节点数、列表行数），且导航起点可控，用来对账停靠形态读不到的窗口前段。
 *
 * 关于「首屏窗口内 >50 ms 长任务之和」（`--longtask` 档）：
 * 不带该档时读到的 0 只代表量具没接线——`getEntriesByType('longtask')` 在没有观察器时恒为空数组。
 * `--longtask` 在面板目标出现后**附加、第一件事就装观察器**，窗口口径为「安装点 → 列表进 DOM」，
 * 并把安装时刻 `ltInstall.atMs`（面板文档自己的 `performance.now()`）作为盲区一起上报；
 * 每个样本落定后再由页内 `setTimeout` 忙等 400 ms 作阳性对照（`ltControl`），只有观察器活着、条数加回来、
 * 且新增条目时长 ≥300 ms，那一列的 0 才是结论。实测 Playwright 的 `ctx.addInitScript`
 * **不作用于停靠面板**（该 target 不走 Playwright 的 frame 生命周期），因此无法把安装点推到 0。
 * 同一窗口另取 CDP `Performance.getMetrics` 的 `TaskDuration` 增量（`busyMsSinceAttach`）作交叉
 * 对账——它同样只统计附加之后那一段，也是下界，两者不能互相替换。
 *
 * 生产埋点复用：`utils/perfMetrics.ts` 已经把每次打开的分段写进
 * `storage.local['sidepanel_perf_log']` 环形缓冲（保留最近 20 条）。本脚本读它，
 * 既避免在页面里塞探针污染被测对象，也让「记录确实新增」成为面板真的开起来的判据。
 *
 * 行数的两个口径（列表采用有界渲染窗口后必须分开看，否则会互相误读）：
 * - `rows`：首屏窗口那一枪的 `.password-item` 数——窗口起始档，不等于稳态；
 * - `rowsSettled`：等到连续若干次采样不变之后的 `.password-item` 数，即落定态，
 *   上限由 `composables/useListRenderWindow.ts` 的 `IDLE_RENDER_LIMIT` 决定（与内联下拉
 *   `INLINE_MAX_RESULT_ROWS` 同档），`rampMs` 是补齐这段额外耗时；
 * - `renderedItemCount` 是应用自报的「渲染完成」计数，属被测方口径，只能与上面两列对账，
 *   不能替代 DOM 实测。
 *
 * 数据是合成的，且只在临时 profile 里以「全明文直通」形态存在
 * （`utils/storage/passwordCrud.ts` 里 `hasEncryptedEntries === false` 分支），
 * 目的是把解密成本从测量里剥掉、只留打开链路。profile 用完即删，不落任何真实凭据。
 *
 * 用法：
 *   pnpm build
 *   export E2E_EXECUTABLE_PATH="$PWD/node_modules/.cache/chrome-for-testing/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
 *   node benchmarks/measure-sidepanel-open.mjs --repeat 3 --label before
 *   node benchmarks/measure-sidepanel-open.mjs --repeat 3 --only s1,s6 --label spot
 *   node benchmarks/measure-sidepanel-open.mjs --repeat 3 --longtask --label lt   # 加测长任务那一列
 *   node benchmarks/measure-sidepanel-open.mjs --repeat 3 --trace --label tr      # 无盲区那一列（trace 自身有开销）
 *   node benchmarks/measure-sidepanel-open.mjs --headless --only s1   # 只会给出分段，FCP 恒为 null
 *
 * 场景（与 §5.3 的矩阵逐条对应）：
 *   s1 会话有效          s2 会话失效或未验证     s3 扩展冷启动（SW 未起）
 *   s4 快速重启（保活中） s5 引导播放期间打开     s6 大库（--rows 条，默认 2000）
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
/** 环形缓冲键名（与 `utils/storageKeys.ts` 的 STORAGE_KEYS.SIDEPANEL_PERF_LOG 同值） */
const PERF_LOG_KEY = 'sidepanel_perf_log';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const REPEAT = Number(arg('repeat', 3));
const LABEL = arg('label', 'run');
const ROWS = Number(arg('rows', 2000));
const ONLY = String(arg('only', ''))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const HEADLESS = process.argv.includes('--headless') || process.env.E2E_HEADLESS === '1';
/** 面板从手势到出现目标的等待上限；600 行大库在慢机器上首屏会明显超时 */
const PANEL_TIMEOUT_MS = Number(process.env.SP_PANEL_TIMEOUT ?? 60_000);
/** 附加后面板时间线里出现 `sp-data-ready` 的等待上限 */
const SETTLE_TIMEOUT_MS = Number(process.env.SP_SETTLE_TIMEOUT ?? 30_000);
/**
 * 落定态行数（`rowsSettled`）的等待上限：首屏那一枪只覆盖到「有界渲染窗口」的起始档，
 * rAF 空闲补齐需要额外帧，必须再采到「连续多次行数不变」才代表 DOM 真正的稳态。
 */
const RAMP_TIMEOUT_MS = Number(process.env.SP_RAMP_TIMEOUT ?? 4_000);
/** 行数连续不变多少次算落定 */
const RAMP_STABLE_POLLS = 3;
/**
 * 长任务档：`--longtask`
 *
 * `performance.getEntriesByType('longtask')` 在没有任何 `longtask` 观察器时**恒为空数组**
 * （规范规定该类条目只在存在观察器时才入时间线缓冲区），所以那一串 0 不代表「没有长任务」。
 * 观察器只能装在面板自己的文档里：
 * - Playwright 的 `ctx.addInitScript` 实测**不作用于停靠面板**（该 target 不由 Playwright 的
 *   frame 生命周期管理，`window.__aphLt` 恒 undefined）；
 * - 因此改成「目标一出现就附加、附加后第一件事就装观察器」，并把安装时刻 `atMs`（面板文档的
 *   `performance.now()`）记下来当盲区上报——`[0, atMs]` 之间**已经结束**的任务收不到，
 *   跨越安装点的任务则按整段时长上报。
 * 每个样本落定后再由页内 `setTimeout` 忙等 400 ms 作阳性对照，只有条数真的加回来且时长 ≥300 ms，
 * 这一列的 0 才可以被当成「确实没有长任务」。量具只存在于本脚本，不进产品代码。
 */
const LT = process.argv.includes('--longtask');
const LT_INSTALL = `(() => {
  const at = Math.round(performance.now());
  if (Array.isArray(window.__aphLt)) {
    return JSON.stringify({ ok: true, atMs: at, readyState: document.readyState, already: true });
  }
  window.__aphLt = [];
  let ok = false;
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__aphLt.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', durationThreshold: 50, buffered: true });
    ok = true;
  } catch {
    window.__aphLt = null;
  }
  return JSON.stringify({ ok, atMs: at, readyState: document.readyState, already: false });
})()`;
/**
 * 阳性对照：忙等必须由**页面自己的定时器任务**发起。
 * 实测走 CDP `Runtime.evaluate` 直接跑的 400 ms 忙等**不会**产生 longtask 条目
 * （options 页与停靠面板两处 `ltLen` 都是 0），拿它当对照会得到「观察器活着但咬不动」的假阴。
 */
const LT_CONTROL =
  "(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 400) {} }, 0); return 'scheduled' })()";

/**
 * 长任务档之二：`--trace`（浏览器级 CDP Tracing，无盲区）
 *
 * 观察器档的致命局限是「装得不够早」：面板目标要到文档跑起来约半秒后才在
 * `Target.getTargets` 里可见，实测安装点落在 `sp-mounted` 之后，`buffered:true` 也**不回填**
 * 首个观察器之前的任务（`lt-check2.mjs` 实测 `bufferedBackfill: []`）。
 * Tracing 由脚本在手势之前启动、按 pid 过滤出面板那个渲染进程，因此窗口从导航起点就覆盖，
 * 拿到的是 `RunTask` 事件本身（µs 精度），不依赖 `durationThreshold` 与观察器时序。
 *
 * 代价：trace 本身有开销，本档的**耗时列不与干净档混用**，只用来出长任务/主线程忙碌。
 *
 * 窗口与归因（都是实测出来的，不是推测）：
 * - 端点取面板自己打的 UserTiming mark。Chrome 153 把 `performance.mark()` 记成 `ph:'I'` 且
 *   `name` 就是 mark 名，**不挂在** `args.data.entryName` 上（那里只有匿名的 `UserTiming::Measure`），
 *   所以只认 `entryName` 会让端点恒为 null、把整段采样期当首屏报（实测虚高约 2 倍）。
 * - 线程收口到 mark 所在的 `CrRendererMain`：同一 pid 还有 Compositor / ChildIOThread /
 *   ServiceWorker thread 也在发 `RunTask`（实测合计 3,284ms vs 主线程 2,994ms）。
 * - 求和前先验证区间不嵌套（实测 660 个任务、并集 == 总和、0 个重叠起点），否则总和会重复计数。
 * - 每个样本用 `firstContentfulPaint` 对表：trace 里 FCP 相对 `sp-main-start` 的偏移必须等于
 *   探针的 `fcpMs - docToMainMs`（六场景 16 个可对比样本最差 |Δ| = 4.0ms）。差值变大即归因挑错了进程/线程，长任务列作废。
 */
const TRACE = process.argv.includes('--trace');
/** `RunTask` 时长阈值，单位 µs——与 §5.3 的「>50 ms 长任务」同口径 */
const LONG_TASK_US = 50_000;
/**
 * 默认三分类是实测出来的最小集：只写 `devtools.timeline` 时面板主线程一个 `RunTask` 都收不到，
 * `sp-*` mark 只走 `blink.user_timing`。浏览器级 disabled 分类代价是**整台机器的任务都被记录**，
 * 但这笔代价随机器负载走，不是恒定倍数：本机 21–35% idle 时把面板 `docToMain` 从干净档的 106–210ms
 * 抬到 960–3034ms（4–15×），约 40% idle 时同一套量具只量到 93–200ms，与干净档无差别。
 * 因此这一档仍然只出长任务、不出耗时——不是因为它一定慢，而是因为负载不可控时它可能慢一个数量级。
 */
const TRACE_CATS_DEFAULT = 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing';

/**
 * 从事件流里切出面板的首屏窗口与主线程任务
 *
 * @param {Array} events `Tracing.dataCollected` 各 chunk 拼起来（或 `tracingComplete.value` 解析出）的事件数组
 * @returns 面板 pid、窗口起止（相对窗口起点，ms）、窗口内主线程任务清单与长任务汇总、FCP 对表值、自检计数
 */
function analyzeTrace(events) {
  const self = { total: events.length, withPid: 0, sidepanelEvents: 0, runTask: 0, userTiming: 0 };
  const MARK_NAMES = new Set([
    'sp-main-start',
    'sp-i18n-ready',
    'vue-mount-start',
    'sp-mounted',
    'sp-data-ready',
    'sp-list-rendered',
  ]);
  const pids = new Set();
  const markPids = new Set();
  const runTaskPids = new Set();
  const entryNames = new Set();
  const nameCount = new Map();
  /** 渲染主线程清单：`RunTask` 也出现在 Compositor / IO / Worker 线程上，混进来会把忙碌时间抬高约 1 倍 */
  const mainThreads = new Set();
  for (const e of events) {
    if (typeof e?.pid !== 'number') continue;
    self.withPid++;
    nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain') {
      mainThreads.add(`${e.pid}/${e.tid}`);
    }
    const entry = e.args?.data?.entryName;
    if (entry) {
      entryNames.add(entry);
      self.userTiming++;
      if (MARK_NAMES.has(entry)) markPids.add(e.pid);
    }
    if (e.ph === 'I' && MARK_NAMES.has(e.name)) {
      self.userTiming++;
      markPids.add(e.pid);
    }
    if (e.name === 'RunTask') {
      self.runTask++;
      runTaskPids.add(e.pid);
    }
    const args = e.args ? JSON.stringify(e.args) : '';
    if (args.includes('sidepanel.html')) {
      pids.add(e.pid);
      self.sidepanelEvents++;
    }
  }
  /**
   * 面板所属 pid 优先按「本 pid 打过侧边栏自己的 UserTiming mark」判定：
   * 光靠 `sidepanel.html` 字样会命中**浏览器进程**（导航、资源请求都带 URL），
   * 而 `RunTask` / mark 都在渲染进程里——实测用 URL 猜会挑错 pid、任务数直接归零。
   */
  const panelPids = markPids.size ? markPids : new Set([...pids].filter(p => runTaskPids.has(p)));
  const mine = events.filter(e => typeof e?.pid === 'number' && panelPids.has(e.pid));
  /**
   * mark 的两种事件形状都要认：实测 Chrome 153 把 `performance.mark()` 记成 `ph:'I'` 且 `name` 即 mark 名，
   * 而 `args.data.entryName` 只挂在匿名 `UserTiming::Measure` 上且从不带我们的名字——只认后者会让窗口端点恒为 null，
   * 于是把整段采样期当首屏报（实测虚高 2 倍）。
   */
  const markTs = name => mine.find(e => e.name === name || e.args?.data?.entryName === name)?.ts ?? null;
  const markEvent = mine.find(e => MARK_NAMES.has(e.name) || MARK_NAMES.has(e.args?.data?.entryName));
  /**
   * 主线程收口：同一个 pid 里 `RunTask` 也来自 Compositor / ChildIOThread / ServiceWorker thread
   * （实测面板 pid 的 6 个线程合计 3,284ms，而 CrRendererMain 单线程 2,994ms），
   * 长任务定义只算主线程，因此以 mark 所在的线程为准；拿不到 mark 时退到该 pid 的 CrRendererMain。
   */
  const threads = new Set();
  if (markEvent) threads.add(`${markEvent.pid}/${markEvent.tid}`);
  else for (const k of mainThreads) if (panelPids.has(Number(k.split('/')[0]))) threads.add(k);
  const start = markTs('sp-main-start') ?? mine.reduce((a, e) => Math.min(a, e.ts), Infinity);
  const listTs = markTs('sp-list-rendered');
  const dataTs = markTs('sp-data-ready');
  const end = listTs ?? dataTs ?? null;
  const tasks = [];
  const ivs = [];
  let busyAllThreadsMs = 0;
  for (const e of mine) {
    if (e.name !== 'RunTask' || e.ph !== 'X' || typeof e.dur !== 'number') continue;
    if (e.ts < start || (end !== null && e.ts > end)) continue;
    if (threads.size && !threads.has(`${e.pid}/${e.tid}`)) continue;
    const clampEnd = end !== null ? Math.min(e.ts + e.dur, end) : e.ts + e.dur;
    tasks.push({
      offMs: round((e.ts - start) / 1000, 1),
      durMs: round(e.dur / 1000, 1),
      /** 跨过窗口右端的那条只算落在窗口内的部分——否则「窗口内忙碌时间」会大于窗口本身（实测 s3 报出 107%） */
      clampMs: round((clampEnd - e.ts) / 1000, 1),
    });
    ivs.push([e.ts, e.ts + e.dur]);
  }
  for (const e of mine) {
    if (e.name !== 'RunTask' || e.ph !== 'X' || typeof e.dur !== 'number') continue;
    if (e.ts < start || (end !== null && e.ts > end)) continue;
    busyAllThreadsMs += e.dur;
  }
  /**
   * 自检：`RunTask` 若存在嵌套（内层任务泵），直接求和会重复计数。
   * 把区间并集算出来与总和比对——实测 660 个任务两者完全相等（0 个重叠起点），
   * 说明主线程任务事件是互不相邻的顶层任务，求和即占用时间。
   */
  ivs.sort((a, b) => a[0] - b[0]);
  let unionUs = 0;
  let curEnd = -Infinity;
  let overlaps = 0;
  for (const [s, e2] of ivs) {
    if (s < curEnd) overlaps++;
    unionUs += Math.max(0, e2 - Math.max(s, curEnd));
    curEnd = Math.max(curEnd, e2);
  }
  const busyMs = round(
    tasks.reduce((a, t) => a + t.durMs, 0),
    1,
  );
  const busyClampedMs = round(
    tasks.reduce((a, t) => a + t.clampMs, 0),
    1,
  );
  const overrunTasks = tasks.filter(t => t.durMs > t.clampMs).length;
  const longs = tasks.filter(t => t.durMs * 1000 >= LONG_TASK_US);
  /** trace 里的 paint 地标，用来和探针读到的 FCP 对表——两份数不一致说明 pid/线程归因挑错了 */
  const fcpTs = mine.find(e => e.name === 'firstContentfulPaint')?.ts ?? null;
  return {
    pids: [...pids],
    windowMs: end !== null ? round((end - start) / 1000, 1) : null,
    windowEndMark: listTs ? 'sp-list-rendered' : dataTs ? 'sp-data-ready' : null,
    traceFcpSinceStartMs: fcpTs !== null ? round((fcpTs - start) / 1000, 1) : null,
    busyMs,
    busyUnionMs: round(unionUs / 1000, 1),
    busyClampedMs,
    overrunTasks,
    overlappingTasks: overlaps,
    busyAllThreadsMs: round(busyAllThreadsMs / 1000, 1),
    longCount: longs.length,
    longSumMs: round(
      longs.reduce((a, t) => a + t.durMs, 0),
      1,
    ),
    longMaxMs: longs.length ? Math.max(...longs.map(t => t.durMs)) : null,
    longs,
    top: [...tasks].sort((a, b) => b.durMs - a.durMs).slice(0, 5),
    taskCount: tasks.length,
    selfCheck: self,
    /** 归因诊断：pid / 线程是怎么选出来的、trace 里都有哪些事件名——判据错了这些数会立刻暴露 */
    diag: {
      panelPids: [...panelPids],
      urlPids: [...pids],
      markPids: [...markPids],
      runTaskPids: [...runTaskPids],
      markThread: markEvent ? `${markEvent.pid}/${markEvent.tid}` : null,
      mainThreads: [...mainThreads],
      entryNames: [...entryNames].slice(0, 12),
      nameTop: [...nameCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      mineCount: mine.length,
    },
  };
}

const log = (...parts) => process.stderr.write(`${parts.join(' ')}\n`);
const median = vs => {
  const xs = [...vs].sort((a, b) => a - b);
  if (!xs.length) return NaN;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
};
const round = (v, p = 1) => (Number.isFinite(v) ? Number(v.toFixed(p)) : null);

/** 由加载路径推导 packed-app 扩展 ID（与 `measure-options-perf.mjs` 同一算法） */
function packagedIdFromPath(absPath) {
  const hex = createHash('sha256').update(absPath).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/** 合成条目：与 `measure-options-perf.mjs` 的夹具同款，明文直通、无真实凭据 */
function buildFixture(count) {
  const now = Date.now();
  const TAGS = ['工作', '个人', 'banking', 'dev', 'travel'];
  return Array.from({ length: count }, (_, i) => {
    const n = String(i).padStart(4, '0');
    const tagCount = i % 4 === 0 ? 3 : i % 3 === 0 ? 2 : 1;
    return {
      id: `perf-${n}`,
      username: `perf-user-${n}`,
      password: `Perf#${n}example`,
      url: '',
      tag: Array.from({ length: tagCount }, (_, k) => TAGS[(i + k) % TAGS.length]).join(','),
      remark: `合成压测条目 ${n}`,
      totp: '',
      favorite: i % 7 === 0,
      createTime: now - i * 60_000,
      updateTime: now - i * 60_000,
      showPassword: false,
    };
  });
}

/**
 * 面板/页面时间线探针（在目标文档里原样求值）
 *
 * 只读不改：不打 mark、不装观察器、不碰业务状态，避免测量本身给被测首屏加成本。
 */
const TIMELINE_PROBE = `(() => {
  const g = t => performance.getEntriesByType(t);
  const m = arr => arr.map(e => [e.name, Math.round(e.startTime ?? e.duration)]);
  return JSON.stringify({
    url: location.href,
    visibility: document.visibilityState,
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    timeOrigin: performance.timeOrigin,
    now: Math.round(performance.now()),
    nodes: document.getElementsByTagName('*').length,
    rows: document.querySelectorAll('.password-item, .el-table__row').length,
    paints: g('paint').map(p => [p.name, Math.round(p.startTime)]),
    marks: m(g('mark')),
    measures: g('measure').map(e => [e.name, Math.round(e.duration * 10) / 10]),
    longs: g('longtask').map(e => [Math.round(e.startTime), Math.round(e.duration)]),
    obs: typeof window.__aphLt === 'undefined' ? null : window.__aphLt || null,
    bodyText: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 90),
  });
})()`;

class Rig {
  constructor(ctx, extensionId, userDataDir) {
    this.ctx = ctx;
    this.id = extensionId;
    this.userDataDir = userDataDir;
    this.seq = 0;
    this.pending = new Map();
  }

  async init() {
    this.cdp = await this.ctx.browser().newBrowserCDPSession();
    this.cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
      const parsed = JSON.parse(message);
      const resolve = this.pending.get(parsed.id);
      if (resolve) {
        this.pending.delete(parsed.id);
        resolve(parsed);
      }
    });
    // reader：一个扩展页面，用来读 storage.local 与调用 chrome.windows API
    this.reader = await this.open(this.originUrl('options.html'));
    await this.reader.waitForSelector('input[type="password"], .header-actions', { timeout: 45_000 });
  }

  originUrl(page) {
    return `chrome-extension://${this.id}/${page}`;
  }

  /**
   * 新开一个聚焦窗口，返回其中的目标页面
   *
   * 必须带一个占位的 `about:blank` 标签页：`openSidePanel()` 成功后会 `window.close()` 关掉自己，
   * 如果 popup 是该窗口唯一的标签页，关页面就等于关窗口，正要挂到该窗口的面板随之作废
   * ——实测「等不到 sidepanel 目标」，而 `chrome.sidePanel.open()` 的 Promise 是成功返回的，
   * 报错完全不指向真因。留一个陪跑标签页后同一脚本立刻产出面板目标与性能记录。
   */
  async open(url) {
    if (!this.reader) {
      const page = await this.ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      page.__windowId = null;
      return page;
    }
    const before = new Set(this.ctx.pages());
    const windowId = await this.reader.evaluate(
      async urls => {
        const w = await chrome.windows.create({ url: urls, focused: true, width: 1280, height: 860 });
        return w.id;
      },
      ['about:blank', url],
    );
    for (let i = 0; i < 200; i++) {
      const fresh = this.ctx.pages().find(p => !before.has(p) && p.url().startsWith(url));
      if (fresh) {
        fresh.__windowId = windowId;
        return fresh;
      }
      await new Promise(r => setTimeout(r, 60));
    }
    throw new Error(`窗口里的页面没出现：${url}`);
  }

  async closeWindow(page) {
    if (!page) return;
    if (page.__windowId) {
      await this.reader
        .evaluate(async id => {
          await chrome.windows.remove(id);
        }, page.__windowId)
        .catch(() => {});
    }
    await page.close({ runBeforeUnload: false }).catch(() => {});
  }

  /**
   * 在扩展上下文里读环形缓冲
   *
   * @returns 全部记录（按写入顺序）
   */
  async records() {
    return this.reader.evaluate(async key => {
      const stored = await chrome.storage.local.get(key);
      return stored[key] ?? [];
    }, PERF_LOG_KEY);
  }

  /** 取本次手势写入的那条记录（ts 大于起点且 trigger 匹配，多条取最后一条） */
  async recordSince(startTs, trigger) {
    const all = await this.records();
    const matched = all.filter(r => r.ts > startTs && (!trigger || r.trigger === trigger));
    return matched.at(-1) ?? null;
  }

  async targets() {
    const { targetInfos } = await this.cdp.send('Target.getTargets');
    return targetInfos;
  }

  /** 非扁平通道：attach 拿到 sessionId，命令与应答走 Target.sendMessageToTarget */
  async attach(targetId) {
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: false });
    await this.send(sessionId, 'Runtime.enable', {});
    await this.send(sessionId, 'Page.enable', {});
    await this.send(sessionId, 'Performance.enable', {});
    return sessionId;
  }

  /**
   * 手势之前开 trace（`--trace`）
   *
   * 浏览器级 `Tracing.start` 会把所有进程都记进来，事后按面板文档所属 pid 过滤；
   * 必须在面板出现之前启动，否则又退回观察器档那种「装晚了」的盲区。
   */
  async startTrace() {
    if (!TRACE) return;
    /**
     * s4 会在同一个 Rig 上开两次面板（第一次是「保活预热」、不进指标），
     * 而 `Tracing.start` 是浏览器级单例——第二次直接报 "Tracing has already been started"。
     * 因此这里先把在飞的 trace 收尾丢弃，保证真正计入的那份只覆盖被测手势之后。
     */
    if (this.traceActive) await this.stopTrace().catch(() => null);
    this.traceActive = true;
    this.traceChunks = [];
    this.traceEventCount = 0;
    /**
     * 监听器只挂一次：s4 一个样本里会 start 两次 trace，若每次都 `on()`，同一批 `dataCollected`
     * 会被推进当前数组两遍，任务区间因此整段重叠、`busyMs` 直接翻倍（实测 s4 报出 busy 1156 / win 619）。
     * 这里**不能**再用 `traceActive` 过滤——`Tracing.end` 之后数据才到，`stopTrace` 已把标志置假，
     * 一加过滤就把整批缓冲丢掉（实测 `collected=0`、trace 全空）。
     */
    if (!this.traceListenerBound) {
      this.traceListenerBound = true;
      this.cdp.on('Tracing.dataCollected', ({ value }) => {
        this.traceChunks.push(value ?? []);
        this.traceEventCount += value?.length ?? 0;
      });
    }
    /**
     * `tracingComplete` 在高负载下可以迟于 30 s（实测会出现），但它迟到不代表数据没到——
     * 数据是分片走 `dataCollected` 的。因此超时只标记「尾巴没等到」，让 `stopTrace` 用手里的分片，
     * 并由样本自己的 FCP 对表值决定这份 trace 能不能用。
     */
    this.traceDone = new Promise(resolve => {
      const timer = setTimeout(() => resolve({ timeout: true, eventsAtTimeout: this.traceEventCount }), 60_000);
      this.cdp.once('Tracing.tracingComplete', p => {
        clearTimeout(timer);
        resolve(p);
      });
    });
    await this.cdp.send('Tracing.start', {
      transferMode: 'ReturnAsJSON',
      traceConfig: {
        // SP_TRACE_CATS 用于A/B trace 自身的开销：浏览器级 disabled 分类会把绝对值抬到不可读
        includedCategories: (process.env.SP_TRACE_CATS ?? TRACE_CATS_DEFAULT).split(','),
      },
    });
  }

  /** 收 trace 并切成面板的首屏窗口指标；没开档时返回 null */
  async stopTrace() {
    if (!TRACE) return null;
    if (!this.traceDone) return { error: 'trace 没启动' };
    const done = this.traceDone;
    this.traceActive = false;
    await this.cdp.send('Tracing.end').catch(() => {});
    const p = await done;
    if (p?.dataLossOccurred) return { error: 'dataLossOccurred', selfCheck: { total: 0 } };
    /**
     * 事件来源有两条：`tracingComplete.value`（ReturnAsJSON）实测**拿不到**——Playwright 的
     * 浏览器级 session 会把它丢掉，只留 keys；真正到货的是 `Tracing.dataCollected` 分片。
     * 两条都试，谁有内容用谁。`tracingComplete` 迟到（`timeout:true`）也不作废：
     * 数据是分片到达的，窗口端点早已在内，尾部多出的只是采样之后的事件。
     */
    const flat = (this.traceChunks ?? []).flat();
    if (!flat.length && typeof p?.value !== 'string') {
      return { error: `trace 空（keys=${Object.keys(p ?? {}).join(',')} collected=${this.traceChunks?.length ?? 0}）` };
    }
    const events = typeof p?.value === 'string' ? JSON.parse(p.value) : flat;
    if (!events.length) {
      return {
        error: `tracingComplete 没有 value（keys=${Object.keys(p ?? {}).join(',')} collected=${this.traceChunks?.length ?? 0}）`,
      };
    }
    /** 调试出口：trace 事件形状只能实测，别照着猜写判据（SP_TRACE_DUMP=1 时落盘） */
    if (process.env.SP_TRACE_DUMP) {
      const file = path.join(REPO, 'benchmarks', '.artifacts', 'timing', `trace-${LABEL}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(events));
      log(`  trace 落盘 → ${file}（${events.length} 事件）`);
    }
    const out = analyzeTrace(events);
    if (p?.timeout) out.traceTailTimedOut = true;
    return out;
  }

  send(sessionId, method, params, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, msg => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.cdp
        .send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        .catch(e => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  async evalIn(sessionId, expression) {
    const r = await this.send(sessionId, 'Runtime.evaluate', { expression, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? 'eval 抛错'));
    return r?.result?.result?.value ?? r;
  }

  async counters(sessionId) {
    const r = await this.send(sessionId, 'Performance.getMetrics', {});
    const out = {};
    for (const m of r?.result?.metrics ?? []) {
      if (
        /^(TaskDuration|ScriptDuration|LayoutDuration|RecalcStyleDuration|PaintDuration|CommitDuration)$/.test(m.name)
      ) {
        out[m.name] = m.value;
      }
    }
    return out;
  }

  /**
   * 等面板目标出现
   *
   * @param {number} sinceEpochMs 只在本次手势之后新建的目标里挑（同窗口重开时旧 targetId 会消失，
   *   但保险起见按「未见过」过滤）
   */
  async waitForPanel(excludeTargetIds) {
    const t0 = Date.now();
    while (Date.now() - t0 < PANEL_TIMEOUT_MS) {
      const infos = await this.targets();
      const panel = infos.find(
        x => /sidepanel\.html/.test(x.url) && x.type === 'page' && !excludeTargetIds.has(x.targetId),
      );
      if (panel) return panel;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`等不到 sidepanel 目标（${PANEL_TIMEOUT_MS}ms）`);
  }

  /**
   * 附加到面板并采时间线
   *
   * @returns 面板自报的时间线 + CDP 计数器增量 + 截图落盘路径
   */
  async samplePanel(target, name) {
    const sessionId = await this.attach(target.targetId);
    /** 附加后的第一件事就是装长任务观察器；`atMs` 即安装盲区，越早越可信 */
    const ltInstall = LT ? JSON.parse(await this.evalIn(sessionId, LT_INSTALL)) : null;
    const before = await this.counters(sessionId);

    let timeline = null;
    const t0 = Date.now();
    while (Date.now() - t0 < SETTLE_TIMEOUT_MS) {
      timeline = JSON.parse(await this.evalIn(sessionId, TIMELINE_PROBE));
      const settled = timeline.marks.some(([n]) => n === 'sp-data-ready' || n === 'sp-list-rendered');
      if (settled && timeline.paints.length) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const after = await this.counters(sessionId);
    const deltaOf = k => round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000, 1);
    /**
     * 主线程忙碌时长按 `TaskDuration` 单口径取，不把五个计数器相加：
     * `TaskDuration` 本身已经包含 Script/Layout/RecalcStyle/Paint/Commit，
     * 相加会把同一段时间数两遍（实测相加约为单口径的 2～3 倍）。
     */
    const busyMs = deltaOf('TaskDuration');

    const shot = await this.send(sessionId, 'Page.captureScreenshot', { format: 'png' }).catch(() => null);
    let shotFile = null;
    if (shot?.result?.data) {
      const dir = path.join(REPO, 'benchmarks', 'results', `sidepanel-open-${LABEL}`);
      fs.mkdirSync(dir, { recursive: true });
      shotFile = path.join(dir, `${name}.png`);
      fs.writeFileSync(shotFile, Buffer.from(shot?.result?.data ?? shot?.data, 'base64'));
    }

    const paintOf = n => timeline.paints.find(([paintName]) => paintName === n)?.[1] ?? null;
    const measureOf = n => timeline.measures.find(([measureName]) => measureName === n)?.[1] ?? null;
    const markOf = n => timeline.marks.find(([markName]) => markName === n)?.[1] ?? null;
    /**
     * 长任务窗口口径：安装点 → 列表进 DOM（没有该 mark 则到数据就绪）。
     * 安装点在面板文档自己的时间轴上（`ltInstall.atMs`），因此这一列的盲区是可读的数值，
     * 而不是像 `busyMsSinceAttach` 那样只是「附加之后」这种定性下界。
     */
    const windowEnd = markOf('sp-list-rendered') ?? markOf('sp-data-ready') ?? Infinity;
    const ltOf = arr => (arr ?? []).filter(([st, dur]) => dur > 50 && st <= windowEnd);
    const inWindow = LT ? ltOf(timeline.obs) : ltOf(timeline.longs);
    /**
     * 阳性对照（仅 `--longtask`）：落定之后由页内定时器在主线程上忙等 400 ms，再看条数是否加得回来。
     * 加得回来才证明观察器真的在收条目——否则「首屏长任务 0 条」可能只是量具没接线。
     * 对照发生在采样与截图之后，不参与任何耗时列。
     */
    let ltControl = null;
    if (LT) {
      const beforeN = (timeline.obs ?? []).length;
      await this.evalIn(sessionId, LT_CONTROL);
      await new Promise(r => setTimeout(r, 1000));
      const recheck = JSON.parse(await this.evalIn(sessionId, TIMELINE_PROBE));
      const afterArr = recheck.obs ?? [];
      const added = afterArr.slice(beforeN);
      ltControl = {
        observer: recheck.obs !== null,
        before: beforeN,
        after: afterArr.length,
        added: added.length,
        controlMs: added.length ? Math.max(...added.map(([, d]) => d)) : 0,
      };
    }
    /**
     * 落定态行数（`rowsSettled` / `nodesSettled`）
     *
     * 首屏那一枪的 `rows` 读的是「侧边栏列表有界渲染窗口」的起始档，之后由 rAF 逐批补到上限，
     * 因此它既不是整库行数也不是稳态行数。落定判据取「连续 `RAMP_STABLE_POLLS` 次行数不变」，
     * 否则会把「还没铺满」误读成「只铺了这么多」。
     * 采样放在截图与计数器增量之后，不给首屏窗口的任何一列加成本。
     */
    const rampT0 = Date.now();
    let rowsSettled = timeline.rows;
    let nodesSettled = timeline.nodes;
    let prevRows = -1;
    let stablePolls = 0;
    while (Date.now() - rampT0 < RAMP_TIMEOUT_MS && stablePolls < RAMP_STABLE_POLLS) {
      await new Promise(r => setTimeout(r, 100));
      const probe = JSON.parse(await this.evalIn(sessionId, TIMELINE_PROBE));
      stablePolls = probe.rows === prevRows ? stablePolls + 1 : 0;
      prevRows = probe.rows;
      rowsSettled = probe.rows;
      nodesSettled = probe.nodes;
    }
    const rampMs = Date.now() - rampT0;

    return {
      settleMs: Date.now() - t0,
      rowsSettled,
      nodesSettled,
      rampMs,
      visibility: timeline.visibility,
      viewport: timeline.viewport,
      dpr: timeline.dpr,
      timeOrigin: timeline.timeOrigin,
      nodes: timeline.nodes,
      rows: timeline.rows,
      bodyText: timeline.bodyText,
      firstPaintMs: paintOf('first-paint'),
      fcpMs: paintOf('first-contentful-paint'),
      marks: Object.fromEntries(timeline.marks),
      measures: {
        docToMain: measureOf('sp:doc→main'),
        mainToI18n: measureOf('sp:main→i18n'),
        i18nToMounted: measureOf('sp:i18n→mounted'),
        mountedToData: measureOf('sp:mounted→data'),
        total: measureOf('sp:doc→data-ready'),
      },
      spDataReadyMs: markOf('sp-data-ready'),
      spListRenderedMs: markOf('sp-list-rendered'),
      /**
       * 附加之后到落定之间的主线程忙碌毫秒数（长任务之和的停靠形态替代表述，见文件头）。
       * 只统计附加之后那一段——面板文档比手势晚约 200 ms 出现，之前的主线程成本计不进来，
       * 因此这是下界，不能与 §9.13 管理页的 `blockingMs` 直接对表。
       */
      busyMsSinceAttach: busyMs,
      busyBreakdown: {
        scriptMs: deltaOf('ScriptDuration'),
        layoutMs: deltaOf('LayoutDuration'),
        styleMs: deltaOf('RecalcStyleDuration'),
        paintMs: deltaOf('PaintDuration'),
        commitMs: deltaOf('CommitDuration'),
      },
      /**
       * 首屏窗口内 >50 ms 长任务之和。`--longtask` 档来自装在文档最前面的观察器（真测量，
       * 带 `ltControl` 阳性对照）；不带该档时这里退回 `getEntriesByType('longtask')`，
       * 实测恒为空数组——没有观察器时规范规定这类条目不入缓冲区，那 0 不代表「没有长任务」。
       */
      longtaskCount: inWindow.length,
      longtaskSumMs: round(
        inWindow.reduce((a, [, dur]) => a + dur, 0),
        1,
      ),
      longtaskMaxMs: inWindow.length ? Math.max(...inWindow.map(([, dur]) => dur)) : null,
      /** 观察器安装点：`atMs` 之前的已结束任务收不到，这个数就是本样本的盲区宽度 */
      ltInstall,
      /** 观察器是否收到过窗口之外的条目，以及阳性对照是否真的加回来一条 ≥300 ms 的任务 */
      ltObservedTotal: LT ? (timeline.obs ?? []).length : null,
      ltControl,
      screenshot: shotFile,
    };
  }

  /** 触发一次真实手势：popup 的「快速填充」卡（`trigger:'popup'`） */
  async openViaPopup() {
    const startTs = Date.now();
    const page = await this.open(this.originUrl('popup.html'));
    // 大库场景下 popup 要等 `GET_INITIAL_DATA` 回来才渲染卡片，固定 900ms 会读到空列表
    await page.waitForSelector('.action-card[role="button"]', { timeout: 30_000 });
    await page.waitForTimeout(200);
    const cards = page.locator('.action-card[role="button"]');
    const titles = await cards.evaluateAll(els =>
      els.map(e => e.querySelector('.action-card__title')?.textContent?.trim() ?? ''),
    );
    const idx = titles.findIndex(t => /快速填充|Quick Fill/i.test(t));
    if (idx < 0) throw new Error(`popup 卡片里找不到「快速填充」：${JSON.stringify(titles)}`);
    // 点击成功后 popup 自己 window.close()，这里不持有它
    await this.startTrace();
    await cards.nth(idx).click();
    return { startTs, page };
  }

  /**
   * 触发一次真实手势：新手引导卡内的「打开侧边栏」按钮（`trigger:'tour'`）
   *
   * 剧本步数会变，因此按「卡内动作按钮出现」判定到位，不硬编码第几步。
   * 引导只在解锁后的管理页上存在（`MasterPasswordSetupView` 没有锚点，见设计稿 §6），
   * 所以调用方必须先 onboard；这里再兜一层：卡已自动打开时不再点头部按钮，避免点到遮罩上。
   */
  async openViaTour() {
    const startTs = Date.now();
    const page = await this.open(this.originUrl('options.html'));
    await page.waitForSelector('.header-actions', { timeout: 45_000 });
    if (
      !(await page
        .locator('.tour__card')
        .isVisible()
        .catch(() => false))
    ) {
      await page
        .locator('.header-actions-right button', { hasText: /新手引导|Tour/i })
        .first()
        .click({ timeout: 20_000 });
    }
    let action = page.locator('.tour__action-btn');
    for (let i = 0; i < 16; i++) {
      if (await action.isVisible().catch(() => false)) break;
      await page.locator('.tour__btn--primary').last().click();
      await page.waitForTimeout(350);
    }
    if (!(await action.isVisible().catch(() => false))) throw new Error('引导里没走到「打开侧边栏」那一步');
    await this.startTrace();
    await action.click();
    return { startTs, page };
  }

  /** 生产入口锁定会话：popup 头部的 `.lock-btn`（仅会话有效时渲染） */
  async lockViaPopup() {
    const page = await this.open(this.originUrl('popup.html'));
    await page.waitForSelector('.lock-btn', { timeout: 20_000 });
    await page.locator('.lock-btn').click();
    await page.waitForFunction(() => !document.querySelector('.lock-btn'), null, { timeout: 20_000 });
    await this.closeWindow(page);
  }

  /**
   * 制造「扩展冷启动」：杀掉正在运行的 SW 目标
   *
   * 用 `Target.closeTarget` 而不是 `ServiceWorker.stopAllWorkers`，因为前者对
   * packed-app 的 service_worker 目标确定可用；杀完必须确认目标真的没了，
   * 否则「冷启动」这一档量的就不是冷启动。
   */
  async killServiceWorker() {
    const infos = await this.targets();
    const workers = infos.filter(x => x.type === 'service_worker');
    for (const w of workers) await this.cdp.send('Target.closeTarget', { targetId: w.targetId }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      const left = (await this.targets()).filter(x => x.type === 'service_worker');
      if (!left.length) return { killed: workers.length, confirmedGone: true };
      await new Promise(r => setTimeout(r, 100));
    }
    return { killed: workers.length, confirmedGone: false };
  }

  /** 侧边栏走「有效会话」所需的最小生产动作：在管理页设置主密码 */
  async onboard(page) {
    const pwd = page.locator('input[type="password"]:visible');
    await pwd.first().waitFor({ state: 'visible', timeout: 30_000 });
    if ((await pwd.count()) >= 2) {
      await pwd.nth(0).fill(TEST_MASTER_PASSWORD);
      await pwd.nth(1).fill(TEST_MASTER_PASSWORD);
    } else {
      await pwd.first().fill(TEST_MASTER_PASSWORD);
    }
    await page.locator('.el-button--primary:visible').last().click();
    await page.waitForSelector('.header-actions', { timeout: 60_000 });
  }

  async seed(page, count) {
    await page.evaluate(
      async ({ key, entries }) => {
        await chrome.storage.local.set({ [key]: entries });
      },
      { key: PASSWORDS_KEY, entries: buildFixture(count) },
    );
  }

  /** 把 `sidepanel.html` 当普通标签页打开（补充形态：可预先注册 longtask 观察器） */
  async openAsTab() {
    const startTs = Date.now();
    const page = await this.open(this.originUrl('sidepanel.html'));
    await page.waitForSelector('body *', { timeout: 30_000 });
    return { page, startTs };
  }
}

/**
 * 场景样本的中位数汇总
 *
 * `fcpUnder1000ms` / `totalUnder1000ms` 是「秒开」SLA 的可判定形式：
 * 3 个样本全部达标才算 true，任一样本缺数（无头形态）记 null 而不是当作通过。
 */
const FIELDS = [
  'clickToDocMs',
  'docToMainMs',
  'mainToI18nMs',
  'i18nToMountedMs',
  'mountedToDataMs',
  'dataToRenderMs',
  'totalMs',
  'firstPaintMs',
  'fcpMs',
  'busyMsSinceAttach',
  'longtaskCount',
  'longtaskSumMs',
  'longtaskMaxMs',
  'ltObservedTotal',
  'traceWindowMs',
  'traceBusyMs',
  'traceBusyUnionMs',
  'traceBusyClampedMs',
  'traceOverrunTasks',
  'traceBusyAllThreadsMs',
  'traceOverlappingTasks',
  'traceFcpSinceStartMs',
  'traceFcpProbeDeltaMs',
  'traceLongCount',
  'traceLongSumMs',
  'traceLongMaxMs',
  'nodes',
  'rows',
  /** 落定态（rAF 补齐之后）的 DOM 行数与节点数，与 `rows`/`nodes` 的首屏口径分开看 */
  'rowsSettled',
  'nodesSettled',
  'rampMs',
  'renderedItemCount',
];

function summarize(name, samples) {
  const ok = samples.filter(s => !s.error);
  if (!ok.length) return { scenario: name, samples: 0, note: '全部样本失败' };
  const pick = key => {
    const vs = ok.map(s => s.summary[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
    return vs.length ? round(median(vs), 1) : null;
  };
  const out = { scenario: name, samples: ok.length };
  for (const f of FIELDS) out[f] = pick(f);
  /** trace 那一组取「最坏样本」而非中位数：卡顿判据关心的是有没有那条 >50 ms 的任务，不是平均 */
  const maxOf = key => {
    const vs = ok.map(s => s.summary[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
    return vs.length ? round(Math.max(...vs), 1) : null;
  };
  if (TRACE) {
    out.traceWindowMs = maxOf('traceWindowMs');
    out.traceBusyMaxMs = maxOf('traceBusyMs');
    out.traceLongCountMax = maxOf('traceLongCount');
    out.traceLongSumMaxMs = maxOf('traceLongSumMs');
    out.traceLongMaxMs = maxOf('traceLongMaxMs');
    out.traceErrors = [...new Set(ok.map(s => s.summary.traceError).filter(Boolean))].join('/');
    /**
     * 归因自检合并在汇总里，省得每个样本单独对：
     * `traceFcpProbeWorstAbsMs` 是「trace 的 FCP 偏移 vs 探针的 FCP 偏移」最大绝对差（>25ms 即归因可疑），
     * `traceOverlaps` 必须为 0（有嵌套说明求和会重复计数）。
     */
    const deltas = ok.map(s => s.summary.traceFcpProbeDeltaMs).filter(v => typeof v === 'number');
    out.traceFcpProbeWorstAbsMs = deltas.length ? round(Math.max(...deltas.map(Math.abs)), 1) : null;
    out.traceOverlaps = maxOf('traceOverlappingTasks') ?? 0;
    out.traceAttributionOk =
      out.traceFcpProbeWorstAbsMs !== null && out.traceFcpProbeWorstAbsMs <= 25 && out.traceOverlaps === 0;
  }
  out.raceWinner = [...new Set(ok.map(s => s.summary.raceWinner).filter(Boolean))].join('/');
  out.sessionValid = [...new Set(ok.map(s => s.summary.sessionValid))].join('/');
  out.bgSwUptimeMs = pick('bgSwUptimeMs');
  out.trigger = [...new Set(ok.map(s => s.summary.trigger).filter(Boolean))].join('/');
  out.visibilities = [...new Set(ok.map(s => s.summary.visibility))].join('/');
  out.viewports = [...new Set(ok.map(s => s.summary.viewport?.join?.('x')))].join('/');
  out.fcpUnder1000ms = ok.every(s => typeof s.summary.fcpMs === 'number' && s.summary.fcpMs < 1000);
  out.totalUnder1000ms = ok.every(s => typeof s.summary.totalMs === 'number' && s.summary.totalMs < 1000);
  /** 阳性对照汇总：观察器必须装成功，且页内 400 ms 定时器忙等必须加回来一条 ≥300 ms 的任务（阈值见 `ltTeeth`） */
  const controls = ok.map(s => s.summary.ltControl).filter(Boolean);
  if (controls.length) {
    out.ltControlSamples = controls.length;
    out.ltObserverAlive = controls.every(c => c.observer === true);
    out.ltInstalled = ok.every(s => s.summary.ltInstall?.ok === true);
    const blinds = ok.map(s => s.summary.ltInstall?.atMs).filter(v => typeof v === 'number');
    out.ltBlindMaxMs = blinds.length ? Math.max(...blinds) : null;
    out.ltReadyStates = [...new Set(ok.map(s => s.summary.ltInstall?.readyState))].join('/');
    out.ltTeeth = controls.every(c => c.added >= 1 && c.controlMs >= 300);
    out.ltMaxMs = Math.max(...ok.map(s => s.summary.longtaskMaxMs ?? 0));
    out.ltSumMax = Math.max(...ok.map(s => s.summary.longtaskSumMs ?? 0));
  }
  return out;
}

/** 把面板时间线与环形缓冲记录合成一个样本 */
async function collect(rig, gesture, name, seenTargets) {
  const panel = await rig.waitForPanel(seenTargets);
  seenTargets.add(panel.targetId);
  const shot = await rig.samplePanel(panel, name);
  const trace = await rig.stopTrace();
  const rec = await rig.recordSince(gesture.startTs, undefined);
  /**
   * 归因对表：trace 里 `firstContentfulPaint` 相对 `sp-main-start` 的偏移，
   * 必须等于探针读到的 `fcpMs - docToMainMs`（两者同一段、不同来源）。
   * 实测差 1.4ms（974.6 vs 976）——差值一旦上到几十 ms，说明 trace 挑错了 pid/线程，本样本的长任务列不可用。
   */
  const probeFcpSinceMain =
    typeof shot.fcpMs === 'number' && typeof rec?.docToMainMs === 'number'
      ? round(shot.fcpMs - rec.docToMainMs, 1)
      : null;
  const merged = {
    ...shot,
    traceWindowMs: trace?.windowMs ?? null,
    traceBusyMs: trace?.busyMs ?? null,
    traceBusyUnionMs: trace?.busyUnionMs ?? null,
    traceBusyClampedMs: trace?.busyClampedMs ?? null,
    traceOverrunTasks: trace?.overrunTasks ?? null,
    traceBusyAllThreadsMs: trace?.busyAllThreadsMs ?? null,
    traceOverlappingTasks: trace?.overlappingTasks ?? null,
    traceFcpSinceStartMs: trace?.traceFcpSinceStartMs ?? null,
    traceFcpProbeDeltaMs:
      trace?.traceFcpSinceStartMs != null && probeFcpSinceMain != null
        ? round(trace.traceFcpSinceStartMs - probeFcpSinceMain, 1)
        : null,
    traceLongCount: trace?.longCount ?? null,
    traceLongSumMs: trace?.longSumMs ?? null,
    traceLongMaxMs: trace?.longMaxMs ?? null,
    traceTaskCount: trace?.taskCount ?? null,
    /** 窗口内最长的 5 个主线程任务（`{offMs}` 相对面板首屏窗口起点），完整切分见 panel.trace */
    traceTop: trace?.top ?? null,
    traceError: trace?.error ?? (TRACE && !trace ? 'trace 缺失' : null),
    clickToDocMs: rec?.clickToDocMs ?? null,
    docToMainMs: rec?.docToMainMs ?? shot.measures.docToMain,
    mainToI18nMs: rec?.mainToI18nMs ?? shot.measures.mainToI18n,
    i18nToMountedMs: rec?.i18nToMountedMs ?? shot.measures.i18nToMounted,
    mountedToDataMs: rec?.mountedToDataMs ?? shot.measures.mountedToData,
    totalMs: rec?.totalMs ?? shot.measures.total,
    dataToRenderMs: rec?.dataToRenderMs ?? null,
    raceWinner: rec?.raceWinner ?? null,
    sessionValid: rec?.sessionValid ?? null,
    renderedItemCount: rec?.renderedItemCount ?? null,
    bgSwUptimeMs: rec?.bgSwUptimeMs ?? null,
    bgPathMs: rec?.bgPathMs ?? null,
    localPathMs: rec?.localPathMs ?? null,
    bgCacheHit: rec?.bgCacheHit ?? null,
    trigger: rec?.trigger ?? null,
    os: rec?.os ?? null,
  };
  return { summary: merged, record: rec ?? null, panel: { ...shot, trace } };
}

async function main() {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`扩展产物不存在：${EXTENSION_PATH}（先 pnpm build）`);
  }
  if (!process.env.E2E_EXECUTABLE_PATH) {
    throw new Error('需要 E2E_EXECUTABLE_PATH 指向 Chromium 系构建，命令见 e2e/README.md');
  }
  log(
    `模式=${HEADLESS ? '无头(面板无绘制表面,FCP 恒 null)' : '有头'} 样本=${REPEAT} 大库=${ROWS} 标签=${LABEL} 长任务=${LT ? '面板内观察器+页内400ms阳性对照' : '关(只读 getEntriesByType,恒空)'} trace=${TRACE ? '开(浏览器级 devtools.timeline)' : '关'}`,
  );

  const scenarios = {
    /** s1 会话有效：设置主密码后即有效 */
    s1: {
      title: '会话有效',
      async run(rig, i) {
        const onb = await rig.open(rig.originUrl('options.html'));
        await rig.onboard(onb);
        await rig.closeWindow(onb);
        const g = await rig.openViaPopup();
        const out = await collect(rig, g, `s1-${i + 1}`, rig.seen);
        await rig.closeWindow(g.page).catch(() => {});
        return out;
      },
    },
    /** s2 会话失效或未验证：先建库再走 popup 的锁定按钮（生产入口） */
    s2: {
      title: '会话失效或未验证',
      async run(rig, i) {
        const onb = await rig.open(rig.originUrl('options.html'));
        await rig.onboard(onb);
        await rig.closeWindow(onb);
        await rig.lockViaPopup();
        const g = await rig.openViaPopup();
        const out = await collect(rig, g, `s2-${i + 1}`, rig.seen);
        await rig.closeWindow(g.page).catch(() => {});
        return out;
      },
    },
    /** s3 扩展冷启动（SW 未起）：杀掉 SW 目标并确认消失后再打开 */
    s3: {
      title: '扩展冷启动（SW 未起）',
      async run(rig, i) {
        const onb = await rig.open(rig.originUrl('options.html'));
        await rig.onboard(onb);
        await rig.closeWindow(onb);
        const kill = await rig.killServiceWorker();
        const g = await rig.openViaPopup();
        const out = await collect(rig, g, `s3-${i + 1}`, rig.seen);
        out.summary.swKilled = kill;
        await rig.closeWindow(g.page).catch(() => {});
        return out;
      },
    },
    /** s4 快速重启（保活中）：紧接着第二次打开，SW 已被心跳唤醒 */
    s4: {
      title: '快速重启（保活中）',
      async run(rig, i) {
        const onb = await rig.open(rig.originUrl('options.html'));
        await rig.onboard(onb);
        await rig.closeWindow(onb);
        const warm = await rig.openViaPopup();
        const warmPanel = await rig.waitForPanel(rig.seen).catch(() => null);
        if (warmPanel) {
          rig.seen.add(warmPanel.targetId);
          await rig.samplePanel(warmPanel, `s4-warm-${i + 1}`).catch(() => null);
        }
        await rig.closeWindow(warm.page).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));
        const g = await rig.openViaPopup();
        const out = await collect(rig, g, `s4-${i + 1}`, rig.seen);
        await rig.closeWindow(g.page).catch(() => {});
        return out;
      },
    },
    /** s5 引导播放期间打开侧边栏：管理页新手引导卡内按钮（trigger='tour'） */
    s5: {
      title: '引导播放期间打开侧边栏',
      async run(rig, i) {
        // 引导卡只在解锁后的管理页里渲染，因此先在生产路径上建好主密码再走引导
        const onb = await rig.open(rig.originUrl('options.html'));
        await rig.onboard(onb);
        await rig.closeWindow(onb);
        const g = await rig.openViaTour();
        const out = await collect(rig, g, `s5-${i + 1}`, rig.seen);
        await rig.closeWindow(g.page).catch(() => {});
        return out;
      },
    },
    /** s6 大库：--rows 条明文直通条目，有效会话下打开 */
    s6: {
      title: `${ROWS} 条大库`,
      async run(rig, i) {
        const onb = await rig.open(rig.originUrl('options.html'));
        await rig.onboard(onb);
        await rig.seed(onb, ROWS);
        await rig.closeWindow(onb);
        const g = await rig.openViaPopup();
        const out = await collect(rig, g, `s6-${i + 1}`, rig.seen);
        await rig.closeWindow(g.page).catch(() => {});
        return out;
      },
    },
  };

  const wanted = ONLY.length ? ONLY : Object.keys(scenarios);
  const out = {};
  for (const key of wanted) {
    const sc = scenarios[key];
    if (!sc) {
      log(`未知场景 ${key}，跳过`);
      continue;
    }
    log(`场景 ${key} · ${sc.title}`);
    const userDataDirs = [];
    const samples = [];
    for (let i = 0; i < REPEAT; i++) {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-sp-open-'));
      userDataDirs.push(userDataDir);
      const ctx = await chromium.launchPersistentContext(userDataDir, {
        executablePath: process.env.E2E_EXECUTABLE_PATH,
        headless: HEADLESS,
        viewport: { width: 1280, height: 860 },
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-sync',
        ],
      });
      const rig = new Rig(ctx, packagedIdFromPath(EXTENSION_PATH), userDataDir);
      rig.seen = new Set();
      try {
        await rig.init();
        // reader 自己就在首个窗口里，先把已存在的面板目标登记为「旧」
        for (const t of await rig.targets()) if (/sidepanel\.html/.test(t.url)) rig.seen.add(t.targetId);
        const sample = await sc.run(rig, i);
        samples.push(sample);
        log(`  ${key}#${i + 1}`, JSON.stringify(sample.summary));
      } catch (error) {
        samples.push({ error: String(error).slice(0, 300) });
        log(`  ${key}#${i + 1} 失败: ${String(error).slice(0, 240)}`);
      } finally {
        await ctx.close().catch(() => {});
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    out[key] = { title: sc.title, samples, summary: summarize(key, samples) };
    log(`  → ${JSON.stringify(out[key].summary)}`);
  }

  const dir = path.join(REPO, 'benchmarks', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `sidepanel-open-${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify({ meta: { headless: HEADLESS, repeat: REPEAT, rows: ROWS }, out }, null, 2));
  log(`结果 → ${file}`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.summary])), null, 2));
}

main().catch(e => {
  log(String(e));
  process.exitCode = 1;
});
