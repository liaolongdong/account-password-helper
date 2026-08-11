import { shallowRef } from 'vue';

/**
 * 智能搜索匹配工具（子串 + 拼音/首字母缩写 + 命中高亮）
 *
 * 设计要点：
 * - 匹配策略分级：大小写不敏感子串命中优先（短路，零额外开销），
 *   未命中时降级拼音匹配（全拼 / 首字母缩写 / 中英混合，含多音字）；
 * - 拼音模块（pinyin-match，约 27KB）经动态 import 拆分为独立 chunk，
 *   不进入侧边栏/popup 首屏关键路径；首帧后由调用方预热（{@link warmPinyinMatcher}），
 *   未温热前搜索退化为子串匹配，行为与旧版完全一致；
 * - {@link pinyinMatcherReady} 为模块级响应式就绪标志，过滤 computed 依赖它：
 *   预热完成后自动重算一次，拼音命中结果即时补齐，无需调用方手动刷新；
 * - 全部纯函数 + 本地计算，零网络、零存储写入，与项目安全定位一致。
 */

/** 拼音匹配模块类型（pinyin-match 默认导出：match 返回 [起始, 结束] 闭区间或 false） */
type PinyinMatchModule = typeof import('pinyin-match');

/**
 * 拼音匹配模块就绪标志（模块级单例）
 *
 * 过滤/高亮函数内部读取该 ref：预热完成置 true 后，依赖它的 computed
 * 自动重算，拼音命中结果即时生效。测试环境可直接赋值以覆盖两条分支。
 */
export const pinyinMatcherReady = shallowRef(false);

/** 已加载的拼音匹配模块实例（同步缓存，供过滤/高亮纯函数同步读取） */
let _pinyinModule: PinyinMatchModule | null = null;

/** 加载中的 Promise（单例：并发/重复预热共享同一次加载；失败置空可重试） */
let _loadPromise: Promise<PinyinMatchModule> | null = null;

/**
 * 预热拼音匹配模块（幂等，返回加载 Promise 供调用方按需 await）
 *
 * 建议在首帧渲染完成后的空闲时机调用（侧边栏 preloadIdleModules /
 * options onMounted），使用户首次输入前模块已温热；重复调用不产生额外加载，
 * 生产调用方无需 await（fire-and-forget，失败静默降级为子串匹配）。
 *
 * 注意：动态 import 必须直接出现在函数体内（不能经 lazyImport 等闭包间接包装），
 * 否则 Vite 静态分析无法识别，pinyin-match（约 27KB 数据）会被并入
 * 侧边栏首屏共享 chunk，违反首屏体积 SLA。
 */
export async function warmPinyinMatcher(): Promise<void> {
  if (pinyinMatcherReady.value) return;
  if (!_loadPromise) {
    _loadPromise = import('pinyin-match').catch(error => {
      _loadPromise = null; // 失败重置，下次调用可重试
      throw error;
    });
  }
  try {
    _pinyinModule = await _loadPromise;
    pinyinMatcherReady.value = true;
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

/**
 * 查询关键词在目标文本中的命中区间
 *
 * 子串优先；未命中且拼音模块已就绪时尝试拼音匹配。
 *
 * @param text 目标文本（用户名/标签/备注/网址等）
 * @param keyword 搜索关键词
 * @returns [起始, 结束] 闭区间；未命中返回 null
 */
export function findMatchRange(text: string, keyword: string): [number, number] | null {
  const trimmed = keyword.trim();
  if (!text || !trimmed) return null;

  const substringRange = indexOfIgnoreCase(text, trimmed);
  if (substringRange) return substringRange;

  if (pinyinMatcherReady.value) {
    const indices = getPinyinMatcherSync(text, trimmed);
    if (indices) return indices;
  }
  return null;
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
 * 判断任一字段是否命中关键词（过滤用）
 * @param fields 候选字段集（空字段自动跳过）
 * @param keyword 搜索关键词
 * @returns 任一字段命中返回 true
 */
export function matchesKeyword(fields: string[], keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return true;
  return fields.some(field => !!field && findMatchRange(field, trimmed) !== null);
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
 * @returns 分段数组（保持原文顺序拼接后等于原文）
 */
export function highlightSegments(text: string, keyword: string): HighlightSegment[] {
  if (!text) return [];
  const trimmed = keyword.trim();
  if (!trimmed) return [{ text, hit: false }];

  const range = findMatchRange(text, trimmed);
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
