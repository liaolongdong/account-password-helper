import { computed, reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import { buildTagPresentationRecords, getTagFullStyle, normalizeTagInput, parseTags } from '@/utils/tagUtils';

describe('buildTagPresentationRecords', () => {
  it('保持既有标签解析顺序、去重规则与样式结果', () => {
    const raw = ' 工作，个人,工作, 重要 ';

    expect(buildTagPresentationRecords(raw)).toEqual(
      parseTags(raw).map(name => ({ name, style: getTagFullStyle(name) })),
    );
  });

  it('在列表行 computed 中仅随 tag 字符串变化重建记录', () => {
    const password = reactive({ tag: '工作,个人', active: false });
    let buildCount = 0;
    const records = computed(() => {
      buildCount += 1;
      return buildTagPresentationRecords(password.tag);
    });

    const first = records.value;
    expect(records.value).toBe(first);
    expect(buildCount).toBe(1);

    password.active = true;
    expect(records.value).toBe(first);
    expect(buildCount).toBe(1);

    password.tag = '工作,重要';
    expect(records.value).not.toBe(first);
    expect(buildCount).toBe(2);
  });

  it('同一 tag 字符串跨调用复用同一冻结记录，避免每行每次渲染新建样式对象', () => {
    const a = buildTagPresentationRecords('工作,个人');
    const b = buildTagPresentationRecords('工作,个人');

    expect(b).toBe(a);
    expect(b[0].style).toBe(a[0].style);
    // 共享对象必须只读，否则一行改样式会串到其他行
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a[0])).toBe(true);
    expect(Object.isFrozen(a[0].style)).toBe(true);
  });

  it('缓存按插入顺序淘汰有界条目，长会话下不无上限增长', () => {
    const oldest = buildTagPresentationRecords('最早-工作');
    // 上限 500：塞入足够多的新组合把最早那条挤出后，最早那条应被重建（引用不再相同）
    for (let i = 0; i < 502; i += 1) {
      buildTagPresentationRecords(`填充-${i}`);
    }
    expect(buildTagPresentationRecords('最早-工作')).not.toBe(oldest);
    // 内容仍等价，淘汰不影响渲染结果
    expect(buildTagPresentationRecords('最早-工作')).toEqual(oldest);

    const recent = buildTagPresentationRecords('填充-501');
    expect(buildTagPresentationRecords('填充-501')).toBe(recent);
  });
});

/**
 * normalizeTagInput：新增表单与批量编辑弹窗共用的标签输入规整口径
 *
 * 回归背景：批量编辑弹窗此前把超长标签静默丢弃，用户既看不到提示、也看不到写入结果；
 * 新增表单则按 `form.tagLengthLimit` 明示。两处口径统一到此函数后，「丢弃了什么」必须
 * 作为可观察返回值暴露给调用方，而不是在函数内部消化掉。
 */
describe('normalizeTagInput', () => {
  it('去空白、过滤空项并去重，顺序与用户选择一致', () => {
    expect(normalizeTagInput([' 工作 ', '', '  ', '生活', '工作'], 30)).toEqual({
      accepted: ['工作', '生活'],
      rejectedTooLong: [],
    });
  });

  it('超长项只进 rejectedTooLong，等长边界放行', () => {
    const atLimit = 'a'.repeat(30);
    const overLimit = 'b'.repeat(31);

    expect(normalizeTagInput([atLimit, overLimit], 30)).toEqual({
      accepted: [atLimit],
      rejectedTooLong: [overLimit],
    });
  });

  it('同一条超长标签重复选择只报一次，避免提示噪声放大', () => {
    expect(normalizeTagInput(['x'.repeat(40), 'x'.repeat(40)], 30).rejectedTooLong).toEqual(['x'.repeat(40)]);
  });

  it('全为空白或空数组时两组皆空，调用方据此阻断提交', () => {
    expect(normalizeTagInput(['   ', '  \t '], 30)).toEqual({ accepted: [], rejectedTooLong: [] });
    expect(normalizeTagInput([], 30)).toEqual({ accepted: [], rejectedTooLong: [] });
    expect(normalizeTagInput(undefined, 30)).toEqual({ accepted: [], rejectedTooLong: [] });
  });
});
