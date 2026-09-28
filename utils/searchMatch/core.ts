/**
 * 智能搜索匹配内核（子串 + 拼音/首字母缩写 + 命中高亮）—— 不依赖 Vue
 *
 * 与 `utils/searchMatch.ts` 的分工：本模块是纯逻辑内核，`searchMatch.ts` 是它的
 * Vue 响应式外壳（维持 `pinyinMatcherReady` ref，供过滤/渲染 computed 依赖）。
 *
 * 为什么要拆：拼音匹配需要同时服务侧边栏/options（Vue 世界）与 Background
 * （Service Worker）。外壳里的 `shallowRef` 会让 Vite 把 Vue 与 vue-i18n
 * （实测约 131KB 的 `i18n-*.js` 共享 chunk）拉进 SW 依赖图，破坏
 * 「background.js 不含 Vue」的首屏与包体积口径；而把匹配逻辑复制一份给 SW 又会
 * 让两侧的搜索口径各自演化。因此内核保持零 Vue 依赖，响应式只在壳层加一层。
 *
 * 其余设计要点（与拆分前一致）：
 * - 匹配策略分级：大小写不敏感子串命中优先（短路，零额外开销），
 *   未命中时降级拼音匹配（全拼 / 首字母缩写 / 中英混合，含多音字）；
 * - 拼音模块（pinyin-match，约 27KB）经动态 import 拆分为独立 chunk，
 *   不进入侧边栏/popup 首屏关键路径；首帧后由调用方预热（{@link warmPinyinMatcher}），
 *   未温热前搜索退化为子串匹配，行为与旧版完全一致；
 * - 全部纯函数 + 本地计算，零网络、零存储写入，与项目安全定位一致。
 */
import { registerPlaintextCacheCleaner } from '@/utils/plaintextCacheCleanup';

/** 拼音匹配模块类型（pinyin-match 默认导出：match 返回 [起始, 结束] 闭区间或 false） */
type PinyinMatchModule = typeof import('pinyin-match');

/** 已加载的拼音匹配模块实例（同步缓存，供过滤/高亮纯函数同步读取） */
let _pinyinModule: PinyinMatchModule | null = null;

/** 加载中的 Promise（单例：并发/重复预热共享同一次加载；失败置空可重试） */
let _loadPromise: Promise<PinyinMatchModule> | null = null;

/** 拼音匹配模块就绪状态（模块级单例；普通布尔，响应式由外壳层负责） */
let _pinyinReady = false;

/** 就绪订阅者（首次预热成功时同步通知；外壳据此更新响应式标志） */
const _readyListeners = new Set<() => void>();

/**
 * 拼音匹配模块当前是否已就绪
 *
 * 就绪前匹配只走子串分支，行为与未接入拼音的旧版一致。
 * @returns 已加载并可用返回 true
 */
export function isPinyinMatcherReady(): boolean {
  return _pinyinReady;
}

/**
 * 订阅「拼音模块就绪」事件
 *
 * 仅在首次就绪时同步通知一次；已就绪状态下的重复订阅不会回调——调用方先用
 * {@link isPinyinMatcherReady} 读取初始值，避免「订阅即回调」与初始化两条路径并存。
 *
 * @param listener 就绪回调（无参、无返回值）
 * @returns 取消订阅函数
 */
export function onPinyinMatcherReady(listener: () => void): () => void {
  _readyListeners.add(listener);
  return () => {
    _readyListeners.delete(listener);
  };
}

/**
 * 预热拼音匹配模块（幂等，返回加载 Promise 供调用方按需 await）
 *
 * 建议在首帧渲染完成后的空闲时机调用（侧边栏 preloadIdleModules /
 * options onMounted / Background 收到检索请求时），使用户首次输入前模块已温热；
 * 重复调用不产生额外加载，生产调用方无需 await（fire-and-forget，失败静默降级为子串匹配）。
 *
 * 注意：动态 import 必须直接出现在函数体内（不能经 lazyImport 等闭包间接包装），
 * 否则 Vite 静态分析无法识别，pinyin-match（约 27KB 数据）会被并入
 * 侧边栏首屏共享 chunk，违反首屏体积 SLA。
 */
export async function warmPinyinMatcher(): Promise<void> {
  if (_pinyinReady) return;
  if (!_loadPromise) {
    _loadPromise = import('pinyin-match').catch(error => {
      _loadPromise = null; // 失败重置，下次调用可重试
      throw error;
    });
  }
  try {
    _pinyinModule = await _loadPromise;
    _pinyinReady = true;
    // 同步通知：外壳的响应式标志在 await 返回前即已对齐，调用方无需额外轮询
    [..._readyListeners].forEach(listener => listener());
  } catch {
    // 加载失败保持子串匹配降级，不抛错
  }
}

/**
 * 大小写不敏感子串查找
 * @param text 目标文本
 * @param keyword 关键词（调用方保证非空）
 * @returns [起始, 结束] 闭区间；未命中返回 null
 */
