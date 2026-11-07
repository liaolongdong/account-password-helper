/**
 * 商店粘贴块的预算与结构守卫（`docs/store/CWS_FILL_CONTENT.md`「第二步」）。
 *
 * 为什么需要它：这条链路此前只有 `CWS_PUBLISHING_GUIDE.md` 里的一段 python heredoc 看守，
 * 而那段要人手动跑。结果是中文说明从 6744 静默漂到 6821（+77 码点）没有任何门禁发现，
 * 账本里的数字与真源长期背离。英文说明只剩 87 码点余量，一次随手新增就会顶穿 16000。
 *
 * 三个刻意的口径：
 * 1. **长度只认 Unicode 码点**（`[...s].length`，等价于 python 的 `len()`）。`String.length`
 *    数的是 UTF-16 码元，emoji 会偏高，历史上就是靠它误判过余量；
 * 2. **粘贴块顺序用内容特征认，不写死下标**。源文档重排小节时写死下标会静默量错东西；
 * 3. 禁词与跨小节重复行沿用那段 python 的判据——3.8.0 草稿被判 keyword stuffing 的结构
 *    特征就是「同一句话在小节里抄第二遍」。禁词表在本文件独立写一份，与被守卫的文档解耦。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const FILL_CONTENT = 'docs/store/CWS_FILL_CONTENT.md';

/** 商店硬上限：名称 45、摘要 132、说明 16000（均为字符数，按码点计） */
const NAME_BUDGET = 45;
const SUMMARY_BUDGET = 132;
const DESCRIPTION_BUDGET = 16000;

/** 竞品品牌名 + 已废止的绝对化表述。AES-256-GCM / PBKDF2 按 2026-09-10 决定允许出现。 */
const BANNED = [
  'LastPass',
  'Bitwarden',
  '1Password',
  'Chrome',
  '零联网',
  '零网络传输',
  '100% offline',
  '数据不出浏览器',
  '军事级',
  '五维',
] as const;

/** Unicode 码点数，与 python `len()` 同口径 */
const codePoints = (text: string): number => [...text].length;

/** 六个粘贴块：顺序为中文名称/摘要/说明，再英文名称/摘要/说明 */
interface PasteBlocks {
  zh: { name: string; summary: string; description: string };
  en: { name: string; summary: string; description: string };
}

function extractPasteBlocks(doc: string): string[] {
  const start = doc.indexOf('## 第二步');
  const end = doc.indexOf('## 第三步');
  expect(start, `${FILL_CONTENT} 缺少「## 第二步」小节`).toBeGreaterThan(-1);
  expect(end, `${FILL_CONTENT} 缺少「## 第三步」小节，无法界定粘贴块范围`).toBeGreaterThan(start);
  const segment = doc.slice(start, end);
  return [...segment.matchAll(/```\n([\s\S]*?)```/g)].map(match => match[1].trim());
}

function classify(blocks: string[]): PasteBlocks {
  const isChinese = (text: string): boolean => /[\u4e00-\u9fff]/.test(text);
  const zh = blocks.filter(isChinese).sort((a, b) => codePoints(a) - codePoints(b));
  const en = blocks.filter(block => !isChinese(block)).sort((a, b) => codePoints(a) - codePoints(b));
  expect(zh.length, '中文粘贴块应恰好 3 个（名称/摘要/说明）').toBe(3);
  expect(en.length, '英文粘贴块应恰好 3 个（名称/摘要/说明）').toBe(3);
  // 分类成立的前提：三种字段的长度量级互不重叠。摘要逼近 132、说明数千，中间有巨大空档。
  expect(codePoints(zh[1]), '中文摘要与说明的长度量级应可区分').toBeLessThan(SUMMARY_BUDGET + 1);
  expect(codePoints(en[1]), '英文摘要与说明的长度量级应可区分').toBeLessThan(SUMMARY_BUDGET + 1);
  expect(codePoints(zh[2]), '中文说明应远长于摘要').toBeGreaterThan(1000);
  expect(codePoints(en[2]), '英文说明应远长于摘要').toBeGreaterThan(1000);
  return {
    zh: { name: zh[0], summary: zh[1], description: zh[2] },
    en: { name: en[0], summary: en[1], description: en[2] },
  };
}

const doc = readFileSync(path.join(ROOT, FILL_CONTENT), 'utf8');
const blocks = extractPasteBlocks(doc);

describe('商店粘贴块预算与结构', () => {
  it('「第二步」里恰好 6 个粘贴块（多一个少一个都说明复制源结构变了）', () => {
    expect(blocks.length).toBe(6);
  });

  it('六块按语言与长度可无歧义地分成名称/摘要/说明', () => {
    const parsed = classify(blocks);
    expect(codePoints(parsed.zh.name)).toBeLessThan(codePoints(parsed.zh.summary));
    expect(codePoints(parsed.en.name)).toBeLessThan(codePoints(parsed.en.summary));
  });

  it('名称与摘要守住商店硬上限（摘要超限会导致 zip 上传被拒）', () => {
    const parsed = classify(blocks);
    for (const lang of ['zh', 'en'] as const) {
      expect(codePoints(parsed[lang].name), `${lang} 名称超 ${NAME_BUDGET}`).toBeLessThanOrEqual(NAME_BUDGET);
      expect(codePoints(parsed[lang].summary), `${lang} 摘要超 ${SUMMARY_BUDGET}`).toBeLessThanOrEqual(SUMMARY_BUDGET);
    }
  });

  it('中英说明各守住 16000 码点硬上限', () => {
    const parsed = classify(blocks);
    for (const lang of ['zh', 'en'] as const) {
      const size = codePoints(parsed[lang].description);
      expect(size, `${lang} 说明 ${size} 码点，超 ${DESCRIPTION_BUDGET} 上限`).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
    }
  });

  it('六个粘贴块都不含竞品品牌名与已废止的绝对化表述', () => {
    const hits = blocks.flatMap((block, index) =>
      BANNED.filter(word => block.includes(word)).map(word => `blocks[${index}] 命中「${word}」`),
    );
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('中英说明都没有跨行重复的长句（keyword stuffing 的结构特征）', () => {
    const parsed = classify(blocks);
    for (const lang of ['zh', 'en'] as const) {
      const lines = parsed[lang].description
        .split('\n')
        .map(line => line.trim())
        .filter(line => codePoints(line) > 20);
      const counts = new Map<string, number>();
      for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
      const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([line]) => line);
      expect(duplicates, `${lang} 说明存在重复长句：\n${duplicates.join('\n')}`).toEqual([]);
    }
  });

  it('四个 _locales 值与对应粘贴块逐字一致（摘要走 manifest，漂了就是两个口径）', () => {
    const parsed = classify(blocks);
    for (const [dir, lang] of [
      ['zh_CN', 'zh'],
      ['en', 'en'],
    ] as const) {
      const messages = JSON.parse(
        readFileSync(path.join(ROOT, `public/_locales/${dir}/messages.json`), 'utf8'),
      ) as Record<string, { message: string }>;
      expect(messages.extensionName.message, `${dir} extensionName 与粘贴块不一致`).toBe(parsed[lang].name);
      expect(messages.extensionDescription.message, `${dir} extensionDescription 与粘贴块不一致`).toBe(
        parsed[lang].summary,
      );
    }
  });
});
