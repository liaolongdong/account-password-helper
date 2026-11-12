/**
 * 表单控件的「可及名」与按标注语义的选择器桶判定
 *
 * 登录框的语义标注有三种等效写法：`aria-label`、`aria-labelledby`、`<label for>`（或包裹式
 * label）。捕获判据此前只读字段自己的四个属性（`name` / `id` / `placeholder` / `aria-label`），
 * 于是出现一个反直觉的结果：**越是按无障碍规范标注的登录页越不被识别**，作者把 `<label>`
 * 换成 `aria-label` 才「修好」——把规范写法改成不规范写法才有功能，这个方向不能留着。
 *
 * 口径是**等效标注，而非放宽**：`ariaKeywordsFrom` 只从某个桶已有的
 * `input[aria-label*="X"]` 条目里抽关键词，`matchesBucketByLabel` 拿可及名比这同一组词。
 * 于是「用 label 标了手机号」与「写 aria-label=手机号」在**桶内 aria 关键词**这一层判定相同，
 * 一个词都没多，收货地址页与搜索页不会因此变成登录页；`looksLikePostalCode` 这类
 * **排除**判据也读同一份可及名，放宽的两端同时生效。注意这不等于与原谓词全面等价：
 * 手机号桶的 aria 词表比 `MOBILE_KEYWORDS` 窄（不含「号码」），所以 `label` 写「社保卡号码」
 * 不构成证据，而 `placeholder` / `aria-label` 写同样的字仍会被原谓词认下。
 *
 * **作用域只到捕获链**（2026-11-11 用户拍板）：可及名进 `hasPhoneEvidence` /
 * `hasVerifyCodeEvidence` / `looksLikePostalCode`，不进 `formSelectors.declaredText`。
 * 后者决定填充落点、侧边栏触发与身份提示让位，而 `isInLoginFormOrPopup` 有整页级回退——
 * 页面别处一个登录区就能把无关填报区一起判成「已认领」，于是 label 标注的联系电话框
 * 气泡消失、钥匙又填不出身份库的值。真机 e2e 在演示台第 ⑯ 区抓到两行，边界由
 * `tests/content/formSelectors.labelScope.test.ts` 与 `formDetector.identityHint.test.ts` 钉住。
 *
 * 已写 `aria-label` 的框一律交回原判定（`matchesBucketByLabel` 当场返回假，`captureText`
 * 不再解析可及名），避免同一框被两套尺子各判一次。标注文本由宿主页面控制：只参与关键词
 * 包含判断，不进 DOM 注入、日志、存储或任何对外呈现，并按 `MAX_NAME_LENGTH` 截断。
 */

/** 可及名截断长度：标注文本多长都不改变判定，只需够关键词包含用 */
const MAX_NAME_LENGTH = 200;

/** 一次最多解析多少个 `aria-labelledby` 引用 id */
const MAX_LABELLED_BY_REFS = 8;

/** `input[aria-label*="X"]`：唯一一个「这个词属于本桶」的可靠标记 */
const ARIA_LABEL_SELECTOR_RE = /^input\[aria-label\*="([^"]+)"\]$/;

/** 元素所在的根（文档或它自己的影子根）——标注只可能与被标注元素同根 */
const rootOf = (node: Node): ParentNode => node.getRootNode() as ParentNode;

/** 纯文本取值：读 `textContent`，绝不回写宿主 DOM */
const textOf = (el: Element | null | undefined): string => (el ? (el.textContent?.trim() ?? '') : '');

/**
 * 在元素所属根内按 id 找元素
 *
 * `getElementById` 不跨影子边界，而 `aria-labelledby` 引用的元素就在同一根里；
 * 这段查询只对**声明了 `aria-labelledby`** 的字段发生——无标注的字段直接走 `labels`，
 * 一次文档级选择器扫描都不必有。
 */
const byIdInRoot = (input: HTMLElement, id: string): Element | null => {
  try {
    return rootOf(input).querySelector(`[id="${CSS.escape(id)}"]`);
  } catch {
    return null;
  }
};

/**
 * 带关联 label 集合的控件
 *
 * `HTMLLabelableElement` 在本仓的 lib 目标里还不存在（同 `.at()` 那一类限制），
 * 这里按规范声明所需的最小结构，不用 `any` 也不用宽化断言。
 */
interface LabelAwareElement extends HTMLElement {
  readonly labels?: NodeListOf<HTMLLabelElement>;
}

/**
 * 解析控件的可及名（`aria-label` 之外的两种规范写法）
 *
 * 优先级取 ARIA 顺序中除 `aria-label` 的那几档：`aria-labelledby` 引用文本 →
 * 关联 `<label>`（`for` 与包裹式一并由原生 `labels` 给出）。刻意不返回 `aria-label`——
 * 那条属性本来就在选择器里判过，返回它会让「已写 aria-label」的框被两套尺子各判一次。
 *
 * 没有任何标注时回空串：不拿 `value` 或 `name` 冒充，否则填着「iphone 15」的搜索框
 * 会因为值里含 `phone` 被当成手机号框。
 *
 * @param input 待解析的控件
 * @returns 截断后的标注文本，无标注时为空串
 */
export function accessibleNameOf(input: HTMLElement): string {
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_LABELLED_BY_REFS)
      .map(id => textOf(byIdInRoot(input, id)))
      .filter(Boolean);
    if (parts.length) return parts.join(' ').slice(0, MAX_NAME_LENGTH);
  }

  // `labels` 是原生关联集合：浏览器已经维护好 for / 包裹两种关系，
  // 不必为每个字段在文档里扫一遍 `label[for=...]`——这四个谓词都在 detectForms 的每轮扫描里。
  const labels = (input as LabelAwareElement).labels;
  if (!labels?.length) return '';
  return Array.from(labels)
    .map(label => textOf(label))
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * 抽出一个选择器桶已经承认过的 aria-label 关键词
 *
 * 只认 `input[aria-label*="X"]` 这一条形状：`[name*=...]` / `[placeholder*=...]` 的属性名
 * 不是 aria 语义，把它们混进来等于凭空扩词表。结果去重并保持原顺序。
 *
 * @param selectors 该桶的完整选择器数组
 * @returns 该桶的 aria 关键词集
 */
export function ariaKeywordsFrom(selectors: readonly string[]): string[] {
  const keywords: string[] = [];
  for (const selector of selectors) {
    const matched = ARIA_LABEL_SELECTOR_RE.exec(selector);
    if (matched && !keywords.includes(matched[1])) keywords.push(matched[1]);
  }
  return keywords;
}

/**
 * 用可及名代替 `aria-label` 做一次桶内关键词判定
 *
 * 已经写了 `aria-label` 的框直接判假：那条路径归原选择器管，这里只补
 * 「标了 label 却没写 aria-label」的等效情形。
 *
 * @param input 待判定的控件
 * @param keywords 由 `ariaKeywordsFrom` 得到的本桶关键词集
 * @returns 标注文本是否命中该桶的某个 aria 关键词
 */
export function matchesBucketByLabel(input: HTMLElement, keywords: readonly string[]): boolean {
  if (input.getAttribute('aria-label')?.trim()) return false;
  const name = accessibleNameOf(input).toLowerCase();
  if (!name) return false;
  return keywords.some(keyword => name.includes(keyword.toLowerCase()));
}
