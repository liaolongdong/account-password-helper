/**
 * 飞书多维表格 Bitable V1 适配器（设计规格 §3.2、§4）
 *
 * 已按官方文档核实并做过真实凭证联调（token 换取 200 / code=0），关键事实：
 * - 鉴权用自建应用 `app_id` + `app_secret` 换取 `tenant_access_token`（内存缓存、
 *   过期前 30s 预刷新、不落盘）；
 * - 字段类型：1=多行文本、2=数字；`is_unique` 参数不存在，业务唯一性由写入前
 *   前置校验保证；索引列（`is_primary`）不可隐藏，故首列用有业务含义的字段；
 * - 记录查询用官方推荐的 `POST .../records/search`（GET list 为历史接口，规格 E3），
 *   `automatic_fields` 置于**请求体**才返回 `last_modified_time`；
 * - `batch_create` 支持 `client_token`（uuidv4）幂等键：网络层重试复用同一 URL
 *   即复用同一 token，防止「请求已成功但响应超时」时重复写入（规格 §3.2）；
 * - `batch_delete` 响应为逐条 `{deleted, record_id}`，须按条解析；整批因
 *   `1254043`（recordId 不存在）被拒时降级单条删除，不存在视为业务成功（规格 §6.4）；
 * - 批量接口单次上限 500，同表不支持并发写（`1254291`）。
 */
import { CloudSyncError } from '../errors';
import type {
  AdapterOptions,
  BatchResult,
  CloudRow,
  FeishuCredentials,
  SchemaCheckResult,
  TableAdapter,
  TableFieldSpec,
  TableMeta,
  TableSpec,
  UpsertRow,
} from '../types';
import { chunkItems, isTransientStatus, requestWithRetry, type RetryContext } from './httpClient';

const BASE_URL = 'https://open.feishu.cn';

/** 单次批量写入/删除上限 */
const BATCH_LIMIT = 500;

/** 分页单页上限 */
const PAGE_SIZE = 500;

/** 建字段接口限流 10 QPS，循环创建时保持最小间隔 */
const FIELD_CREATE_INTERVAL_MS = 120;

/** token 提前刷新窗口 */
const TOKEN_REFRESH_MARGIN_MS = 30_000;

/** 可重试的业务错误码（限流/写冲突/数据未就绪/超时/重复提交） */
const RETRYABLE_CODES = new Set<number>([1254290, 1254291, 1254607, 1254608, 1255040]);

/** token 失效类错误码：刷新后重试一次 */
const TOKEN_INVALID_CODES = new Set<number>([99991663, 99991661]);

/** 构造参数 */
export interface FeishuAdapterInit {
  appToken: string;
  /** 未建表前为 null，建表成功后由调用方回填 */
  tableId: string | null;
  credentials: FeishuCredentials;
  options?: AdapterOptions;
}

/** 飞书字段类型枚举（本设计只用前两种） */
const FIELD_TYPE = { text: 1, number: 2 } as const;

/** 飞书 API 响应外壳 */
interface FeishuResponse<T> {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
  data?: T;
}

interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
  last_modified_time?: number;
}

interface FeishuField {
  field_id: string;
  field_name: string;
  type: number;
  is_primary?: boolean;
  is_hidden?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 生成标准 uuidv4（飞书 `client_token` 幂等键要求此格式，非法格式返回 1254037）
 *
 * 用于 `batch_create`：网络层重试复用同一 URL 即复用同一 token，防止
 * 「请求已成功但响应超时」时重复写入云端。
 */
function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 把飞书字段值归一化为扁平字符串/数字（屏蔽富文本数组等平台格式） */
function normalizeFieldValue(value: unknown): string | number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // 富文本/多选等结构统一降级为可读文本，不参与任何执行
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text: unknown }).text ?? '');
        return '';
      })
      .join('');
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

