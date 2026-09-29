import type { Page } from '@playwright/test';
import { createEntry, expect, parkPointer, rowOf, test, visibleTooltipTexts } from './harness';
import { textOf } from './i18n';

/**
 * 管理页表格「截断浮层」的指针命中测试（真机）
 *
 * `show-overflow-tooltip` 的浮层不是页面里写的 `el-tooltip`，而是 Element Plus 在
 * `handleCellMouseEnter` 里用 `createTablePopper()` 现建的一个内部 `ElTooltip`，属性由
 * `util.js` 写死：`virtualTriggering` + `appendTo: tableWrapper` + `placement: 'top'` +
 * `strategy: 'fixed'` + `hideAfter: 0`。默认的 `enterable` 让它参与命中测试，于是这条浮层
 * 会压住**上一行**的可点控件并把指针事件接走——真机表现为「指针停在按钮上，点了没反应」，
 * CI 侧则是 Playwright 判 `subtree intercepts pointer events` 后在同一点重试到超时。
 *
 * 可达性是真机量出来的，不是推的（Chrome for Testing，1280×720 视口，两条条目）：行高 63～64 像素、
 * 备注浮层 1280×52 时，上一行有 8 处可点控件（勾选框、显示密码、站点链接、查看详情、创建副本、
 * 编辑、收藏、删除）的中心落在浮层内，且在**未修复**的构建上 `elementFromPoint(中心)` 逐条返回
 * 浮层节点。同一构建下 URL 浮层只有 520×32、比控件中心低 1 像素，一处没压住；用户名列没截断。
 * 所以本守卫以备注列为准，其余列只由源码级守卫覆盖到「绑定存在」这一层。
 *
 * 修复是每表一行 `:tooltip-options="TABLE_OVERFLOW_TOOLTIP_OPTIONS"`（见
 * `utils/tableOverflowTooltip.ts`），代价是浮层文字不再可选中——取舍写在该常量的 JSDoc 里。
 * 本文件只钉「点击不被吞」这条用户可感知的性质；源码级恒等式（五张表都绑了、常量本体没被改）
 * 由 `tests/architecture/tableOverflowTooltipPointerTransparent.test.ts` 负责。
 */

/** 触发截断的条目：备注长到出省略号、且浮层必须高到压得住上一行（实测 6 段=52 像素高，3 段只有 32 像素） */
const TRIGGER = {
  username: 'e2e-overflow-trigger',
  password: 'Synthetic!Overflow1',
  url: 'https://overflow-trigger.e2e.test/',
  remark: 'e2e-overflow-remark-长备注用于触发省略号截断。'.repeat(6),
};

/** 被压住的条目：它的整行都在触发行上方，正是浮层的覆盖对象 */
const VICTIM = {
  username: 'e2e-overflow-victim',
  password: 'Synthetic!Overflow2',
  url: 'https://overflow-victim.e2e.test/',
  remark: '受害行备注',
};

/** 备注列在 `PasswordTable` 里的下标（0 多选框 / 1 用户名 / 2 密码 / 3 分类 / 4 URL / 5 标签 / 6 备注） */
const REMARK_CELL_INDEX = 6;

/** 操作列按钮顺序中与 `operation-tooltip.spec.ts` 同源的下标：0 详情 / 1 复制 / 2 编辑 / 3 收藏 / 4 删除 */
const FAVORITE_BUTTON_INDEX = 3;

/** 一行内可点控件的取样范围；零尺寸的原生 input（如多选框的 hidden checkbox）由下面的判据剔除 */
const INTERACTIVE_SELECTOR = 'button, a[href], input:not([type="hidden"]), .el-checkbox__inner, .el-tag, .el-select';

/** 悬浮到触发行备注单元格并等截断浮层成为唯一可见 tooltip */
async function hoverTruncatedCell(page: Page): Promise<void> {
  const cell = rowOf(page, TRIGGER.username).locator('td').nth(REMARK_CELL_INDEX).locator('.cell').first();

  // 下标写死后必须自证量的是备注列：哪天列序变动，这里红，而不是让整份守卫静默空跑
  await expect(cell).toContainText(TRIGGER.remark.slice(0, 12));
  await cell.hover({ force: true });

  await expect
    .poll(() => visibleTooltipTexts(page), { timeout: 5_000, message: '截断浮层没有出现' })
    .toEqual([TRIGGER.remark]);
}

interface TipScan {
  pointerEvents: string;
  centerHitsSelf: boolean;
  covered: string[];
  stolen: string[];
}

/**
 * 在页面内一次性量完「浮层压住了上一行哪些控件、这些控件的命中测试归谁」
 *
 * 必须单次 `evaluate` 测完：浮层显隐由真实鼠标位置决定，逐次跨进程采样会把指针离开单元格
 * 的窗口算进来（`hideAfter: 0` 让它一出单元格就收）。选择器与 `visibleTooltipTexts` 同源——
 * 这条浮层是 `strategy: 'fixed'`，用 `offsetParent` 判可见会把它整个读成「不可见」。
 */
