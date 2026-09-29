import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEISHU_DEFAULT_BASE_URL,
  FeishuAdapter,
  mapFeishuErrorCode,
  normalizeFeishuBaseUrl,
  resolveFeishuBaseUrl,
} from '@/utils/cloudSync/adapters/feishu';

/**
 * 飞书 Bitable V1 适配器测试（设计规格 §3.2）
 *
 * 用 mock fetch 锁定：token 换取与内存缓存、分页遍历、值格式归一化、
 * 批量写入顺序映射、表结构校验与错误码映射。
 * 真实凭证联调已确认 token 接口返回 200 / code=0（见设计规格修订说明）。
 */

const CREDS = { appId: 'cli_test', appSecret: 'secret_test' };
const APP_TOKEN = 'bascnTest';

interface StubResponse {
  status?: number;
  body: unknown;
}

/** 按调用顺序返回预设响应，并记录请求 */
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

const TOKEN_OK = { code: 0, tenant_access_token: 't-123', expire: 7200 };

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeAdapter(tableId: string | null = 'tbl1', baseUrl?: string | null, allowInsecure = false): FeishuAdapter {
  return new FeishuAdapter({ appToken: APP_TOKEN, tableId, credentials: CREDS, baseUrl, allowInsecure });
}

describe('FeishuAdapter：token 与请求', () => {
  it('换取 tenant_access_token 并复用缓存（后续调用不再换 token）', async () => {
    const { calls } = stubFetchSequence([
      { body: TOKEN_OK },
      { body: { code: 0, data: { items: [{ table_id: 'tbl1', name: 'A' }], has_more: false } } },
      { body: { code: 0, data: { items: [{ table_id: 'tbl2', name: 'B' }], has_more: false } } },
    ]);
    const adapter = makeAdapter();
    await adapter.listTables();
    await adapter.listTables();

    const tokenCalls = calls.filter(call => call.url.includes('tenant_access_token'));
    expect(tokenCalls).toHaveLength(1);
    const authHeader = calls[1].init.headers as Record<string, string>;
    expect(authHeader.Authorization).toBe('Bearer t-123');
  });

  it('testConnection 仅校验凭证，不触碰目标表', async () => {
    const { calls } = stubFetchSequence([{ body: TOKEN_OK }]);
    await makeAdapter().testConnection();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('tenant_access_token');
  });

  it('token 接口返回非 0 → invalidCredential', async () => {
    stubFetchSequence([{ body: { code: 99991663, msg: 'token invalid' } }]);
    await expect(makeAdapter().testConnection()).rejects.toMatchObject({ kind: 'invalidCredential' });
  });

  it('凭证错误不泄露 secret（错误对象不含请求体）', async () => {
    stubFetchSequence([{ body: { code: 1254302, msg: 'forbidden' } }]);
    try {
      await makeAdapter().testConnection();
      expect.unreachable('should throw');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(CREDS.appSecret);
    }
  });
});

describe('FeishuAdapter：列表与分页', () => {
  it('listTables 按 page_token 遍历全部分页', async () => {
    stubFetchSequence([
      { body: TOKEN_OK },
      { body: { code: 0, data: { items: [{ table_id: 't1', name: 'A' }], has_more: true, page_token: 'p2' } } },
      { body: { code: 0, data: { items: [{ table_id: 't2', name: 'B' }], has_more: false } } },
    ]);
    await expect(makeAdapter().listTables()).resolves.toEqual([
      { id: 't1', name: 'A' },
      { id: 't2', name: 'B' },
    ]);
  });

  it('getRows 走官方推荐的 POST records/search，automatic_fields 置于请求体', async () => {
    const { calls } = stubFetchSequence([
      { body: TOKEN_OK },
      {
        body: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec1',
                last_modified_time: 1700000000000,
                fields: { 用户名: [{ type: 'text', text: 'alice' }], 本地更新时间: 123 },
              },
            ],
            has_more: false,
          },
        },
      },
    ]);
    const rows = await makeAdapter().getRows();
    expect(rows).toEqual([
      {
        recordId: 'rec1',
        fields: { 用户名: 'alice', 本地更新时间: 123 },
        cloudModifiedAt: 1700000000000,
      },
    ]);
    const searchCall = calls[1];
    expect(searchCall.url).toContain('/records/search');
    expect(searchCall.init.method).toBe('POST');
    expect(JSON.parse(String(searchCall.init.body))).toEqual({ automatic_fields: true });
    expect(searchCall.url).toContain('page_size=500');
  });

  it('getRows 未配置 tableId → notFound', async () => {
    stubFetchSequence([{ body: TOKEN_OK }]);
    await expect(makeAdapter(null).getRows()).rejects.toMatchObject({ kind: 'notFound' });
  });
});

