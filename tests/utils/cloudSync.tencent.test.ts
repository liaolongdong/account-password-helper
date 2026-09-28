import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TencentAdapter,
  encodeFields,
  fromTencentValue,
  mapTencentErrorCode,
} from '@/utils/cloudSync/adapters/tencent';

/**
 * 腾讯智能表 OpenAPI v2 适配器测试（设计规格 §3.1）
 *
 * 用 mock fetch 锁定：三个独立鉴权 Header、文本字段数组编码、分页遍历、
 * 错误码映射与凭证不泄露。真实联调被平台账号类型拒绝（ret=59000），
 * 因此请求/响应形状标注「待真实调用校正」，但**编码与映射逻辑**本身可测。
 */

const CREDS = { clientId: 'cli-1', openId: 'open-1', accessToken: 'token-1' };
const FILE_ID = 'file-test';

interface StubResponse {
  status?: number;
  body: unknown;
}

function stubFetchSequence(responses: StubResponse[]): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return { calls };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeAdapter(sheetId: string | null = 'sheet-1'): TencentAdapter {
  return new TencentAdapter({ fileId: FILE_ID, sheetId, credentials: CREDS });
}

describe('TencentAdapter：鉴权与值格式', () => {
  it('请求带三个独立 Header 而非 Bearer', async () => {
    const { calls } = stubFetchSequence([{ body: { ret: 0, data: { sheets: [] } } }]);
    await makeAdapter().listTables();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Access-Token']).toBe(CREDS.accessToken);
    expect(headers['Client-Id']).toBe(CREDS.clientId);
    expect(headers['Open-Id']).toBe(CREDS.openId);
    expect(JSON.stringify(calls[0].init.headers)).not.toContain('Authorization');
  });

  it('文本字段编码为 [{type:text,text}]，数字字段保持数字', () => {
    expect(encodeFields({ 用户名: 'alice', 本地更新时间: 123 })).toEqual({
      用户名: [{ type: 'text', text: 'alice' }],
      本地更新时间: 123,
    });
    expect(fromTencentValue([{ type: 'text', text: 'alice' }])).toBe('alice');
    expect(fromTencentValue(123)).toBe(123);
  });

  it('凭证已进入请求头是预期；错误对象/消息不泄露 token', async () => {
    stubFetchSequence([{ status: 200, body: { ret: 37019, msg: 'token invalid' } }]);
    try {
      await makeAdapter().listTables();
      expect.unreachable('should throw');
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(CREDS.accessToken);
      expect(serialized).not.toContain(CREDS.clientId);
      expect(error).toMatchObject({ kind: 'invalidCredential' });
    }
  });
});

describe('TencentAdapter：列表、字段与行', () => {
  it('listTables 分页遍历并归一化 sheet 结构', async () => {
    stubFetchSequence([
      { body: { ret: 0, data: { sheets: [{ sheetID: 's1', title: 'A' }], hasMore: true } } },
      { body: { ret: 0, data: { sheets: [{ sheetId: 's2', title: 'B' }], hasMore: false } } },
    ]);
    await expect(makeAdapter().listTables()).resolves.toEqual([
      { id: 's1', name: 'A' },
      { id: 's2', name: 'B' },
    ]);
  });

  it('getRows 解析 recordID/values/updateTime 并归一化', async () => {
    stubFetchSequence([
      {
        body: {
          ret: 0,
          data: {
            records: [
              {
                recordID: 'rec1',
                updateTime: '1700000000000',
                values: { 用户名: [{ type: 'text', text: 'alice' }], 本地更新时间: 123 },
              },
            ],
            hasMore: false,
          },
        },
      },
    ]);
    const rows = await makeAdapter().getRows();
    expect(rows).toEqual([
      { recordId: 'rec1', fields: { 用户名: 'alice', 本地更新时间: 123 }, cloudModifiedAt: 1700000000000 },
    ]);
  });

  it('checkTableSchema：字段缺失 → ok:false，全部匹配 → ok:true', async () => {
    stubFetchSequence([
      {
        body: {
          ret: 0,
          data: { fields: [{ fieldTitle: '用户名', fieldType: 'text' }] },
        },
      },
    ]);
    const check = await makeAdapter().checkTableSchema([
      { name: '用户名', type: 'text' },
      { name: '本地更新时间', type: 'number' },
    ]);
    expect(check).toEqual({ ok: false, missingFields: ['本地更新时间'] });

    // 第二次调用直接测匹配
    stubFetchSequence([
      {
        body: {
          ret: 0,
          data: {
            fields: [
              { fieldTitle: '用户名', fieldType: 'text' },
              { fieldTitle: '本地更新时间', fieldType: 'number' },
            ],
          },
        },
      },
    ]);
    await expect(
      makeAdapter().checkTableSchema([
        { name: '用户名', type: 'text' },
        { name: '本地更新时间', type: 'number' },
      ]),
    ).resolves.toEqual({ ok: true });
  });
});

describe('TencentAdapter：批量写入与删除', () => {
  it('batchUpsert 新增与更新都编码为平台值格式', async () => {
    stubFetchSequence([
      { body: { ret: 0, data: { records: [{ recordID: 'new-1' }] } } },
      { body: { ret: 0, data: {} } },
    ]);
    const adapter = makeAdapter();
    const result = await adapter.batchUpsert([
      { recordId: '', businessId: 'b1', fields: { 用户名: 'u1', 本地更新时间: 1 } },
      { recordId: 'upd-1', businessId: 'b2', fields: { 用户名: 'u2' } },
    ]);
    expect(result.succeeded).toEqual([
      { recordId: 'new-1', businessId: 'b1' },
      { recordId: 'upd-1', businessId: 'b2' },
    ]);

    const { calls } = stubFetchSequence([{ body: { ret: 0, data: {} } }]);
    await adapter.batchUpsert([{ recordId: '', businessId: 'b3', fields: { 用户名: 'u3' } }]);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.addRecords.records[0].values.用户名).toEqual([{ type: 'text', text: 'u3' }]);
  });

  it('batchDelete 响应成功即整批成功', async () => {
    stubFetchSequence([{ body: { ret: 0, data: {} } }]);
    const result = await makeAdapter().batchDelete(['rec1', 'rec2']);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toEqual([]);
  });
});

describe('mapTencentErrorCode：错误码映射', () => {
  it('按规格映射到领域错误类别', () => {
    expect(mapTencentErrorCode(10313, 'x').kind).toBe('invalidCredential');
    expect(mapTencentErrorCode(10302, 'x').kind).toBe('invalidCredential');
    expect(mapTencentErrorCode(10303, 'x').kind).toBe('invalidCredential');
    expect(mapTencentErrorCode(37019, 'x').kind).toBe('invalidCredential');
    expect(mapTencentErrorCode(59000, 'x').kind).toBe('permission');
    expect(mapTencentErrorCode(429, 'x').kind).toBe('rateLimit');
    expect(mapTencentErrorCode(40301, 'x').kind).toBe('permission');
  });

  it('未知错误码 → unknown', () => {
    expect(mapTencentErrorCode(999999, 'x').kind).toBe('unknown');
  });
});
