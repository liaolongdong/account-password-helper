/**
 * 平台检测工具
 *
 * 提供跨上下文（Service Worker / 扩展页面）复用的操作系统平台判断，含两类 API：
 *
 * - 异步三态判定（`detectWindowsPlatform` / `isWindowsPlatform`）：基于
 *   `chrome.runtime.getPlatformInfo()`，结果在模块生命周期内缓存，避免重复异步调用；
 *   成功判定同时持久化到 storage.local，供 SW 冷启动早期 API 异常时兜底
 *   （Windows 保活闹钟决策依赖本判定，误判为非 Windows 会导致保活被误清）。
 * - 同步嗅探（`isMacPlatform`）：供模块级常量与 composable 同步初始化等
 *   无法 await 的路径使用，仅服务于误判影响轻微的展示层场景。
 */
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/** 缓存的「是否 Windows」结果（null 表示尚未检测成功） */
let _isWindowsCache: boolean | null = null;

/** 进行中的检测 Promise，用于并发去重，避免冷启动并发多次调用 getPlatformInfo */
let _inFlight: Promise<boolean | null> | null = null;

/**
 * 检测当前运行平台是否为 Windows（三态结果）
 *
 * 基于 `chrome.runtime.getPlatformInfo().os === 'win'` 判定：
 * - 成功：结果缓存于模块生命周期内，并 fire-and-forget 持久化到 storage.local；
 * - 失败：回退读取持久化的历史判定（扩展安装后首次成功判定即长期可用）；
 *   持久化也不可用时返回 `null`（判定不可得），且不缓存失败结果——
 *   下次调用重新尝试，避免一次瞬时异常在 SW 生命周期内被固化为错误平台。
 *
 * 调用方可依据 `null` 做 fail-safe 决策（如保活闹钟同步：判定不可得时维持现状不清除）。
 *
 * @returns Windows 为 true，非 Windows 为 false，判定不可得为 null
 */
export function detectWindowsPlatform(): Promise<boolean | null> {
  if (_isWindowsCache !== null) return Promise.resolve(_isWindowsCache);
  if (_inFlight) return _inFlight;

  _inFlight = chrome.runtime
    .getPlatformInfo()
    .then(info => {
      _isWindowsCache = info.os === 'win';
      // 持久化成功判定（fire-and-forget），供后续 SW 冷启动异常时兜底
      try {
        void chrome.storage.local.set({ [STORAGE_KEYS.PLATFORM_IS_WINDOWS]: _isWindowsCache }).catch(() => {});
      } catch {
        // storage 不可用不影响本次判定结果
      }
      return _isWindowsCache;
    })
    .catch(async error => {
      logger.error('检测平台信息失败，尝试持久化兜底:', error);
      try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.PLATFORM_IS_WINDOWS);
        const persisted = result[STORAGE_KEYS.PLATFORM_IS_WINDOWS];
        if (typeof persisted === 'boolean') {
          _isWindowsCache = persisted;
          return persisted;
        }
      } catch {
        // 持久化读取失败，返回判定不可得
      }
      return null;
    })
    .finally(() => {
      _inFlight = null;
    });

  return _inFlight;
}

/**
 * 判断当前运行平台是否为 Windows
 *
 * detectWindowsPlatform 的两态便捷包装：判定不可得（null）时回退为 `false`
 * （按非 Windows 处理），适用于「预热与否」等失败影响轻微的场景；
 * 失败影响重大（如保活闹钟清除）的调用方应改用 detectWindowsPlatform 感知三态。
 *
 * @returns 当前平台为 Windows 时解析为 true，否则 false
 */
export async function isWindowsPlatform(): Promise<boolean> {
  return (await detectWindowsPlatform()) ?? false;
}

/**
 * 同步判断当前平台是否为 Apple 系（macOS / iOS / iPadOS）
 *
 * 与 `detectWindowsPlatform` 的异步三态判定不同，本函数只做同步 UA 嗅探，供模块级
 * 常量与 composable 同步初始化等无法 await 的路径使用（如快捷键未绑定时的兜底按键选择）。
 *
 * 仅适用于误判影响轻微的展示层场景：Apple 平台展示 `⌘`、其它平台展示 `Ctrl`，
 * 判错也只是修饰键风格不符预期，不影响功能正确性。涉及保活、预热等失败影响重大的
 * 决策仍应使用 `detectWindowsPlatform` 感知三态。
 *
 * 优先读 `navigator.userAgentData.platform`（Chromium 101+ 提供的结构化 UA），
 * 回退到已废弃但仍被普遍实现的 `navigator.platform`；两者皆不可得时（如 Node 测试
 * 环境无 DOM navigator）返回 false，按非 Apple 平台处理。
 *
 * @returns 当前平台为 Apple 系时为 true，否则 false
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;

  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}
