/**
 * 已发布页面的 JSON-LD 结构化数据守卫
 *
 * 官网根目录 10 页 + `blog/*.html` 一共 54 个 `<script type="application/ld+json">` 块，
 * 决定的是搜索结果里的富结果（评分、面包屑、FAQ、HowTo 步骤）。这一层此前**没有任何判据**：
 * 一个未转义的引号、一个漏掉的 `offers`，都会让整块 JSON 解析失败，而解析失败只表现为
 * 「富结果悄悄消失」——本地打开页面看得到、测不出，只有 Search Console 几周后才反映出来。
 * 2026-10-26 全量量下来结构是干净的（54 块全部可解析、必填字段齐），所以这个文件不是修 bug，
 * 是把已经对的东西钉住，防止下一次静默损坏。
 *
 * 三条容易写错的口径，都在这文件里显式处理，避免守卫自己制造假问题：
 * 1. `@context` 只要求出现在**文档层**。`@graph` 里的子节点（Organization / WebSite）
 *    按规范继承图级 context，逐节点强制会误报 8 条。
 * 2. 日期只断言 ISO 形态与 `dateModified >= datePublished`，不假设具体日期——博客页由
 *    `pnpm gen:blog` 从 md front matter 生成，新鲜度归 `blogMeta.test.ts` 管，这里不重复守。
 * 3. URL 类字段一律要求绝对 `https://`：相对路径在 JSON-LD 里不会像 `<a href>` 那样自动补全，
 *    Google 直接判无效。
 * 4. 带 `itemListElement` 的节点有两种（BreadcrumbList / ItemList），位置连续性对两者都成立。
 *    这条是第一版漏掉的：给判据配刀时，变异打在 ItemList 上却仍然全绿——因为当时只查了
 *    BreadcrumbList。「六把刀」当场变成五把，故在此记下：**每条判据都要有自己的刀，且刀要
 *    打在自己声称覆盖的那个分支上**。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** 站点域名（与 blogMeta / pageMetaBudget 同一口径，守卫不 import 被守卫的模块） */
const SITE_ORIGIN = 'https://liaolongdong.github.io';

interface JsonLdNode {
  '@type'?: unknown;
  [key: string]: unknown;
}

interface Block {
  file: string;
  index: number;
  raw: string;
}

/** 递归收集 HTML 文件，跳过构建产物与并行会话的 worktree */
function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (
        /^(node_modules|\.output|\.git|dist|benchmarks|assets)$/.test(entry.name) ||
        entry.name.startsWith('.aph-wt') ||
        entry.name.startsWith('.review-pinned')
      )
        continue;
      htmlFiles(rel, acc);
    } else if (entry.name.endsWith('.html')) {
      acc.push(rel);
    }
  }
  return acc;
}

function jsonLdBlocks(file: string, html: string): Block[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match, index) => ({
    file,
    index,
    raw: match[1],
  }));
}

const PAGES = htmlFiles('');
const BLOCKS = PAGES.flatMap(file => jsonLdBlocks(file, readFileSync(path.join(ROOT, file), 'utf8')));

/** 解析并展开 `@graph`，解析失败直接记为违规（而不是让整条用例崩掉） */
function nodesOf(block: Block): { nodes: JsonLdNode[]; error?: string } {
  try {
    const parsed = JSON.parse(block.raw) as JsonLdNode & { '@graph'?: JsonLdNode[] };
    if (typeof parsed !== 'object' || parsed === null) return { nodes: [], error: '顶层不是对象' };
    if (!parsed['@context']) return { nodes: [], error: '文档层缺 @context' };
    const nodes = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
    return { nodes };
  } catch (error) {
    return { nodes: [], error: `JSON 解析失败：${(error as Error).message}` };
  }
}

const ABSOLUTE_URL_FIELDS = ['url', '@id', 'image', 'logo', 'installUrl', 'downloadUrl', 'screenshot', 'license'];

function isIsoDate(value: unknown): boolean {
  return (
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[0-2]\d:[0-5]\d(:[0-5]\d)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)
  );
}

