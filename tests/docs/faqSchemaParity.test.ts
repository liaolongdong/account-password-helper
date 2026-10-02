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
 * 3. 单页内无重复问题，英文块不残留中文；中文块的问题为中文。英文块里唯一放行的中文是界面上
 *    真实显示的标签原文「中文」（见 `EN_ALLOWED_CJK`）——那是用户在面板里要点的那个词，不是漏翻；
 * 4. **覆盖面**：FAQPage 条目数必须等于可见 FAQ 条数——`scripts/lib/faq-schema.mjs` 里的名单从
 *    白名单改成了顺序名单（2026-10-02 前 42 条问答只有 19 条进得了 JSON-LD，且「新增 FAQ 忘了加进
 *    名单」不会报错），这条断言让「少一条」第一次就会变红。
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

/**
 * 英文块里允许原样出现的中文：界面上真实显示的标签文字。语言切换那条问答必须写「中文」，
 * 换成 "Chinese" 用户反而在面板里找不到对应项。除这些字以外的任何汉字都算漏翻。
 */
const EN_ALLOWED_CJK = ['中文'];

/** 去掉允许的界面标签原文后再判中文 */
function stripUiLabels(text: string): string {
  return EN_ALLOWED_CJK.reduce((acc, label) => acc.split(label).join(''), text);
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

  it('每条可见问答都进了结构化数据（一条不落）', () => {
    const visible = (region.match(/q: \{/g) ?? []).length;
    expect(visible, '可见 FAQS 解析不到条目').toBeGreaterThan(0);
    expect(items.length, `可见 FAQ ${visible} 条，FAQPage 只有 ${items.length} 条`).toBe(visible);
  });
});

describe('官网 FAQPage 结构化数据中英对齐', () => {
  it('两页条目数一致（防只重新生成一侧）', () => {
    expect(en.items.length).toBe(zh.items.length);
  });

  it('同序配对且语言各自正确', () => {
    expect(en.items.length).toBe(zh.items.length);
    const offenders: string[] = [];
    zh.items.forEach((item, i) => {
      if (!CJK.test(item.name)) offenders.push(`中文块的问题应为中文：${item.name}`);
      const enName = stripUiLabels(en.items[i].name);
      const enText = stripUiLabels(en.items[i].text);
      if (CJK.test(enName)) offenders.push(`英文块的问题残留中文：${enName}`);
      if (CJK.test(enText)) offenders.push(`英文块的答案残留中文：${en.items[i].name} → ${enText}`);
    });
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
