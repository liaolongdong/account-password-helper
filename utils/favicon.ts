/**
 * 网站图标（favicon）工具
 *
 * 基于 Chrome 扩展 `_favicon/` 本地端点读取浏览器已缓存的网站图标，
 * 全程不发起任何外部网络请求，契合插件「零网络」安全定位。
 * 需要 manifest `favicon` 权限（Chrome 104+）；不支持该端点的环境
 * （如 Firefox）返回的 URL 会加载失败，由调用方（SiteFavicon 组件）
 * 降级渲染默认图标，不影响原有展示。
 *
 * @module utils/favicon
 */

/**
 * 将 URL 文本归一化为带协议的完整链接
 *
 * 密码条目的 url 字段允许不带协议（如 `github.com`），
 * `_favicon/` 端点要求完整 URL 才能命中缓存。
 *
 * @param url 原始 URL 文本
 * @returns 带协议的完整 URL；空输入返回空字符串
 */
export function normalizeUrlForFavicon(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * 构造网站图标的本地 `_favicon/` 端点 URL
 *
 * @param pageUrl 网站地址（可不带协议）
 * @param size 期望的图标尺寸（像素，常用 16/32/64；高分屏建议传显示尺寸的 2 倍）
 * @returns 图标 URL；无法构造（空地址 / 非扩展环境）时返回空字符串
 */
export function getFaviconUrl(pageUrl: string, size = 32): string {
  const normalized = normalizeUrlForFavicon(pageUrl);
  if (!normalized) return '';

  try {
    const base = chrome?.runtime?.getURL?.('/_favicon/');
    if (!base) return '';
    return `${base}?pageUrl=${encodeURIComponent(normalized)}&size=${size}`;
  } catch {
    // 非扩展环境（如单元测试局部 mock 缺失）安全降级
    return '';
  }
}

// ── favicon dataURL（供内容脚本消费） ────────────────────────

/**
 * favicon dataURL 内存缓存（key = 归一化 URL|size）
 *
 * 同一域名的图标在 SW 存活期内只读取转码一次；FIFO 淘汰防无界增长。
 */
const _faviconDataUrlCache = new Map<string, Promise<string>>();

/** 缓存容量上限（每条约 1~4KB，200 条内存占用可控） */
const FAVICON_CACHE_MAX = 200;

/**
 * 读取网站图标并转为 dataURL（仅限扩展自身上下文调用，如 background SW）
 *
 * 用于内联下拉等内容脚本注入 UI：网页环境无法直接加载 chrome-extension://
 * 的 `_favicon/` 资源（需暴露 web_accessible_resources，会引入网页探测浏览
 * 历史的隐私风险），改由 background 读取本地缓存转码后随元数据下发。
 * 全程本地 IO，零外部网络请求；任意失败安全降级返回空字符串。
 *
 * @param pageUrl 网站地址（可不带协议）
 * @param size 图标尺寸（像素）
 * @returns `data:image/...;base64,...` 字符串；无图标/失败时返回空字符串
 */
export async function fetchFaviconDataUrl(pageUrl: string, size = 32): Promise<string> {
  const endpoint = getFaviconUrl(pageUrl, size);
  if (!endpoint) return '';

  const cacheKey = `${normalizeUrlForFavicon(pageUrl)}|${size}`;
  let pending = _faviconDataUrlCache.get(cacheKey);
  if (!pending) {
    if (_faviconDataUrlCache.size >= FAVICON_CACHE_MAX) {
      const oldest = _faviconDataUrlCache.keys().next().value;
      if (oldest !== undefined) _faviconDataUrlCache.delete(oldest);
    }
    pending = (async () => {
      const res = await fetch(endpoint);
      if (!res.ok) return '';
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0) return '';
      // SW 环境无 FileReader，手动 base64 编码（favicon 仅几 KB，开销可忽略）
      let binary = '';
      for (const byte of buf) binary += String.fromCharCode(byte);
      const mime = res.headers.get('content-type') || 'image/png';
      return `data:${mime};base64,${btoa(binary)}`;
    })();
    _faviconDataUrlCache.set(cacheKey, pending);
    // 失败不缓存失败态，保留下次重试机会；按身份删除避免误删新条目
    const createdPromise = pending;
    pending.catch(() => {
      if (_faviconDataUrlCache.get(cacheKey) === createdPromise) _faviconDataUrlCache.delete(cacheKey);
    });
  }

  try {
    return await pending;
  } catch {
    // fail-safe：图标获取失败不影响主流程，调用方降级为默认图标
    return '';
  }
}
