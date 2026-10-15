/**
 * 身份提示的跨入口角色词表
 *
 * 页面侧分类器与 Options 侧之间只允许流动「语义角色」这一个标签，它是判别联合的
 * 取值集合，因此在 `utils/` 里单点定义，content / background / options 三方共用：
 * 网页 DOM 是自报环境，角色串经 {@link normalizeIdentityHintRole} 收窄后才进 switch，
 * 不在词表内的值一律降级为「不带提示打开」。
 *
 * 卡类角色（`cardNo` / `cardExp` / `cardCvv`）**刻意缺席**：按既有拍板银行卡信息
 * 不走身份提示路径，把它们排除在类型层面而不是「运行时记得别发」。
 *
 * @module utils/identity/hintRoles
 */
import type { IdentityCategory } from './types';

/** 允许跨入口传递的身份语义角色 */
export const IDENTITY_HINT_ROLES = [
  'name',
  'givenName',
  'familyName',
  'phone',
  'email',
  'address',
  'region',
  'postal',
  'idNumber',
  'passport',
  'birthday',
  'gender',
  'org',
] as const;

/** 身份提示角色（由词表推导，新增角色只需改上面那份数组） */
export type IdentityHintRole = (typeof IDENTITY_HINT_ROLES)[number];

const HINT_ROLE_SET: ReadonlySet<string> = new Set<string>(IDENTITY_HINT_ROLES);

/**
 * 收窄网页/消息侧带来的角色串
 *
 * 与 `normalizeSiteRuleDomain` / `normalizeSearchKeyword` 同一口径：不可信输入只接受
 * 闭合词表内的值，其余（含非字符串、超长串、卡类角色）一律按「无角色」处理。
 *
 * @param value 待收窄的原始值
 * @returns 合法角色或 null
 */
export function normalizeIdentityHintRole(value: unknown): IdentityHintRole | null {
  if (typeof value !== 'string' || !HINT_ROLE_SET.has(value)) return null;
  return value as IdentityHintRole;
}

/** 角色 → 身份库类别（决定打开弹窗时预选哪一档过滤） */
const ROLE_CATEGORY: Record<IdentityHintRole, IdentityCategory> = {
  name: 'person',
  givenName: 'person',
  familyName: 'person',
  phone: 'person',
  email: 'person',
  birthday: 'person',
  gender: 'person',
  org: 'person',
  idNumber: 'id_card',
  passport: 'id_card',
  address: 'address',
  region: 'address',
  postal: 'address',
};

/**
 * 取角色对应的身份库类别
 *
 * 只覆盖 `person` / `id_card` / `address` 三类：`bank_card` 不在提示路径内（卡类角色
 * 已被 `IDENTITY_HINT_ROLES` 排除），因此 `Record` 完备、无需运行时兜底。
 * @param role 已收窄的角色
 * @returns 该角色所属的身份库类别，用于弹窗的初始筛选档位
 */
export function identityCategoryForRole(role: IdentityHintRole): IdentityCategory {
  return ROLE_CATEGORY[role];
}
