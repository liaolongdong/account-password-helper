/** @vitest-environment jsdom */

/**
 * 身份库检索首屏定位的落点判据
 *
 * 钉的是「滚过去的是哪一节」这一件事，时序与作废由组件侧的接线守卫负责。
 * 夹具按真实模板的形状建树：标题区（`SearchHighlight` 命中时产出 `.search-hit`）、
 * 字段区（严格态命中的值/字段名同样是 `.search-hit`，放宽态的整串字段名是
 * `.identity-field__name-hit`）、折叠卡与掩码态机密卡则**没有**任何命中节点。
 *
 * 之所以不直接挂载 SFC：本仓 Vitest 管线没有 `@vitejs/plugin-vue`（`WxtVitest()` 不注册
 * 编译器），`import '*.vue'` 会直接报「Install @vitejs/plugin-vue」。这里测的是被组件
 * 调用的那个纯函数，模板侧接线由 `tests/architecture/identitySearchRevealWiring.test.ts` 钉。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { findSearchRevealTarget } from '@/utils/identity/searchReveal';

/** 标题/字段值上的严格命中分段 */
const HIT = (text: string): string => `<span class="search-hit">${text}</span>`;
/** 放宽态「这句话认成某一格」的字段名命中 */
const NAME_HIT = (text: string): string => `<span class="identity-field__name-hit">${text}</span>`;

/**
 * 建一个与真实滚动容器同形的 `.identity-list`
 *
 * @param cards 卡片内部结构（标题 + 可选字段区）的原文片段
 */
function mountList(cards: string): HTMLElement {
  document.body.innerHTML = `<div class="identity-list">${cards}</div>`;
  const container = document.querySelector<HTMLElement>('.identity-list');
  if (!container) {
    throw new Error('夹具没建出滚动容器');
  }
  return container;
}

/** 展开态结果卡：标题 + 逐行字段（字段行里才有用户要看的那一格） */
const openCard = (title: string, fields: string): string =>
  `<div class="identity-card" data-card="${title}"><div class="identity-card__title">${title}</div>` +
  `<div class="identity-card__fields">${fields}</div></div>`;

/** 折叠态结果卡：字段区是 `v-if`，DOM 里只剩标题 */
const collapsedCard = (title: string): string =>
  `<div class="identity-card is-collapsed" data-card="${title}"><div class="identity-card__title">${title}</div></div>`;

const fieldRow = (label: string, value: string): string =>
  `<div class="identity-field"><span class="identity-field__label">${label}</span><span>${value}</span></div>`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('落点取第一张结果卡内的命中节点', () => {
  it('命中落在卡片下部的字段行时，定位到那一格而不是卡片顶部', () => {
    const container = mountList(
      openCard('张三', fieldRow('手机号', '13800000000') + fieldRow(NAME_HIT('证件号码'), '3301**********')) +
        openCard(HIT('张三'), fieldRow('地址', '某地')),
    );

    const target = findSearchRevealTarget(container);

    expect(target?.textContent).toBe('证件号码');
    // 第二张卡标题里的命中不能被选中：那是「另一条结果」的位置，用户要看的是第一条里的那一格
    const secondCard = container.querySelectorAll<HTMLElement>('.identity-card')[1];
    expect(secondCard?.contains(target ?? null)).toBe(false);
  });

  it('同一张卡内多处命中时取文档序最前的一处', () => {
    const container = mountList(openCard(HIT('李四'), fieldRow('姓名', HIT('李四')) + fieldRow('备注', '常用')));

    const target = findSearchRevealTarget(container);

    expect(target?.textContent).toBe('李四');
    expect(target?.parentElement?.className).toBe('identity-card__title');
  });

  it('严格态的值命中同样是落点（深链带本人姓名命中标题之外的字段）', () => {
    const container = mountList(openCard('王五', fieldRow('邮箱', HIT('wang五') + '@mail.com')));

    expect(findSearchRevealTarget(container)?.textContent).toBe('wang五');
  });
});

describe('卡内取不到命中节点时退回卡片头部，不跳去后面的卡', () => {
  it('首卡是折叠卡：滚到它自己，字段区没有节点也不展开', () => {
    const container = mountList(collapsedCard('赵六') + openCard(HIT('赵六'), fieldRow('地址', '某地')));

    const target = findSearchRevealTarget(container);
    const firstCard = container.querySelector<HTMLElement>('.identity-card');

    expect(target).toBe(firstCard);
    expect(target?.classList.contains('is-collapsed')).toBe(true);
  });

  it('首卡机密字段掩码态无高亮节点：落点退回卡片头部', () => {
    const container = mountList(openCard('孙七', fieldRow('身份证号', '********')));

    expect(findSearchRevealTarget(container)).toBe(container.querySelector<HTMLElement>('.identity-card'));
  });
});

describe('没有结果卡就不定位（交给逐帧重试）', () => {
  it('容器存在但列表还没铺出卡片', () => {
    expect(findSearchRevealTarget(mountList('<div class="identity-empty">无</div>'))).toBeNull();
  });

  it('滚动容器尚未挂载（空态 / 无匹配分支下 `.identity-list` 不在 DOM 里）', () => {
    expect(findSearchRevealTarget(null)).toBeNull();
  });
});