/** 把业务错误码映射为领域错误类别 */
export function mapFeishuErrorCode(code: number, msg: string): CloudSyncError {
  if (TOKEN_INVALID_CODES.has(code)) return new CloudSyncError('invalidCredential', msg, code);
  switch (code) {
    case 91402:
    case 1254003:
    case 1254040:
    case 1254041:
    case 1254043:
      return new CloudSyncError('notFound', msg, code);
    case 1254045:
    case 1254015:
      return new CloudSyncError('schema', msg, code);
    case 1254060:
    case 1254061:
    case 1254062:
    case 1254063:
    case 1254064:
    case 1254065:
    case 1254066:
    case 1254067:
    case 1254068:
    case 1254069:
    case 1254103:
      return new CloudSyncError('schema', msg, code);
    case 1254104:
      return new CloudSyncError('unknown', msg, code);
    case 1254130:
      return new CloudSyncError('tooLarge', msg, code);
    case 1254290:
      return new CloudSyncError('rateLimit', msg, code);
    case 1254291:
    case 1254608:
      return new CloudSyncError('writeConflict', msg, code);
    case 1254302:
    case 1254304:
      return new CloudSyncError('permission', msg, code);
    default:
      return new CloudSyncError('unknown', msg, code);
  }
}

/** 飞书多维表格适配器 */
export class FeishuAdapter implements TableAdapter {
  readonly provider = 'feishu' as const;

  private appToken: string;
  private tableId: string | null;
  private credentials: FeishuCredentials;
  private options: AdapterOptions;

  /** tenant_access_token 仅内存缓存，页面销毁即清空 */
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(init: FeishuAdapterInit) {
    this.appToken = init.appToken;
    this.tableId = init.tableId;
    this.credentials = init.credentials;
    this.options = init.options ?? {};
  }

  /** 建表成功后回填 table_id，避免重新探测 */
  setTableId(tableId: string): void {
    this.tableId = tableId;
  }

  /**
   * 换取 tenant_access_token（内存缓存 + 过期前 30s 预刷新）
   *
   * 凭证校验失败（app_id/app_secret 错误）在飞书侧返回业务错误码，需映射为
   * `invalidCredential`，UI 据此引导用户重新录入。
   */
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return this.token;

