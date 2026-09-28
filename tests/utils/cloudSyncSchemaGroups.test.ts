import { describe, expect, it } from 'vitest';
import {
  ENCRYPTED_TABLE_SPEC,
  PLAINTEXT_FIELDS,
  PLAINTEXT_TABLE_SPEC,
  SYNCED_TEXT_FIELDS,
  entryToFields,
  fieldsToEntry,
  getRequiredFieldNames,
} from '@/utils/cloudSync/schema';
import { computeEntryHash } from '@/utils/cloudSync/hash';

describe('云同步明文表分组列', () => {
  it('字段名常量含分组', () => {
    expect(PLAINTEXT_FIELDS.group).toBe('分组');
  });

  it('表结构为 9 字段，分组列位于 TOTP 之后、本地更新时间之前', () => {
    const names = PLAINTEXT_TABLE_SPEC.map(field => field.name);
    expect(names).toHaveLength(9);
    expect(names.indexOf(PLAINTEXT_FIELDS.group)).toBe(names.indexOf(PLAINTEXT_FIELDS.totp) + 1);
    expect(names.indexOf(PLAINTEXT_FIELDS.group)).toBe(names.indexOf(PLAINTEXT_FIELDS.localUpdateTime) - 1);
  });

  it('分组列为文本类型且非索引列', () => {
    const groupField = PLAINTEXT_TABLE_SPEC.find(field => field.name === PLAINTEXT_FIELDS.group)!;
    expect(groupField.type).toBe('text');
    expect(groupField.primary).toBeFalsy();
  });

  it('结构校验必需字段含分组', () => {
    expect(getRequiredFieldNames('plaintext')).toContain(PLAINTEXT_FIELDS.group);
  });

  it('哈希口径含分组（分组变更参与 LWW diff）', async () => {
    expect(SYNCED_TEXT_FIELDS).toContain('groupPath');
    const base = {
      username: 'u',
      password: 'p',
      url: '',
      tag: '',
      remark: '',
      totp: '',
      groupPath: '',
    };
    expect(await computeEntryHash({ ...base, groupPath: '工作/项目A' })).not.toBe(await computeEntryHash(base));
  });

  it('entryToFields 输出分组全路径', () => {
    const fields = entryToFields({
      id: '1',
      username: 'u',
      password: 'p',
      url: '',
      tag: '',
      remark: '',
      totp: '',
      groupPath: '工作/项目A',
      updateTime: 0,
    });
    expect(fields[PLAINTEXT_FIELDS.group]).toBe('工作/项目A');
  });

  it('fieldsToEntry 还原 groupPath，缺失时为空串', () => {
    const withGroup = fieldsToEntry({
      [PLAINTEXT_FIELDS.id]: '1',
      [PLAINTEXT_FIELDS.username]: 'u',
      [PLAINTEXT_FIELDS.password]: 'p',
      [PLAINTEXT_FIELDS.url]: '',
      [PLAINTEXT_FIELDS.tag]: '',
      [PLAINTEXT_FIELDS.remark]: '',
      [PLAINTEXT_FIELDS.totp]: '',
      [PLAINTEXT_FIELDS.group]: '工作/项目A',
      [PLAINTEXT_FIELDS.localUpdateTime]: 123,
    });
    expect(withGroup.entry.groupPath).toBe('工作/项目A');

    const withoutGroup = fieldsToEntry({ [PLAINTEXT_FIELDS.id]: '1' });
    expect(withoutGroup.entry.groupPath).toBe('');
  });

  it('密文表结构不受影响（无分组列）', () => {
    expect(ENCRYPTED_TABLE_SPEC.some(field => field.name === '分组')).toBe(false);
  });
});
