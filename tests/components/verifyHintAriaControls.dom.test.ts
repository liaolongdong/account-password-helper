/**
 * 解锁页提示语的 `aria-controls` 不得悬空（评审 2026-11-02 Minor 9）
 *
 * 折叠按钮写了 `aria-controls="verify-hint-text"`，而被指向的那段文本挂在 `v-if="!hintCollapsed"` 上：
 * 用户一收起提示语，节点就不存在了，`aria-controls` 指向一个查无此人的 id——axe 按
 * `aria-valid-attr-value` 判违规，屏幕阅读器也失去「这个按钮控制哪块内容」的关联。
 *
 * 取真实 SFC 模板片段来判（与 `identityEmptyState.dom.test.ts` 同一套方式），不重写组件逻辑；
 * 断言落在「静态 aria-controls 指向的 id 必须无条件存在」这条通用规则上，而不是只钉当前这一处。
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

/** 模板里出现过的全部 id 值 */
function templateIds(): Set<string> {
  return new Set([...TEMPLATE.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
}

/**
 * 挂在 `v-if` / `v-else-if` 上的元素 id
 *
 * 判定方式：从该元素开标签的起点向前回溯到上一个 `>`，如果中间夹着 `v-if`/`v-else-if` 属性，
 * 就认为这个节点是条件渲染的。够用且不需要引完整模板解析器。
 */
function conditionalIds(): Set<string> {
  const result = new Set<string>();
  for (const match of TEMPLATE.matchAll(/<(\w+)([^>]*?)\sid="([^"]+)"/g)) {
    const attrs = match[2];
    if (/\sv-if(?:=|\.else)/.test(attrs) || /v-else-if/.test(attrs)) result.add(match[3]);
  }
  return result;
}

describe('提示语折叠按钮的无障碍关联', () => {
  it('扫描到 aria-controls 与目标 id（判据不是空跑）', () => {
    expect([...TEMPLATE.matchAll(/aria-controls="([^"]+)"/g)].length).toBeGreaterThan(0);
    expect(templateIds().has('verify-hint-text')).toBe(true);
  });

  it('每个静态 aria-controls 指向的 id 都必须存在，且不在条件渲染分支里', () => {
    const existing = templateIds();
    const conditional = conditionalIds();
    const dangling = [...TEMPLATE.matchAll(/aria-controls="([^"]+)"/g)]
      .map(match => match[1])
      .filter(id => !existing.has(id) || conditional.has(id));

    expect(
      dangling,
      '指向 v-if 节点的 aria-controls 在收起态就是悬空引用，axe 按 aria-valid-attr-value 判违规；' +
        '要隐藏文本请改用 v-show（节点留在 DOM 里，屏幕阅读器也不会念出隐藏内容）',
    ).toEqual([]);
  });

  it('展开态标记 aria-expanded，折叠按钮本身仍可聚焦', () => {
    expect(TEMPLATE).toMatch(/:aria-expanded="!hintCollapsed"/);
  });
});
