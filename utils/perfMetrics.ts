/**
 * 侧边栏打开性能埋点工具（生产可用）
 *
 * 生产构建通过 esbuild `drop: ['console']` 剥除了全部 logger.debug 时序日志，
 * 本模块改用 User Timing API（performance.mark/measure）承载埋点：
 * - measure 结果常驻页面 performance 时间线，生产环境可经 DevTools
 *   `performance.getEntriesByType('measure')` 或 Performance 录制直接读取；
 * - 关键打开指标另写入 storage.local 环形缓冲（保留最近 20 次打开记录），
 *   便于跨会话回溯 Windows 会话失效等场景的真实打开耗时分布。
 *
 * 所有 API 均静默容错：埋点失败绝不影响业务流程。
 *
 * @module utils/perfMetrics
 */
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/**
 * 侧边栏打开链路的 User Timing mark 名称
 *
 * 时序：doc(timeOrigin) → MAIN_START → I18N_READY → VUE_MOUNT_START → MOUNTED → DATA_READY
 */
export const SP_PERF_MARKS = {
  /** 入口 JS（main.ts）开始执行 */
  MAIN_START: 'sp-main-start',
  /** i18n 初始化完成（语言偏好读取 + 语言包就绪） */
  I18N_READY: 'sp-i18n-ready',
  /** Vue 同步挂载开始（保持与既有 App.vue measure 兼容的历史命名） */
  VUE_MOUNT_START: 'vue-mount-start',
  /** App onMounted 回调触发（首帧已渲染） */
  MOUNTED: 'sp-mounted',
  /** 首屏数据就绪（initSidepanelData 竞速完成） */
  DATA_READY: 'sp-data-ready',
  /** 首屏真实 UI 渲染完成（锁屏卡片可见 / 密码列表 DOM flush + 首帧绘制） */
  LIST_RENDERED: 'sp-list-rendered',
} as const;

/** 侧边栏打开触发源（区分不同打开路径的耗时分布） */
export type SidepanelOpenTrigger = 'float' | 'shortcut' | 'popup' | 'content';

/** 环形缓冲最大记录数 */
const PERF_LOG_MAX_ENTRIES = 20;

/** 打开请求时间戳的有效窗口（毫秒）：超出视为陈旧记录（上次打开失败等场景残留） */
const OPEN_REQUEST_MAX_AGE_MS = 60000;

/** 单次侧边栏打开的性能记录（写入 storage.local 环形缓冲） */
export interface SidepanelOpenMetrics {
  /** 记录时间（epoch 毫秒） */
  ts: number;
  /** 运行平台（win/mac/linux 等，区分 Windows/Mac 耗时分布） */
  os: string | null;
  /** 打开触发源（float=悬浮按钮 / shortcut=快捷键 / popup / content，null=直接刷新等） */
  trigger: SidepanelOpenTrigger | null;
  /** 用户点击（sidePanel.open 请求）→ 文档 timeOrigin（渲染进程创建段，仅有时间戳时可算） */
  clickToDocMs: number | null;
  /** 文档启动 → 入口 JS 开始执行（资源加载 + 编译） */
  docToMainMs: number | null;
  /** 入口 JS 开始 → i18n 就绪（storage 语言偏好读取） */
  mainToI18nMs: number | null;
  /** i18n 就绪 → Vue onMounted（同步挂载与首帧渲染） */
  i18nToMountedMs: number | null;
  /** Vue onMounted → 首屏数据就绪（竞速数据加载） */
  mountedToDataMs: number | null;
  /** 首屏数据就绪 → 真实 UI 渲染完成（列表渲染段，此前为埋点盲区） */
  dataToRenderMs: number | null;
  /** 文档启动 → 首屏数据就绪（端到端总耗时） */
  totalMs: number | null;
  /** 竞速胜出路径（bg=Background 缓存，local=本地直读，snapshot=storage.session 加密快照直读，null=异常/未决出） */
  raceWinner: 'bg' | 'local' | 'snapshot' | null;
  /** bg 结果是否为回退阶段迟到采纳（true 时 bgPathMs 为冷 SW 真实耗时而非 800ms 门限内胜出） */
  bgLateAdopted: boolean;
  /** Background 路径耗时（毫秒，未完成时为 null） */
  bgPathMs: number | null;
  /** 本地直读路径耗时（毫秒，未完成时为 null） */
  localPathMs: number | null;
  /** Background 路径 SW 端处理耗时（毫秒，与 bgPathMs 差值即 IPC + SW 唤醒开销） */
  bgSwProcessMs: number | null;
  /** Background 路径是否命中内存密码缓存 */
  bgCacheHit: boolean | null;
  /** Background 响应时 SW 已运行时长（毫秒，判定 SW 冷/热启动） */
  bgSwUptimeMs: number | null;
  /** 数据就绪时会话是否有效（区分锁定态/解锁态打开场景） */
  sessionValid: boolean;
  /** 首屏渲染完成时的列表条目数（量化列表渲染段与条目数的关系） */
  renderedItemCount: number | null;
  /** 首屏关键资源加载分解（按耗时降序取前 12 项，区分磁盘 IO/杀软扫描 vs V8 编译） */
  resources: Array<{ name: string; ms: number }> | null;
}

