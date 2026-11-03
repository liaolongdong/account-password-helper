/**
 * 官网页面的 title / description 预算与语言标注守卫
 *
 * 起因：`tests/docs/blogMeta.test.ts` 早就给博客页定了 `DESCRIPTION_BUDGET = 170`，
 * 但根目录那 10 个营销页没人管。全量量下来 `author.en.html` 的 description 205 字、
 * `compare.en.html` 的 description 279 字 + og:description 320 字——Google 在约 160 字
 * 处截断，社交卡在更短处截断，被砍掉的正好是句子后半的差异化卖点。
 * 中文对照页都在预算内（86 / 118），超的全是英文页：**翻译天然膨胀**，
 * 所以这条判据必须按页逐条量，不能假设「中文过了英文也就过了」。
 *
 * 顺带把 `<html lang>` 与 hreflang 三件套钉住。写这个守卫的直接原因是手搓正则量 lang 时，
 * `<html lang="zh-CN" data-lang="zh">` 里的 `data-lang` 被 `\blang` 抢先命中
 * （`-` 是非单词字符，前面确实有词边界），于是把正确的 `zh-CN` 读成了 `zh`，
 * 差一点报出一条不存在的缺陷。这里改用属性级解析，不再拿正则猜标签形状。
 *
 * 预算与 blogMeta 同为 170，是刻意重复的第二份：守卫不 import 被守卫的模块。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DESCRIPTION_BUDGET = 170;
/** `<title>` 整条（含品牌后缀）的字符预算，与 blogMeta 同一口径 */
const TITLE_BUDGET = 72;

const PAGES: ReadonlyArray<{ file: string; lang: 'zh-CN' | 'en' }> = [
  { file: 'index.html', lang: 'zh-CN' },
  { file: 'en.html', lang: 'en' },
  { file: 'author.html', lang: 'zh-CN' },
  { file: 'author.en.html', lang: 'en' },
  { file: 'pricing.html', lang: 'zh-CN' },
  { file: 'pricing.en.html', lang: 'en' },
  { file: 'privacy.html', lang: 'zh-CN' },
  { file: 'privacy.en.html', lang: 'en' },
  { file: 'compare.html', lang: 'zh-CN' },
  { file: 'compare.en.html', lang: 'en' },
];

/** 取 `<head>` 原文 */
function headOf(file: string): string {
  const html = readFileSync(path.join(ROOT, file), 'utf8');
  return /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
}

/**
 * 按 name / property 取 meta 的 content，属性顺序与 prettier 折行都不敏感。
 * 用标签切分而不是单条正则：`[^>]*` 天然跨换行，而 `data-lang` 这类同尾缀的属性
 * 不会因为词边界被误命中——我们只比较整段的 `name="x"` / `property="x"`。
 */
function metaContents(head: string, key: string): string[] {
  return [...head.matchAll(/<meta\b([^>]*)>/g)]
    .map(match => match[1])
    .filter(attrs => new RegExp(`(?:name|property)\\s*=\\s*"${key}"`).test(attrs))
    .map(attrs => /content\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '');
}

/** `<html>` 标签上的 lang（只看第一个 lang 属性，避开同一标签里的 data-lang） */
function htmlLang(file: string): string | undefined {
  const html = readFileSync(path.join(ROOT, file), 'utf8');
  const tag = /<html\b([^>]*)>/i.exec(html)?.[1] ?? '';
  return /(?:^|[\s"'])lang\s*=\s*"([^"]*)"/.exec(tag)?.[1];
}

describe('官网页面的 title 与 description 预算', () => {
  it('量到全部 10 个页面，且确实能读出 meta（防空跑）', () => {
    expect(PAGES).toHaveLength(10);
    for (const { file } of PAGES) {
      const head = headOf(file);
      expect(metaContents(head, 'description').length, `${file} 没读到 description`).toBeGreaterThanOrEqual(1);
      expect(metaContents(head, 'og:description').length, `${file} 没读到 og:description`).toBeGreaterThanOrEqual(1);
    }
    // 反向自检：用一个不存在的 key 必须读出空，否则上面的 filter 是永真
    expect(metaContents(headOf('index.html'), 'no-such-meta')).toEqual([]);
  });

  describe.each(PAGES)('$file', ({ file }) => {
    it('description 与 og:description 都不超预算，且各只有一枚', () => {
      for (const key of ['description', 'og:description']) {
        const values = metaContents(headOf(file), key);
        expect(values.length, `${key} 应当恰好一枚`).toBe(1);
        const [text] = values;
        expect(
          text?.length,
          `${key} ${text?.length} 字，超出 ${DESCRIPTION_BUDGET} 会被搜索结果截断`,
        ).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
      }
    });

    it('title 在预算内且非空', () => {
      const title = /<title>([\s\S]*?)<\/title>/i.exec(headOf(file))?.[1]?.trim() ?? '';
      expect(title.length, 'title 为空').toBeGreaterThan(0);
      expect(title.length, `title ${title.length} 字，超出 ${TITLE_BUDGET}`).toBeLessThanOrEqual(TITLE_BUDGET);
    });
  });
});

describe('官网页面的语言标注', () => {
  describe.each(PAGES)('$file', ({ file, lang }) => {
    it('<html lang> 与本页语言一致（不被 data-lang 干扰）', () => {
      expect(htmlLang(file)).toBe(lang);
    });

    it('hreflang 三件套齐备：本页语言、对侧语言、x-default', () => {
      const alternates = [...headOf(file).matchAll(/<link\b([^>]*)>/g)]
        .map(match => match[1])
        .filter(attrs => /rel\s*=\s*"alternate"/.test(attrs) && /hreflang\s*=/.test(attrs))
        .map(attrs => /hreflang\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '');
      expect([...alternates].sort(), 'hreflang 必须是 zh-CN / en / x-default 三条').toEqual([
        'en',
        'x-default',
        'zh-CN',
      ]);
    });
  });
});
