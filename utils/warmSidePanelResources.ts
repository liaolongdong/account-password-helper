/**
 * 侧边栏渲染资源预热工具（Service Worker 侧）
 *
 * 背景：Windows 会话失效（≈长时间空闲）后打开侧边栏会出现数秒白屏——卡点在渲染进程
 * 冷启动 + 扩展文件被移出 OS 磁盘缓存后的冷读（杀软扫描 + V8 编译）。SW 保活只温热
 * SW 进程，管不到侧边栏渲染进程/JS chunk 的磁盘缓存。
 *
 * 本工具从 SW 侧 `fetch()` 侧边栏自身打包资源（sidepanel.html 及其入口 JS/CSS），
 * 将文件读入以温热 OS 磁盘缓存与 Chrome 资源缓存，降低后续渲染进程冷加载文件的耗时。
 * 属尽力而为的缓解：可缩短冷文件读取/扫描耗时，但无法温热「渲染进程创建」本身。
 *
 * 免新权限：扩展在自身上下文 `fetch` 自身打包资源无需 web_accessible_resources 或额外权限。
 * 仅在 Windows + 会话失效时按节流执行；非 Windows / 会话有效期直接跳过，避免无谓开销。
 */
import { logger } from '@/utils/logger';
import { isWindowsPlatform } from '@/utils/platform';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';

/** 侧边栏入口 HTML（相对扩展根路径），经 chrome.runtime.getURL 解析为绝对 URL */
const SIDEPANEL_HTML = 'sidepanel.html';

/**
 * 预热节流窗口（毫秒）
 *
 * SIDEPANEL_PRELOAD（hover/focus 抢跑）与 SW 保活 tick（空闲期持续温热）共用本节流：
 * 先触发者预热、后触发者在窗口内被去重，兼顾缓存新鲜度与低损耗。
 */
const WARM_THROTTLE_MS = 60000;

/** 上次预热时间戳（毫秒），模块级维护（Service Worker 生命周期内有效） */
let _lastWarmAt = 0;

/**
 * 从侧边栏 HTML 文本中提取需预热的静态资源 URL（module 脚本与样式表）
 *
 * 使用容错正则兼容属性顺序（src/href 可能位于 type/rel 之前或之后）与 `media="print"` 等附加属性；
 * 仅提取 `<script type="module" src>` 与 `<link rel="stylesheet" href>`，忽略图标等其它链接。
 * 纯函数、无副作用，导出以便单测。
 *
 * @param html 侧边栏入口 HTML 文本
 * @returns 去重后的资源 URL 列表（保持原始出现顺序）
 */
export function extractSidePanelAssetUrls(html: string): string[] {
  const urls: string[] = [];

  // module 入口脚本：匹配同时含 type="module" 与 src 的 <script>（兼容属性顺序）
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) urls.push(src);
  }

  // 样式表：匹配同时含 rel="stylesheet" 与 href 的 <link>（兼容属性顺序与 media 属性）
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) urls.push(href);
  }

  // 去重并保持出现顺序
  return [...new Set(urls)];
}

/**
 * 依据 storage.local 中的会话过期时间戳，轻量判定当前会话是否有效
 *
 * 仅做过期时间比较（不触发密钥派生/解密），供预热门控使用：
 * 会话有效期内本就秒开、无需预热。读取失败时按「无效」处理（倾向于执行预热的安全侧）。
 */
async function isSessionCurrentlyValid(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(SESSION_STORAGE_KEYS.PASSWORD_EXPIRY);
    const expiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | undefined;
    return !!expiry && Date.now() < expiry;
  } catch {
    return false;
  }
}

/**
 * 按需预热侧边栏渲染资源（Windows 会话失效期）
 *
 * 门控与节流（依次判定，任一不满足即跳过）：
 * 1. 非 Windows → 跳过（Mac/Linux 冷路径本就快）；
 * 2. 命中 60s 节流窗口 → 跳过；
 * 3. 会话有效 → 跳过（本就秒开；此时不占用节流窗口，使会话一旦失效即可立即预热）。
 *
 * 通过后 `fetch` sidepanel.html 及其入口 JS/CSS，温热磁盘/资源缓存。
 * 全程 fire-and-forget：任何异常均静默吞掉，绝不影响调用方（保活 / 预唤醒路径）。
 */
export async function maybeWarmSidePanelResources(): Promise<void> {
  try {
    if (!(await isWindowsPlatform())) return;

    const now = Date.now();
    if (now - _lastWarmAt < WARM_THROTTLE_MS) return;

    // 会话有效期内无需预热；此处不占用节流窗口，
    // 以便会话一旦失效，下一次调用（hover 抢跑 / 保活 tick）能立即预热
    if (await isSessionCurrentlyValid()) return;

    // 通过全部门控，占用节流窗口后再执行预热
    _lastWarmAt = now;

    const baseUrl = chrome.runtime.getURL(SIDEPANEL_HTML);
    const html = await fetch(baseUrl).then(res => res.text());
    const assetUrls = extractSidePanelAssetUrls(html);

    // 并行预热各资源（单个失败不影响其余）
    await Promise.all(
      assetUrls.map(url =>
        fetch(new URL(url, baseUrl).href).catch(() => {
          // 单个资源预热失败静默忽略
        }),
      ),
    );

    logger.debug(`SidePanel: 资源预热完成（Windows 会话失效期），资源数 ${assetUrls.length}`);
  } catch (error) {
    // 预热为尽力而为的优化，任何异常静默吞掉，绝不影响调用方
    logger.debug('SidePanel: 资源预热跳过/失败', error);
  }
}
