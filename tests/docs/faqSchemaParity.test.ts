/**
 * 官网 FAQPage 结构化数据一致性测试
 *
 * 背景：index.html 的可见 FAQ 由页面内 `FAQS` 数组在运行时渲染，而 FAQPage JSON-LD 是静态
 * 字节。两者曾各自维护一份文案并发生漂移——结构化数据里的问题与页面可见问题对不上，会破坏
 * Google「结构化数据必须与可见内容一致」的要求；而非 JS 爬虫（GPTBot / PerplexityBot / ClaudeBot）
 * 只能读到 JSON-LD，所以这里把「逐字一致」固化为断言：
 *
 * 1. index.html 与 en.html 各自都存在 FAQPage 块，且每条问题与答案文案在其 `FAQS` 数组源码中逐字可见；
 * 2. 两页 FAQPage 条目数一致，且同序配对（防只重新生成一侧或语言张冠李戴）；
 * 3. 单页内无重复问题，英文块不残留中文；中文块的问题为中文。
 *
 * 中文块由 `pnpm gen:faq`（scripts/build-faq-jsonld.mjs）生成，英文块由 `pnpm gen:en`
 * （scripts/build-en-page.mjs）用同一份可见 FAQ 生成；改动 FAQS 后需两条命令都执行。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const CJK = /[\u4e00-\u9fff]/;

/** 官网中英文页（en.html 由 index.html 生成） */
const ZH_PAGE = { file: 'index.html', label: '中文页' } as const;
const EN_PAGE = { file: 'en.html', label: '英文页' } as const;

interface FaqPageItem {
  name: string;
  text: string;
}

/** 取出页面内 FAQPage 结构化数据的问答条目 */
function extractFaqPageItems(html: string): FaqPageItem[] {
  const scriptRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    const data = JSON.parse(match[1]) as {
      '@type'?: string;
      mainEntity?: { name?: string; acceptedAnswer?: { text?: string } }[];
    };
    if (data['@type'] !== 'FAQPage') continue;
    return (data.mainEntity ?? []).map(item => ({
      name: item.name ?? '',
      text: item.acceptedAnswer?.text ?? '',
    }));
  }
  return [];
}

/** 截取页面内可见 FAQ 的 `FAQS` 数组源码，并还原 JS 转义，便于逐字比对 */
function visibleFaqSource(html: string, file: string): string {
  const start = html.indexOf('const FAQS = [');
  expect(start, `${file} 未找到可见 FAQS 数组`).toBeGreaterThan(-1);
  const end = html.indexOf('];', start);
  expect(end, `${file} 未找到可见 FAQS 数组终点`).toBeGreaterThan(-1);
  return html.slice(start, end).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/** 读取一个页面及其结构化数据、可见 FAQ 源码 */
function loadPage(page: { file: string; label: string }) {
  const html = readFileSync(path.join(ROOT, page.file), 'utf8');
  return {
    ...page,
    items: extractFaqPageItems(html),
    region: visibleFaqSource(html, page.file),
  };
}

const zh = loadPage(ZH_PAGE);
const en = loadPage(EN_PAGE);

describe.each([
  { label: zh.label, items: zh.items, region: zh.region },
  { label: en.label, items: en.items, region: en.region },
])('官网 FAQPage 结构化数据一致性 — $label', ({ items, region }) => {
  it('存在 FAQPage 结构化数据', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('每条问答都在可见 FAQ 中逐字出现，且文案非空', () => {
    for (const item of items) {
      expect(item.name.trim(), '存在空问题').not.toBe('');
      expect(item.text.trim(), '存在空答案').not.toBe('');
      expect(region, `问题「${item.name}」未在可见 FAQ 中逐字出现`).toContain(item.name);
      expect(region, `答案未与可见 FAQ 逐字一致: ${item.name}`).toContain(item.text);
    }
  });

  it('无重复问题', () => {
    const names = items.map(item => item.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('官网 FAQPage 结构化数据中英对齐', () => {
  it('两页条目数一致（防只重新生成一侧）', () => {
    expect(en.items.length).toBe(zh.items.length);
  });

  it('同序配对且语言各自正确', () => {
    expect(en.items.length).toBe(zh.items.length);
    zh.items.forEach((item, i) => {
      expect(item.name, '中文块的问题应为中文').toMatch(CJK);
      expect(en.items[i].name, '英文块的问题不应残留中文').not.toMatch(CJK);
      expect(en.items[i].text, '英文块的答案不应残留中文').not.toMatch(CJK);
    });
  });
});
