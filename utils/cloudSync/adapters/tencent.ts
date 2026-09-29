/**
 * 腾讯文档智能表 Smartsheet OpenAPI v2 适配器（设计规格 §3.1、§4）
 *
 * 平台事实（按官方文档核实）：
 * - 域名 `https://docs.qq.com`，鉴权用三个独立 Header `Access-Token` / `Client-Id` /
 *   `Open-Id`，**不是** `Authorization: Bearer`；
 * - 无换取 token 接口，凭证由用户在开放平台手动生成后粘贴，需持久化（加密）；
 * - 增删改查共用同一 POST 路径，靠 body 顶层键区分（`getFields` / `addFields` /
 *   `getRecords` / `addRecords` / `updateRecords` / `deleteRecords`）；
 * - 文本字段值是数组 `[{ type: 'text', text: '...' }]`，数字字段是裸数字；
 * - record 自带 `updateTime`（字符串毫秒），LWW 直接读元数据，不建系统字段。
 *
 * ⚠️ 联调状态：本机实测凭证可用性时平台返回 `ret=59000`
 * "Requests from Wechat account are rejected by WeCom service"——个人微信账号被智能表
 * OpenAPI 拒绝，属平台账号类型限制，代码无法绕过。因此**本适配器的请求/响应形状
 * 尚未经真实调用验证**，全部集中在 `PLATFORM` 注释处，联调时按实际报文校正即可，
 * 上层（diff/syncEngine）不受影响。
 */
import { CloudSyncError } from '../errors';
import type {
  AdapterOptions,
  BatchResult,
  CloudRow,
  SchemaCheckResult,
  TableAdapter,
  TableFieldSpec,
  TableMeta,
  TableSpec,
  TencentCredentials,
  UpsertRow,
} from '../types';
import { chunkItems, isTransientStatus, requestWithRetry } from './httpClient';
import { normalizeServerBaseUrl, resolveServerBaseUrl } from './serverAddress';

/** 官方 SaaS 开放平台地址 */
export const TENCENT_DEFAULT_BASE_URL = 'https://docs.qq.com';

/** 单次批量写入/删除建议上限（官方建议 ≤500） */
const BATCH_LIMIT = 500;

/** 分页单页上限 */
const PAGE_SIZE = 500;

/** 可重试的 HTTP/业务错误码 */
const RETRYABLE_CODES = new Set<number>([429]);

/** 构造参数 */
export interface TencentAdapterInit {
  fileId: string;
  /** 未建子表前为 null，建表成功后由调用方回填 */
  sheetId: string | null;
  /** 私有化部署的开放平台地址；留空或 null 使用官方 SaaS 地址 */
  baseUrl?: string | null;
  /** HTTP 明文传输已由用户显式确认 */
  allowInsecure?: boolean;
  credentials: TencentCredentials;
  options?: AdapterOptions;
}

/**
 * 归一化腾讯文档开放平台地址
 *
 * 空值回退官方地址；非法、非 http(s) 或未确认的内网 HTTP 地址抛 `notFound`。
 */
export function resolveTencentBaseUrl(input?: string | null, allowInsecure = false): string {
  return resolveServerBaseUrl(input, TENCENT_DEFAULT_BASE_URL, allowInsecure);
}

/** 把用户填写地址归一为可入库形态；官方地址与空值返回 `null` */
export function normalizeTencentBaseUrl(input?: string | null, allowInsecure = false): string | null {
  return normalizeServerBaseUrl(input, TENCENT_DEFAULT_BASE_URL, allowInsecure);
}

/** 腾讯响应外壳：平台统一用 `ret` 表示业务结果，`0` 为成功 */
interface TencentResponse<T> {
  ret: number;
  msg?: string;
  data?: T;
}

interface TencentField {
  fieldID?: string;
  fieldId?: string;
  fieldTitle?: string;
  title?: string;
  type?: string | number;
  fieldType?: string | number;
}

interface TencentRecord {
  recordID?: string;
  recordId?: string;
  updateTime?: string | number;
  values?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}

/** 平台字段类型名 ↔ 领域类型 */
const PLATFORM = {
  /** 平台文本类型标识（联调时按实际报文校正） */
  text: 'text',
  /** 平台数字类型标识 */
  number: 'number',
} as const;

/**
 * 把领域扁平字段编码为腾讯要求的平台值格式
 *
 * 数字字段传裸数字，其余一律包装为 `[{type:'text',text}]` 数组——这是与飞书
 * 最大的值格式差异，必须在适配器内消化，不能泄漏到上层。
 */
export function encodeFields(fields: Record<string, string | number>): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    encoded[key] = typeof value === 'number' ? value : [{ type: 'text', text: String(value) }];
  }
  return encoded;
}

/** 把腾讯字段值归一化为扁平字符串/数字 */
export function fromTencentValue(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text: unknown }).text ?? '');
        return '';
      })
      .join('');
  }
  return String(value);
}

