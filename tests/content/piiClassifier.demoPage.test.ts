// @vitest-environment jsdom
/**
 * 个人信息演示台的逐字段判定账本
 *
 * 全仓唯一吃「一整页真实形状」的账本：`docs/fixtures/identity-hint-demo.html` 把页面写出标签与
 * 输入框关系的十种形状（嵌套 label、`label[for]`、组件库式兄弟块、autocomplete 自声明、登录组、
 * 裸兄弟文本、表格 th、英文词典、值形状收口、负向噪音）一次摆平，本页每个受检字段带
 * `data-expect`（期望角色，`-` 表示不该提示）与 `data-suppress`（被哪条出口挡掉）。
 *
 * 为什么要有这份文件：其余分类器用例各钉一条**形状结论**，改一处词典只会红一条；
 * 而「为什么我在真实页面上看不到提示」是一次整页扫描才答得出的问题——它要的是命中率，
 * 不是单点。这一页同时是手工回归台（起法见文件头注释）与这份账本的夹具，两边读同一份 HTML，
 * 不会各说各话。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { resolvePiiField } from '@/entrypoints/content/piiClassifier';
import { readSource } from '../helpers/architectureScan';

/** 演示台夹具：仓库内路径，`data-expect` 是它唯一的期望声明处 */
const DEMO_PAGE = 'docs/fixtures/identity-hint-demo.html';

/** 一行账：字段 id、页面声明的期望、分类器实际给出的结论 */
interface Row {
  id: string;
  expected: string;
  expectedSuppress: string;
  actual: string;
  actualSuppress: string;
  owns: string;
  /** 声明的命中层级（`data-tier`，只在需要钉「哪条通道给的结论」时写） */
  expectedTier: string;
  actualTier: string;
}

/** 把整页正文塞进 jsdom：只取 `<body>` 内的片段，无嵌套 body */
function loadDemoPage(): void {
  const html = readSource(DEMO_PAGE);
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1];
  if (!body) throw new Error(`${DEMO_PAGE} 里没有 <body> 片段，夹具被改坏了`);
  document.body.innerHTML = body;
}

/** 逐字段跑判定，收成可对账的行 */
function sweep(): Row[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-expect]')).map(el => {
    const verdict = resolvePiiField(el);
    return {
      id: el.id || '<无 id>',
      expected: el.dataset.expect ?? '',
      expectedSuppress: el.dataset.suppress ?? '',
      actual: verdict.role ?? '-',
      actualSuppress: verdict.suppress ?? '',
      owns: el.dataset.owns ?? '',
      expectedTier: el.dataset.tier ?? '',
      actualTier: verdict.tier ?? '',
    };
  });
}

describe('演示台逐字段判定账本', () => {
  beforeAll(loadDemoPage);

  it('夹具里有足量受检字段（扫描面不得静默空跑）', () => {
    expect(sweep().length).toBeGreaterThanOrEqual(40);
  });

  /**
   * 一次性比对所有行
   *
   * 不用逐行 `expect`：那会在第一处漂移就中断，而「这一页有多少框出提示」要的是整页读数，
   * 一次看全才能判断该改词典还是该改夹具。
   *
   * 声明了 `data-tier` 的行还要对上「靠哪条线索判出来的」：`group`（同项兄弟标签）与
   * `placeholder` 都是这一轮新加的弱线索，它们与 label / attr 之间的**先后**才是这条链路的契约，
   * 只看角色对不对的话，「placeholder 抢在 label 前面」这类倒挂会静默通过。
   * 末尾两行计数是给 `data-tier` 本身兜底的：属性被整段删掉时上面的比对会恒真通过。
   */
  it('每个字段的结论与页面声明一致', () => {
    const rows = sweep();
    const drifted = rows.filter(
      row =>
        row.actual !== row.expected ||
        (row.expected === '-' && row.actualSuppress !== row.expectedSuppress) ||
        (row.expectedTier !== '' && row.actualTier !== row.expectedTier),
    );
    expect(drifted, '这些字段的判定与 `data-expect` / `data-tier` 不符').toEqual([]);
    const tierCount = (tier: string): number => rows.filter(row => row.expectedTier === tier).length;
    expect(tierCount('group'), '同项兄弟标签那两条通道的账本行没了（`data-tier="group"`）').toBeGreaterThanOrEqual(4);
    expect(tierCount('placeholder'), '占位符通道的账本行没了（`data-tier="placeholder"`）').toBeGreaterThanOrEqual(8);
  });

  /**
   * 命中面按角色闭集点齐
   *
   * 这条守的是「词典整段漏掉某个角色」：单条形状用例全绿时，某个角色可能在这页上一个都没出现，
   * 而那正是英文站点曾经的漏报形态。`owns=fill` 的手机号框计入分类器命中，页面侧让位由 e2e 管。
   */
  it('十六个可提示角色在本页全部出现过', () => {
    const roles = new Set(
      sweep()
        .filter(row => row.actual !== '-')
        .map(row => row.actual),
    );
    expect([...roles].sort()).toEqual(
      [
        'address',
        'birthday',
        'cardBank',
        'cardHolder',
        'cardNo',
        'email',
        'familyName',
        'gender',
        'givenName',
        'idNumber',
        'name',
        'org',
        'passport',
        'phone',
        'postal',
        'region',
      ].sort(),
    );
  });

  /** 命中面与压制面都得有量：某一侧整块塌陷，说明词典或负向表被改坏了 */
  it('提示与压制各占一半上下（命中面不得整侧塌陷）', () => {
    const rows = sweep();
    const hits = rows.filter(row => row.actual !== '-').length;
    expect(hits).toBeGreaterThanOrEqual(14);
    expect(rows.length - hits).toBeGreaterThanOrEqual(12);
  });

  /**
   * 标了 `owns="fill"` 的框：分类器照旧给角色，让位发生在页面侧（钥匙图标拥有它）。
   * 这一句把「两层判据分开」写进账本——把让位误写进分类器，本行会红，
   * 而单看 `formDetector.identityHint.test.ts` 看不见这个方向。
   */
  it('让位给快速填充的框，分类器本身仍给出角色', () => {
    const owned = sweep().filter(row => row.owns === 'fill');
    expect(owned.length, '夹具里的 `data-owns="fill"` 行没了，两层判据的分界不再被记录').toBeGreaterThan(0);
    expect(owned.every(row => row.actual !== '-')).toBe(true);
  });
});
