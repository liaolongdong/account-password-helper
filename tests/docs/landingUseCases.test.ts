/**
 * 官网「使用场景」一节的结构与动效守卫。
 *
 * 这一节补了两件事：逐行错峰入场，和一排分类筛选 chip。两者的正确性取决于 markup、
 * CSS、文末脚本三处约定是否仍然对齐，而这三处分散在同一文件相隔几千行的位置里
 * （11 个 `<tr>`、Scroll Reveal 那一段、`ucReindex`），改任何一处都很容易忘掉另外两处：
 *
 * 1. 行没有 `data-cat` → 选任何分类都会被 `hidden` 掉，那一行在筛选态下凭空消失；
 * 2. chip 的 `data-cat` 写错 → 该分类恒为 0 行，点上去像「表被清空了」；
 * 3. 错峰只写基准态、漏了 `.visible` 终态 → 11 行卡在 opacity:0，整张表只剩表头。
 *
 * 三条都是静默故障（不报错、控制台干净），所以在这里钉死，并各配一条注入式自检。
 *
 * @module tests/docs/landingUseCases
 */

import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { hasReducedMotionRule, reducedMotionRules } from '../helpers/landingCss';
import { i18nEntry } from '../helpers/landingI18n';

const ROOT = process.cwd();

/** 分类真源：chip 的 data-cat 与行的 data-cat 必须都落在这四个里（`all` 是「不筛选」） */
const CATEGORIES = ['env', 'login', 'migrate', 'security'];

/** 错峰的两条选择器（基准态 / 终态），降级块必须两条都列 */
const STAGGER_STATES = ['html.js #use-cases .pa-wrap tbody tr', 'html.js #use-cases .pa-wrap.visible tbody tr'];

/**
 * 取 `#use-cases` 小节源码。
 *
 * @param html 页面源码
 * @returns 从 section 开标签到 `</section>` 的片段
 */
function useCasesSection(html: string): string {
  const start = html.indexOf('<section id="use-cases">');
  expect(start, 'index.html 缺少 <section id="use-cases">').toBeGreaterThan(-1);
  const end = html.indexOf('</section>', start);
  expect(end, '#use-cases 小节没有闭合').toBeGreaterThan(start);
  return html.slice(start, end);
}

/**
 * 取 tbody 片段——表头那一行本来就没有分类，判「有没有裸行」时必须先把它排除。
 *
 * @param section `#use-cases` 小节源码
 * @returns `<tbody>` 内部
 */
function tbodyOf(section: string): string {
  const open = section.indexOf('<tbody>');
  expect(open, '#use-cases 缺少 tbody').toBeGreaterThan(-1);
  return section.slice(open + '<tbody>'.length, section.indexOf('</tbody>', open));
}

