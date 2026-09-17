import { describe, expect, it } from 'vitest';
import type { IdentityEntry, IdentityPayload } from '@/utils/identity/types';
import {
  buildIdentityBackupData,
  buildIdentityPlaintextJson,
  decryptIdentityBackup,
  encryptIdentityBackup,
  getIdentityBackupErrorCode,
  mergeIdentityRecords,
  parseIdentityBackupData,
  parseIdentityPlaintextJson,
  resolveExportEntries,
  type IdentityBackupRecord,
} from '@/utils/identity/backup';

/**
 * 身份信息备份（.aphid）单元测试
 *
 * 纯逻辑（build/parse/merge）零加解密；真实 Web Crypto 的往返与错密测试
 * 各跑一次 PBKDF2-SHA256/600k（约 2s/次），显式放宽超时，避免与
 * encryption.test.ts 等并行用例抢 CPU 时误判超时。
 */

const payload = (overrides: Partial<IdentityPayload> = {}): IdentityPayload => ({
  pv: 1,
  category: 'person',
  name: '张三',
  ...overrides,
});

const entry = (id: string, updateTime: number, overrides: Partial<IdentityPayload> = {}): IdentityEntry => ({
  id,
  encryptedPayload: 'cipher:' + id,
  createTime: 1,
  updateTime,
  payload: payload(overrides),
});

const record = (id: string, updateTime: number): IdentityBackupRecord => ({
  id,
  createTime: 1,
  updateTime,
  payload: payload(),
});

describe('buildIdentityBackupData', () => {
  it('records 保留 id / createTime / updateTime / payload', () => {
    const data = buildIdentityBackupData([entry('a', 42, { name: '李四' })]);
    expect(data.kind).toBe('aphid');
    expect(data.version).toBe(1);
    expect(data.count).toBe(1);
    expect(data.records[0]).toMatchObject({ id: 'a', updateTime: 42 });
    expect(data.records[0].payload.name).toBe('李四');
  });
});

describe('buildIdentityPlaintextJson（明文导出结构）', () => {
  it('JSON.parse + parseIdentityBackupData 可还原，records 与 id 一致', () => {
    const json = buildIdentityPlaintextJson([
      entry('a', 1, { name: '张三' }),
      entry('b', 2, { category: 'bank_card' }),
    ]);
    const parsed = parseIdentityBackupData(JSON.parse(json));
    expect(parsed.kind).toBe('aphid');
    expect(parsed.count).toBe(2);
    expect(parsed.records.map(r => r.id)).toEqual(['a', 'b']);
    expect(parsed.records[0].payload.name).toBe('张三');
    expect(parsed.records[1].payload.category).toBe('bank_card');
  });

  it('是合法、带缩进的 JSON 文本', () => {
    const json = buildIdentityPlaintextJson([entry('a', 1)]);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('\n  ');
  });
});

describe('parseIdentityPlaintextJson（明文导入解析 / 导出→回导往返）', () => {
  /** 捕获 parseIdentityPlaintextJson 抛出的错误码（未抛则返回 null） */
  const captureCode = (text: string) => {
    try {
      parseIdentityPlaintextJson(text);
      return null;
    } catch (error) {
      return getIdentityBackupErrorCode(error);
    }
  };

  it('往返：buildIdentityPlaintextJson 文本可被解析回同结构 records', () => {
    const json = buildIdentityPlaintextJson([
      entry('a', 1, { name: '张三' }),
      entry('b', 2, { category: 'bank_card' }),
    ]);
    const parsed = parseIdentityPlaintextJson(json);
    expect(parsed.kind).toBe('aphid');
    expect(parsed.count).toBe(2);
    expect(parsed.records.map(r => r.id)).toEqual(['a', 'b']);
    expect(parsed.records[0].payload.name).toBe('张三');
    expect(parsed.records[1].payload.category).toBe('bank_card');
  });

  it('解析结果可喂给 mergeIdentityRecords（与加密路径共用合并尾部）', () => {
    const json = buildIdentityPlaintextJson([entry('a', 200), entry('b', 50)]);
    const { records } = parseIdentityPlaintextJson(json);
    // 当前库已有较旧的 a（updateTime 100）→ 被更新；b 为新增
    const merged = mergeIdentityRecords([record('a', 100)], records);
    expect(merged.updated).toBe(1);
    expect(merged.added).toBe(1);
    expect(merged.records).toHaveLength(2);
    expect(merged.records.find(r => r.id === 'a')?.updateTime).toBe(200);
  });

  it('密码库导出的 JSON（无 kind）→ NOT_APHID', () => {
    const text = JSON.stringify({ version: 1, exportedAt: 0, count: 0, entries: [] });
    expect(captureCode(text)).toBe('NOT_APHID');
  });

  it('非 JSON 文本 → INVALID_STRUCTURE', () => {
    expect(captureCode('这不是 JSON {{{')).toBe('INVALID_STRUCTURE');
  });

  it('kind 为 aphid 但记录形状非法 → INVALID_STRUCTURE', () => {
    const text = JSON.stringify({ kind: 'aphid', version: 1, records: [{ id: 1 }] });
    expect(captureCode(text)).toBe('INVALID_STRUCTURE');
  });
});