/** initSidepanelData 返回的初始化元信息（性能记录维度） */
export interface SidepanelInitMeta {
  /** 竞速胜出路径（bg=Background 缓存，local=本地直读，snapshot=storage.session 加密快照直读） */
  raceWinner: 'bg' | 'local' | 'snapshot' | null;
  /** bg 结果是否在统一初始化上限后迟到采纳（区分正常竞速与冷 SW 长尾样本） */
  bgLateAdopted?: boolean;
  /** 初始化完成时会话是否有效 */
  sessionValid: boolean;
  /** Background 路径耗时（毫秒，未完成时为 null） */
  bgPathMs?: number | null;
  /** 本地直读路径耗时（毫秒，未完成时为 null） */
  localPathMs?: number | null;
  /** Background 路径 SW 端处理耗时（毫秒） */
  bgSwProcessMs?: number | null;
  /** Background 路径是否命中内存密码缓存 */
  bgCacheHit?: boolean | null;
  /** Background 响应时 SW 已运行时长（毫秒） */
  bgSwUptimeMs?: number | null;
  /** 首屏渲染完成时的列表条目数 */
  renderedItemCount?: number | null;
}

/**
 * 安全打点：performance.mark 的容错包装
 *
 * @param name mark 名称（建议使用 SP_PERF_MARKS 常量）
 */
export function markPerf(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // 埋点失败静默忽略，不影响业务流程
  }
}

/**
 * 安全测量：performance.measure 的容错包装
 *
 * @param name measure 名称（常驻 performance 时间线，生产可读）
 * @param start 起点 mark 名称或时间戳（0 表示文档 timeOrigin）
 * @param end 终点 mark 名称或时间戳，缺省为当前时刻
 * @returns 测量耗时（毫秒），mark 缺失等异常时返回 null
 */
export function measurePerf(name: string, start: string | number, end?: string | number): number | null {
  try {
    const entry = performance.measure(name, { start, end: end ?? performance.now() });
    return entry?.duration ?? null;
  } catch {
    return null;
  }
}

/**
 * 记录「侧边栏打开请求」时间戳与触发源（调用侧：background / popup）
 *
 * 在调用 chrome.sidePanel.open() 之前同步发起（fire-and-forget，不 await，
 * 不打断用户手势链）。侧边栏页面启动后读取并与 performance.timeOrigin 对齐，
 * 得到「点击 → 渲染进程创建」段耗时（Windows 白屏的最大嫌疑段，此前不可观测）。
 * 使用 storage.session（仅内存、TRUSTED_CONTEXTS）：不落盘、内容脚本不可读。
 *
 * @param meta 打开请求元信息：clickTs 为内容脚本侧的点击时刻（含 SW 冷启动等待段，
 *   缺省回退为 SW 侧 Date.now()）；trigger 为触发源标识
 */
export function markSidepanelOpenRequested(meta?: { clickTs?: number; trigger?: SidepanelOpenTrigger }): void {
  try {
    void chrome.storage.session
      .set({
        [SESSION_MEMORY_KEYS.SIDEPANEL_OPEN_REQUESTED_AT]: {
          at: meta?.clickTs ?? Date.now(),
          trigger: meta?.trigger ?? null,
        },
      })
      .catch(() => {});
  } catch {
    // 埋点失败静默忽略，不影响打开流程
  }
}

/**
 * 读取并消耗「打开请求」记录，计算点击 → 文档 timeOrigin 耗时与触发源
 *
 * 时间戳与 timeOrigin 均为 epoch 毫秒，可直接相减；读后即删除防止陈旧值污染下次记录。
 * 仅接受 [0, 60s) 窗口内的合理值（负值/超窗口视为无效，如直接刷新侧边栏页面的场景）。
 * 兼容旧版纯数字格式（扩展更新瞬间 storage.session 可能残留旧格式记录）。
 *
 * @returns 点击到渲染进程启动的耗时与触发源，无有效记录时两者均为 null
 */
