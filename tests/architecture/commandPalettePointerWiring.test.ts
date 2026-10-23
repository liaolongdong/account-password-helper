/**
 * 命令面板的指针接线守卫：悬停不得抢走键盘游标
 *
 * 2026-10-22 报的「上下箭头有 bug」根因是逐行 `@mouseenter` 直接改活动项，而活动项一变就
 * `scrollIntoView()`：列表一滚，另一行被搬到静止的指针底下，Chromium 重算 hover 并补发
 * `mouseenter`，游标被改回去——独立复现页实测连按 ↓ 出现 `4 → 3`、`5 → 4` 的倒退。
 * 修法是把判定收在容器的 `mousemove` 上（滚动会补发 enter/leave，但**不会**补发 mousemove）。
 *
 * 行为判据在 `e2e/command-palette.spec.ts`（要真布局、真指针）。本文件只做源码层的 tripwire，
 * 挡三种「看起来修好了」的退化：把 `@mouseenter` 加回行上、把容器 `mousemove` 摘掉、
 * 以及为了躲 bug 顺手删掉 `scrollIntoView`（那样键盘导航就滚不动长列表了，是更糟的回归）。
 *
 * 四道判据各自配一把变异：先证明改坏能被读出来，再断言当前源码是好的——否则正则错但恰好
 * 匹配、或取数为 0 的静默空跑，都会让守卫长期绿灯。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const COMPONENT = 'components/options/CommandPalette.vue';

/** 取 `.cp-item` 那一整段属性区（从 class 声明到闭合的 `>`） */
function itemTag(source: string): string {
  const start = source.indexOf('class="cp-item"');
  if (start === -1) throw new Error('找不到 class="cp-item"，组件结构变了');
  const end = source.indexOf('>', start);
  return source.slice(start, end);
}

/** 取列表容器的开标签（它承载 pointer 事件） */
function listTag(source: string): string {
  const start = source.indexOf('class="cp-list"');
  if (start === -1) throw new Error('找不到 class="cp-list"，组件结构变了');
  const end = source.indexOf('>', start);
  return source.slice(start, end);
}

const source = readSource(COMPONENT);

describe('命令面板的指针接线', () => {
  it('行上没有 mouseenter / mouseover：悬停改活动项的老路必须保持封死', () => {
    expect(itemTag(source)).not.toMatch(/@mouse(enter|over|move)/);
    expect(itemTag(source)).toContain('@click');

    // 牙齿：把 @mouseenter 加回去，必须被读出来
    const regressed = itemTag(source).replace(
      '@click',
      '@mouseenter="emit(\'update:activeIndex\', item.index)" @click',
    );
    expect(regressed, '变异没生效（行标签里找不到 @click 锚点）').not.toBe(itemTag(source));
    expect(regressed, '把 @mouseenter 加回行上，守卫却读不出来').toMatch(/@mouse(enter|over|move)/);
  });

  it('列表容器挂 @mousemove，且处理器在索引未变时不写 ref', () => {
    expect(listTag(source)).toContain('@mousemove="onPointerMove"');

    // 牙齿：摘掉绑定，判据必须立刻红
    const unbound = listTag(source).replace('@mousemove="onPointerMove"', '');
    expect(unbound, '变异没生效').not.toBe(listTag(source));
    expect(unbound, '摘掉 @mousemove 之后守卫仍然绿 —— 说明它没真的查这个绑定').not.toContain('@mousemove');

    const handler = /const onPointerMove = [\s\S]*?\n};/.exec(source);
    expect(handler, '找不到 onPointerMove 的函数体').not.toBeNull();
    expect(handler![0], '处理器没有在索引相同时提前返回，mousemove 的高频触发会白写 ref').toMatch(
      /=== props\.activeIndex\)\s*return/,
    );
  });

  it('活动项变化仍然 scrollIntoView：躲 bug 不能顺手把滚动删掉', () => {
    const watcher = /watch\(\s*\(\) => props\.activeIndex[\s\S]*?\n\);/.exec(source);
    expect(watcher, '找不到活动项的 watcher').not.toBeNull();
    expect(watcher![0], '活动项变化不再滚动进可视区：长列表里键盘导航会滚不动').toContain('scrollIntoView');
  });
});