function scanTip(page: Page): Promise<TipScan> {
  return page.evaluate(
    ({ victim, interactive }) => {
      const visible = (el: HTMLElement) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const tip = [...document.querySelectorAll<HTMLElement>('.el-popper[role="tooltip"]')].find(visible);
      if (!tip) throw new Error('poll 之后浮层消失了');

      const victimRow = [...document.querySelectorAll<Element>('tr.el-table__row')].find(node =>
        (node.textContent ?? '').includes(victim),
      );
      if (!victimRow) throw new Error('受害行不在 DOM 里');

      const rect = tip.getBoundingClientRect();
      const label = (el: Element) =>
        `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}`;
      const covered: string[] = [];
      const stolen: string[] = [];

      for (const el of victimRow.querySelectorAll(interactive)) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
        covered.push(label(el));
        const hit = document.elementFromPoint(cx, cy);
        if (hit && tip.contains(hit)) stolen.push(label(el));
      }

      const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        pointerEvents: getComputedStyle(tip).pointerEvents,
        centerHitsSelf: Boolean(center) && (center === tip || tip.contains(center)),
        covered,
        stolen,
      };
    },
    { victim: VICTIM.username, interactive: INTERACTIVE_SELECTOR },
  );
}

test.describe('表格截断浮层的指针命中', () => {
  test.beforeEach(async ({ optionsPage }) => {
    // 行序为新者优先：先建触发行、再建受害行，受害行才落在上方、被 `placement="top"` 的浮层压住
    await createEntry(optionsPage, TRIGGER);
    await createEntry(optionsPage, VICTIM);
  });

  test('浮层对指针透明：被压住的上一行控件无一被吞掉命中测试', async ({ optionsPage }) => {
    await hoverTruncatedCell(optionsPage);
    const scan = await scanTip(optionsPage);

    // ① 恒成立的牙（已用变异法验过）：与行距、与 `hideAfter` 和淡出时序都无关。摘掉
    //    `PasswordTable` 上那行绑定、退回可命中的 `enterable` 浮层，本地与 runner 都在这一条红。
    expect(scan.pointerEvents, '截断浮层仍在参与指针命中测试').toBe('none');
    expect(scan.centerHitsSelf, '浮层自己仍是命中测试的落点').toBe(false);

    // ② 用户视角的落点：上一行每一颗被压住的控件，中心命中测试仍归它自己。
    expect(scan.stolen, `以下控件被浮层接走了点击：${scan.stolen.join(' | ')}`).toEqual([]);

    await parkPointer(optionsPage);
  });

  test('量到的确实是压在上方的截断浮层（防止本守卫因布局变化空跑）', async ({ optionsPage }) => {
    await hoverTruncatedCell(optionsPage);
    const scan = await scanTip(optionsPage);

    // 上面那条 `stolen` 只有在「确有控件落在浮层范围内」时才有意义：今天 1280×720、行高 63～64
    // 像素时上一行有 8 处被压住；哪天行距改大到 104 像素以上、浮层不再压住任何控件中心，②就变成恒真。
    // 那属于测量口径失效，必须红出来要求人工重新确认，而不是让守卫悄悄空跑。
    expect(
      scan.covered.length,
      '浮层没压住上一行任何可点控件：②的空断言已失去意义，需重新确认测量口径',
    ).toBeGreaterThan(0);

    await parkPointer(optionsPage);
  });

  test('指针走到被压住的那颗按钮上时气泡让位，收藏真的被点到', async ({ optionsPage }) => {
    await hoverTruncatedCell(optionsPage);

    const favorite = rowOf(optionsPage, VICTIM.username).locator('button[data-tip]').nth(FAVORITE_BUTTON_INDEX);
    await expect(favorite).toHaveAttribute('data-tip', textOf('common.favorite'));
    const box = (await favorite.boundingBox())!;

    // 这一条是「点击真的落到了那颗按钮上」的端到端形态，牙在时序而不是在 Playwright 的
    // 拦截检测上：`mouse.move` 是一次跳变，未修复版那条 `enterable` 浮层会在指针进入它时
    // 取消隐藏，气泡就赖在按钮上不走；改成对指针透明后指针归按钮，`hideAfter: 0` 让它当帧收掉。
    // 200 毫秒刻意短于操作列提示的 400 毫秒显示延迟——再晚就会撞上另一条气泡，断言变成看运气。
    await optionsPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await optionsPage.waitForTimeout(200);
    expect(await visibleTooltipTexts(optionsPage), '指针已离开单元格，截断浮层还占着按钮').toEqual([]);

    await favorite.click();
    await expect(favorite).toHaveAttribute('data-tip', textOf('common.unfavorite'));

    await parkPointer(optionsPage);
  });
});