/** 把腾讯业务错误码映射为领域错误类别 */
export function mapTencentErrorCode(code: number, msg: string): CloudSyncError {
  switch (code) {
    case 10313:
    case 10302:
    case 10303:
    case 37019:
      return new CloudSyncError('invalidCredential', msg, code);
    case 59000:
      // 个人微信账号被智能表 OpenAPI 拒绝：属平台账号类型限制，非用户可修复的凭证错误
      return new CloudSyncError('permission', msg, code);
    case 429:
      return new CloudSyncError('rateLimit', msg, code);
    case 40301:
      return new CloudSyncError('permission', msg, code);
    default:
      return new CloudSyncError('unknown', msg, code);
  }
}

/** 腾讯文档智能表适配器 */
export class TencentAdapter implements TableAdapter {
  readonly provider = 'tencent' as const;

  private fileId: string;
  private sheetId: string | null;
  private credentials: TencentCredentials;
  private options: AdapterOptions;
  /** 本次实例生效的开放平台地址（官方 SaaS 或私有化部署） */
  private baseUrl: string;

  constructor(init: TencentAdapterInit) {
    this.fileId = init.fileId;
    this.sheetId = init.sheetId;
    this.credentials = init.credentials;
    this.options = init.options ?? {};
    this.baseUrl = resolveTencentBaseUrl(init.baseUrl, init.allowInsecure === true);
  }

  /** 建子表成功后回填 sheetID */
  setSheetId(sheetId: string): void {
    this.sheetId = sheetId;
  }

