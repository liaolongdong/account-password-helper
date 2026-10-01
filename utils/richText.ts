/**
 * 语言包富文本的安全解析器
 *
 * 帮助与指引文案是语言包内置的静态字符串，其中用 `<b>` / `<code>` 标记强调与代码位。
 * 这批文案此前经 `v-html` 交给浏览器解析，等于把「内容来源可信」的假设外推到整条渲染链：
 * 一旦语言包文案的供给方式发生变化（导入、远程覆盖、复制粘贴进带属性的片段），就是现成的
 * XSS 入口。本模块把解析改成显式白名单——只有 `<b>` 与 `<code>` 成为元素，其余任何尖括号
 * 写法（未知标签、属性、脚本、注释、未闭合、落单的结束标签）一律按字面文本输出，
 * 由 Vue 的文本节点自然转义，DOM 里不可能出现可执行内容。
 *
 * `parseRichText` 是纯字符串解析；`toRichTextVNodes` 是唯一依赖 Vue 的一层，
 * 由 `components/RichText.vue` 直接调用，宿主组件不接触解析结果。
 *
 * 设计契约见 `docs/reports/GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md` §4.3。
 */

import { createTextVNode, h, type VNode } from 'vue';

/** 白名单标签：语义强调与代码位，二者都不接受属性 */
export type RichTextTag = 'b' | 'code';

/** 文本分段（已解码实体引用） */
export interface RichTextTextNode {
  type: 'text';
  text: string;
}

/** 白名单元素分段 */
export interface RichTextElementNode {
  type: 'element';
  tag: RichTextTag;
  children: RichTextParsedNode[];
}

/** 解析树的一个节点 */
export type RichTextParsedNode = RichTextTextNode | RichTextElementNode;

/**
 * 白名单开始标签：`<b>` / `<code>`，允许跟任意属性文本但一律丢弃
 *
 * `(?:\s[^<>]*)?` 保证 `<code>` 后的下一个字符必须是空白或 `>`，
 * 因此 `<codex>`、`<bcc>` 这类写法不会被误认成白名单标签。
 */
const OPEN_TAG_RE = /<(b|code)(?:\s[^<>]*)?>/y;

/** 白名单结束标签：`</b>` / `</code>` */
const CLOSE_TAG_RE = /<\/(b|code)\s*>/y;

/**
 * XML 预定义实体引用
 *
 * 现存语言包只用到 `&lt;`（`help.fc.10` 的「误差 &lt; 30 秒」），补齐五个是为了让
 * 「文本节点的最终呈现」与原 `v-html` 的浏览器解析结果在后续文案改动前保持等价。
 * 数字实体（`&#39;`）不在此列——语言包从未使用，支持它只增加解析面。
 */
const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** 实体引用（单次扫描：`&amp;lt;` 解成字面 `&lt;`，不做二次解码） */
const ENTITY_RE = /&(lt|gt|amp|quot|apos);/g;

/** 把文本分段里的实体引用解码为字符 */
function decodeEntities(raw: string): string {
  return raw.replace(ENTITY_RE, (_match, name: string) => ENTITIES[name]);
}

/** 自栈顶向下找同名开始标签的下标，无匹配返回 -1 */
function findLastOpenTag(stack: RichTextElementNode[], tag: string): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tag === tag) return i;
  }
  return -1;
}

/**
 * 解析白名单富文本为节点树
 *
 * @param source 语言包原始字符串（可含 `<b>` / `<code>` 标记与实体引用）
 * @returns 顶层节点数组；空输入返回空数组
 */
export function parseRichText(source: string): RichTextParsedNode[] {
  const root: RichTextParsedNode[] = [];
  /** 未闭合元素栈；元素在「开始标签命中」时即挂到父级 children，出栈只影响后续文本归属 */
  const stack: RichTextElementNode[] = [];
  const currentChildren = (): RichTextParsedNode[] => (stack.length ? stack[stack.length - 1].children : root);

  let buffer = '';
  /**
   * 把累积的文本落到当前层级
   *
   * 与上一个文本分段合并：白名单外的写法走的是「逐字符回填」路径，会在同一层级里
   * 产生两段相邻文本，而浏览器解析 `innerHTML` 时只给一个文本节点。合并之后，
   * 替换 `v-html` 前后 HelpDialog 的 DOM 才能逐节点对齐。
   */
  const flushText = (): void => {
    if (!buffer) return;
    const children = currentChildren();
    const last = children[children.length - 1];
    const decoded = decodeEntities(buffer);
    if (last?.type === 'text') {
      last.text += decoded;
    } else {
      children.push({ type: 'text', text: decoded });
    }
    buffer = '';
  };

  let index = 0;
  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      buffer += source.slice(index);
      break;
    }
    buffer += source.slice(index, lt);

    // 结束标签必须先试：`</b>` 若按开始标签正则在 `<` 处失配，会被拆成字面 `<` + `/b>`，
    // 虽然呈现相同，但会让「落单结束标签」与「白名单外标签」走同一条分支，判据变模糊。
    CLOSE_TAG_RE.lastIndex = lt;
    const close = CLOSE_TAG_RE.exec(source);
    if (close) {
      const openIndex = findLastOpenTag(stack, close[1]);
      flushText();
      if (openIndex === -1) {
        // 没有对应的开始标签：整段按字面文本输出，不做浏览器式的静默丢弃
        buffer += close[0];
      } else {
        // 连同其内未闭合的嵌套一并收口（`<code><b>x</code>` → `<code><b>x</b></code>`）
        stack.length = openIndex;
      }
      index = CLOSE_TAG_RE.lastIndex;
      continue;
    }

    OPEN_TAG_RE.lastIndex = lt;
    const open = OPEN_TAG_RE.exec(source);
    if (open) {
      flushText();
      const element: RichTextElementNode = { type: 'element', tag: open[1] as RichTextTag, children: [] };
      currentChildren().push(element);
      stack.push(element);
      index = OPEN_TAG_RE.lastIndex;
      continue;
    }

    // 白名单之外的一切写法：只消费这个 `<`，后续字符继续按文本累积
    buffer += '<';
    index = lt + 1;
  }

  flushText();
  return root;
}

/** 解析树节点 → VNode：文本分段自然转义，元素分段只有白名单标签且不带任何属性 */
const toVNode = (node: RichTextParsedNode): VNode =>
  node.type === 'text' ? createTextVNode(node.text) : h(node.tag, node.children.map(toVNode));

/**
 * 把语言包富文本渲染成一组 VNode
 *
 * 返回数组而非根元素：调用方的宿主节点（帮助弹窗 / 文档中页的 `<li>`）必须与替换前
 * 的 `v-html` 输出逐节点对齐，中间不能多出包装元素。
 *
 * @param source 含白名单标记的语言包原始文案
 * @returns 直接可用作 render 返回值的节点数组
 */
export function toRichTextVNodes(source: string): VNode[] {
  return parseRichText(source).map(toVNode);
}
