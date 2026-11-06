/**
 * CSV 导入的「未能带出」逐行原因
 *
 * 此前 `utils/excelCsv.ts` 对不合格的行直接 `continue`（列数不足、账号列为空），
 * 表头不在识别范围时还会兜底成 Chrome 映射（`detectFormat` 的最后一行）再落进同一条丢弃分支。
 * 用户看到的就是「导入 0 条」而没有第二句话——迁移是安装后第一件事，这一步哑掉等于把新用户
 * 直接退回未激活状态。
 *
 * 隐私边界必须一起钉住：跳过记录只允许行号与原因枚举，**不得携带任何字段原值**。
 * 导入文件里那一列可能就是明文口令，把它回显到界面或留在内存对象里都是新的泄漏面。
 */
import { describe, expect, it } from 'vitest';
import { groupSkippedRows, parseCSVBuffer } from '@/utils/excelCsv';

const toBuffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('CSV 导入的逐行跳过原因', () => {
  it('合格行照常入库，不合格行按原因与数据行序号报出', () => {
    const csv = [
      'name,url,username,password',
      'GitHub,https://github.com,alice,E2eOnly!Passw0rd',
      '"only-one-column"',
      'Work,https://work.example.com,,E2eOnly!Passw0rd',
    ].join('\n');

    const { entries, skipped } = parseCSVBuffer(toBuffer(csv));

    expect(entries.map(e => e.username)).toEqual(['alice']);
    expect(skipped).toEqual([
      { row: 2, reason: 'too-few-columns' },
      { row: 3, reason: 'missing-username' },
    ]);
  });

  it('表头认不出账号列时，每一行都给出可行动的原因而不是静默归零', () => {
    const csv = ['account_id,secret', 'a1,s3cr3t', 'a2,s3cr3t'].join('\n');

    const { entries, skipped } = parseCSVBuffer(toBuffer(csv));

    expect(entries).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    expect(skipped.every(row => row.reason === 'missing-username')).toBe(true);
  });

  it('跳过记录不携带字段原值：只允许 row 与 reason 两个键', () => {
    const csv = ['name,url,username,password', 'Work,https://work.example.com,,E2eOnly!Passw0rd'].join('\n');

    const { skipped } = parseCSVBuffer(toBuffer(csv));

    expect(Object.keys(skipped[0]).sort()).toEqual(['reason', 'row']);
    expect(JSON.stringify(skipped)).not.toContain('E2eOnly');
    expect(JSON.stringify(skipped)).not.toContain('work.example.com');
  });

  it('空行不占数据行序号（口径与界面文案一致：第 N 条数据行）', () => {
    const csv = 'name,url,username,password\n\nGitHub,https://github.com,alice,E2eOnly!Passw0rd\n\nx\n';

    const { entries, skipped } = parseCSVBuffer(toBuffer(csv));

    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([{ row: 2, reason: 'too-few-columns' }]);
  });
});

/**
 * 界面归组：整份文件表头错位时会有几千行被跳过，行号必须截断，
 * 否则导入对话框会变成一根滚动条。
 */
describe('跳过行按原因归组', () => {
  it('同原因合成一组，行号原样带出且没有剩余', () => {
    const groups = groupSkippedRows([
      { row: 2, reason: 'missing-username' },
      { row: 3, reason: 'too-few-columns' },
      { row: 5, reason: 'missing-username' },
    ]);

    expect(groups).toEqual([
      { reason: 'missing-username', rows: [2, 5], more: 0 },
      { reason: 'too-few-columns', rows: [3], more: 0 },
    ]);
  });

  it('超过上限只列前 10 个行号，剩余数落进 more', () => {
    const skipped = Array.from({ length: 12 }, (_, i) => ({ row: i + 1, reason: 'missing-username' as const }));

    const [group] = groupSkippedRows(skipped);

    expect(group.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(group.more).toBe(2);
  });

  it('没有跳过时返回空数组（界面据此整块不渲染）', () => {
    expect(groupSkippedRows([])).toEqual([]);
  });
});