  /** 鉴权头：三个独立 Header（测试连接复用三端点的最小请求） */
  private headers(hasBody: boolean): Record<string, string> {
    return {
      'Access-Token': this.credentials.accessToken,
      'Client-Id': this.credentials.clientId,
      'Open-Id': this.credentials.openId,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  /**
   * 统一请求入口（GET 列表 / POST 单路径 body 键区分）
   *
   * 平台错误既可能通过 HTTP 状态码表达，也可能通过 `ret` 字段表达，故两者都映射。
   */
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const { response, json } = await requestWithRetry(`${this.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: this.options.signal,
      onApiCall: this.options.onApiCall,
      shouldRetry: context =>
        isTransientStatus(context.status, context.networkError) ||
        (typeof context.code === 'number' && RETRYABLE_CODES.has(context.code)),
    });

    const payload = json as TencentResponse<T> | null;
    if (!payload) {
      if (!response.ok) throw new CloudSyncError('network', `HTTP ${response.status}`, response.status);
      throw new CloudSyncError('unknown', 'unparsable response', response.status);
    }
    if (typeof payload.ret === 'number' && payload.ret !== 0) {
      throw mapTencentErrorCode(payload.ret, payload.msg ?? 'tencent error');
    }
    if (!response.ok) throw new CloudSyncError('network', `HTTP ${response.status}`, response.status);
    return (payload.data ?? ({} as T)) as T;
  }

  /**
   * 校验凭证有效性
   *
   * 无独立的 token 校验端点，故以「列出子表」作为最小鉴权探测：凭证错误会返回
   * 10302/10303/10313/37019，文档不存在会返回文档类错误码，两者可区分。
   */
  async testConnection(): Promise<void> {
    await this.listTables();
  }

  /** 列出文件下的子表（分页遍历） */
  async listTables(): Promise<TableMeta[]> {
    const tables: TableMeta[] = [];
    let offset = 0;
    for (;;) {
      const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
      const data = await this.request<{
        sheets?: { sheetID?: string; sheetId?: string; title?: string; name?: string }[];
        hasMore?: boolean;
        total?: number;
      }>(`/openapi/smartbook/v2/files/${encodeURIComponent(this.fileId)}/sheets?${query.toString()}`);
      const items = data.sheets ?? [];
      for (const item of items) {
        const id = item.sheetID ?? item.sheetId;
        if (id) tables.push({ id, name: item.title ?? item.name ?? id });
      }
      const hasMore = data.hasMore ?? (typeof data.total === 'number' ? offset + items.length < data.total : false);
      if (!hasMore || items.length === 0) break;
      offset += items.length;
    }
    return tables;
  }

  /** 创建子表并补齐字段 */
  async createTable(spec: TableSpec): Promise<TableMeta> {
    const created = await this.request<{ properties?: { sheetId?: string; sheetID?: string } }>(
      `/openapi/smartbook/v2/files/${encodeURIComponent(this.fileId)}/sheets`,
      {
        // PLATFORM: 建表请求体顶层键为 addSheet
        addSheet: { title: spec.name, rowCount: 0, columnCount: 0 },
      },
    );
    const sheetId = created.properties?.sheetId ?? created.properties?.sheetID;
    if (!sheetId) throw new CloudSyncError('unknown', 'addSheet returned no sheet id');
    this.sheetId = sheetId;

    await this.addFields(spec.fields);
    return { id: sheetId, name: spec.name };
  }

  /** 添加字段（腾讯不支持隐藏字段时按规格保留可见的末位 ID 列） */
  private async addFields(fields: TableFieldSpec[]): Promise<void> {
    if (fields.length === 0) return;
    await this.request(this.sheetPath(), {
      // PLATFORM: 字段创建请求体
      addFields: {
        fields: fields.map(field => ({
          fieldTitle: field.name,
          fieldType: field.type === 'number' ? PLATFORM.number : PLATFORM.text,
        })),
      },
    });
  }

  /** 读取字段 */
  private async listFields(): Promise<TableFieldSpec[]> {
    const data = await this.request<{ fields?: TencentField[] }>(this.sheetPath(), {
      // PLATFORM: 查询字段请求体
      getFields: {},
    });
    return (data.fields ?? []).map(field => {
      const rawType = field.fieldType ?? field.type;
      return {
        name: String(field.fieldTitle ?? field.title ?? ''),
        type: rawType === PLATFORM.number || rawType === 2 ? 'number' : 'text',
      };
    });
  }

  /** 校验既有表结构 */
  async checkTableSchema(requiredFields: TableFieldSpec[]): Promise<SchemaCheckResult> {
    const fields = await this.listFields();
    const byName = new Map(fields.map(f => [f.name, f]));
    const missingFields = requiredFields
      .filter(spec => {
        const actual = byName.get(spec.name);
        return !actual || actual.type !== spec.type;
      })
      .map(spec => spec.name);
    return missingFields.length === 0 ? { ok: true } : { ok: false, missingFields };
  }

  /** 全量读取记录（分页遍历） */
  async getRows(): Promise<CloudRow[]> {
    const rows: CloudRow[] = [];
    let offset = 0;
    for (;;) {
      const data = await this.request<{
        records?: TencentRecord[];
        hasMore?: boolean;
        next?: number;
        total?: number;
      }>(this.sheetPath(), {
        // PLATFORM: 查询记录请求体
        getRecords: { offset, limit: PAGE_SIZE },
      });
      const items = data.records ?? [];
      for (const record of items) {
        const recordId = record.recordID ?? record.recordId ?? '';
        if (!recordId) continue;
        const raw = record.values ?? record.fields ?? {};
        const fields: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(raw)) fields[key] = fromTencentValue(value);
        rows.push({
          recordId,
          fields,
          cloudModifiedAt: Number(record.updateTime ?? 0) || 0,
        });
      }
      const hasMore = data.hasMore ?? (typeof data.total === 'number' ? offset + items.length < data.total : false);
      if (!hasMore || items.length === 0) break;
      offset = typeof data.next === 'number' ? data.next : offset + items.length;
    }
    return rows;
  }

  /** 批量新增/更新（按 500 分批，批间串行） */
  async batchUpsert(rows: UpsertRow[]): Promise<BatchResult> {
    const result: BatchResult = { succeeded: [], failed: [] };
    const creates = rows.filter(row => !row.recordId);
    const updates = rows.filter(row => row.recordId);

    for (const batch of chunkItems(creates, BATCH_LIMIT)) {
      const data = await this.request<{ records?: TencentRecord[] }>(this.sheetPath(), {
        addRecords: { records: batch.map(row => ({ values: encodeFields(row.fields) })) },
      });
      batch.forEach((row, index) => {
        const recordId = data.records?.[index]?.recordID ?? data.records?.[index]?.recordId;
        if (recordId) result.succeeded.push({ recordId, businessId: row.businessId });
        else
          result.failed.push({
            businessId: row.businessId,
            code: 'no-record-id',
            message: 'addRecords returned no recordID',
          });
      });
    }

    for (const batch of chunkItems(updates, BATCH_LIMIT)) {
      await this.request(this.sheetPath(), {
        updateRecords: { records: batch.map(row => ({ recordID: row.recordId, values: encodeFields(row.fields) })) },
      });
      for (const row of batch) result.succeeded.push({ recordId: row.recordId, businessId: row.businessId });
    }

    return result;
  }

  /** 批量删除（recordID 不存在视为业务成功） */
  async batchDelete(recordIds: string[]): Promise<BatchResult> {
    const result: BatchResult = { succeeded: [], failed: [] };
    for (const batch of chunkItems(recordIds, BATCH_LIMIT)) {
      await this.request(this.sheetPath(), { deleteRecords: { records: batch } });
      for (const recordId of batch) result.succeeded.push({ recordId, businessId: '' });
    }
    return result;
  }

  private sheetPath(): string {
    if (!this.sheetId) throw new CloudSyncError('notFound', 'sheet id not configured');
    return `/openapi/smartbook/v2/files/${encodeURIComponent(this.fileId)}/sheets/${encodeURIComponent(this.sheetId)}`;
  }
}