describe('#use-cases 分类筛选的结构契约', () => {
  const html = readFileSync(`${ROOT}/index.html`, 'utf8');
  const section = useCasesSection(html);
  const body = tbodyOf(section);
  const rowCats = [...body.matchAll(/^ {14}<tr data-cat="([^"]+)">$/gm)].map(m => m[1]);
  const chipCats = [...section.matchAll(/class="uc-chip(?: is-on)?"\s+type="button"\s+data-cat="([^"]+)"/g)].map(
    m => m[1],
  );

  it('11 行场景都在，且每一行都带已知分类（漏一行就会在筛选态下凭空消失）', () => {
    expect(rowCats).toHaveLength(11);
    expect(rowCats.filter(cat => !CATEGORIES.includes(cat))).toEqual([]);
  });

  it('tbody 里没有不带 data-cat 的行', () => {
    expect([...body.matchAll(/^ {14}<tr>/gm)].map(m => m[0])).toEqual([]);
    expect([...body.matchAll(/^ {14}<tr/gm)].length, '行数与带分类的行数不一致').toBe(rowCats.length);
  });

  it('chip 覆盖 all 与四个分类，且每个分类下面都真有行', () => {
    expect(chipCats).toEqual(['all', ...CATEGORIES]);
    CATEGORIES.forEach(cat => {
      expect(rowCats.filter(c => c === cat).length, `分类 ${cat} 下没有任何行`).toBeGreaterThan(0);
    });
  });

  it('初态恰好一枚按下，且它就是 all（否则首屏表格被自带的筛选切掉一块）', () => {
    expect([...section.matchAll(/aria-pressed="true"/g)]).toHaveLength(1);
    expect(section).toMatch(/class="uc-chip is-on"\s+type="button"\s+data-cat="all"/);
  });

  it('筛选条的可见性挂在 html.js 上（没有 JS 就不留一套点不动的死控件）', () => {
    expect(html).toMatch(/\.uc-filters\s*\{[^}]*display:\s*none/);
    expect(html).toMatch(/html\.js \.uc-filters\s*\{[^}]*display:\s*flex/);
  });

  it('六个筛选文案中英齐备，且 markup 默认文本逐字等于字典中文值', () => {
    const keys = ['label', 'all', 'env', 'login', 'migrate', 'security'].map(s => `useCases.filter.${s}`);
    // label 那条被 prettier 拆成多属性一行，闭合 `>` 落在下一行，`\s*>` 同时覆盖两种形状
    const markupDefault = [...section.matchAll(/data-i18n="useCases\.filter\.(\w+)"\s*>\s*([^<]*?)\s*<\//g)].map(m => ({
      key: `useCases.filter.${m[1]}`,
      text: m[2],
    }));
    expect(markupDefault.map(m => m.key).sort()).toEqual([...keys].sort());
    markupDefault.forEach(({ key, text }) => {
      const entry = i18nEntry(html, key);
      expect(entry, `I18N 字典缺少 ${key} 的中英两项`).not.toBeNull();
      expect(entry!.en.trim(), `${key} 英文不能为空`).not.toBe('');
      expect(text, `markup 默认文本与字典 zh 不一致：${key}`).toBe(entry!.zh);
    });
  });

  it('守卫自检：抹掉某一行的分类会被判违规', () => {
    const broken = body.replace(/^ {14}<tr data-cat="login">$/m, '              <tr>');
    const cats = [...broken.matchAll(/^ {14}<tr data-cat="([^"]+)">$/gm)].map(m => m[1]);
    expect(cats).toHaveLength(10);
    expect([...broken.matchAll(/^ {14}<tr>/gm)].length).toBe(1);
  });

  it('守卫自检：chip 指向不存在的分类会被判违规', () => {
    const brokenSection = section.replace(/class="uc-chip"\s+type="button"\s+data-cat="migrate"/, 'x');
    const cats = [...brokenSection.matchAll(/class="uc-chip(?: is-on)?"\s+type="button"\s+data-cat="([^"]+)"/g)].map(
      m => m[1],
    );
    expect(cats).not.toContain('migrate');
  });
});

describe('#use-cases 逐行错峰的三层配对', () => {
  const html = readFileSync(`${ROOT}/index.html`, 'utf8');

  it('基准态与终态成对出现，且都带 html.js 前缀与 #use-cases 归属', () => {
    expect(html).toMatch(/html\.js #use-cases \.pa-wrap tbody tr\s*\{[^}]*opacity:\s*0/);
    expect(html).toMatch(/html\.js #use-cases \.pa-wrap\.visible tbody tr\s*\{[^}]*opacity:\s*1/);
  });

  it('错峰只染不移（transform 对 table-row 盒子无效，写了等于没写）', () => {
    const baseline = /html\.js #use-cases \.pa-wrap tbody tr\s*\{([^}]*)\}/.exec(html)?.[1] ?? '';
    expect(baseline).toMatch(/transition:[^;]*opacity/);
    expect(baseline).not.toMatch(/transform/);
  });

  it('降级块把两条选择器都列上并撤掉时长', () => {
    const rules = reducedMotionRules(html);
    STAGGER_STATES.forEach(state => {
      expect(
        hasReducedMotionRule(rules, state, /transition:\s*none/),
        `reduce 块里没有 ${state} { transition: none }`,
      ).toBe(true);
    });
  });

  it('步进值由脚本按可见顺序现给，markup 里不写死 --ri', () => {
    expect(html).not.toMatch(/style="[^"]*--ri/);
    expect(html).toMatch(/setProperty\('--ri'/);
  });

  it('守卫自检：抽掉终态那条会让三层配对判定失效（确认这条断言真的在数它）', () => {
    const broken = html.replace(/html\.js #use-cases \.pa-wrap\.visible tbody tr\s*\{[^}]*\}/, '');
    expect(broken).not.toMatch(/html\.js #use-cases \.pa-wrap\.visible tbody tr\s*\{[^}]*opacity:\s*1/);
  });

  it('守卫自检：降级块里抹掉终态那条，配对判定立刻变红（确认它真的在逐条数选择器）', () => {
    const pair = /html\.js #use-cases \.pa-wrap tbody tr,\n\s*html\.js #use-cases \.pa-wrap\.visible tbody tr \{/;
    expect(html, '降级块里那两条不再是相邻的逗号组，自检的切片方式已失效').toMatch(pair);
    const broken = html.replace(pair, 'html.js #use-cases .pa-wrap tbody tr {');
    const rules = reducedMotionRules(broken);
    expect(hasReducedMotionRule(rules, STAGGER_STATES[0], /transition:\s*none/)).toBe(true);
    expect(hasReducedMotionRule(rules, STAGGER_STATES[1], /transition:\s*none/)).toBe(false);
  });
});