function indexOfIgnoreCase(text: string, keyword: string): [number, number] | null {
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  return index === -1 ? null : [index, index + keyword.length - 1];
}

/** 可安全跳过拼音 DP 的文本形态：全为可见 ASCII（0x21–0x7E，即不含空格与控制字符） */
const ASCII_VISIBLE_NO_SPACE = /^[\x21-\x7e]+$/;

/**
 * 判定「拼音降级不可能比子串匹配多命中」
 *
 * 依据 `pinyin-match` 的实现（读其 `src/core.js`）：两端先统一转小写并做 NFD 分解 +
 * 去组合音标；关键词侧 `normalizeKey` 会**删掉全部空白**；文本侧 `getIndex` 遇到 `' '`
 * **直接跳过、不消费关键词字符**；逐字符比对是「相等或关键词字符是文本字符拼音的前缀」。
 * 由此：
 * - 文本为可见 ASCII 且**无空格**时，每个字符的「拼音候选」就是它自己（单字符，前缀判定
 *   退化为相等），整条 DP 等价于「逐字符相等」= 大小写不敏感子串——而子串命中已在上层短路，
 *   故此处必然不命中；
 * - 文本含空格（如 `user name` ← `username`）、含非 ASCII（中文、带音标的拉丁字母）时，
 *   上述等价关系不成立，必须走 DP。
 * 关键词侧含空白时其归一形态更宽，因此也只对无空白关键词短路。
 *
 * 该短路只是**跳过必然为 null 的 DP**，不改变任何命中结果；纯 ASCII 判定本身是
 * 一次正则扫描，成本远低于一次多音字 DP，故放在读缓存之前——不命中就不必把 null 写进缓存。
 *
 * @param text 目标文本（已确认非空、子串未命中）
 * @param keyword 已 trim 的关键词
 * @returns 可安全跳过拼音匹配返回 true
 */
function pinyinCannotWidenMatch(text: string, keyword: string): boolean {
  return ASCII_VISIBLE_NO_SPACE.test(text) && !/\s/.test(keyword);
}

/**
 * 查询关键词在目标文本中的命中区间
 *
 * 子串优先；未命中且允许拼音匹配时尝试拼音，其中「拼音必然不命中」的形态由
 * {@link pinyinCannotWidenMatch} 短路（结果等价，见该函数说明）。
 *
 * `pinyinEnabled` 默认取内核就绪状态，非 Vue 调用方（Background）直接省略即可。
 * Vue 外壳显式传入 `pinyinMatcherReady.value`：一来让 computed 在求值期间读到 ref、
 * 预热完成后自动重算（拆分前正是这个机制），二者在本模块生命周期内始终同向。
 *
 * @param text 目标文本（用户名/标签/备注/网址等）
 * @param keyword 搜索关键词
 * @param pinyinEnabled 是否允许拼音降级匹配，缺省随内核就绪状态
 * @returns [起始, 结束] 闭区间；未命中返回 null
 */
export function findMatchRange(
  text: string,
  keyword: string,
  pinyinEnabled: boolean = _pinyinReady,
): [number, number] | null {
  const trimmed = keyword.trim();
  if (!text || !trimmed) return null;

  const substringRange = indexOfIgnoreCase(text, trimmed);
  if (substringRange) return substringRange;

  if (pinyinEnabled && !pinyinCannotWidenMatch(text, trimmed)) {
    return findPinyinRangeCached(text, trimmed);
  }
  return null;
}

/**
 * 拼音匹配区间记忆缓存
 *
 * 记忆键**只取文本**，关键词放在缓存外作为「代际」：关键词一变即清空整把缓存。
 * 这样做的三个理由：
 * 1. 拼接键 `` `${text}\0${keyword}` `` 每次查询都要新分配一条「条目字段明文」的副本
 *    （V8 的字符串拼接产出新的 flat string），而一次过滤要对 2000 条 × 4 字段问一遍；
 * 2. 键域随输入过程累积「打过的每一个前缀 × 每一条文本」，明文字段的滞留时间被拉长；
 *    按代际清空后，残留上界退化为「当前这一轮检索命中的去重文本数」；
 * 3. 同一条目在同一轮检索里会被过滤与高亮两条路径反复询问（列表重排、筛选变化、逐行渲染），
 *    真正省掉 DP 的正是这一层复用，跨关键词复用本就罕见。
 *
 * 上限只兜住极端场景（一轮内切换关键词前文本数已超上限），超出按插入顺序淘汰最旧一项。
 * 键取自解密后的条目字段，属明文在内存中的派生残留，因此上限只兜住体积、
 * 不兜住存活时间——存活时间由 {@link clearPinyinRangeCache} 在锁定/过期时收口。
 */
const PINYIN_RANGE_CACHE_MAX = 2000;

/** 文本 → 拼音命中区间（只在上层确认拼音模块已就绪后读写，故就绪状态无需参与键值） */
const pinyinRangeCache = new Map<string, [number, number] | null>();

