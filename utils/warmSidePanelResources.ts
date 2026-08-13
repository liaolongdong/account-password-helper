/**
 * 侧边栏渲染资源预热工具（Service Worker 侧）
 *
 * 背景：Windows 会话失效（≈长时间空闲）后打开侧边栏会出现数秒白屏——卡点在渲染进程
 * 冷启动 + 扩展文件被移出 OS 磁盘缓存后的冷读（杀软扫描 + V8 编译）。SW 保活只温热
 * SW 进程，管不到侧边栏渲染进程/JS chunk 的磁盘缓存。
 *
 * 本工具从 SW 侧 `fetch()` 侧边栏全量打包资源——包括入口 HTML、module 脚本、
 * modulepreload 依赖 chunk（Vue 运行时等）、样式表、入口 JS 中的动态 import chunk
 * （sessionManager-storage / passwordCrud / HelpDialog 等），以及动态 chunk 静态引入的
 * 二级依赖 chunk（如认证视图的 Element Plus 重组件），将文件读入以温热 OS 磁盘
 * 缓存与 Chrome 资源缓存，最大限度降低后续渲染进程冷加载文件的耗时。
 * 属尽力而为的缓解：可缩短冷文件读取/扫描耗时，但无法温热「渲染进程创建」本身。
 *
 * 免新权限：扩展在自身上下文 `fetch` 自身打包资源无需 web_accessible_resources 或额外权限。
 * 常规调用在 Windows 按 5 分钟节流全量预热，不区分会话状态——OS 磁盘缓存逐出
 * （杀软扫描 / 内存压力）与会话有效性无关，会话有效期内同样会命中冷读白屏；
 * 非 Windows 常规调用默认跳过，但可经 allowNonWindowsLightweight 降级为轻量预热
 * （第一/二层 + 认证视图关键动态 chunk 及其二级依赖，~12 个小文件）——
 * Mac 长时间未操作后 OS 同样会逐出扩展文件，首开命中文件全冷读即
 * “间隔一段时间偶现白屏”（认证视图的 Element Plus CSS 运行时 chunk 是最大冷读单体，
 * 故白名单保留该 chunk，其余按需 chunk 仍跳过）；
 * 浏览器首启（ignorePlatformGate）场景 OS 磁盘缓存全冷，Mac 重启后首开同样白屏，
 * 故该场景跨平台全量执行。
 */
import { logger } from '@/utils/logger';
import { isWindowsPlatform } from '@/utils/platform';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

/** 侧边栏入口 HTML（相对扩展根路径），经 chrome.runtime.getURL 解析为绝对 URL */
const SIDEPANEL_HTML = 'sidepanel.html';

/**
 * 轻量预热（非 Windows）动态 chunk 白名单（按 Vite 产物相对路径前缀匹配，hash 可变）
 *
 * 认证视图 chunk 是认证态首屏必需的最大冷读单体（自身 ~11KB + 静态引入的
 * Element Plus CSS 运行时 chunk ~80KB）：macOS 长时间空闲后 UBC 逐出这组文件，
 * 下次认证态打开全冷读即数秒白屏——这正是 Mac「间隔一段时间后打开侧边栏白屏」
 * 的主导根因。轻量预热按白名单保留该 chunk（二级静态依赖由递归收集自动带入），
 * 其余按需 chunk（HelpDialog / passwordCrud 等交互时才用）仍跳过以控制常态 IO。
 */
const LIGHTWEIGHT_DYNAMIC_CHUNK_ALLOWLIST: RegExp[] = [/^\.\/SidepanelAuthView-/];

/**
 * 预热节流窗口（毫秒）
 *
 * 侧边栏打开后延时预热与 SW 保活 tick（空闲期温热）共用本节流：
 * 先触发者预热、后触发者在窗口内被去重。
 *
 * 取值 5 分钟：与保活 tick 周期（~15s）解耦——此前取 30s 与保活间隔对齐，
 * 等于会话失效期全天候每 30s 一轮全量 fetch（~20 文件），既加剧系统 IO/杀软
 * 扫描压力，用户点击落在预热窗口内时还会与渲染进程首屏资源加载争抢磁盘带宽
 * （白屏放大器）。OS 磁盘缓存并不会在分钟级被逐出，5 分钟粒度的温热已覆盖
 * 绝大多数冷读场景，同时把预热的常态开销降低一个数量级。
 */