function describeBlock(block: Block): string {
  return `${block.file} #${block.index + 1}`;
}

describe('已发布页面的 JSON-LD 结构', () => {
  it('扫描面够大：页面与 JSON-LD 块都不是空集，防止整条判据空跑', () => {
    expect(PAGES.length).toBeGreaterThan(30);
    expect(BLOCKS.length).toBeGreaterThan(40);
  });

  it('每一块都能被 JSON.parse，且文档层带 @context', () => {
    const broken = BLOCKS.map(block => ({ block, ...nodesOf(block) }))
      .filter(entry => entry.error)
      .map(entry => `${describeBlock(entry.block)} — ${entry.error}`);
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('类型集合覆盖已知的那九种（整块被删会让这条变红）', () => {
    const seen = new Set<string>();
    for (const block of BLOCKS) for (const node of nodesOf(block).nodes) seen.add(String(node['@type']));
    expect([...seen].sort()).toEqual([
      'BlogPosting',
      'BreadcrumbList',
      'FAQPage',
      'HowTo',
      'ItemList',
      'Organization',
      'ProfilePage',
      'SoftwareApplication',
      'WebSite',
    ]);
  });

  it('每个节点都有 @type，且 Google 的必填项齐备', () => {
    /**
     * 只列 Google 真正要求的字段，不列「推荐但有就更好」的那一批：
     * pricing 两页的 SoftwareApplication 只有 8 个字段、index 有 23 个，那是详略差异
     * 不是无效（缺 `url` / `softwareVersion` / `isAccessibleForFree` 不影响富结果资格）。
     * 把推荐项写成硬判据，等于替用户决定对外元数据要写多细——那属于要问的范畴。
     */
    const REQUIRED: Record<string, string[]> = {
      SoftwareApplication: ['name', 'operatingSystem', 'applicationCategory'],
      BlogPosting: ['headline', 'datePublished', 'dateModified', 'author', 'inLanguage'],
      BreadcrumbList: ['itemListElement'],
      FAQPage: ['mainEntity'],
      HowTo: ['name', 'step'],
      ItemList: ['itemListElement'],
      ProfilePage: ['url', 'mainEntity', 'inLanguage'],
      Organization: ['name', 'url'],
      WebSite: ['url', 'name'],
    };
    const violations: string[] = [];
    for (const block of BLOCKS) {
      for (const node of nodesOf(block).nodes) {
        const type = String(node['@type'] ?? '');
        const required = REQUIRED[type];
        if (!required) {
          violations.push(`${describeBlock(block)}: 未登记的 @type「${type || '(缺失)'}」`);
          continue;
        }
        for (const field of required) {
          if (node[field] === undefined || node[field] === null || node[field] === '') {
            violations.push(`${describeBlock(block)} (${type}): 缺 ${field}`);
          }
        }
        if (type === 'SoftwareApplication' && node.offers === undefined && node.aggregateRating === undefined) {
          violations.push(`${describeBlock(block)}: SoftwareApplication 既无 offers 也无 aggregateRating`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  /**
   * 详略可以不同，但**同一实体在各页的描述不能互相矛盾**。
   * `name` 按页面语言分流是刻意的（中文页用中文名、英文页用英文名，另一语言进
   * `alternateName`），所以这里不断言 name 全局唯一，而是断言它与本页 `<html lang>` 匹配；
   * 其余实体属性（license / 分类 / 系统）必须逐字一致。
   */
  it('各页的 SoftwareApplication 描述同一个实体，且本地化名字跟着本页语言走', () => {
    const BRAND: Record<'zh' | 'en', { name: string; alternate: string }> = {
      zh: { name: '账号密码管理助手', alternate: 'Account Password Helper' },
      en: { name: 'Account Password Helper', alternate: '账号密码管理助手' },
    };
    const apps = BLOCKS.flatMap(block =>
      nodesOf(block)
        .nodes.filter(node => node['@type'] === 'SoftwareApplication')
        .map(node => ({ block, node })),
    );
    expect(apps.length).toBeGreaterThanOrEqual(4);

    for (const { block, node } of apps) {
      // `<html>` 的 lang 可能与其他属性一起被折行，取整个开标签再抽属性
      const htmlTag = /<html\b([^>]*)>/i.exec(readFileSync(path.join(ROOT, block.file), 'utf8'))?.[1] ?? '';
      const lang = /\blang\s*=\s*["']([^"']+)["']/.exec(htmlTag)?.[1] ?? '';
      const bucket: 'zh' | 'en' = lang.startsWith('zh') ? 'zh' : 'en';
      expect(node.name, `${describeBlock(block)} 页面 lang=${lang}，name 应为「${BRAND[bucket].name}」`).toBe(
        BRAND[bucket].name,
      );
      expect(node.alternateName, describeBlock(block)).toBe(BRAND[bucket].alternate);
    }

    const COMPARE = ['applicationCategory', 'operatingSystem', 'license'];
    const violations: string[] = [];
    for (const field of COMPARE) {
      const values = new Map<string, string[]>();
      for (const { block, node } of apps) {
        const value = node[field];
        if (value === undefined) continue;
        const key = JSON.stringify(value);
        values.set(key, [...(values.get(key) ?? []), describeBlock(block)]);
      }
      if (values.size > 1) {
        violations.push(
          `${field} 出现 ${values.size} 种取值：` +
            [...values.entries()].map(([value, files]) => `${value} ← ${files.join(', ')}`).join('；'),
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('URL 类字段是绝对 https 地址（相对路径在 JSON-LD 里不会被补全）', () => {
    const violations: string[] = [];
    const visit = (value: unknown, where: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${where}[${i}]`));
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          if (ABSOLUTE_URL_FIELDS.includes(key) && typeof child === 'string') {
            if (!/^https:\/\/\S+$/.test(child)) violations.push(`${where}.${key} = ${child}`);
          } else if (child && typeof child === 'object') {
            visit(child, `${where}.${key}`);
          }
        }
      }
    };
    for (const block of BLOCKS) for (const node of nodesOf(block).nodes) visit(node, describeBlock(block));
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('日期是 ISO 形态，且 dateModified 不早于 datePublished', () => {
    const violations: string[] = [];
    for (const block of BLOCKS) {
      for (const node of nodesOf(block).nodes) {
        for (const field of ['datePublished', 'dateModified']) {
          const value = node[field];
          if (value === undefined) continue;
          if (!isIsoDate(value)) {
            violations.push(`${describeBlock(block)}: ${field} = ${JSON.stringify(value)} 不是 ISO 日期`);
            continue;
          }
          if (field === 'dateModified' && isIsoDate(node.datePublished)) {
            const published = Date.parse(String(node.datePublished));
            const modified = Date.parse(String(value));
            if (Number.isFinite(published) && modified < published) {
              violations.push(
                `${describeBlock(block)}: dateModified(${value}) 早于 datePublished(${node.datePublished})`,
              );
            }
          }
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('SoftwareApplication 的 offers 如实标成免费（price 为 0）', () => {
    const apps = BLOCKS.flatMap(block =>
      nodesOf(block)
        .nodes.filter(node => node['@type'] === 'SoftwareApplication')
        .map(node => ({ block, node })),
    );
    expect(apps.length).toBeGreaterThanOrEqual(4);
    for (const { block, node } of apps) {
      const offers = node.offers as Record<string, unknown> | undefined;
      // `isAccessibleForFree` 属推荐项（pricing 两页就没写），不在这里替用户决定详略；
      // 但**写了 offers 就必须自洽**：声称免费的实体不能出现非零价。
      if (!offers) continue;
      expect(offers['@type'], describeBlock(block)).toBe('Offer');
      expect(String(offers.price), `${describeBlock(block)} 声称免费则 price 必须是 0`).toBe('0');
      expect(typeof offers.priceCurrency, describeBlock(block)).toBe('string');
    }
  });

  it('面包屑与列表的位置从 1 连续递增，FAQ 与 HowTo 的子项结构完整', () => {
    const violations: string[] = [];
    const checkList = (node: JsonLdNode, where: string, kind: string): void => {
      const items = node.itemListElement as Array<Record<string, unknown>>;
      if (!Array.isArray(items) || items.length === 0) {
        violations.push(`${where}: ${kind} 的 itemListElement 不是非空数组`);
        return;
      }
      items.forEach((item, i) => {
        if (item['@type'] !== 'ListItem') violations.push(`${where}: ${kind} 第 ${i + 1} 项不是 ListItem`);
        if (item.position !== i + 1) {
          violations.push(`${where}: ${kind} 第 ${i + 1} 项 position=${String(item.position)}，应为 ${i + 1}`);
        }
        if (!item.item && !item.url) {
          // ListItem 的指针可以是 `item`（compare 页用这个，带完整子实体）
          // 也可以是 `url`（博客索引页用这个）——只认其一会把合法写法判成缺陷。
          violations.push(`${where}: ${kind} 第 ${i + 1} 项既无 item 也无 url`);
        }
        // 面包屑靠 name 显示层级文字，ItemList 的 name 可选（条目本身带名称）
        if (kind === 'BreadcrumbList' && !item.name) violations.push(`${where}: 面包屑第 ${i + 1} 项缺 name`);
      });
    };
    for (const block of BLOCKS) {
      for (const node of nodesOf(block).nodes) {
        const type = String(node['@type']);
        const where = describeBlock(block);
        if (type === 'BreadcrumbList' || type === 'ItemList') checkList(node, where, type);
        if (type === 'FAQPage') {
          for (const q of node.mainEntity as Array<Record<string, unknown>>) {
            if (
              q['@type'] !== 'Question' ||
              !q.name ||
              !(q.acceptedAnswer as Record<string, unknown> | undefined)?.text
            ) {
              violations.push(`${where}: FAQ 条目不是完整的 Question/acceptedAnswer`);
            }
          }
        }
        if (type === 'HowTo') {
          const steps = node.step as Array<Record<string, unknown>>;
          if (!Array.isArray(steps) || steps.length === 0) violations.push(`${where}: HowTo 没有 step`);
          else steps.forEach((s, i) => !s.name && violations.push(`${where}: 第 ${i + 1} 步缺 name`));
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('营销页的 JSON-LD url 与该页 canonical 指向同一地址', () => {
    const pagesWithApp = ['index.html', 'en.html', 'pricing.html', 'pricing.en.html'];
    for (const file of pagesWithApp) {
      const html = readFileSync(path.join(ROOT, file), 'utf8');
      // 逐个 `<link>` 标签取出 rel / href，而不是拿一条正则去猜标签的书写形状：
      // prettier 会把长标签折行（index.html 的 canonical 就是 `rel` 与 `href` 分两行），
      // 单行正则会漏读成「缺 canonical」——同一个坑在 pageMetaBudget.test.ts 里记过。
      const canonical = [...html.matchAll(/<link\b([^>]*)>/g)]
        .map(match => {
          const rel = /\brel\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1];
          const href = /\bhref\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1];
          return rel === 'canonical' ? href : undefined;
        })
        .find(Boolean);
      expect(canonical, `${file} 缺 canonical`).toBeTruthy();
      const app = jsonLdBlocks(file, html)
        .flatMap(block => nodesOf(block).nodes)
        .find(node => node['@type'] === 'SoftwareApplication');
      expect(app, `${file} 缺 SoftwareApplication 节点`).toBeTruthy();
      // pricing 两页的实体没写 url（属详略差异，见必填项那条的说明），写了才比对。
      if (app!.url === undefined) continue;
      expect(String(app!.url).startsWith(SITE_ORIGIN), `${file} 的 JSON-LD url 不在本站域下`).toBe(true);
      expect(new URL(String(app!.url)).pathname, `${file} 的 JSON-LD url 与 canonical 不同页`).toBe(
        new URL(canonical!).pathname,
      );
    }
  });
});