    const { json } = await requestWithRetry(`${BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.credentials.appId, app_secret: this.credentials.appSecret }),
      signal: this.options.signal,
      onApiCall: this.options.onApiCall,
      shouldRetry: context => isTransientStatus(context.status, context.networkError),
    });

    const body = json as FeishuResponse<never> | null;
    if (!body || body.code !== 0 || !body.tenant_access_token) {
      throw new CloudSyncError('invalidCredential', body?.msg ?? 'token exchange failed', body?.code);
    }
    this.token = body.tenant_access_token;
    this.tokenExpiresAt = Date.now() + (body.expire ?? 7200) * 1000;
    return this.token;
  }

  /**
   * 统一请求入口：注入鉴权头、解析业务码、映射错误
   *
   * token 失效（99991663/99991661）时清空缓存并重试一次；仍失败则抛出凭证错误。
   */
  private async call<T>(
    path: string,
    init: { method?: string; body?: unknown; query?: URLSearchParams } = {},
    allowTokenRetry = true,
  ): Promise<T> {
    const token = await this.ensureToken();
    const suffix = init.query ? `?${init.query.toString()}` : '';
    const { response, json } = await requestWithRetry(`${BASE_URL}${path}${suffix}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: this.options.signal,
      onApiCall: this.options.onApiCall,
      shouldRetry: (context: RetryContext) =>
        isTransientStatus(context.status, context.networkError) ||
        (typeof context.code === 'number' && RETRYABLE_CODES.has(context.code)),
    });

    const body = json as FeishuResponse<T> | null;
    if (!body) {
      if (!response.ok) throw new CloudSyncError('network', `HTTP ${response.status}`, response.status);
      throw new CloudSyncError('unknown', 'unparsable response', response.status);
    }
    if (body.code !== 0) {
      if (TOKEN_INVALID_CODES.has(body.code) && allowTokenRetry) {
        this.token = null;
        this.tokenExpiresAt = 0;
        return this.call<T>(path, init, false);
      }
      throw mapFeishuErrorCode(body.code, body.msg ?? 'feishu error');
    }
    return (body.data ?? ({} as T)) as T;
  }

  /** 校验凭证有效性（仅换取 token，不触碰目标表） */
  async testConnection(): Promise<void> {
    await this.ensureToken();
  }

  /** 列出 Base 下全部数据表（分页遍历） */
  async listTables(): Promise<TableMeta[]> {
    const tables: TableMeta[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: '100' });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.call<{
        items?: { table_id: string; name: string }[];
        page_token?: string;
        has_more?: boolean;
      }>(`/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables?${query.toString()}`);
      for (const item of data.items ?? []) tables.push({ id: item.table_id, name: item.name });
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return tables;
  }

  /**
   * 创建数据表
   *
   * 飞书建表时必须同时提交首列（索引列），其余字段单次创建接口逐个补充
   * （10 QPS，需节流）。
   */
  async createTable(spec: TableSpec): Promise<TableMeta> {
    const [primary, ...rest] = spec.fields;
    if (!primary) throw new CloudSyncError('unknown', 'table spec requires at least one field');

    const created = await this.call<{ table_id: string; name?: string }>(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables`,
      {
        method: 'POST',
        body: {
          table: {
            name: spec.name,
            default_view_name: spec.name,
            fields: [{ field_name: primary.name, type: FIELD_TYPE[primary.type] }],
          },
        },
      },
    );
    const tableId = created.table_id;
    this.tableId = tableId;

    for (const field of rest) {
      await this.createField(tableId, field);
      await sleep(FIELD_CREATE_INTERVAL_MS);
    }
    return { id: tableId, name: spec.name };
  }

  /** 创建单个字段（索引列与隐藏列标记按规格传入） */
  private async createField(tableId: string, field: TableFieldSpec): Promise<void> {
    await this.call(`/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${tableId}/fields`, {
      method: 'POST',
      body: {
        field_name: field.name,
        type: FIELD_TYPE[field.type],
        ...(field.primary ? { is_primary: true } : {}),
        ...(field.hidden ? { is_hidden: true } : {}),
      },
    });
  }

  /** 读取全部字段（分页） */
  private async listFields(): Promise<FeishuField[]> {
    const tableId = this.requireTableId();
    const fields: FeishuField[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: '100' });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.call<{ items?: FeishuField[]; page_token?: string; has_more?: boolean }>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${tableId}/fields?${query.toString()}`,
      );
      fields.push(...(data.items ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return fields;
  }

  /** 校验既有表是否满足所需字段（字段名 + 类型） */
  async checkTableSchema(requiredFields: TableFieldSpec[]): Promise<SchemaCheckResult> {
    const fields = await this.listFields();
    const byName = new Map(fields.map(f => [f.field_name, f]));
    const missingFields = requiredFields
      .filter(spec => {
        const actual = byName.get(spec.name);
        return !actual || actual.type !== FIELD_TYPE[spec.type];
      })
      .map(spec => spec.name);
    return missingFields.length === 0 ? { ok: true } : { ok: false, missingFields };
  }

  /**
   * 全量读取记录（内部按 500 分页遍历）
   *
   * 使用官方推荐的 `POST .../records/search`（GET list 为历史接口，规格 E3）；
   * `automatic_fields` 置于请求体，返回 `last_modified_time` 供 LWW 使用。
   */
  async getRows(): Promise<CloudRow[]> {
    const tableId = this.requireTableId();
    const rows: CloudRow[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.call<{ items?: FeishuRecord[]; page_token?: string; has_more?: boolean }>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${tableId}/records/search`,
        { method: 'POST', body: { automatic_fields: true }, query },
      );
      for (const record of data.items ?? []) {
        const fields: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(record.fields ?? {})) fields[key] = normalizeFieldValue(value);
        rows.push({
          recordId: record.record_id,
          fields,
          cloudModifiedAt: typeof record.last_modified_time === 'number' ? record.last_modified_time : 0,
        });
      }
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return rows;
  }

  /** 批量新增/更新（按 500 分批，批间串行） */
  async batchUpsert(rows: UpsertRow[]): Promise<BatchResult> {
    const result: BatchResult = { succeeded: [], failed: [] };
    const creates = rows.filter(row => !row.recordId);
    const updates = rows.filter(row => row.recordId);

    for (const batch of chunkItems(creates, BATCH_LIMIT)) {
      // client_token 幂等键：每批生成一次，网络层重试复用同一 URL（即同一 token），
      // 防止「请求已成功但响应超时」时重复写入（官方文档 + 规格 §3.2）
      const data = await this.call<{ records?: { record_id: string }[] }>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${this.requireTableId()}/records/batch_create`,
        {
          method: 'POST',
          body: { records: batch.map(row => ({ fields: row.fields })) },
          query: new URLSearchParams({ client_token: uuidv4() }),
        },
      );
      // 飞书批量接口按入参顺序返回 records；缺失项记为失败而不是猜测成功
      batch.forEach((row, index) => {
        const recordId = data.records?.[index]?.record_id;
        if (recordId) result.succeeded.push({ recordId, businessId: row.businessId });
        else
          result.failed.push({
            businessId: row.businessId,
            code: 'no-record-id',
            message: 'batch_create returned no record_id',
          });
      });
    }

    for (const batch of chunkItems(updates, BATCH_LIMIT)) {
      const data = await this.call<{ records?: { record_id: string }[] }>(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${this.requireTableId()}/records/batch_update`,
        {
          method: 'POST',
          body: { records: batch.map(row => ({ record_id: row.recordId, fields: row.fields })) },
        },
      );
      batch.forEach((row, index) => {
        const recordId = data.records?.[index]?.record_id ?? row.recordId;
        result.succeeded.push({ recordId, businessId: row.businessId });
      });
    }

    return result;
  }

  /**
   * 批量删除（按 500 分批，批间串行）
   *
   * 官方响应为逐条 `{deleted, record_id}`，按条解析：
   * - `deleted: true` → 成功；
   * - 整批因 `1254043`（recordId 不存在）被拒 → 降级单条删除，
   *   单条仍报 1254043 视为**业务成功**（目标状态已达成，规格 §6.4）；
   * - 其余失败 → 记入 failed 供上层重试。
   */
  async batchDelete(recordIds: string[]): Promise<BatchResult> {
    const result: BatchResult = { succeeded: [], failed: [] };
    for (const batch of chunkItems(recordIds, BATCH_LIMIT)) {
      try {
        const data = await this.call<{ records?: { deleted?: boolean; record_id: string }[] }>(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${this.requireTableId()}/records/batch_delete`,
          { method: 'POST', body: { records: batch } },
        );
        const returned = new Map((data.records ?? []).map(item => [item.record_id, item.deleted !== false]));
        for (const recordId of batch) {
          if (returned.get(recordId)) result.succeeded.push({ recordId, businessId: '' });
          else
            result.failed.push({
              businessId: '',
              code: 'delete-not-deleted',
              message: `record ${recordId} not deleted`,
            });
        }
      } catch (error) {
        // 整批被拒且原因为 recordId 不存在：降级单条删除，不存在的视为业务成功
        if (error instanceof CloudSyncError && error.code === 1254043) {
          for (const recordId of batch) {
            try {
              await this.call(
                `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${this.requireTableId()}/records/batch_delete`,
                { method: 'POST', body: { records: [recordId] } },
              );
              result.succeeded.push({ recordId, businessId: '' });
            } catch (singleError) {
              if (singleError instanceof CloudSyncError && singleError.code === 1254043) {
                result.succeeded.push({ recordId, businessId: '' });
              } else {
                throw singleError;
              }
            }
          }
        } else {
          throw error;
        }
      }
    }
    return result;
  }

  private requireTableId(): string {
    if (!this.tableId) throw new CloudSyncError('notFound', 'table id not configured');
    return this.tableId;
  }
}
