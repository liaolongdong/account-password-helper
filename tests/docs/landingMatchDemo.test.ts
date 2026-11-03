/**
 * 落地页「多环境匹配模拟器」结构守卫
 *
 * 模拟器是落地页上唯一直接演示「同一站点多环境账号为何不会串号」的交互。
 * 它有三条容易静默失效的路径：
 *
 * 1. **无 JS 时没有内容**：结果列表若只由脚本注入，禁 JS 的读者与不执行脚本的
 *    AI 爬虫只看到一张空卡。因此静态默认结果必须真实写在服务字节里，且与
 *    `admin.example.com` / 精确档的运行时结果一致；
 * 2. **中英只翻一半**：动态结果里的账号说明、徽标与档位规则走 `I18N` 字典，
 *    漏一条就会出现「中文页英文、英文页中文」的混排；
 * 3. **规则演示与产品口径漂移**：演示数据必须覆盖精确、通配、主域、兄弟子域
 *    与 localhost 端口隔离五种形状，否则「三档」只是三个没有区别的按钮。
 *
 * 本文件从服务字节与字典反推这三件事；真正的点击行为由
 * `e2e/landing-match-demo.spec.ts` 在 Chrome 里验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(__dirname, '../..');

const PAGES = [
  { file: 'index.html', lang: 'zh' as const, label: '中文页' },
  { file: 'en.html', lang: 'en' as const, label: '英文页' },
];

type Dict = Record<string, { zh: string; en: string }>;

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

/** 与 `landingNoJsSurface.test.ts` 同一截取方式：纯对象字面量交给 vm 求值 */
function i18nDict(html: string, file: string): Dict {
  const start = html.indexOf('const I18N = {');
  expect(start, `${file} 找不到 I18N 字典起点`).toBeGreaterThan(-1);
  const bodyStart = html.indexOf('{', start);
  const dictEnd = html.indexOf('};', bodyStart);
  expect(dictEnd, `${file} 找不到 I18N 字典终点`).toBeGreaterThan(bodyStart);
  return vm.runInNewContext(`(${html.slice(bodyStart, dictEnd + 1)})`) as Dict;
}

/** 取某个 id 的 `<b>` / `<em>` 文本，属性可跨行 */
function textById(html: string, tag: 'b' | 'em', id: string, file: string): string {
  const match = new RegExp(`<${tag}\\s+id="${id}"[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`).exec(html);
  expect(match, `${file} 找不到 #${id}`).not.toBeNull();
  return match![1].replace(/\s+/g, ' ').trim();
}

/** 静态默认结果列表：服务字节里必须已经有行 */
function staticRows(html: string, file: string): string {
  const block = /<ul\s+class="match-list"\s+id="matchList"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  expect(block, `${file} 的 #matchList 不可解析`).not.toBeNull();
  return block![1];
}

describe('服务字节里的静态默认结果', () => {
  it.each(PAGES)('$label 默认展示 admin.example.com 的三条精确命中', ({ file, lang, label }) => {
    const html = read(file);
    const dict = i18nDict(html, file);
    const rows = staticRows(html, file);

    expect(rows.match(/<li class="match-row">/g) ?? [], `${label} 静态结果不是 3 行`).toHaveLength(3);
    expect(rows).toContain('demo-admin@example.com');
    expect(rows).toContain(dict['match.note.prod'][lang]);
    expect(rows).toContain(dict['match.kind.exact'][lang]);
    expect(rows).toContain('admin.example.com');

    expect(textById(html, 'b', 'matchSummary', file)).toBe(dict['match.summaryStatic'][lang]);
    expect(textById(html, 'em', 'matchRule', file)).toBe(dict['match.rule.exact'][lang]);
    expect(/id="matchHost"[\s\S]{0,160}?value="admin\.example\.com"/.test(html), `${label} 默认主机名不对`).toBe(true);
  });

  it('模拟器位于痛点与特性之间，默认结果不依赖脚本', () => {
    const html = read('index.html');
    const problem = html.indexOf('id="problem"');
    const demo = html.indexOf('id="matchDemo"');
    const features = html.indexOf('id="features"');
    expect(problem).toBeGreaterThan(-1);
    expect(demo).toBeGreaterThan(problem);
    expect(features).toBeGreaterThan(demo);
  });
});

describe('字典覆盖与中英一致', () => {
  it.each(PAGES)('$label 的每个 match.* key 都有中英值', ({ file, label }) => {
    const html = read(file);
    const dict = i18nDict(html, file);
    const keys = new Set<string>();
    for (const match of html.matchAll(/data-i18n(?:-html)?="(match\.[^"]+)"/g)) keys.add(match[1]);
    expect(keys.size, `${label} 没扫到 match.* 词条`).toBeGreaterThan(10);
    for (const key of keys) {
      expect(dict[key], `${label} 缺少 ${key}`).toBeDefined();
      expect(dict[key].zh, `${label} 的 ${key} 缺中文`).toBeTruthy();
      expect(dict[key].en, `${label} 的 ${key} 缺英文`).toBeTruthy();
    }
  });

  it('中英字典的 match.* key 集合一致', () => {
    const zh = i18nDict(read('index.html'), 'index.html');
    const en = i18nDict(read('en.html'), 'en.html');
    const zhKeys = Object.keys(zh)
      .filter(key => key.startsWith('match.'))
      .sort();
    const enKeys = Object.keys(en)
      .filter(key => key.startsWith('match.'))
      .sort();
    expect(enKeys).toEqual(zhKeys);
  });
});

describe('演示数据覆盖五种匹配形状', () => {
  it('中英页面都带着完整夹具与渲染入口', () => {
    for (const { file, label } of PAGES) {
      const html = read(file);
      expect(html, `${label} 缺夹具`).toContain('const MATCH_VAULT');
      expect(html, `${label} 缺规则实现`).toContain('const resolveMatches');
      expect(html, `${label} 缺渲染入口`).toContain('function renderMatch');
      expect(html, `${label} 的 applyLang 没有重建结果`).toContain('renderMatch();');
      for (const host of [
        'admin.example.com',
        '*.example.com',
        '*.qq.com',
        'qq.com',
        'v.qq.com',
        'localhost:5173',
        'localhost:3000',
      ]) {
        expect(html, `${label} 缺演示主机 ${host}`).toContain(host);
      }
      expect(textById(html, 'b', 'matchSummary', file)).toBeTruthy();
    }
  });
});