describe('resolveExportEntries（导出作用域）', () => {
  const list = [entry('a', 1), entry('b', 2), entry('c', 3)];

  it('未勾选任何 id → 返回全部（原引用）', () => {
    expect(resolveExportEntries(list, new Set())).toBe(list);
  });

  it('勾选子集 → 仅返回所选，保持原顺序', () => {
    expect(resolveExportEntries(list, new Set(['c', 'a'])).map(e => e.id)).toEqual(['a', 'c']);
  });

  it('勾选含失效 id（已删除）→ 自动忽略', () => {
    expect(resolveExportEntries(list, new Set(['a', 'gone'])).map(e => e.id)).toEqual(['a']);
  });
});

describe('parseIdentityBackupData（不可信输入边界校验）', () => {
  it('合法数据原样返回', () => {
    const json = { kind: 'aphid', version: 1, exportedAt: 0, count: 1, records: [record('a', 1)] };
    expect(parseIdentityBackupData(json).records).toHaveLength(1);
  });

  it('kind 缺失（如 .aph 密码备份）→ NOT_APHID', () => {
    const json = { version: 1, exportedAt: 0, count: 0, entries: [] };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('NOT_APHID');
  });

  it('kind 为其它值 → NOT_APHID', () => {
    const json = { kind: 'aph', version: 1, records: [] };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('NOT_APHID');
  });

  it('records 非数组 → INVALID_STRUCTURE', () => {
    const json = { kind: 'aphid', version: 1, records: 'nope' };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('记录形状非法 → INVALID_STRUCTURE', () => {
    const json = { kind: 'aphid', version: 1, records: [{ id: 1 }] };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('category 为任意非枚举字符串 → INVALID_STRUCTURE（不渲染裸 i18n key）', () => {
    const json = {
      kind: 'aphid',
      version: 1,
      records: [{ id: 'a', createTime: 1, updateTime: 1, payload: { pv: 1, category: '__proto__' } }],
    };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('category 缺失（非字符串）→ INVALID_STRUCTURE', () => {
    const json = {
      kind: 'aphid',
      version: 1,
      records: [{ id: 'a', createTime: 1, updateTime: 1, payload: { pv: 1 } }],
    };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('version 缺失 → INVALID_STRUCTURE', () => {
    const json = { kind: 'aphid', records: [record('a', 1)] };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('version 高于当前（前向不兼容）→ INVALID_STRUCTURE', () => {
    const json = { kind: 'aphid', version: 2, records: [record('a', 1)] };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('内置字段超长（>200）→ INVALID_STRUCTURE', () => {
    const json = {
      kind: 'aphid',
      version: 1,
      records: [
        { id: 'a', createTime: 1, updateTime: 1, payload: { pv: 1, category: 'person', address: 'x'.repeat(201) } },
      ],
    };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('备注超长（>1000）→ INVALID_STRUCTURE', () => {
    const json = {
      kind: 'aphid',
      version: 1,
      records: [
        { id: 'a', createTime: 1, updateTime: 1, payload: { pv: 1, category: 'person', remark: 'x'.repeat(1001) } },
      ],
    };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('自定义字段数量超限（>10）→ INVALID_STRUCTURE', () => {
    const customFields = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, label: 'l', value: 'v', secret: false }));
    const json = {
      kind: 'aphid',
      version: 1,
      records: [{ id: 'a', createTime: 1, updateTime: 1, payload: { pv: 1, category: 'person', customFields } }],
    };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('自定义字段形状非法（secret 非布尔）→ INVALID_STRUCTURE', () => {
    const json = {
      kind: 'aphid',
      version: 1,
      records: [
        {
          id: 'a',
          createTime: 1,
          updateTime: 1,
          payload: { pv: 1, category: 'person', customFields: [{ id: 'c', label: 'l', value: 'v', secret: 'yes' }] },
        },
      ],
    };
    expect(getIdentityBackupErrorCode(captureParseError(json))).toBe('INVALID_STRUCTURE');
  });

  it('自定义字段在限内 → 合法', () => {
    const json = {
      kind: 'aphid',
      version: 1,
      records: [
        {
          id: 'a',
          createTime: 1,
          updateTime: 1,
          payload: { pv: 1, category: 'person', customFields: [{ id: 'c', label: 'l', value: 'v', secret: true }] },
        },
      ],
    };
    expect(parseIdentityBackupData(json).records).toHaveLength(1);
  });
});

/** 捕获 parseIdentityBackupData 抛出的错误（未抛则返回 null） */
function captureParseError(json: unknown): unknown {
  try {
    parseIdentityBackupData(json);
    return null;
  } catch (error) {
    return error;
  }
}

describe('decryptIdentityBackup', () => {
  it('字节过短 → INVALID_FILE（不触发 PBKDF2）', async () => {
    const code = getIdentityBackupErrorCode(await decryptIdentityBackup(new Uint8Array(5), 'pw').catch(e => e));
    expect(code).toBe('INVALID_FILE');
  });

  it('往返：加密后解密回原文，records 与 id 逐条一致', async () => {
    const data = buildIdentityBackupData([entry('a', 1, { name: '张三' }), entry('b', 2, { category: 'bank_card' })]);
    const bytes = await encryptIdentityBackup(data, 'master-pw');
    const decrypted = await decryptIdentityBackup(bytes, 'master-pw');

    expect(decrypted.kind).toBe('aphid');
    expect(decrypted.records).toHaveLength(2);
    expect(decrypted.records.map(r => r.id)).toEqual(['a', 'b']);
    expect(decrypted.records[0].payload.name).toBe('张三');
    expect(decrypted.records[1].payload.category).toBe('bank_card');
  }, 20_000);

  it('错误密码 → WRONG_PASSWORD', async () => {
    const data = buildIdentityBackupData([entry('a', 1)]);
    const bytes = await encryptIdentityBackup(data, 'correct-pw');
    const err = await decryptIdentityBackup(bytes, 'wrong-pw').catch(e => e);
    expect(getIdentityBackupErrorCode(err)).toBe('WRONG_PASSWORD');
  }, 20_000);
});

describe('mergeIdentityRecords（按 id 合并 + 计数）', () => {
  it('新增 / 更新 / 跳过计数正确', () => {
    const current = [record('a', 100)];
    const incoming = [record('a', 200), record('b', 50)];
    const result = mergeIdentityRecords(current, incoming);

    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.records).toHaveLength(2);
    expect(result.records.find(r => r.id === 'a')?.updateTime).toBe(200);
  });

  it('较旧的同 id 记录计入 skipped，不覆盖', () => {
    const current = [record('a', 200)];
    const result = mergeIdentityRecords(current, [record('a', 100)]);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.records[0].updateTime).toBe(200);
  });

  it('更新时保留原有 createTime', () => {
    const current = [{ ...record('a', 100), createTime: 7 }];
    const incoming = [{ ...record('a', 200), createTime: 999 }];
    const result = mergeIdentityRecords(current, incoming);
    expect(result.records[0].createTime).toBe(7);
  });

  it('同一份备份连续导入两次 → 条数不变（不产生重复 PII）', () => {
    const backup = [record('a', 1), record('b', 2), record('c', 3)];

    const first = mergeIdentityRecords([], backup);
    expect(first.added).toBe(3);
    expect(first.records).toHaveLength(3);

    // 第二次导入同一份备份：updateTime 相同 → 全部跳过，条数不变
    const second = mergeIdentityRecords(first.records, backup);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(3);
    expect(second.records).toHaveLength(3);
  });
});
