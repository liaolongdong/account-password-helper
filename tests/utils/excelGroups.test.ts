import { describe, expect, it } from 'vitest';
import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE } from '@/utils/types';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { FORMAT_COLUMN_MAP } from '@/utils/excelFormatMap';
import { parseCSVBuffer } from '@/utils/excelCsv';
import { parsePasswordJSON } from '@/utils/excelJson';

const toBuffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe('CSV group column mapping', () => {
  it('maps the native group column', () => {
    expect(FORMAT_COLUMN_MAP.native.group).toContain('分组');
  });

  it('maps LastPass grouping to group instead of tag', () => {
    expect(FORMAT_COLUMN_MAP.lastpass.group).toContain('grouping');
    expect(FORMAT_COLUMN_MAP.lastpass.tag).not.toContain('grouping');
  });

  it('maps Bitwarden folder to group instead of tag', () => {
    expect(FORMAT_COLUMN_MAP.bitwarden.group).toContain('folder');
    expect(FORMAT_COLUMN_MAP.bitwarden.tag).not.toContain('folder');
  });
});

describe('CSV group path parsing', () => {
  it('returns groupPath with an empty group tree', () => {
    const csv = ['用户名(必填),密码,网址,标签,备注,两步验证,分组', 'alice,pw,example.com,t1,r1,,工作/项目A'].join('\n');

    const result = parseCSVBuffer(toBuffer(csv), 'native');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].groupPath).toBe('工作/项目A');
    expect(result.groups).toEqual([]);
  });

  it('returns an empty groupPath when no group column exists', () => {
    const csv = ['用户名(必填),密码', 'alice,pw'].join('\n');
    expect(parseCSVBuffer(toBuffer(csv), 'native').entries[0].groupPath).toBe('');
  });

  it('parses the Bitwarden folder as groupPath', () => {
    const csv = ['folder,login_username,login_password,login_uri,notes', 'Work/Sites,alice,pw,example.com,note'].join(
      '\n',
    );
    const result = parseCSVBuffer(toBuffer(csv), 'bitwarden');
    expect(result.entries[0].groupPath).toBe('Work/Sites');
  });
});

describe('JSON group parsing', () => {
  it('parses groups and entry groupId', () => {
    const payload = {
      version: 2,
      groups: [{ code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 }],
      entries: [{ username: 'alice', password: 'pw', groupId: 'work' }],
    };

    const result = parsePasswordJSON(JSON.stringify(payload));

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('工作');
    expect(result.entries[0].groupId).toBe('work');
  });

  it('falls back to an empty tree for a v1 JSON array', () => {
    const result = parsePasswordJSON(JSON.stringify([{ username: 'alice', password: 'pw' }]));
    expect(result.groups).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('ignores malformed groups without dropping entries', () => {
    const result = parsePasswordJSON(JSON.stringify({ groups: 'corrupted', entries: [{ username: 'a' }] }));
    expect(result.groups).toEqual([]);
    expect(result.entries).toHaveLength(1);
  });

  it('parses entry groupPath consistently with CSV', () => {
    const result = parsePasswordJSON(JSON.stringify([{ username: 'a', groupPath: '工作/项目A' }]));
    expect(result.entries[0].groupPath).toBe('工作/项目A');
  });
});

describe('export payloads with groups', () => {
  const groups: PasswordGroup[] = [
    { code: 'work', name: '工作', parentCode: ROOT_GROUP_CODE, order: 0 },
    { code: 'proj', name: '项目A', parentCode: 'work', order: 0 },
  ];

  it('builds CSV rows with the full group path', async () => {
    const { buildCsvRows } = await import('@/utils/excelExport');
    const rows = buildCsvRows([makePasswordEntry({ id: '1', username: 'alice', groupId: 'proj' })], groups);
    expect(rows[0][6]).toBe('工作/项目A');
  });

  it('builds an empty group cell for ungrouped entries', async () => {
    const { buildCsvRows } = await import('@/utils/excelExport');
    expect(buildCsvRows([makePasswordEntry({ id: '1' })], groups)[0][6]).toBe('');
  });

  it('builds a JSON payload with groups and entry groupId', async () => {
    const { buildJsonPayload } = await import('@/utils/excelExport');
    const payload = buildJsonPayload([makePasswordEntry({ id: '1', groupId: 'proj' })], groups);
    expect(payload.groups).toHaveLength(2);
    expect(payload.entries[0].groupId).toBe('proj');
  });
});
