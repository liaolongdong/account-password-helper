/**
 * 命令面板条数的对外口径守卫
 *
 * 「命令面板有 N 条命令」这句话在 14 个对外文件里被写死（管理页操作指引的中英词条、README 中英、
 * `llms.txt`、落地页中英的指标位、竞品对比页中英、定价页中英与机读摘要、产品站、商店填写文案），
 * 而它的真源是 `entrypoints/options/App.vue` 里 `buildPaletteActions` 返回的 id 列表。
 * 新增或删除一条命令时，typecheck、lint 与既有单测都不会提醒这 14 处——2026-10-13 合入
 * 「身份库复验设置」（第 25 条命令 `identityAccess`）后，语言包词条仍停在 24、定价页三处仍停在
 * 23，两处都是本轮实测发现的静默漂移。
 *
 * 判据方向：先证明**取数本身非空且形状正确**（抽错区域会静默数出 0 或一个错数），再用带 `g` 的正则
 * 要求每处锚点命中到的**每一个**数字都恰好等于真源条数——写旧数字、写其它值、只改同文件里的
 * 一处重复表述、或把这句话删掉，都会红。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

/** 取数：`buildPaletteActions` 返回的数组字面量里的 `id: '...'` 列表 */
function paletteIds(): string[] {
  const source = readSource('entrypoints/options/App.vue');
  const start = source.indexOf('const buildPaletteActions = () => [');
  if (start === -1) return [];
  const end = source.indexOf('\n];', start);
  if (end === -1) return [];
  return [...source.slice(start, end).matchAll(/id:\s*'([A-Za-z]\w*)'/g)].map(match => match[1]);
}

/** 一处对外文案：文件 + 紧邻「命令」的那个数字的锚点（捕获组即数字，必须带 `g`） */
interface CopySite {
  file: string;
  label: string;
  pattern: RegExp;
}

const COPY_SITES: CopySite[] = [
  {
    file: 'utils/i18n/locales/zh-CN/help.json',
    label: '侧边栏操作指引（中文）',
    pattern: /从页面的 (\d+) 条命令中筛选/g,
  },
  {
    file: 'utils/i18n/locales/en/help.json',
    label: '侧边栏操作指引（英文）',
    pattern: /narrow down the page's (\d+) commands/g,
  },
  {
    file: 'README.md',
    label: 'README 功能速览',
    pattern: /唤起，(\d+) 条命令支持中文/g,
  },
  {
    file: 'README.md',
    label: 'README 快捷键表',
    pattern: /检索并直达 (\d+) 条命令/g,
  },
  {
    file: 'README.en.md',
    label: 'README（英文）功能速览',
    pattern: /filter its (\d+) commands by Chinese/g,
  },
  {
    file: 'README.en.md',
    label: 'README（英文）快捷键表',
    pattern: /any of its (\d+) commands/g,
  },
  { file: 'llms.txt', label: 'llms.txt 机读摘要', pattern: /filters its (\d+) commands/g },
  {
    file: 'index.html',
    label: '落地页指标位',
    pattern: /<b>(\d+)<\/b>\s*<span data-i18n="metrics\.commands">/g,
  },
  {
    file: 'en.html',
    label: '英文落地页指标位',
    pattern: /<b>(\d+)<\/b>\s*<span data-i18n="metrics\.commands">/g,
  },
  { file: 'compare.html', label: '竞品对比页（中文）', pattern: /检索并直达 (\d+) 条命令/g },
  {
    file: 'compare.en.html',
    label: '竞品对比页（英文）',
    pattern: /(?:filter|run) (\d+) commands/g,
  },
  {
    file: 'pricing.md',
    label: '机读定价摘要',
    pattern: /filters (\d+) commands/g,
  },
  {
    file: 'pricing.html',
    label: '定价页（中文）功能卡与词条',
    pattern: /检索 (\d+) 条命令/g,
  },
  {
    file: 'pricing.html',
    label: '定价页（中文）词条英文值',
    pattern: /filters (\d+) commands/g,
  },
  {
    file: 'pricing.en.html',
    label: '定价页（英文）功能卡与词条',
    pattern: /filters (\d+) commands/g,
  },
  {
    file: 'product-site/index.html',
    label: '产品站功能卡',
    pattern: /唤起 (\d+) 条命令/g,
  },
  {
    file: 'product-site/index.html',
    label: '产品站快捷键表',
    pattern: /检索并直达 (\d+) 条命令/g,
  },
  {
    file: 'docs/store/CWS_FILL_CONTENT.md',
    label: '商店填写文案（中文粘贴块）',
    pattern: /检索并直达 (\d+) 条常用命令/g,
  },
  {
    file: 'docs/store/CWS_FILL_CONTENT.md',
    label: '商店填写文案（英文粘贴块）',
    pattern: /searches (\d+) commands/g,
  },
];

describe('命令面板条数的对外口径', () => {
  const ids = paletteIds();

  it('真源抽取非空，且首条与本轮新增那条都在（防抽错区域静默空跑）', () => {
    expect(ids.length).toBeGreaterThan(10);
    // `add` 是历史首条；`identityAccess` 是 2026-10-13 加入的第 25 条，也是本守卫的起因
    expect(ids[0]).toBe('add');
    expect(ids).toContain('identityAccess');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(COPY_SITES.map(site => [`${site.file} · ${site.label}`, site] as const))(
    '%s 写的是真源条数',
    (_label, site) => {
      const found = [...readSource(site.file).matchAll(site.pattern)].map(match => Number(match[1]));
      expect(found.length, `未命中锚点：${site.pattern.source}`).toBeGreaterThan(0);
      expect([...new Set(found)], `${site.file} 存在与真源不一致的条数`).toEqual([ids.length]);
    },
  );

  it('语言包中英两侧的数字互等（防止只改一种语言）', () => {
    const zh = [...readSource('utils/i18n/locales/zh-CN/help.json').matchAll(/从页面的 (\d+) 条命令中筛选/g)];
    const en = [...readSource('utils/i18n/locales/en/help.json').matchAll(/narrow down the page's (\d+) commands/g)];
    expect(zh.map(match => match[1])).toEqual(en.map(match => match[1]));
  });
});
