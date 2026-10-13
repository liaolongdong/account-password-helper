/**
 * 语言包富文本解析器测试
 *
 * 这份解析器的唯一职责是「把 `v-html` 的信任面收进白名单」，所以断言的重心不是
 * 「标记有没有生效」，而是**白名单之外的一切写法都必须变成文本**：属性、未知标签、
 * 脚本、事件处理器、未闭合、落单的结束标签。同时钉住两条等价性——
 * 现存语言包解析后只产出 `b` / `code`，以及实体引用解码结果与浏览器解析一致，
 * 这两条保证了 `HelpDialog.vue` 从 `v-html` 换成 `<RichText>` 后呈现不变。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { parseRichText, type RichTextParsedNode } from '@/utils/richText';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES_DIR = path.join(ROOT, 'utils/i18n/locales');

/** 把解析树压平成 `b(...)` / `code(...)` / `"文本"` 形状，便于一次性断言嵌套与文本归属 */
function shape(nodes: RichTextParsedNode[]): string[] {
  return nodes.map(n => (n.type === 'text' ? JSON.stringify(n.text) : `${n.tag}(${shape(n.children).join(',')})`));
}

/** 收集解析树里出现过的全部标签名 */
function tagsOf(nodes: RichTextParsedNode[]): string[] {
  return nodes.flatMap(n => (n.type === 'text' ? [] : [n.tag, ...tagsOf(n.children)]));
}

/** 拼接解析树里的全部文本 */
function textOf(nodes: RichTextParsedNode[]): string {
  return nodes.flatMap(n => (n.type === 'text' ? [n.text] : textOf(n.children))).join('');
}

describe('parseRichText 的白名单元素', () => {
  it('`<b>` 与 `<code>` 解析为元素，文本按原顺序落在正确的层级', () => {
    expect(shape(parseRichText('点击 <code>Ctrl+K</code> 唤出'))).toEqual(['"点击 "', 'code("Ctrl+K")', '" 唤出"']);
    expect(shape(parseRichText('<b>侧边栏不显示？</b> 确认版本'))).toEqual(['b("侧边栏不显示？")', '" 确认版本"']);
  });

  it('标签上的属性被丢弃，不透传进解析树', () => {
    expect(shape(parseRichText('<code class="x" onclick="evil()">a</code>'))).toEqual(['code("a")']);
    expect(shape(parseRichText('<b data-tour="x">b</b>'))).toEqual(['b("b")']);
  });

  it('嵌套按栈式规则成形，交叉闭合按浏览器口径就地收口', () => {
    expect(shape(parseRichText('<b>a<code>c</code>b</b>'))).toEqual(['b("a",code("c"),"b")']);
    expect(shape(parseRichText('<code><b>x</code>y'))).toEqual(['code(b("x"))', '"y"']);
  });

  it('未闭合标签在输入结束时自动闭合（与浏览器解析一致）', () => {
    expect(shape(parseRichText('<b>未闭合'))).toEqual(['b("未闭合")']);
    expect(shape(parseRichText('<b>a<code>c'))).toEqual(['b("a",code("c"))']);
  });
});

