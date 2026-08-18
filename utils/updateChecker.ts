import type { UpdateInfo } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { GITHUB_RELEASES_API_URL, GITHUB_RELEASES_PAGE_URL, CHROME_WEB_STORE_CHECK_URL } from '@/utils/urls';

/**
 * 版本更新检测闹钟名称
 * 与 chrome.alarms API 配合使用，定期触发版本检测
 */
export const UPDATE_CHECK_ALARM_NAME = 'check-extension-update';

/**
 * 版本检测间隔（分钟）：每 6 小时检测一次
 * GitHub API 未认证时限速 60 次/小时，此间隔远低于限速阈值
 */
export const UPDATE_CHECK_INTERVAL_MINUTES = 360;

/**
 * CWS 可访问性缓存结果
 *
 * 首次检测后缓存 24 小时，避免每次更新检测都发起额外请求。
 * null 表示尚未检测或缓存已过期。
 */
let _cwsAccessibleCache: { accessible: boolean; checkedAt: number } | null = null;

/** CWS 可访问性缓存有效期（24 小时） */
const CWS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** CWS 探测请求超时时间（3 秒） */
const CWS_CHECK_TIMEOUT_MS = 3000;

/**
 * 比较两个语义化版本号
 * @param current - 当前版本号，如 "1.0.0"
 * @param latest - 目标版本号，如 "1.2.0"
 * @returns 若 latest > current 返回 true，否则返回 false
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parseVersion = (v: string): number[] => {
    // 去除前缀 "v" 并拆分为数字段
    return v
      .replace(/^v/i, '')
      .split('.')
      .map(n => parseInt(n, 10) || 0);
  };

  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);

  // 逐段比较（major → minor → patch）
  const maxLen = Math.max(currentParts.length, latestParts.length);
  for (let i = 0; i < maxLen; i++) {
    const c = currentParts[i] ?? 0;
    const l = latestParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

/**
 * 检测是否能访问 Chrome 应用商店（CWS）
 *
 * 通过发起轻量 HEAD 请求判断用户网络是否可达 CWS。
 * 中国大陆等被墙地区将无法访问，此时应通过 GitHub API 通知更新；
 * 可访问 CWS 的用户可直接在商店更新，无需 GitHub 通知打扰。
 *
 * @returns 可访问返回 true，网络错误/超时/被墙返回 false
 */
export async function canAccessChromeWebStore(): Promise<boolean> {
  // 检查缓存
  if (_cwsAccessibleCache && Date.now() - _cwsAccessibleCache.checkedAt < CWS_CACHE_TTL_MS) {
    return _cwsAccessibleCache.accessible;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CWS_CHECK_TIMEOUT_MS);

    const response = await fetch(CHROME_WEB_STORE_CHECK_URL, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const accessible = response.ok;
    _cwsAccessibleCache = { accessible, checkedAt: Date.now() };
    logger.info(`UpdateChecker: CWS 可访问性检测结果 ${accessible ? '可访问' : '不可访问'}`);
    return accessible;
  } catch (_error) {
    _cwsAccessibleCache = { accessible: false, checkedAt: Date.now() };
    logger.info('UpdateChecker: CWS 不可访问（网络错误/超时/被墙）');
    return false;
  }
}

/**
 * 重置 CWS 可访问性缓存（供测试或手动重新检测使用）
 */
export function resetCwsAccessCache(): void {
  _cwsAccessibleCache = null;
}

/**
 * 向 GitHub Releases API 请求最新版本信息
 * @returns 解析后的版本信息对象，若无新版本或请求失败则返回 null
 */
async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(GITHUB_RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (!response.ok) {
      logger.warn(`UpdateChecker: GitHub API 请求失败，状态码 ${response.status}`);
      return null;
    }

    const data = await response.json();

    // 解析 tag_name（通常为 "v1.2.0" 或 "1.2.0"）
    const tagName: string = data.tag_name ?? '';
    const latestVersion = tagName.replace(/^v/i, '').trim();

    if (!latestVersion) {
      logger.warn('UpdateChecker: 无法从 Release 数据中解析版本号');
      return null;
    }

    // 截断 release notes 至 200 字符，避免存储过多数据
    const rawBody: string = data.body ?? '';
    const releaseNotes = rawBody.length > 200 ? rawBody.slice(0, 200) + '...' : rawBody;

    return {
      latestVersion,
      downloadUrl: data.html_url || GITHUB_RELEASES_PAGE_URL,
      releaseNotes,
      publishedAt: data.published_at ?? '',
      checkedAt: Date.now(),
    };
  } catch (error) {
    logger.error('UpdateChecker: 请求 GitHub Releases API 失败:', error);
    return null;
  }
}