const WARM_THROTTLE_MS = 5 * 60 * 1000;

/**
 * 上次预热时间戳（毫秒），内存镜像
 *
 * 真实来源持久化于 chrome.storage.session（SW 重启不归零，浏览器重启即清——
 * 与「重启后磁盘缓存全冷需重新预热」语义天然一致）。此前仅模块级维护，
 * SW 冷启后归零导致用户打开侧边栏瞬间必然触发全量预热，
 * 与渲染进程关键资源加载争抢磁盘 IO / 杀软扫描带宽，放大白屏时长。
 */
let _lastWarmAt = 0;

/** 进行中的预热 Promise（模块级 in-flight 互斥，防止并发触发源重复全量 fetch） */
let _warmInFlight: Promise<void> | null = null;

/**
 * 读取持久化的上次预热时间戳（读取失败按 0 处理，倾向执行预热的安全侧）
 */
async function readPersistedWarmAt(): Promise<number> {
  try {
    const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.SIDEPANEL_WARM_AT);
    return (result[SESSION_MEMORY_KEYS.SIDEPANEL_WARM_AT] as number | undefined) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 从侧边栏 HTML 文本中提取需预热的静态资源 URL
 *
 * 提取范围（按关键程度排序）：
 * 1. `<script type="module" src>` — 入口 JS chunk
 * 2. `<link rel="modulepreload" href>` — 关键依赖 chunk（Vue 运行时、logger 等）
 * 3. `<link rel="stylesheet" href>` — 样式表（含 media="print" 非阻塞加载）
 *
 * 使用容错正则兼容属性顺序（src/href 可能位于 type/rel 之前或之后）与附加属性；
 * 忽略图标等其它链接。纯函数、无副作用，导出以便单测。
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

  // modulepreload 依赖 chunk：匹配同时含 rel="modulepreload" 与 href 的 <link>
  // 这些是入口 chunk 的关键依赖（Vue 运行时、logger、工具模块等），
  // 浏览器在解析入口脚本前即开始加载，冷读时同样受杀软扫描影响
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']modulepreload["']/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) urls.push(href);
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
 * 从 JS chunk 文本中提取静态 import/export 引用的同目录 chunk 相对路径
 *
 * Vite 压缩产物中静态引用形如 `from"./chunkName-HASH.js"`（具名导入/再导出）
 * 或 `import"./chunkName-HASH.js"`（副作用导入）。动态 import 因带括号
 * `import(...)` 不会被本正则命中，由 extractDynamicImportUrls 单独处理。
 *
 * 用于递归预热动态 chunk 的二级静态依赖（如认证视图静态引入的 Element Plus
 * 重组件 chunk，认证态首屏最大的冷读单体）。纯函数、无副作用，导出以便单测。
 *
 * @param jsText JS chunk 的文本内容
 * @returns 去重后的静态引用 chunk 相对路径列表（保持出现顺序）
 */
