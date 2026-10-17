import fs from 'node:fs';
import path from 'node:path';

import { REPO_ROOT } from './global-setup';
import { expect, test } from './harness';
import { liteExactMatch } from './i18n';
import {
  focusAndReadState,
  focusUntilHint,
  focusUntilKey,
  keyReadout,
  openFormPage,
  type KeyRead,
} from './identityHintDom';

/**
 * 「个人信息填写演示台」的真机逐行对账
 *
 * `docs/fixtures/identity-hint-demo.html` 把十七种「页面把标签与输入框写成什么关系」的真实形状
 * 一次摆平（嵌套 label、`label[for]`、Element Plus 式兄弟块、`autocomplete` 自声明、登录组、
 * 裸兄弟文本、表格 `th` 与 `<td>` 标签格、英文词典、值形状收口、负向噪音、组件库复合项、行栅格、
 * 只有占位符、银行卡三档、不可输入的控件、国内五类高频填报场景、编号族）。它已经有一份 jsdom 账本
 * （`tests/content/piiClassifier.demoPage.test.ts`），那份吃的是**分类器**的结论，能区分
 * 「被哪条出口挡掉」；这一条吃的是**装完之后**的行为，量不到出口归属，只量一件事：
 *
 * > 用户在真 Chrome 里点到这一框，到底有没有气泡、气泡报的是不是账本写的那个角色。
 *
 * 两者的差正是这条用例的价值所在：分类器判出角色之后，还要过总闸、顶层 frame、
 * 「控件三类之一」、只读控件不参与、快速填充让位这五道门才轮到建泡。jsdom 全绿而这一条红，
 * 说明漏的是这五道门里的某一道，而不是词典。
 *
 * 账本从**页面 DOM** 读，不在测试里重抄一份：重抄等于把「演示台说的」和「测试证的」拆成
 * 两本可能各改各的账，那正是这页存在的反面。
 *
 * 标了 `data-owns="fill"` 的行不只断「气泡为 0」，还要**量到钥匙正钉在这一框上**：
 * 前者是个空读数，内容脚本没挂载、总闸关着都能给出同一个 0；只有后者才把「让位」这件事
 * 证成一次真实的交接——这一框没被漏掉，是快速填充先认领了它。
 */

/** 演示台在仓库里的位置（Pages 从仓库根发布，fixtures 走 `docs/` 层） */
const DEMO_PAGE = path.join(REPO_ROOT, 'docs', 'fixtures', 'identity-hint-demo.html');

/**
 * 页面里一行受检字段。三本账各有归属，别混：
 * - `data-expect`：分类器结论（jsdom 那本账吃它）；
 * - `data-owns="fill"`：分类器给了角色，但页面侧由让位规则交给快速填充那把钥匙；
 * - `data-nohint="readonly"`：分类器给了角色，但页面侧「只读控件不提示」那道门把它挡下。
 *   后两类在真机这一侧都期望零枚气泡，区别只在要不要额外量到钥匙。
 */
type LedgerRow = { id: string; expect: string; owns: string; nohint: string; type: string | null };

/** 就绪门用的那一框：区块 A 的「真实姓名」，词典与结构都最干净，出不了提示就是链路没通 */
const GATE_FIELD_ID = 'a-name';

/** 检测落定门用的那一框：区块 ⑤ 登录区的用户名框，它拿到钥匙即证明用户名 + 口令对已进字段集 */
const LOGIN_ANCHOR_ID = 'e-user';

/**
 * 把一次钥匙读数写成一句能定性的话
 *
 * 「这一框上没有钥匙」和「钥匙的量具算不出盒」是两回事：前者是账本判据，后者是量具状态。
 * 2026-10-17 实测过后者冒充前者——只读代理框上残留的上一框 class 让 pierce 视图报
 * "Could not compute box model"，协议错误一路冒出来，把本该一次报全的 miss 清单整个盖掉。
 */
function describeKey(read: KeyRead): string {
  if (read.anchored) return '在这框上（归快速填充）';
  if (read.rect) return '在别的框上';
  return read.visible ? 'class 说可见但盒模型算不出（量具读数，别当账本）' : '没有（藏着）';
}

