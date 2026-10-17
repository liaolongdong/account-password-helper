/**
 * 身份提示的角色词表
 *
 * 页面侧分类器给出的语义角色是开放串（网页 DOM 自报），只有落在这份闭集里的值才允许驱动
 * 气泡，因此单点定义在 `utils/` 供 content 侧引用：角色串经 {@link normalizeIdentityHintRole}
 * 收窄后才交给气泡，不在词表内的一律「这框没有身份语义、不出提示」。
 *
 * 它同时是气泡文案的目录（`cs.identity.role.*`），所以词表与轻量语言包必须同步——
 * 由 `tests/utils/identityHintRoles.test.ts` 钉住。
 *
 * 角色**不跨入口**：2026-10-17 起深链载荷只剩搜索词一个标签，角色不再决定身份库的类别档位
 * （一条条目同时携带证件号、手机号等多个值，预选会把该命中的筛掉）。曾经那份
 * 「角色 → 类别」映射因此失去唯一消费者并删除。
 *
 * @module utils/identity/hintRoles
 */

/**
 * 可提示的身份语义角色
 *
 * 卡类只放三档（2026-10-17 拍板）：卡号、户名、开户行——它们与证件号一样是「库里存着的一条
 * 银行信息」，而有效期与 CVV 属卡类口令，身份库按同一口径把它们当秘密字段加密展示，
 * 让它们进这份词表等于把 CVV 的取值路径挂到页面提示上，因此类型层面就不收录。
 */
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
  'cardNo',
  'cardHolder',
  'cardBank',
] as const;

/** 身份提示角色（由词表推导，新增角色只需改上面那份数组） */
export type IdentityHintRole = (typeof IDENTITY_HINT_ROLES)[number];

const HINT_ROLE_SET: ReadonlySet<string> = new Set<string>(IDENTITY_HINT_ROLES);

/**
 * 收窄分类器给出的角色串
 *
 * 与 `normalizeSiteRuleDomain` / `normalizeSearchKeyword` 同一口径：网页 DOM 是自报环境，
 * 只接受闭合词表内的值，其余（含非字符串、超长串、卡类口令角色）一律按「无角色」处理——
 * 落到调用方就是「这一框不出提示」，而不是「按原样把未知角色画给用户」。
 *
 * @param value 待收窄的原始值
 * @returns 合法角色或 null
 */
export function normalizeIdentityHintRole(value: unknown): IdentityHintRole | null {
  if (typeof value !== 'string' || !HINT_ROLE_SET.has(value)) return null;
  return value as IdentityHintRole;
}
