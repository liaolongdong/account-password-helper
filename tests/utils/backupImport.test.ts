/**
 * 密码库导入边界（B4）纯函数回归测试
 *
 * 覆盖 `utils/backup/parseBackupEntries.ts`：
 * - `parseBackupContainer`：version 上界 / requireVersion / count↔entries 交叉校验 / entries 非数组；
 * - `validateAndBoundEntries`：条数上界（TOO_MANY_ENTRIES）、字段类型白名单（对象/数组/布尔不再被
 *   悄悄 `String()` 成 "[object Object]"）、逐字段长度上限、空用户名过滤、favorite 布尔、时间戳回退；
 * - `readBoundedText`：字符串 / 有限数放行，其它类型与超限抛 INVALID_ENTRY。
 *
 * 纯函数、零 i18n / 零 Vue / 零 chrome 依赖，可在 Node 环境直接运行（对标 identity 备份测试口径）。
 */
import { describe, expect, it } from 'vitest';
import {
  PasswordBackupError,
  checkEntryCount,
  parseBackupContainer,
  readBoundedText,
  validateAndBoundEntries,
} from '@/utils/backup/parseBackupEntries';
import { MAX_PASSWORD_IMPORT_ENTRIES, MAX_REMARK_LEN } from '@/utils/backup/constants';

/** 取出抛错里的机器可读 code */
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof PasswordBackupError ? e.code : `NON_PASSWORD_ERROR:${String(e)}`;
  }
  return undefined;
};

/** 构造一条合法条目的最小副本，便于各用例只覆盖被考察字段 */
const validEntry = (overrides: Record<string, unknown> = {}) => ({
  username: 'alice',
  password: 'secret',
  url: 'https://a.com',
  tag: 'work',
  remark: 'note',
  totp: 'JBSWY3DP',
  createTime: 100,
  updateTime: 200,
  ...overrides,
});

describe('readBoundedText（逐字段类型与长度门）', () => {
  it('字符串放行并 trim', () => {
    expect(readBoundedText('  hi  ', 10)).toBe('hi');
  });
  it('有限数转字符串（保留对数字列名的兼容）', () => {
    expect(readBoundedText(12345, 10)).toBe('12345');
  });
  it('null / undefined 归一为空串', () => {
    expect(readBoundedText(null, 10)).toBe('');
    expect(readBoundedText(undefined, 10)).toBe('');
  });
  it('对象被拒（不再产出 "[object Object]"）', () => {
    expect(codeOf(() => readBoundedText({ a: 1 }, 100))).toBe('INVALID_ENTRY');
  });
  it('数组被拒', () => {
    expect(codeOf(() => readBoundedText(['x'], 100))).toBe('INVALID_ENTRY');
  });
  it('布尔被拒', () => {
    expect(codeOf(() => readBoundedText(true, 100))).toBe('INVALID_ENTRY');
  });
  it('超限抛 INVALID_ENTRY', () => {
    expect(codeOf(() => readBoundedText('x'.repeat(11), 10))).toBe('INVALID_ENTRY');
  });
});

describe('checkEntryCount（条数上界）', () => {
  it('等于上界放行', () => {
    expect(() => checkEntryCount(new Array(MAX_PASSWORD_IMPORT_ENTRIES).fill(0))).not.toThrow();
  });
  it('超过上界抛 TOO_MANY_ENTRIES', () => {
    expect(codeOf(() => checkEntryCount(new Array(MAX_PASSWORD_IMPORT_ENTRIES + 1).fill(0)))).toBe('TOO_MANY_ENTRIES');
  });
});

describe('validateAndBoundEntries（条目级边界）', () => {
  it('合法条目原样收窄为可入库形状', () => {
    expect(validateAndBoundEntries([validEntry()])).toEqual([
      {
        username: 'alice',
        password: 'secret',
        url: 'https://a.com',
        tag: 'work',
        remark: 'note',
        totp: 'JBSWY3DP',
        createTime: 100,
        updateTime: 200,
      },
    ]);
  });

  it('丢弃空用户名条目', () => {
    const result = validateAndBoundEntries([validEntry({ username: '  ' }), validEntry({ username: 'bob' })]);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('bob');
  });

  it('favorite 为布尔时保留', () => {
    expect(validateAndBoundEntries([validEntry({ favorite: true })])[0].favorite).toBe(true);
  });

  it('favorite 非布尔被拒', () => {
    expect(codeOf(() => validateAndBoundEntries([validEntry({ favorite: 'yes' })]))).toBe('INVALID_ENTRY');
  });

  it('缺失时间戳回退为有限数（当前时间）', () => {
    const entry = validateAndBoundEntries([{ username: 'x' }])[0];
    expect(Number.isFinite(entry.createTime)).toBe(true);
    expect(Number.isFinite(entry.updateTime)).toBe(true);
  });

  it('可解析字符串时间戳被转成数字', () => {
    const ts = Date.parse('2020-01-01T00:00:00Z');
    expect(validateAndBoundEntries([{ username: 'x', createTime: '2020-01-01T00:00:00Z' }])[0].createTime).toBe(ts);
  });

  it('password 为对象时整批拒绝（不再产出垃圾字符串）', () => {
    expect(codeOf(() => validateAndBoundEntries([validEntry({ password: { nested: 1 } })]))).toBe('INVALID_ENTRY');
  });

  it('超长 remark 抛 INVALID_ENTRY', () => {
    expect(codeOf(() => validateAndBoundEntries([validEntry({ remark: 'r'.repeat(MAX_REMARK_LEN + 1) })]))).toBe(
      'INVALID_ENTRY',
    );
  });

  it('非数组入参抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => validateAndBoundEntries({}))).toBe('INVALID_STRUCTURE');
  });

  it('元素为原始值（非对象）抛 INVALID_ENTRY', () => {
    expect(codeOf(() => validateAndBoundEntries(['just-a-string']))).toBe('INVALID_ENTRY');
  });
});

describe('parseBackupContainer（容器级边界）', () => {
  const container = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
    version: 1,
    exportedAt: 123,
    count: entries.length,
    entries,
    ...extra,
  });

  it('合法容器解析出条目', () => {
    expect(parseBackupContainer(container([validEntry()]))[0]).toMatchObject({ username: 'alice' });
  });

  it('entries 非数组抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => parseBackupContainer({ version: 1, entries: {} }))).toBe('INVALID_STRUCTURE');
  });

  it('requireVersion=true 且缺失 version 抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => parseBackupContainer({ entries: [] }, true))).toBe('INVALID_STRUCTURE');
  });

  it('requireVersion=false 允许缺失 version（兼容手改 JSON）', () => {
    expect(parseBackupContainer({ entries: [validEntry()] }, false)[0]).toMatchObject({ username: 'alice' });
  });

  it('version 高于上界抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => parseBackupContainer(container([], { version: 99 })))).toBe('INVALID_STRUCTURE');
  });

  it('version 非整数抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => parseBackupContainer(container([], { version: 1.5 })))).toBe('INVALID_STRUCTURE');
  });

  it('count 与 entries 长度不符抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => parseBackupContainer(container([validEntry()], { count: 5 })))).toBe('INVALID_STRUCTURE');
  });

  it('count 缺失时跳过交叉校验（向后兼容旧导出）', () => {
    const data = container([validEntry()]) as { count?: unknown };
    delete data.count;
    expect(parseBackupContainer(data)[0]).toMatchObject({ username: 'alice' });
  });

  it('顶层为数组抛 INVALID_STRUCTURE', () => {
    expect(codeOf(() => parseBackupContainer([validEntry()]))).toBe('INVALID_STRUCTURE');
  });
});