test('演示台逐行对账：真浏览器里点到每一框，提示与页面上的账本一致', async ({ extContext }) => {
  const html = fs.readFileSync(DEMO_PAGE, 'utf-8');
  const { page, cdp } = await openFormPage(extContext, html, '/identity-hint-demo');

  const rows = (
    (await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-expect]')].map(el => ({
        id: el.id,
        expect: el.dataset.expect ?? '',
        owns: el.dataset.owns ?? '',
        nohint: el.dataset.nohint ?? '',
        type: el.getAttribute('type'),
      })),
    )) as LedgerRow[]
  ).filter(row => {
    // 缺 id 的行根本扫不到，必须当场判红——静默跳过等于把账本上的一行悄悄划掉
    if (!row.id) throw new Error(`演示台有一行 \`data-expect="${row.expect}"\` 没有 id，逐行扫描够不到它`);
    // `type=hidden` 不可聚焦 ⇒ 永远不会有 `focusin`，这一行的判定已由 jsdom 那份账本覆盖
    return row.type !== 'hidden';
  });

  // 账本自身也要有牙：整页属性被误删时 rows 会空，空数组的循环是恒绿的
  expect(rows.length, '演示台的受检字段行数掉了（页面被改写后请同步这条用例的读法）').toBeGreaterThanOrEqual(50);
  expect(rows.filter(r => r.expect !== '-').length).toBeGreaterThanOrEqual(30);
  expect(rows.filter(r => r.expect === '-' || r.owns === 'fill').length).toBeGreaterThanOrEqual(15);
  /** 计数是给 `data-nohint` 本身兜底的：属性被整段删掉时上面那条「本该沉默」的判据会静默失效 */
  expect(
    rows.filter(r => r.nohint !== '').length,
    '⑮ 区只读控件那几行的账本没了（`data-nohint`）',
  ).toBeGreaterThanOrEqual(4);

  // 就绪门：内容脚本按 `document_idle` 注入，晚到就没人接住第一次 `focusin`。
  // 没有这一道门，后面每一行的「没出提示」都分不清是没挂载还是判定挡掉了。
  await focusUntilHint(cdp, page, GATE_FIELD_ID);
  expect(liteExactMatch('cs.identity.role.name', (await focusAndReadState(page, cdp, GATE_FIELD_ID)).role)).toBe(true);

  // 检测落定门：让位判据吃的是字段检测产物，而首次判定会被 `LoginFormAnalyzer` 缓存到 WeakMap，
  // 所以在扫描开始前必须把检测推到完成态——否则区块 A 的邮箱框会在「出提示 / 归钥匙」之间翻转，
  // 红的是量具的时序，不是分类器也不是让位规则。登录区那块用户名框上出现钥匙即为落定。
  await focusUntilKey(page, cdp, LOGIN_ANCHOR_ID);

  const misses: string[] = [];
  for (const row of rows) {
    // 单读一次就够：判定与建泡都发生在 `focusin` 的同步路径上，`refocus` 之后状态已落定
    const state = await focusAndReadState(page, cdp, row.id);
    const shouldStaySilent = row.expect === '-' || row.owns === 'fill' || row.nohint !== '';
    if (shouldStaySilent) {
      if (state.count !== 0) {
        misses.push(
          `#${row.id} 本该沉默（expect=${row.expect}${row.owns ? ', owns=fill' : ''}${
            row.nohint ? `, nohint=${row.nohint}` : ''
          }），却出了「${state.role}」`,
        );
      }
      // 「让位给钥匙」只有量到钥匙才成立：单看气泡数为 0，分不清是钥匙认领了这框，
      // 还是判定链压根没跑（内容脚本晚到、总闸关着都会给出同一个 0）。
      // 读数必须在焦点还停在这一框时取——钥匙是单例，失焦后它归给下一个字段。
      if (row.owns === 'fill') {
        const key = await keyReadout(page, cdp, row.id);
        if (!key.anchored) {
          misses.push(`#${row.id} 标了 owns=fill，但这一框上没有快速填充钥匙（读数：${describeKey(key)}）`);
        }
      }
      continue;
    }
    if (state.count !== 1) {
      // 带上钥匙读数：0 枚提示有两种成因，「这框归了快速填充」和「判定链压根没跑」在气泡侧
      // 长得一模一样，而只有前者是可以接受的。把读数写进消息，一次运行就分得清该补账本还是该报缺陷。
      const key = await keyReadout(page, cdp, row.id);
      misses.push(
        `#${row.id} 出了 ${state.count} 枚提示（期望恰好 1 枚，角色=${row.expect}），钥匙${describeKey(key)}`,
      );
    } else if (!liteExactMatch(`cs.identity.role.${row.expect}`, state.role)) {
      misses.push(`#${row.id} 报成「${state.role}」，期望角色=${row.expect}`);
    }
  }

  // 一次报全而不是首条即停：这批行同属一张形状表，红了要看的是「掉的是哪几类」
  expect(misses, `演示台有 ${misses.length} 行对不上：\n${misses.join('\n')}`).toEqual([]);

  await page.close();
});
