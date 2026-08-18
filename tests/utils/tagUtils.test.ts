import { computed, reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import { buildTagPresentationRecords, getTagFullStyle, parseTags } from '@/utils/tagUtils';

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
});