async function consumeOpenRequest(): Promise<{ clickToDocMs: number | null; trigger: SidepanelOpenTrigger | null }> {
  const empty = { clickToDocMs: null, trigger: null };
  try {
    const key = SESSION_MEMORY_KEYS.SIDEPANEL_OPEN_REQUESTED_AT;
    const result = await chrome.storage.session.get(key);
    const raw = result[key] as number | { at?: number; trigger?: SidepanelOpenTrigger | null } | undefined;
    if (raw === undefined) return empty;
    void chrome.storage.session.remove(key).catch(() => {});
    const requestedAt = typeof raw === 'number' ? raw : raw?.at;
    const trigger = typeof raw === 'object' ? (raw?.trigger ?? null) : null;
    if (typeof requestedAt !== 'number') return empty;
    const delta = performance.timeOrigin - requestedAt;
    return { clickToDocMs: delta >= 0 && delta < OPEN_REQUEST_MAX_AGE_MS ? delta : null, trigger };
  } catch {
    return empty;
  }
}

/**
 * 采集首屏关键资源（JS chunk / CSS）加载耗时分解
 *
 * duration 主要由磁盘读取 + 杀软扫描构成（扩展资源无网络段），与 docToMainMs
 * 对照即可归因 Windows 慢点属于「文件冷读」还是「V8 编译/执行」。
 * 按耗时降序截取前 12 项，避免环形日志体积膨胀。
 *
 * @returns 资源名与耗时（毫秒）列表，无资源或 API 异常时返回 null
 */
function collectResourceTimings(): Array<{ name: string; ms: number }> | null {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    if (!entries.length) return null;
    return entries
      .map(e => ({ name: e.name.split('/').pop() ?? e.name, ms: Math.round(e.duration * 10) / 10 }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 12);
  } catch {
    return null;
  }
}

/**
 * 获取运行平台标识（win/mac/linux 等），失败时返回 null
 */
async function getPlatformOs(): Promise<string | null> {
  try {
    const info = await chrome.runtime.getPlatformInfo();
    return info.os;
  } catch {
    return null;
  }
}

/**
 * 记录本次侧边栏打开的完整耗时分解，并写入 storage.local 环形缓冲
 *
 * 应在首屏数据就绪（DATA_READY mark 已打点）后调用一次。
 * 存储写入为 fire-and-forget，不阻塞 UI；同时生成的 measure
 * 可在生产环境经 DevTools 时间线直接查看。
 *
 * @param meta 初始化元信息（竞速胜出路径 + 会话状态 + 竞速内部耗时）
 */
export function recordSidepanelOpenMetrics(meta: SidepanelInitMeta): void {
  try {
    const record: SidepanelOpenMetrics = {
      ts: Date.now(),
      os: null,
      trigger: null,
      clickToDocMs: null,
      docToMainMs: measurePerf('sp:doc→main', 0, SP_PERF_MARKS.MAIN_START),
      mainToI18nMs: measurePerf('sp:main→i18n', SP_PERF_MARKS.MAIN_START, SP_PERF_MARKS.I18N_READY),
      i18nToMountedMs: measurePerf('sp:i18n→mounted', SP_PERF_MARKS.I18N_READY, SP_PERF_MARKS.MOUNTED),
      mountedToDataMs: measurePerf('sp:mounted→data', SP_PERF_MARKS.MOUNTED, SP_PERF_MARKS.DATA_READY),
      dataToRenderMs: measurePerf('sp:data→rendered', SP_PERF_MARKS.DATA_READY, SP_PERF_MARKS.LIST_RENDERED),
      totalMs: measurePerf('sp:doc→data-ready', 0, SP_PERF_MARKS.DATA_READY),
      raceWinner: meta.raceWinner,
      bgLateAdopted: meta.bgLateAdopted ?? false,
      bgPathMs: meta.bgPathMs ?? null,
      localPathMs: meta.localPathMs ?? null,
      bgSwProcessMs: meta.bgSwProcessMs ?? null,
      bgCacheHit: meta.bgCacheHit ?? null,
      bgSwUptimeMs: meta.bgSwUptimeMs ?? null,
      sessionValid: meta.sessionValid,
      renderedItemCount: meta.renderedItemCount ?? null,
      resources: collectResourceTimings(),
    };

    logger.debug('PerfMetrics: 侧边栏打开耗时', record);

    // 异步补齐平台与点击前置段后写入环形缓冲（fire-and-forget）：
    // 读取现有日志 → 追加 → 截断至上限
    void Promise.all([getPlatformOs(), consumeOpenRequest()])
      .then(([os, openRequest]) => {
        record.os = os;
        record.clickToDocMs = openRequest.clickToDocMs;
        record.trigger = openRequest.trigger;
        return chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_PERF_LOG);
      })
      .then(result => {
        const log = (result[STORAGE_KEYS.SIDEPANEL_PERF_LOG] as SidepanelOpenMetrics[] | undefined) ?? [];
        log.push(record);
        return chrome.storage.local.set({
          [STORAGE_KEYS.SIDEPANEL_PERF_LOG]: log.slice(-PERF_LOG_MAX_ENTRIES),
        });
      })
      .catch(error => logger.debug('PerfMetrics: 写入性能日志失败', error));
  } catch (error) {
    logger.debug('PerfMetrics: 记录性能指标失败', error);
  }
}