/**
 * 执行版本更新检测
 *
 * 检测策略：
 * 1. 先检测 CWS 可访问性（可访问则用户可在商店直接更新，跳过 GitHub 检测）
 * 2. CWS 不可访问时，请求 GitHub Releases API 获取最新版本
 * 3. 与当前插件版本比较
 * 4. 将检测结果缓存到 chrome.storage.local
 * 5. 发现新版本时返回 UpdateInfo，否则返回 null
 *
 * @param skipIfCwsAccessible 当 CWS 可访问时是否跳过检测（默认 true）
 */
export async function checkForUpdate(skipIfCwsAccessible = true): Promise<UpdateInfo | null> {
  // CWS 可访问性检测：可访问则用户可直接在商店更新，无需 GitHub 通知
  const cwsAccessible = await canAccessChromeWebStore();
  if (skipIfCwsAccessible && cwsAccessible) {
    logger.info('UpdateChecker: CWS 可访问，用户可在商店直接更新，跳过 GitHub 检测');
    // 清除旧的更新提示（若存在）
    await chrome.storage.local.remove(STORAGE_KEYS.UPDATE_INFO);
    return null;
  }

  const currentVersion = chrome.runtime.getManifest().version;
  logger.info(`UpdateChecker: 开始检测更新，当前版本 ${currentVersion}`);

  const releaseInfo = await fetchLatestRelease();

  if (!releaseInfo) {
    logger.info('UpdateChecker: 未能获取最新版本信息');
    return null;
  }

  logger.info(`UpdateChecker: 最新版本 ${releaseInfo.latestVersion}，当前版本 ${currentVersion}`);

  if (isNewerVersion(currentVersion, releaseInfo.latestVersion)) {
    // 发现新版本，缓存到 storage
    await chrome.storage.local.set({
      [STORAGE_KEYS.UPDATE_INFO]: releaseInfo,
    });
    logger.info(`UpdateChecker: 发现新版本 ${releaseInfo.latestVersion}，已缓存更新信息`);
    return releaseInfo;
  }

  // 已是最新版本，清除旧的更新提示（若存在）
  await chrome.storage.local.remove(STORAGE_KEYS.UPDATE_INFO);
  logger.info('UpdateChecker: 当前已是最新版本');
  return null;
}

/**
 * 从 chrome.storage.local 读取缓存的更新信息
 * @returns 缓存的 UpdateInfo，若不存在或已过期（超过 24 小时）则返回 null
 */
export async function getCachedUpdateInfo(): Promise<UpdateInfo | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.UPDATE_INFO);
    const info = result[STORAGE_KEYS.UPDATE_INFO] as UpdateInfo | undefined;

    if (!info) return null;

    // 超过 24 小时的缓存视为过期，避免用户长期看到过期的更新提示
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - info.checkedAt > ONE_DAY_MS) {
      logger.debug('UpdateChecker: 缓存的更新信息已过期（超过 24 小时）');
      return null;
    }

    // 再次比对版本号，防止用户已手动更新但缓存未清除
    const currentVersion = chrome.runtime.getManifest().version;
    if (!isNewerVersion(currentVersion, info.latestVersion)) {
      await chrome.storage.local.remove(STORAGE_KEYS.UPDATE_INFO);
      return null;
    }

    return info;
  } catch (error) {
    logger.error('UpdateChecker: 读取缓存的更新信息失败:', error);
    return null;
  }
}

/**
 * 获取 GitHub Release 页面 URL（用于通知点击跳转）
 */
export function getReleasesPageUrl(): string {
  return GITHUB_RELEASES_PAGE_URL;
}