describe('parseRichText 对白名单之外写法的降级', () => {
  it('未知标签连同尖括号原样输出为文本', () => {
    expect(shape(parseRichText('<img src=x>'))).toEqual(['"<img src=x>"']);
    expect(shape(parseRichText('<a href="https://example.com">链接</a>'))).toEqual([
      '"<a href=\\"https://example.com\\">链接</a>"',
    ]);
    expect(shape(parseRichText('<div>块</div>'))).toEqual(['"<div>块</div>"']);
  });

  it('脚本与事件处理器不会成为元素，只留下字面文本', () => {
    const evil = parseRichText('<script>alert(1)</script>');
    expect(tagsOf(evil)).toEqual([]);
    expect(textOf(evil)).toBe('<script>alert(1)</script>');

    const img = parseRichText('<img src=x onerror=alert(1)>');
    expect(tagsOf(img)).toEqual([]);
    expect(textOf(img)).toBe('<img src=x onerror=alert(1)>');
  });

  it('落单的结束标签按文本保留，不做静默丢弃', () => {
    expect(shape(parseRichText('a</b>c'))).toEqual(['"a</b>c"']);
    expect(shape(parseRichText('</code>'))).toEqual(['"</code>"']);
  });

  it('裸 `<` 与形似标签但不在白名单的写法保持原样', () => {
    expect(shape(parseRichText('误差 < 30 秒'))).toEqual(['"误差 < 30 秒"']);
    expect(shape(parseRichText('<codex>not-code</codex>'))).toEqual(['"<codex>not-code</codex>"']);
    expect(shape(parseRichText('<b attr'))).toEqual(['"<b attr"']);
  });

  it('空输入与纯空白不产生多余节点', () => {
    expect(parseRichText('')).toEqual([]);
    expect(shape(parseRichText('   '))).toEqual(['"   "']);
    expect(shape(parseRichText('<b></b>'))).toEqual(['b()']);
  });
});

describe('parseRichText 的实体引用解码', () => {
  it('XML 预定义实体解码为字符（现存语言包只用到 `&lt;`）', () => {
    expect(textOf(parseRichText('本机时钟须准确（误差 &lt; 30 秒）'))).toBe('本机时钟须准确（误差 < 30 秒）');
    expect(textOf(parseRichText('&gt;&amp;&quot;&apos;'))).toBe('>&"\'');
  });

  it('单次扫描：`&amp;lt;` 解成字面 `&lt;`，不会被二次解码成 `<`', () => {
    expect(textOf(parseRichText('&amp;lt;'))).toBe('&lt;');
  });

  it('解码后的 `<` 仍是文本，不会被重新当作标签起点', () => {
    expect(tagsOf(parseRichText('&lt;b&gt;x&lt;/b&gt;'))).toEqual([]);
    expect(textOf(parseRichText('&lt;b&gt;x&lt;/b&gt;'))).toBe('<b>x</b>');
  });
});

describe('现存语言包文案与解析器的口径对齐', () => {
  /** 逐语言、逐命名空间读出全部字符串值 */
  const allLocaleValues = (): string[] =>
    readdirSync(LOCALES_DIR).flatMap(locale =>
      readdirSync(path.join(LOCALES_DIR, locale))
        .filter(f => f.endsWith('.json'))
        .flatMap(f => Object.values(JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, f), 'utf-8')) as string[])),
    );

  it('文案里的每个裸 `<` 都是白名单标签的起点（新增标记写法必须先过这一关）', () => {
    const withMarkup = allLocaleValues().filter(v => v.includes('<'));
    expect(withMarkup.length, '语言包一个标记都没有，本用例的判据已失去意义').toBeGreaterThan(0);

    for (const value of withMarkup) {
      for (let i = value.indexOf('<'); i !== -1; i = value.indexOf('<', i + 1)) {
        const isWhitelistTag = /^<\/?(?:b|code)(?:\s[^<>]*)?>/.test(value.slice(i));
        expect(isWhitelistTag, `文案「${value.slice(0, 40)}」位置 ${i} 的尖括号不在白名单，会被渲染成字面文本`).toBe(
          true,
        );
      }
    }
  });

  it('带标记的文案解析后文本无损（换掉 v-html 不丢字）', () => {
    for (const value of allLocaleValues().filter(v => v.includes('<'))) {
      // 去掉白名单标签后剩下的就是应渲染的全部文本
      const expected = value
        .replace(/<\/?(?:b|code)(?:\s[^<>]*)?>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
      expect(textOf(parseRichText(value)), `文案「${value.slice(0, 40)}」解析后文本与原文不等价`).toBe(expected);
    }
  });
});
