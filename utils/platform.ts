/**
 * 平台检测工具
 *
 * 提供跨上下文（Service Worker / 扩展页面）复用的操作系统平台判断。
 * 结果在模块生命周期内缓存，避免重复的 chrome.runtime.getPlatformInfo() 异步调用。
 */
import { logger } from '@/utils/logger';

/** 缓存的「是否 Windows」结果（null 表示尚未检测） */
let _isWindowsCache: boolean | null = null;

/** 进行中的检测 Promise，用于并发去重，避免冷启动并发多次调用 getPlatformInfo */
let _inFlight: Promise<boolean> | null = null;

/**
 * 判断当前运行平台是否为 Windows
 *
 * 基于 `chrome.runtime.getPlatformInfo().os === 'win'` 判定，结果在模块生命周期内缓存；
 * 首次调用触发异步检测（含 in-flight 去重），后续命中缓存同步返回。
 * 获取失败时回退为 `false`（按非 Windows 处理），确保既有平台行为不受异常影响。
 *
 * @returns 当前平台为 Windows 时解析为 true，否则 false
 */
export function isWindowsPlatform(): Promise<boolean> {
  if (_isWindowsCache !== null) return Promise.resolve(_isWindowsCache);
  if (_inFlight) return _inFlight;

  _inFlight = chrome.runtime
    .getPlatformInfo()
    .then(info => {
      _isWindowsCache = info.os === 'win';
      return _isWindowsCache;
    })
    .catch(error => {
      logger.error('检测平台信息失败，回退为非 Windows:', error);
      _isWindowsCache = false;
      return false;
    })
    .finally(() => {
      _inFlight = null;
    });

  return _inFlight;
}
