/** @vitest-environment jsdom */
/**
 * 解锁页提示语的 `aria-controls` 不得悬空（评审 2026-11-02 Minor 9）
 *
 * 折叠按钮原先写死 `aria-controls="verify-hint-text"`，而被指向的那段文本挂在
 * `v-if="!hintCollapsed"` 上：用户一收起提示语，节点就不存在，这个关联指向查无此人的 id
 * （axe 按 `aria-valid-attr-value` 判违规），屏幕阅读器也失去「这按钮控制哪块内容」的线索。
 *
 * 修法有两个方向，只能选后者：
 * - 把 `v-if` 换成 `v-show` —— **不行**。`e2e/auth-screen-layout.spec.ts` 断的是
 *   `toHaveCount(0)`：提示语是躺在本机的明文，「收起」是它的窥屏隐私出口，契约是节点真的从文档里
 *   消失，而不是只是看不见。（实测踩过：换成 v-show 后那条用例红在 Expected 0 / Received 1。）
 * - 保留 `v-if`，把 `aria-controls` 改成同条件下的动态绑定，折叠时把属性整个摘掉。
 *
 * 所以这里的不变量是「**静态** aria-controls 不许指向条件渲染的 id」，并要求动态绑定在没有目标时
 * 交出 `undefined`（Vue 对 `undefined`/`null` 的绑定会移除属性）。取真实 SFC 模板判，不重写组件逻辑。
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';
import { readSource } from '@/tests/helpers/architectureScan';

const TEMPLATE = (() => {
  const { descriptor, errors } = parse(readSource('components/options/PasswordVerifyView.vue'), {
    filename: 'PasswordVerifyView.vue',
  });
  expect(errors).toEqual([]);
  return descriptor.template?.content ?? '';
})();

/** 无论折叠与否都一定在场的 id：被 v-if / v-else-if 罩着的那些要剔掉 */
function alwaysPresentIds(): Set<string> {
  const all = new Set([...TEMPLATE.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const m of TEMPLATE.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"/g)) {
    if (/\sv-if[=.]/.test(m[2]) || /v-else-if/.test(m[2])) all.delete(m[3]);
  }
  return all;
}

/** 分开取静态与动态两类 aria-controls 绑定（`(?<![:\w-])` 把 `:aria-controls` 让给动态那一类） */
function ariaControlsBindings(): { statics: string[]; dynamics: string[] } {
  return {
    statics: [...TEMPLATE.matchAll(/(?<![:\w-])aria-controls="([^"]+)"/g)].map(m => m[1]),
    dynamics: [...TEMPLATE.matchAll(/:aria-controls="([^"]+)"/g)].map(m => m[1]),
  };
}

describe('提示语折叠按钮的无障碍关联', () => {
  it('扫描到 aria-controls 绑定与那个 id（判据不是空跑）', () => {
    const { statics, dynamics } = ariaControlsBindings();
    expect(statics.length + dynamics.length, '模板里一个 aria-controls 都没有，下面的断言就是空跑').toBeGreaterThan(0);
    expect(TEMPLATE).toMatch(/\sid="verify-hint-text"/);
  });

  it('静态 aria-controls 不得指向条件渲染的 id', () => {
    const present = alwaysPresentIds();
    const dangling = ariaControlsBindings().statics.filter(id => !present.has(id));
    expect(
      dangling,
      `这些静态 aria-controls 指向的节点会被 v-if 摘走，收起态即悬空引用：${dangling.join(', ')}`,
    ).toEqual([]);
  });

  it('动态 aria-controls 在无目标时交出 undefined/null，而不是指向空 id', () => {
    const broken = ariaControlsBindings().dynamics.filter(expr => !/undefined|null/.test(expr));
    expect(
      broken,
      `动态绑定缺「目标不在场就摘属性」那一支，折叠时仍会指向空 id：${broken.join(' | ')}`,
    ).toEqual([]);
  });

  it('提示语文本仍走 v-if：收起是隐私出口，节点必须真的从文档里消失', () => {
    expect(
      TEMPLATE,
      '改成 v-show 会把明文留在 DOM 里，且 e2e 的 toHaveCount(0) 契约（窥屏时当场收掉）会红',
    ).toMatch(/v-if="!hintCollapsed"\s+id="verify-hint-text"/);
  });
});
