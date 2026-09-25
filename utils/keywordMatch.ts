/**
 * 关键词过滤内核（框架无关、拼音无关）
 *
 * 侧边栏与内联下拉的检索口径唯一来源：参与检索的字段清单、字段归一（非字符串
 * 一律按空串）、trim 与大小写、空关键词语义全部在这里定义，两侧只替换「怎么判断命中」。
 *
 * 为什么单独成文件而不直接用 `utils/searchMatch`：
 * - 内联下拉运行在内容脚本世界，那里不能执行 `import('pinyin-match')`（扩展未声明
 *   web_accessible_resources，页面上下文加载扩展 chunk 必然失败），也不该引用
 *   `utils/searchMatch`（它是 Vue 响应式外壳，会把 vue + vue-i18n 的共享 chunk 拉进
 *   content 依赖图）；拼音匹配因此在内容脚本侧改由 Background 代跑，见
 *   `entrypoints/background/passwordCache.ts` 的 `getMatchingAccounts`；
 * - 但「搜哪几个字段」这件事两侧必须同答案，否则就会出现同一关键词侧边栏搜得到、
 *   内联搜不到的静默分歧。故把口径抽到零依赖模块，两侧按需注入匹配器。
 */

/**
 * 关键词长度上限（字符）
 *
 * 关键词经 runtime message 从页面侧传入，属不可信输入；拼音匹配是多音字 DP，
 * 成本随关键词长度上升，故在边界处截断，也顺带约束了缓存键的体积。
 */
export const MAX_SEARCH_KEYWORD_LENGTH = 64;

/**
 * 关键词输入的防抖时长（毫秒）
 *
 * 管理页密码表与回收站弹窗这两处「输入即时回显、过滤延后落地」的地方共用这一档：
 * 过滤是整表重排（见 `composables/useVaultListPagination` 的存在理由），连续击键时
 * 不防抖就是每击一次键重排一页。取同一个值是为了让两处对「手感是否跟手」给出同一个
 * 答案，而不是各写各的 200。侧边栏不带防抖（它走的是缓存好的快路径），不在共用之列。
 */
export const KEYWORD_DEBOUNCE_MS = 200;

/**
 * 归一来自外部上下文的检索关键词
 *
 * 非字符串（含 `undefined`）一律视为「无关键词」，避免页面侧伪造载荷影响匹配路径；
 * 长度截断到 {@link MAX_SEARCH_KEYWORD_LENGTH}。返回值可能仍含空白，由匹配器自行 trim。
 *
 * @param value 消息里的原始 `keyword`（不可信）
 * @returns 可安全参与匹配的关键词，无有效关键词时为空串
 */
export function normalizeSearchKeyword(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_SEARCH_KEYWORD_LENGTH);
}

/** 参与关键词检索的字段载体（`PasswordEntry` 与 `MatchingAccountMeta` 的共同结构子集） */
export interface KeywordSearchable {
  /** 用户名 */
  username?: string;
  /** 标签（逗号分隔字符串） */
  tag?: string;
  /** 备注 */
  remark?: string;
  /** 网址 */
  url?: string;
}

/**
 * 关键词匹配器
 *
 * @param fields 已归一的候选字段文本（可能含空串，实现应跳过）
 * @param keyword 原始关键词（未 trim，由匹配器自行归一）
 * @returns 任一字段命中即为 true
 */
export type KeywordMatcher = (fields: string[], keyword: string) => boolean;

/**
 * 把不可信的展示字段收成字符串
 *
 * 类型上这些字段是必填 `string`，但条目可能来自历史数据或手工改过的存储；
 * 内联面板的筛选/渲染路径上任何一处抛错都会让 `panelOpen` 停在 true、之后永久打不开。
 *
 * @param value 原始值（不可信）
 * @returns 字符串值本身，非字符串一律按空串处理
 */
export function toFieldText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 取出条目的检索字段清单
 *
 * 顺序即语义：用户名 / 标签 / 备注 / 网址。这是两侧共同的闭合清单——新增可搜字段
 * 只改这里一处，避免侧边栏与内联各自维护出分歧的字段集。
 *
 * @param entry 携带检索字段的条目（密码条目或下发给内容脚本的元数据）
 * @returns 归一后的字段文本数组
 */
export function keywordFieldsOf(entry: KeywordSearchable): string[] {
  return [toFieldText(entry.username), toFieldText(entry.tag), toFieldText(entry.remark), toFieldText(entry.url)];
}

/**
 * 大小写不敏感子串匹配器（内容脚本侧的安全档位：零依赖、零动态导入）
 *
 * @param fields 候选字段文本
 * @param keyword 关键词（空白等价于不过滤）
 * @returns 是否命中
 */
export const substringMatcher: KeywordMatcher = (fields, keyword) => {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;
  return fields.some(field => field.toLowerCase().includes(kw));
};

/**
 * 按关键词保序过滤条目
 *
 * 返回新数组，命中顺序与入参一致——排序由上游（`utils/passwordSort`）单点决定，
 * 过滤只做减法、绝不重排，这样「内联首条」与「侧边栏首条」始终是同一条。
 *
 * @param entries 候选条目
 * @param keyword 关键词（空白时原样返回副本，不执行匹配）
 * @param matcher 注入的匹配器（侧边栏用拼音版，内容脚本用 {@link substringMatcher}）
 * @returns 过滤后的条目副本
 */
export function filterByKeyword<T extends KeywordSearchable>(
  entries: readonly T[],
  keyword: string,
  matcher: KeywordMatcher,
): T[] {
  if (!keyword.trim()) return [...entries];
  return entries.filter(entry => matcher(keywordFieldsOf(entry), keyword));
}
