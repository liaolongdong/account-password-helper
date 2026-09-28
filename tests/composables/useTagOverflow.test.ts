/** @vitest-environment jsdom */

/**
 * 标签溢出判定回归测试（composables/useTagOverflow.ts）
 *
 * 口径变更点：标签文本改由触发元素自身的 `data-tag` 提供，模板因此可以直接绑
 * `@mouseenter="checkTagOverflow"`，不再为每个标签在每次渲染时新建箭头函数
 * （大列表下每帧上千个闭包）。断言锁定「判定结果只与该标签自身有关」这一等价前提。
 */
import { describe, expect, it } from 'vitest';
import { useTagOverflow } from '@/composables/useTagOverflow';

/**
 * 构造一个带 .el-tag__content 内层的标签根节点
 * @param tag 写入 data-tag 的标签文本；传 undefined 模拟缺失 data-tag
 * @param overflowed 内层是否处于文本截断状态
 */
const buildTagEl = (tag: string | undefined, overflowed: boolean) => {
  const el = document.createElement('span');
  if (tag !== undefined) el.dataset.tag = tag;
  const content = document.createElement('span');
  content.className = 'el-tag__content';
  Object.defineProperty(content, 'scrollWidth', { value: overflowed ? 120 : 60 });
  Object.defineProperty(content, 'clientWidth', { value: 60 });
  el.appendChild(content);
  return { el, content };
};

/** 用真实节点作为 currentTarget 伪造鼠标事件 */
const mouseEnter = (el: HTMLElement) => ({ currentTarget: el }) as unknown as MouseEvent;

describe('useTagOverflow', () => {
  it('内层截断时以 data-tag 作为溢出标签，判定为溢出', () => {
    const { overflowedTag, checkTagOverflow, isTagOverflowed } = useTagOverflow();
    const { el } = buildTagEl('工作-很长很长很长的标签', true);

    checkTagOverflow(mouseEnter(el));

    expect(overflowedTag.value).toBe('工作-很长很长很长的标签');
    expect(isTagOverflowed('工作-很长很长很长的标签')).toBe(true);
    expect(isTagOverflowed('其他标签')).toBe(false);
  });

  it('未截断时清空溢出状态，tooltip 保持禁用', () => {
    const { overflowedTag, checkTagOverflow, isTagOverflowed } = useTagOverflow();
    const { el } = buildTagEl('工作', false);

    checkTagOverflow(mouseEnter(el));

    expect(overflowedTag.value).toBeNull();
    expect(isTagOverflowed('工作')).toBe(false);
  });

  it('从溢出标签切到未溢出标签时状态随之回落（hover 语义不变）', () => {
    const { checkTagOverflow, isTagOverflowed } = useTagOverflow();
    checkTagOverflow(mouseEnter(buildTagEl('工作', true).el));
    expect(isTagOverflowed('工作')).toBe(true);

    checkTagOverflow(mouseEnter(buildTagEl('个人', false).el));

    expect(isTagOverflowed('工作')).toBe(false);
  });

  it('缺失 data-tag 时安全降级为不提示，不抛错', () => {
    const { overflowedTag, checkTagOverflow } = useTagOverflow();

    expect(() => checkTagOverflow(mouseEnter(buildTagEl(undefined, true).el))).not.toThrow();
    expect(overflowedTag.value).toBeNull();
  });

  it('无内层 .el-tag__content 时按根节点自身度量', () => {
    const { checkTagOverflow, isTagOverflowed } = useTagOverflow();
    const el = document.createElement('span');
    el.dataset.tag = '备注';
    Object.defineProperty(el, 'scrollWidth', { value: 100 });
    Object.defineProperty(el, 'clientWidth', { value: 40 });

    checkTagOverflow(mouseEnter(el));

    expect(isTagOverflowed('备注')).toBe(true);
  });

  it('currentTarget 为空时不改动既有状态', () => {
    const { overflowedTag, checkTagOverflow } = useTagOverflow();
    checkTagOverflow(mouseEnter(buildTagEl('工作', true).el));
    expect(overflowedTag.value).toBe('工作');

    checkTagOverflow({ currentTarget: null } as unknown as MouseEvent);

    expect(overflowedTag.value).toBe('工作');
  });
});
