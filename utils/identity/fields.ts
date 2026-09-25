/**
 * 身份信息字段展示模型（纯函数，零 Vue / 零存储；i18n 以 `t` 形参注入）
 *
 * 把「哪些字段是机密、如何展开为字段行、如何拼成整卡剪贴板文本」这类判定从列表弹窗
 * 上移至此，供 composable（批量展开 / 收起）与弹窗（渲染 / 复制）共享同一事实来源，
 * 避免两处对「含机密字段」的理解分叉。
 *
 * @module utils/identity/fields
 */
import type { IdentityEntry, IdentityPayload } from './types';

/** i18n 取词函数（由调用方注入，使本模块可脱离 Vue 生命周期单测） */
type Translate = (key: string) => string;

/** 内置字段的键（均为 IdentityPayload 上的字符串字段） */
type BuiltinFieldKey =
  | 'name'
  | 'idNumber'
  | 'phone'
  | 'email'
  | 'address'
  | 'cardNo'
  | 'cardBank'
  | 'cardHolder'
  | 'cardExpiry'
  | 'cardCvv'
  | 'remark';

/** 内置字段的展示定义（secret 决定默认掩码与复制通道） */
interface IdentityFieldDef {
  key: BuiltinFieldKey;
  secret: boolean;
}

/** 内置字段展示定义（数组顺序即列表展示顺序） */
export const IDENTITY_FIELD_DEFS: readonly IdentityFieldDef[] = [
  { key: 'name', secret: false },
  { key: 'idNumber', secret: true },
  { key: 'phone', secret: false },
  { key: 'email', secret: false },
  { key: 'address', secret: false },
  { key: 'cardNo', secret: true },
  { key: 'cardBank', secret: false },
  { key: 'cardHolder', secret: false },
  { key: 'cardExpiry', secret: false },
  { key: 'cardCvv', secret: true },
  { key: 'remark', secret: false },
];

/** 单条字段行（用于只读展示与整卡复制） */
export interface IdentityFieldRow {
  key: string;
  label: string;
  value: string;
  secret: boolean;
}

/**
 * 该负载是否含任一非空机密字段（内置机密字段或 secret 自定义字段）。
 *
 * 判定口径与 `buildIdentityFieldRows` 严格一致：仅当对应字段为非空字符串时才计入，
 * 从而决定卡级显 / 隐眼睛是否出现，以及批量展开 / 收起的作用范围。
 */
export function hasSecretFields(payload: IdentityPayload): boolean {
  const builtinSecret = IDENTITY_FIELD_DEFS.some(
    def => def.secret && typeof payload[def.key] === 'string' && payload[def.key],
  );
  if (builtinSecret) {
    return true;
  }
  return (payload.customFields ?? []).some(field => field.secret && !!field.value);
}

/** 把条目展开为字段行（仅非空字段；自定义字段附在其后） */
export function buildIdentityFieldRows(entry: IdentityEntry, t: Translate): IdentityFieldRow[] {
  const rows: IdentityFieldRow[] = [];
  for (const def of IDENTITY_FIELD_DEFS) {
    const value = entry.payload[def.key];
    if (typeof value === 'string' && value) {
      rows.push({ key: def.key, label: t(`identity.field.${def.key}`), value, secret: def.secret });
    }
  }
  for (const field of entry.payload.customFields ?? []) {
    if (field.value) {
      rows.push({ key: `custom:${field.id}`, label: field.label || '—', value: field.value, secret: field.secret });
    }
  }
  return rows;
}

/** 把字段行拼成「标签: 值」多行文本（整卡复制到剪贴板的载荷） */
export function formatIdentityCardText(rows: readonly IdentityFieldRow[]): string {
  return rows.map(field => `${field.label}: ${field.value}`).join('\n');
}
