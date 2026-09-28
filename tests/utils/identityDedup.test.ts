import { describe, expect, it } from 'vitest';
import { findDuplicateIdentity } from '@/utils/identity/dedup';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';

/**
 * 身份信息重复检测单元测试（纯函数）
 *
 * 钉死收紧后的口径：卡号相同直接命中；证件号相同**必须**再配相同姓名或相同卡号才命中
 * （避免同一身份证号的社保卡 / 银行卡被误报）；trim + 大写归一、排除编辑自身、
 * 按数组顺序命中首个；目标字段为空不误报「空 == 空」；跨字段与重名字段不参与。
 */

function entry(id: string, payload: Partial<IdentityPayload>): IdentityEntry {
  return {
    id,
    encryptedPayload: 'x',
    createTime: 0,
    updateTime: 0,
    payload: { pv: 1, category: 'person', ...payload },
  };
}

describe('findDuplicateIdentity', () => {
  it('卡号相同 → 直接命中 cardNo', () => {
    const rows = [entry('b', { cardNo: '6222020200112233445' })];
    expect(
      findDuplicateIdentity(rows, { name: undefined, idNumber: undefined, cardNo: '6222020200112233445' }),
    ).toEqual({ id: 'b', field: 'cardNo' });
  });

  it('证件号 + 相同姓名 → 命中 idNumber', () => {
    const rows = [entry('a', { name: '张三', idNumber: '11010519491231002X' })];
    expect(findDuplicateIdentity(rows, { name: '张三', idNumber: '11010519491231002X', cardNo: undefined })).toEqual({
      id: 'a',
      field: 'idNumber',
    });
  });

  it('归一后比较：首尾空白与 x/X 大小写不敏感', () => {
    const rows = [entry('a', { name: '张三', idNumber: '11010519491231002x' })];
    expect(
      findDuplicateIdentity(rows, { name: '  张三  ', idNumber: '  11010519491231002X  ', cardNo: undefined })?.id,
    ).toBe('a');
  });

  it('仅证件号相同、姓名与卡号均不同 → 不判重（社保卡/银行卡共享同一证件号场景）', () => {
    const rows = [entry('a', { name: '李四', idNumber: 'DUP', cardNo: 'CARD-A' })];
    expect(findDuplicateIdentity(rows, { name: '张三', idNumber: 'DUP', cardNo: 'CARD-B' })).toBeNull();
  });

  it('仅证件号相同、姓名为空 → 无佐证则不判重', () => {
    const rows = [entry('a', { idNumber: 'DUP' })];
    expect(findDuplicateIdentity(rows, { name: undefined, idNumber: 'DUP', cardNo: undefined })).toBeNull();
  });

  it('证件号相同且卡号也相同 → 以 idNumber 报告（佐证生效且优先）', () => {
    const rows = [entry('a', { idNumber: 'SAME', cardNo: 'SAME' })];
    expect(findDuplicateIdentity(rows, { name: undefined, idNumber: 'same', cardNo: 'same' })).toEqual({
      id: 'a',
      field: 'idNumber',
    });
  });

  it('编辑态排除自身，不与自己判重', () => {
    const rows = [entry('a', { name: '张三', idNumber: '11010519491231002X' })];
    expect(
      findDuplicateIdentity(rows, { name: '张三', idNumber: '11010519491231002X', cardNo: undefined }, 'a'),
    ).toBeNull();
  });

  it('目标字段为空时跳过，绝不把「空 == 空」判为重复', () => {
    const rows = [entry('a', { idNumber: undefined, cardNo: undefined })];
    expect(findDuplicateIdentity(rows, { name: 'x', idNumber: '', cardNo: '   ' })).toBeNull();
  });

  it('既有条目该字段为空也不误命中', () => {
    const rows = [entry('a', { name: '张三', idNumber: '   ' })];
    expect(findDuplicateIdentity(rows, { name: '张三', idNumber: '', cardNo: undefined })).toBeNull();
  });

  it('跨字段不误判：payload 证件号命中他条的卡号不算重复', () => {
    const rows = [entry('a', { cardNo: 'ABCD' })]; // a 无 idNumber
    expect(findDuplicateIdentity(rows, { name: undefined, idNumber: 'ABCD', cardNo: undefined })).toBeNull();
  });

  it('姓名 / 手机 / 邮箱相同（无证件号 / 卡号）绝不判重', () => {
    const rows = [entry('a', { name: '张三', phone: '13800000000', email: 'x@y.com' })];
    expect(findDuplicateIdentity(rows, { name: '张三', idNumber: undefined, cardNo: undefined })).toBeNull();
  });

  it('多条候选命中首个（数组顺序优先）', () => {
    const rows = [entry('a', { name: 'n', idNumber: 'DUP' }), entry('b', { name: 'n', idNumber: 'DUP' })];
    expect(findDuplicateIdentity(rows, { name: 'n', idNumber: 'dup', cardNo: undefined })).toEqual({
      id: 'a',
      field: 'idNumber',
    });
  });
});