/** 当前缓存所属的关键词（代际标记）；`null` 表示缓存已被清空、尚未开始新一轮 */
let cacheGeneration: string | null = null;

/**
 * 带记忆缓存的拼音区间查询
 *
 * 拼音匹配是多音字 DP，也是过滤/高亮路径上最贵的一步；同一文本会在列表重排、
 * 筛选条件变化、每个文本单元格渲染中被反复询问，故在此记忆。
 * 子串命中已在上层短路返回，不进缓存。
 *
 * @param text 目标文本
 * @param keyword 已 trim 的关键词
 * @returns [起始, 结束] 闭区间或 null
 */
function findPinyinRangeCached(text: string, keyword: string): [number, number] | null {
  if (cacheGeneration !== keyword) {
    cacheGeneration = keyword;
    pinyinRangeCache.clear();
  }

  const cached = pinyinRangeCache.get(text);
  if (cached !== undefined) return cached;

  const range = getPinyinMatcherSync(text, keyword);
  if (pinyinRangeCache.size >= PINYIN_RANGE_CACHE_MAX) {
    const oldest = pinyinRangeCache.keys().next();
    if (!oldest.done) pinyinRangeCache.delete(oldest.value);
  }
  pinyinRangeCache.set(text, range);
  return range;
}

/**
 * 同步获取拼音匹配结果（模块未加载时返回 null，不触发加载）
 *
 * @param text 目标文本
 * @param keyword 关键词
 * @returns [起始, 结束] 闭区间或 null
 */
function getPinyinMatcherSync(text: string, keyword: string): [number, number] | null {
  if (!_pinyinModule) return null;
  try {
    const result = _pinyinModule.default.match(text, keyword);
    return result === false ? null : [result[0], result[1]];
  } catch {
    return null;
  }
}

/**
 * 清空拼音匹配区间记忆缓存
 *
 * 缓存键是条目字段明文（用户名/标签/备注/URL），锁定或过期后
 * 这些明文不应继续以可寻址形式留在内存里，故与会话密钥材料同步销毁
 * （安全基线：不延长明文的存活时间）。本模块初始化时把它登记给
 * `utils/plaintextCacheCleanup.ts`，由会话边界在 clearSession 与跨上下文会话重置两处执行。
 * 代际标记一并清空，避免下一次查询误判「仍是上一轮关键词」而读到已清空的缓存。
 *
 * 只丢记忆，不丢数据：下一次搜索自然重新计算。
 */
export function clearPinyinRangeCache(): void {
  cacheGeneration = null;
  pinyinRangeCache.clear();
}

// 模块级登记：只有加载了本内核的上下文才持有这把缓存，会话边界据此同步销毁明文键残留
registerPlaintextCacheCleaner(clearPinyinRangeCache);

/**
 * 判断任一字段是否命中关键词（过滤用）
 * @param fields 候选字段集（空字段自动跳过）
 * @param keyword 搜索关键词
 * @param pinyinEnabled 是否允许拼音降级匹配，缺省随内核就绪状态
 * @returns 任一字段命中返回 true
 */
export function matchesKeyword(fields: string[], keyword: string, pinyinEnabled: boolean = _pinyinReady): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return true;
  return fields.some(field => !!field && findMatchRange(field, trimmed, pinyinEnabled) !== null);
}

/** 高亮分段 */
export interface HighlightSegment {
  /** 分段文本 */
  text: string;
  /** 是否为命中分段 */
  hit: boolean;
}

/**
 * 将文本按关键词命中区间切分为高亮分段（渲染用）
 *
 * 无命中时返回单段非高亮文本；命中区间内的文本标记 hit=true，
 * 由调用方以强调样式渲染（样式与主题令牌绑定，组件侧负责）。
 *
 * @param text 目标文本（空文本返回空数组）
 * @param keyword 搜索关键词
 * @param pinyinEnabled 是否允许拼音降级匹配，缺省随内核就绪状态
 * @returns 分段数组（保持原文顺序拼接后等于原文）
 */
export function highlightSegments(
  text: string,
  keyword: string,
  pinyinEnabled: boolean = _pinyinReady,
): HighlightSegment[] {
  if (!text) return [];
  const trimmed = keyword.trim();
  if (!trimmed) return [{ text, hit: false }];

  const range = findMatchRange(text, trimmed, pinyinEnabled);
  if (!range) return [{ text, hit: false }];

  const [start, end] = range;
  // 防御：越界区间退化为不高亮（拼音模块异常返回时避免渲染错乱）
  if (start < 0 || end >= text.length || start > end) return [{ text, hit: false }];

  const segments: HighlightSegment[] = [];
  if (start > 0) segments.push({ text: text.slice(0, start), hit: false });
  segments.push({ text: text.slice(start, end + 1), hit: true });
  if (end + 1 < text.length) segments.push({ text: text.slice(end + 1), hit: false });
  return segments;
}