describe('FeishuAdapter：批量写入', () => {
  it('batchUpsert 按入参顺序映射新增 recordId，更新沿用原 recordId', async () => {
    stubFetchSequence([
      { body: TOKEN_OK },
      { body: { code: 0, data: { records: [{ record_id: 'new-1' }, { record_id: 'new-2' }] } } },
      { body: { code: 0, data: { records: [{ record_id: 'upd-1' }] } } },
    ]);
    const adapter = makeAdapter();
    const result = await adapter.batchUpsert([
      { recordId: '', businessId: 'b1', fields: { 用户名: 'u1' } },
      { recordId: '', businessId: 'b2', fields: { 用户名: 'u2' } },
      { recordId: 'upd-1', businessId: 'b3', fields: { 用户名: 'u3' } },
    ]);
    expect(result.succeeded).toEqual([
      { recordId: 'new-1', businessId: 'b1' },
      { recordId: 'new-2', businessId: 'b2' },
      { recordId: 'upd-1', businessId: 'b3' },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('batchUpsert 新增响应缺 record_id → 记为失败而非猜测成功', async () => {
    stubFetchSequence([{ body: TOKEN_OK }, { body: { code: 0, data: { records: [{ record_id: 'new-1' }] } } }]);
    const result = await makeAdapter().batchUpsert([
      { recordId: '', businessId: 'b1', fields: {} },
      { recordId: '', businessId: 'b2', fields: {} },
    ]);
    expect(result.succeeded).toHaveLength(1);
    expect(result.failed).toEqual([
      { businessId: 'b2', code: 'no-record-id', message: 'batch_create returned no record_id' },
    ]);
  });

  it('batch_create 携带 uuidv4 格式 client_token 幂等键', async () => {
    const { calls } = stubFetchSequence([
      { body: TOKEN_OK },
      { body: { code: 0, data: { records: [{ record_id: 'new-1' }] } } },
    ]);
    await makeAdapter().batchUpsert([{ recordId: '', businessId: 'b1', fields: {} }]);
    const createCall = calls[1];
    expect(createCall.url).toContain('/records/batch_create');
    const token = new URL(createCall.url).searchParams.get('client_token');
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('FeishuAdapter：批量删除', () => {
  it('按响应逐条解析 deleted 标记', async () => {
    stubFetchSequence([
      { body: TOKEN_OK },
      {
        body: {
          code: 0,
          data: {
            records: [
              { deleted: true, record_id: 'r1' },
              { deleted: false, record_id: 'r2' },
            ],
          },
        },
      },
    ]);
    const result = await makeAdapter().batchDelete(['r1', 'r2']);
    expect(result.succeeded).toEqual([{ recordId: 'r1', businessId: '' }]);
    expect(result.failed).toEqual([{ businessId: '', code: 'delete-not-deleted', message: 'record r2 not deleted' }]);
  });

  it('整批 1254043 → 降级单条删除；单条仍 1254043 视为业务成功', async () => {
    stubFetchSequence([
      { body: TOKEN_OK },
      // 整批删除被拒：recordId 不存在
      { body: { code: 1254043, msg: 'RecordIdNotFound' } },
      // 单条降级：r1 删除成功
      { body: { code: 0, data: { records: [{ deleted: true, record_id: 'r1' }] } } },
      // 单条降级：r2 仍报不存在 → 业务成功
      { body: { code: 1254043, msg: 'RecordIdNotFound' } },
    ]);
    const result = await makeAdapter().batchDelete(['r1', 'r2']);
    expect(result.succeeded).toEqual([
      { recordId: 'r1', businessId: '' },
      { recordId: 'r2', businessId: '' },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('整批因其他错误被拒 → 向上抛出（不静默吞掉）', async () => {
    stubFetchSequence([{ body: TOKEN_OK }, { body: { code: 1254302, msg: 'Permission denied' } }]);
    await expect(makeAdapter().batchDelete(['r1'])).rejects.toMatchObject({ kind: 'permission' });
  });
});

describe('FeishuAdapter：表结构校验', () => {
  it('字段缺失或类型不符 → ok:false 并列出缺失字段', async () => {
    stubFetchSequence([
      { body: TOKEN_OK },
      {
        body: {
          code: 0,
          data: {
            items: [
              { field_id: 'f1', field_name: '用户名', type: 1 },
              { field_id: 'f2', field_name: '密码', type: 1 },
            ],
            has_more: false,
          },
        },
      },
    ]);
    const check = await makeAdapter().checkTableSchema([
      { name: '用户名', type: 'text' },
      { name: '密码', type: 'text' },
      { name: '本地更新时间', type: 'number' },
    ]);
    expect(check).toEqual({ ok: false, missingFields: ['本地更新时间'] });
  });

  it('全部字段匹配 → ok:true', async () => {
    stubFetchSequence([
      { body: TOKEN_OK },
      {
        body: {
          code: 0,
          data: {
            items: [
              { field_id: 'f1', field_name: '用户名', type: 1 },
              { field_id: 'f2', field_name: '本地更新时间', type: 2 },
            ],
            has_more: false,
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

describe('mapFeishuErrorCode：错误码映射', () => {
  it('按规格映射到领域错误类别', () => {
    expect(mapFeishuErrorCode(99991663, 'x').kind).toBe('invalidCredential');
    expect(mapFeishuErrorCode(1254041, 'x').kind).toBe('notFound');
    expect(mapFeishuErrorCode(1254043, 'x').kind).toBe('notFound');
    expect(mapFeishuErrorCode(1254045, 'x').kind).toBe('schema');
    expect(mapFeishuErrorCode(1254130, 'x').kind).toBe('tooLarge');
    expect(mapFeishuErrorCode(1254290, 'x').kind).toBe('rateLimit');
    expect(mapFeishuErrorCode(1254291, 'x').kind).toBe('writeConflict');
    expect(mapFeishuErrorCode(1254608, 'x').kind).toBe('writeConflict');
    expect(mapFeishuErrorCode(1254302, 'x').kind).toBe('permission');
    expect(mapFeishuErrorCode(1254304, 'x').kind).toBe('permission');
    expect(mapFeishuErrorCode(91402, 'x').kind).toBe('notFound');
    expect(mapFeishuErrorCode(1, 'x').kind).toBe('unknown');
  });
});

describe('FeishuAdapter：私有化部署地址', () => {
  it('自定义 baseUrl 时 token 与业务请求都打到该地址，末尾斜杠被归一', async () => {
    const { calls } = stubFetchSequence([
      { body: TOKEN_OK },
      { body: { code: 0, data: { items: [{ table_id: 'tbl1', name: 'A' }], has_more: false } } },
    ]);
    await makeAdapter('tbl1', 'https://open.corp.example/').listTables();

    expect(calls[0].url).toBe('https://open.corp.example/open-apis/auth/v3/tenant_access_token/internal');
    expect(calls[1].url.startsWith(`https://open.corp.example/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`)).toBe(
      true,
    );
    expect(calls.some(call => call.url.includes('open.feishu.cn'))).toBe(false);
  });

  it('支持网关路径前缀（开放平台挂在子路径的部署）', async () => {
    const { calls } = stubFetchSequence([{ body: TOKEN_OK }]);
    await makeAdapter(null, 'https://gw.corp.example/feishu/').testConnection();
    expect(calls[0].url).toBe('https://gw.corp.example/feishu/open-apis/auth/v3/tenant_access_token/internal');
  });

  it('未填 baseUrl 时仍走官方地址（既有行为不变）', async () => {
    const { calls } = stubFetchSequence([{ body: TOKEN_OK }]);
    await makeAdapter().testConnection();
    expect(calls[0].url).toBe(`${FEISHU_DEFAULT_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`);
  });

  it('内网 http 地址未确认时在构造阶段拒绝，不发出请求', () => {
    stubFetchSequence([{ body: TOKEN_OK }]);
    expect(() => makeAdapter('tbl1', 'http://192.168.1.8:8080')).toThrowError(/explicit confirmation/);
  });

  it('显式确认后内网 http 地址可用，请求打向自建地址', async () => {
    const { calls } = stubFetchSequence([{ body: TOKEN_OK }]);
    await makeAdapter('tbl1', 'http://192.168.1.8:8080/', true).testConnection();
    expect(calls[0].url).toBe('http://192.168.1.8:8080/open-apis/auth/v3/tenant_access_token/internal');
  });
});

describe('resolveFeishuBaseUrl / normalizeFeishuBaseUrl：地址归一化', () => {
  it('空值回退官方默认地址', () => {
    expect(resolveFeishuBaseUrl()).toBe(FEISHU_DEFAULT_BASE_URL);
    expect(resolveFeishuBaseUrl(null)).toBe(FEISHU_DEFAULT_BASE_URL);
    expect(resolveFeishuBaseUrl('   ')).toBe(FEISHU_DEFAULT_BASE_URL);
  });

  it('去掉末尾斜杠，保留端口与路径前缀', () => {
    expect(resolveFeishuBaseUrl(' https://open.corp.example/ ')).toBe('https://open.corp.example');
    expect(resolveFeishuBaseUrl('https://open.corp.example:8443//')).toBe('https://open.corp.example:8443');
    expect(resolveFeishuBaseUrl('https://gw.corp.example/feishu/')).toBe('https://gw.corp.example/feishu');
  });

  it('本机 http 放行（仅联调用）', () => {
    expect(resolveFeishuBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(resolveFeishuBaseUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
  });

  it('未确认的内网 http、缺协议、非 http(s) 协议一律归一为 notFound', () => {
    for (const input of ['http://192.168.1.8', 'open.corp.example', 'ftp://open.corp.example', 'https://']) {
      try {
        resolveFeishuBaseUrl(input);
        expect.unreachable(`should throw: ${input}`);
      } catch (error) {
        expect(error).toMatchObject({ kind: 'notFound' });
      }
    }
  });

  it('确认后放行内网 http，并仍归一化端口与路径', () => {
    expect(resolveFeishuBaseUrl('http://192.168.1.8:8080/feishu/', true)).toBe('http://192.168.1.8:8080/feishu');
  });

  it('normalizeFeishuBaseUrl：官方地址与空值归一为 null，自定义地址归一化返回', () => {
    expect(normalizeFeishuBaseUrl()).toBeNull();
    expect(normalizeFeishuBaseUrl('')).toBeNull();
    expect(normalizeFeishuBaseUrl('https://open.feishu.cn/')).toBeNull();
    expect(normalizeFeishuBaseUrl('https://open.corp.example/')).toBe('https://open.corp.example');
  });
});
