/**
 * 命令面板的源码扫描守卫：对外条数口径 + 别名抢位
 *
 * 「命令面板有 N 条命令」这句话在 14 个对外文件里被写死（管理页操作指引的中英词条、README 中英、
 * `llms.txt`、落地页中英的指标位、竞品对比页中英、定价页中英与机读摘要、产品站、商店填写文案），
 * 而它的真源是 `entrypoints/options/App.vue` 里 `buildPaletteActions` 返回的 id 列表。
 * 新增或删除一条命令时，typecheck、lint 与既有单测都不会提醒这 20 处——2026-10-13 合入
 * 「身份库复验设置」（第 25 条命令 `identityAccess`）后，语言包词条仍停在 24、定价页三处仍停在
 * 23，两处都是本轮实测发现的静默漂移。
 *
 * 判据方向：先证明**取数本身非空且形状正确**（抽错区域会静默数出 0 或一个错数），再用带 `g` 的正则
 * 要求每处锚点命中到的**每一个**数字都恰好等于真源条数——写旧数字、写其它值、只改同文件里的
 * 一处重复表述、或把这句话删掉，都会红。匹配面是压平空白后的源码（见 `flatSource`），因为
 * prettier 会把 HTML 长句折行，单行原文锚点曾因此漏掉一处活文案；20 处锚点分布在上述 14 个文件。
 *
 * 第二段守卫管的是**别名抢位**：`matchesKeyword` 的匹配方向是「用户输入必须是字段（标签或别名串）
 * 的子串」，所以给一条命令的 `keywords` 里多写一个属于别的命令的词，就会让那个词直达时把别人排在
 * 前面。2026-10-14 加「新手引导」这条时就在评审中抓到一次——它的别名里带了 `'guide'`，输入 guide
 * 时「新手引导」压过了原本的「使用指引」，而这条结果的错位既不会红 typecheck、也不会红单测。
 * 判据写成「把每条命令的 id 打进检索框，首条必须命中它自己」，只让 `keywords` 参与（标签置空），
 * 因而与当前语言无关。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';
import { filterActions, type CommandAction } from '@/utils/commandPalette';

/** 取数：`buildPaletteActions` 返回的数组字面量里的 `id: '...'` 列表 */
function paletteIds(): string[] {
  const source = readSource('entrypoints/options/App.vue');
  const start = source.indexOf('const buildPaletteActions = () => [');
  if (start === -1) return [];
  const end = source.indexOf('\n];', start);
  if (end === -1) return [];
  return [...source.slice(start, end).matchAll(/id:\s*'([A-Za-z]\w*)'/g)].map(match => match[1]);
}

/** 一条命令的 id 与其检索别名（`keywords` 数组里的字符串字面量） */
interface PaletteKeywordSet {
  id: string;
  keywords: string[];
}

/**
 * 取数：把清单切成 `{ id, keywords }` 对
 *
 * 按 `id:` 出现的位置分片，每片取到下一个 `id:` 为止——别名恒在其所属对象的 `id` 之后，
 * 这样不需要解析嵌套括号，也不会把下一条的别名算进这一条。
 */
function paletteKeywords(): PaletteKeywordSet[] {
  const source = readSource('entrypoints/options/App.vue');
  const start = source.indexOf('const buildPaletteActions = () => [');
  const end = source.indexOf('\n];', start);
  if (start === -1 || end === -1) return [];
  const slice = source.slice(start, end);
  const idAt = [...slice.matchAll(/id:\s*'([A-Za-z]\w*)'/g)];
  return idAt.map((match, index) => {
    const from = match.index + match[0].length;
    const to = idAt[index + 1] ? idAt[index + 1]!.index : slice.length;
    const block = /keywords:\s*\[([^\]]*)\]/.exec(slice.slice(from, to));
    return {
      id: match[1],
      keywords: block ? [...block[1].matchAll(/'([^']*)'/g)].map(alias => alias[1]) : [],
    };
  });
}

/**
 * 取数：把整份源码的空白压成单个空格
 *
 * 锚点是单行正则，而对外文案随时会被 prettier 折行 —— 本轮 25→27 就漏掉过一处活文案：
 * `compare.html` 的「按中文 / 拼音 / 首字母检索 23⏎条命令」在数字与「条命令」之间断了行，
 * 单行锚点看不见，于是那个 23 一直躲着守卫（它在本轮之前就已滞后两个修订）。压平后断行位置
 * 不参与判定，命中面只剩「这句话在不在」。
 */
function flatSource(file: string): string {
  return readSource(file).replace(/\s+/g, ' ');
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
  { file: 'compare.html', label: '竞品对比页（中文）要点行', pattern: /检索并直达 (\d+) 条命令/g },
  {
    file: 'compare.html',
    label: '竞品对比页（中文）功能条目行',
    pattern: /按中文 \/ 拼音 \/ 首字母检索 (\d+) 条命令/g,
  },
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

describe('命令面板的源码扫描守卫', () => {
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
      const found = [...flatSource(site.file).matchAll(site.pattern)].map(match => Number(match[1]));
      expect(found.length, `未命中锚点：${site.pattern.source}`).toBeGreaterThan(0);
      expect([...new Set(found)], `${site.file} 存在与真源不一致的条数`).toEqual([ids.length]);
    },
  );

  it('语言包中英两侧的数字互等（防止只改一种语言）', () => {
    const zh = [...flatSource('utils/i18n/locales/zh-CN/help.json').matchAll(/从页面的 (\d+) 条命令中筛选/g)];
    const en = [...flatSource('utils/i18n/locales/en/help.json').matchAll(/narrow down the page's (\d+) commands/g)];
    // 两侧都必须真的命中：都空的话下面的 toEqual([]) 恒过，这条就成了假守卫
    expect(zh.length, '未命中中文锚点').toBeGreaterThan(0);
    expect(en.length, '未命中英文锚点').toBeGreaterThan(0);
    expect(zh.map(match => match[1])).toEqual(en.map(match => match[1]));
  });

  it('任何一条命令的 id 打进检索框，排第一的都必须是它自己（别名不得互相抢位）', () => {
    const sets = paletteKeywords();
    expect(sets.length, '别名抽取为空 = 抽取区域没命中，本守卫在空跑').toBe(ids.length);
    for (const set of sets) expect(set.id, '抽取顺序应与 id 清单一致').toBe(ids[ids.indexOf(set.id)]);
    // 逐条要求至少抽到一个别名：抽错形状会让下面整段判据恒过（每条都 0 命中而被跳过），这是它的空跑自检
    for (const set of sets) expect(set.keywords.length, `${set.id} 没抽到 keywords（抽取正则失效）`).toBeGreaterThan(0);

    // 判据用真过滤器：`matchesKeyword` 的方向是「用户输入必须是字段（标签或别名串）的子串」，
    // 所以别名里多写一个 'guide'，就会让输入 guide 时「新手引导」排到「使用指引」前面 ——
    // 标签置空，只让 keywords 参与，抢位这件事就完全由别名集合决定，与当前语言无关。
    const actions: CommandAction[] = sets.map(set => ({
      id: set.id,
      group: 'entry',
      label: '',
      keywords: set.keywords,
      run: () => {},
    }));

    const offenders = sets
      .map(set => ({ set, hits: filterActions(actions, set.id) }))
      .filter(({ set, hits }) => hits.length > 0 && hits[0]!.id !== set.id)
      .map(({ set, hits }) => `输入「${set.id}」首条是「${hits[0]!.id}」`);

    expect(offenders, `别名抢位：\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