export function extractStaticImportUrls(jsText: string): string[] {
  const urls: string[] = [];
  for (const match of jsText.matchAll(/\b(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g)) {
    urls.push(match[1]);
  }
  return [...new Set(urls)];
}

/**
 * 从动态 chunk 的 fetch 结果中收集尚未预热的二级静态依赖绝对 URL
 *
 * 相对路径以各动态 chunk 自身的绝对 URL 为基准解析（Promise.allSettled 保序，
 * 结果与 dynamicHrefs 一一对应），不依赖「所有 chunk 同目录」的构建假设。
 * 单个 chunk 文本读取失败静默跳过，不影响其余依赖收集；收集到的 URL
 * 同步写入 warmedHrefs 集合完成跨层去重。
 *
 * @param dynamicResults 动态 chunk 的 fetch settled 结果列表（与 dynamicHrefs 同序）
 * @param dynamicHrefs 动态 chunk 的绝对 URL 列表（作为各自二级依赖的解析基准）
 * @param warmedHrefs 已预热资源的绝对 URL 集合（原地追加新收集的 URL）
 * @returns 尚未预热的二级依赖 chunk 绝对 URL 列表
 */
async function collectStaticDepHrefs(
  dynamicResults: PromiseSettledResult<Response>[],
  dynamicHrefs: string[],
  warmedHrefs: Set<string>,
): Promise<string[]> {
  const secondaryHrefs: string[] = [];
  for (const [index, result] of dynamicResults.entries()) {
    if (result.status !== 'fulfilled' || !result.value.ok) continue;
    try {
      const chunkText = await result.value.text();
      for (const relUrl of extractStaticImportUrls(chunkText)) {
        const href = new URL(relUrl, dynamicHrefs[index]).href;
        if (warmedHrefs.has(href)) continue;
        warmedHrefs.add(href);
        secondaryHrefs.push(href);
      }
    } catch {
      // 单个动态 chunk 文本读取失败不影响其余依赖收集
    }
  }
  return secondaryHrefs;
}

/**
 * 从入口 JS chunk 文本中提取动态 import 的 chunk URL
 *
 * Vite 构建产物中动态 import 形如 `import("./chunkName-HASH.js")`，
 * 提取这些 URL 以便预热按需加载的模块（sessionManager-storage / passwordCrud /
 * HelpDialog / autoSaveManager / useSidepanelSettings 等），
 * 避免用户首次交互时触发冷 chunk fetch 造成数秒延迟。
 *
 * 纯函数、无副作用，导出以便单测。
 *
 * @param jsText 入口 JS chunk 的文本内容
 * @returns 去重后的动态 import chunk 相对路径列表
 */
export function extractDynamicImportUrls(jsText: string): string[] {
  const urls: string[] = [];
  // 匹配 import("./xxx.js") 或 import('./xxx.js') 模式
  for (const match of jsText.matchAll(/import\(\s*["'](\.\/[^"']+\.js)["']\s*\)/g)) {
    urls.push(match[1]);
  }
  return [...new Set(urls)];
}

/**
 * 预热选项
 */
export interface WarmSidePanelOptions {
  /**
   * 浏览器首启冷缓存模式：忽略「非 Windows → 跳过」平台门控
   *
   * 浏览器刚启动（chrome.runtime.onStartup）时 OS 磁盘缓存全冷、渲染进程冷、
   * V8 无 code cache，Mac 重启后首开同样出现长白屏，
   * 故置 true 时跨平台强制执行一次全量资源预热。
   */
  ignorePlatformGate?: boolean;

  /**
   * 非 Windows 平台降级为轻量预热（第一/二层：HTML + module 脚本 +
   * modulepreload 依赖 + 样式表，另按白名单附加认证视图关键动态 chunk
   * 及其二级静态依赖，共 ~12 个小文件），而非直接跳过
   *
   * Mac/Linux 长时间未操作后 OS 同样会逐出扩展文件磁盘缓存，首开命中全冷读
   * 即「间隔一段时间偶现白屏几秒」的直接根因。轻量层覆盖首屏关键路径资源
   * 与认证态关键 chunk（认证视图 + Element Plus CSS 运行时，Mac 白屏最大冷读
   * 单体），跳过其余按需动态 chunk 递归层（非 Windows 磁盘 IO 快、无杀软扫描
   * 放大，按需 chunk 冷读代价低），在收益与常态 IO 开销间取平衡。Windows 不受
   * 本选项影响，仍执行全量四层预热。调用时机：窗口聚焦恢复 / 侧边栏打开后
   * 延时预热 / SW 保活 tick（均共用 5 分钟节流，不增加高频 IO）。
   */
  allowNonWindowsLightweight?: boolean;
}

/**
 * 按需预热侧边栏全量渲染资源（Windows 常规节流预热 / 浏览器启动冷缓存期跨平台预热）
 *
 * 门控与节流（依次判定，任一不满足即跳过）：
 * 1. 非 Windows 且非浏览器首启 → 跳过（Mac/Linux 磁盘 IO 快、无杀软扫描放大，
 *    日常路径本就快；浏览器首启经 options.ignorePlatformGate 跨平台放行——
 *    重启后磁盘缓存全冷，Mac 首开同样白屏）；
 * 2. 命中 5 分钟节流窗口 → 跳过。
 *
 * 不设会话状态门控：OS 磁盘缓存逐出（杀软扫描 / 内存压力）与会话有效性无关，
 * 会话有效期内扩展文件同样可能被逐出导致骨架屏前白屏，Windows 常规调用
 * 无论会话状态均按节流预热（每 5 分钟最多一轮 ~25 个小文件 fetch，开销可忽略）。
 *
 * 预热范围（四层递进，轻量模式仅收窄第三层范围）：
 * - 第一层：sidepanel.html 本身（温热入口 HTML）
 * - 第二层：HTML 中引用的 module 脚本 + modulepreload 依赖 + 样式表
 * - 第三层：入口 JS 中的动态 import chunk——全量模式覆盖全部按需模块
 *   （sessionManager-storage / passwordCrud / HelpDialog / autoSaveManager /
 *   useSidepanelSettings 等）；轻量模式按白名单仅覆盖认证视图 chunk
 * - 第四层：动态 chunk 静态引入的二级依赖 chunk（如认证视图的 Element Plus
 *   CSS 运行时 chunk，认证态首屏最大的冷读单体）
 *
 * 全程 fire-and-forget：任何异常均静默吞掉，绝不影响调用方（保活 / 预唤醒 / 启动路径）。
 *
 * @param options 预热选项（缺省保持原有门控行为）
 */
export function maybeWarmSidePanelResources(options: WarmSidePanelOptions = {}): Promise<void> {
  // in-flight 并发去重：节流判定含多次 await（平台/持久化/会话读取），
  // 并发触发源（保活 tick / 打开后延时预热）可能在异步间隙内同时通过节流检查，
  // 导致两轮全量 fetch 并发执行（IO 突刺加倍），以模块级互斥消除
  if (_warmInFlight) return _warmInFlight;
  _warmInFlight = doWarmSidePanelResources(options).finally(() => {
    _warmInFlight = null;
  });
  return _warmInFlight;
}

/**
 * 预热第三/四层：动态 import chunk 及其静态引入的二级依赖（全量/轻量共用流程）
 *
 * 从入口 JS chunk 文本中提取动态 import URL，可选按白名单过滤（轻量模式仅保留
 * 认证视图关键 chunk，见 LIGHTWEIGHT_DYNAMIC_CHUNK_ALLOWLIST），随后预热过滤后的
 * 动态 chunk 并递归一层收集其静态引入的二级依赖（认证视图的 Element Plus CSS
 * 运行时 chunk 经静态 import 引入，仅靠动态 import 正则会漏网）。任何环节失败
 * 静默跳过，不影响已完成的第一/二层预热。
 *
 * @param fetchResults 第二层资源的 fetch settled 结果列表（与 assetUrls 同序，用于复用入口 JS 响应体）
 * @param assetUrls 第二层资源 URL 列表（保持原始出现顺序，第一个 .js 即入口 module 脚本）
 * @param baseUrl 侧边栏入口 HTML 的绝对 URL（相对路径解析基准）
 * @param dynamicChunkFilter 动态 chunk 相对路径白名单（缺省 = 不过滤，全量预热）
 */
async function warmDynamicChunks(
  fetchResults: PromiseSettledResult<Response>[],
  assetUrls: string[],
  baseUrl: string,
  dynamicChunkFilter?: RegExp[],
): Promise<void> {
  // 找到入口 module 脚本的 fetch 结果（assetUrls 中第一个 .js，即 <script type="module" src>）
  const entryJsUrl = assetUrls.find(url => url.includes('.js'));
  if (!entryJsUrl) return;
  const entryResult = fetchResults[assetUrls.indexOf(entryJsUrl)];
  if (entryResult?.status !== 'fulfilled' || !entryResult.value.ok) return;

  try {
    const entryJsText = await entryResult.value.text();
    let dynamicUrls = extractDynamicImportUrls(entryJsText);
    // 轻量模式：按白名单收窄至认证关键 chunk（白名单按产物相对路径前缀匹配）
    if (dynamicChunkFilter) {
      dynamicUrls = dynamicUrls.filter(relUrl => dynamicChunkFilter.some(pattern => pattern.test(relUrl)));
    }
    if (dynamicUrls.length === 0) return;

    // 动态 import chunk 相对于入口 JS 所在目录（通常为 /chunks/）
    const entryBase = new URL(entryJsUrl, baseUrl).href;
    // 已预热资源的绝对 URL 集合，供第三/四层跨层去重（避免重复 fetch 同一 chunk）
    const warmedHrefs = new Set(assetUrls.map(url => new URL(url, baseUrl).href));
    const dynamicHrefs = dynamicUrls
      .map(relUrl => new URL(relUrl, entryBase).href)
      .filter(href => !warmedHrefs.has(href));
    dynamicHrefs.forEach(href => warmedHrefs.add(href));
    const dynamicResults = await Promise.allSettled(dynamicHrefs.map(href => fetch(href)));

    // 第四层：递归一层，预热动态 chunk 静态引入的二级依赖 chunk
    //（认证视图依赖的 Element Plus CSS 运行时 chunk 经静态 import 引入，
    //  仅靠动态 import 正则会漏网，需从动态 chunk 文本中二次提取）
    const secondaryHrefs = await collectStaticDepHrefs(dynamicResults, dynamicHrefs, warmedHrefs);
    if (secondaryHrefs.length > 0) {
      await Promise.allSettled(secondaryHrefs.map(href => fetch(href)));
    }

    logger.debug(
      `SidePanel: 动态 chunk 预热完成，动态 chunk ${dynamicHrefs.length} + 二级依赖 ${secondaryHrefs.length}${dynamicChunkFilter ? '（轻量白名单）' : ''}`,
    );
  } catch {
    // 入口 JS 文本读取/解析失败，不影响已完成的静态资源预热
  }
}

/** 预热执行体（由 maybeWarmSidePanelResources 经 in-flight 互斥调度） */
async function doWarmSidePanelResources(options: WarmSidePanelOptions): Promise<void> {
  try {
    // 平台门控与预热模式判定：
    // - Windows / 浏览器首启（ignorePlatformGate）→ 全量四层预热；
    // - 非 Windows 常规调用：允许轻量模式（allowNonWindowsLightweight）时
    //   预热第一/二层 + 白名单动态 chunk（Mac 长时间未操作后磁盘缓存逐出的
    //   首开白屏缓解），否则保持既往行为直接跳过
    let lightweight = false;
    if (!options.ignorePlatformGate && !(await isWindowsPlatform())) {
      if (!options.allowNonWindowsLightweight) return;
      lightweight = true;
    }

    // 节流判定：内存镜像快路径命中直接跳过；未命中时读取 storage.session
    // 持久化时间戳复核（SW 冷启后内存镜像归零，避免误判为「从未预热」）
    const now = Date.now();
    if (now - _lastWarmAt < WARM_THROTTLE_MS) return;
    _lastWarmAt = Math.max(_lastWarmAt, await readPersistedWarmAt());
    if (now - _lastWarmAt < WARM_THROTTLE_MS) return;

    // 注意：不设会话状态门控——磁盘缓存逐出与会话有效性无关（详见函数头注释），
    // 会话有效期内同样按节流预热，根治「会话有效 + 文件被逐出」的冷读白屏

    // 通过全部门控，占用节流窗口后再执行预热（同步更新内存镜像 +
    // fire-and-forget 持久化，跨 SW 生命周期保持窗口有效）
    _lastWarmAt = now;
    try {
      void chrome.storage.session.set({ [SESSION_MEMORY_KEYS.SIDEPANEL_WARM_AT]: now }).catch(() => {});
    } catch {
      // storage.session 不可用时退化为纯内存节流，不影响预热执行
    }

    const baseUrl = chrome.runtime.getURL(SIDEPANEL_HTML);
    const html = await fetch(baseUrl).then(res => res.text());
    const assetUrls = extractSidePanelAssetUrls(html);

    // 第二层：并行预热 HTML 引用的静态资源（module 脚本 + modulepreload + CSS）
    const fetchResults = await Promise.allSettled(assetUrls.map(url => fetch(new URL(url, baseUrl).href)));

    // 轻量模式（非 Windows）：第一/二层 + 白名单认证关键 chunk（含二级依赖），
    // 跳过其余按需动态 chunk——认证视图的 Element Plus CSS 运行时 chunk 是
    // macOS 磁盘缓存逐出后认证态打开的最大冷读单体，必须随轻量预热温热
    if (lightweight) {
      await warmDynamicChunks(fetchResults, assetUrls, baseUrl, LIGHTWEIGHT_DYNAMIC_CHUNK_ALLOWLIST);
      logger.debug(`SidePanel: 资源轻量预热完成（非 Windows），静态资源 ${assetUrls.length} + 认证关键 chunk`);
      return;
    }

    // 全量模式（Windows / 浏览器首启）：第三/四层覆盖全部动态 chunk
    await warmDynamicChunks(fetchResults, assetUrls, baseUrl);
    logger.debug(`SidePanel: 资源预热完成，静态资源 ${assetUrls.length}`);
  } catch (error) {
    // 预热为尽力而为的优化，任何异常静默吞掉，绝不影响调用方
    logger.debug('SidePanel: 资源预热跳过/失败', error);
  }
}
