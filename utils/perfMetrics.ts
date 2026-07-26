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
import { STORAGE_KEYS } from '@/utils/storageKeys';
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
} as const;

/** 环形缓冲最大记录数 */
const PERF_LOG_MAX_ENTRIES = 20;

/** 单次侧边栏打开的性能记录（写入 storage.local 环形缓冲） */
export interface SidepanelOpenMetrics {
  /** 记录时间（epoch 毫秒） */
  ts: number;
  /** 文档启动 → 入口 JS 开始执行（渲染进程创建 + 资源加载 + 编译） */
  docToMainMs: number | null;
  /** 入口 JS 开始 → i18n 就绪（storage 语言偏好读取） */
  mainToI18nMs: number | null;
  /** i18n 就绪 → Vue onMounted（同步挂载与首帧渲染） */
  i18nToMountedMs: number | null;
  /** Vue onMounted → 首屏数据就绪（竞速数据加载） */
  mountedToDataMs: number | null;
  /** 文档启动 → 首屏数据就绪（端到端总耗时） */
  totalMs: number | null;
  /** 竞速胜出路径（bg=Background 缓存，local=本地直读，null=异常/未决出） */
  raceWinner: 'bg' | 'local' | null;
  /** 数据就绪时会话是否有效（区分锁定态/解锁态打开场景） */
  sessionValid: boolean;
}

/** initSidepanelData 返回的初始化元信息（性能记录维度） */
export interface SidepanelInitMeta {
  /** 竞速胜出路径 */
  raceWinner: 'bg' | 'local' | null;
  /** 初始化完成时会话是否有效 */
  sessionValid: boolean;
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
 * 记录本次侧边栏打开的完整耗时分解，并写入 storage.local 环形缓冲
 *
 * 应在首屏数据就绪（DATA_READY mark 已打点）后调用一次。
 * 存储写入为 fire-and-forget，不阻塞 UI；同时生成的 measure
 * 可在生产环境经 DevTools 时间线直接查看。
 *
 * @param meta 初始化元信息（竞速胜出路径 + 会话状态）
 */
export function recordSidepanelOpenMetrics(meta: SidepanelInitMeta): void {
  try {
    const record: SidepanelOpenMetrics = {
      ts: Date.now(),
      docToMainMs: measurePerf('sp:doc→main', 0, SP_PERF_MARKS.MAIN_START),
      mainToI18nMs: measurePerf('sp:main→i18n', SP_PERF_MARKS.MAIN_START, SP_PERF_MARKS.I18N_READY),
      i18nToMountedMs: measurePerf('sp:i18n→mounted', SP_PERF_MARKS.I18N_READY, SP_PERF_MARKS.MOUNTED),
      mountedToDataMs: measurePerf('sp:mounted→data', SP_PERF_MARKS.MOUNTED, SP_PERF_MARKS.DATA_READY),
      totalMs: measurePerf('sp:doc→data-ready', 0, SP_PERF_MARKS.DATA_READY),
      raceWinner: meta.raceWinner,
      sessionValid: meta.sessionValid,
    };

    logger.debug('PerfMetrics: 侧边栏打开耗时', record);

    // 环形缓冲写入（fire-and-forget）：读取现有日志 → 追加 → 截断至上限
    void chrome.storage.local
      .get(STORAGE_KEYS.SIDEPANEL_PERF_LOG)
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
