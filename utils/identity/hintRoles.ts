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
 *
 * `serialNumber` 是 2026-10-18 补的**编号族**：学历证书编号、社保电脑号、保单号那一类各自成串、
 * 都不等于身份证号，所以它刻意不冒充 `idNumber`（那正是 2026-10-17 那批账本判「不出提示」的理由），
 * 而用户说的落点是「这些可以放到自定义字段里面」——库里真有一个能被字段名搜到的地方，
 * 于是这一档从沉默翻成提示，代价是它必须自己说明「存哪儿」（见 {@link CUSTOM_FIELD_LANDING_ROLES}）。
 *
 * 同日稍晚，**机构主体的证照号**（统一社会信用代码 / 营业执照号码 / 纳税人识别号那一族）也从沉默
 * 并进这一档：那条闸门还在、方向也没松（这一族永远不许被词典接进 `idNumber`），变的只是出口，
 * 而且只有机构字样写在**这一格自己的标签或 name/id** 上时才进来（判据与理由见
 * `piiClassifier.ts` 的 `orgCredentialHit` 调用处）。所以这一档今天接的是两族写法——
 * 「自己的一串难记编号」与「自己要替机构填的一串机构码」，共同点是库里都没有那一格。
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
  'serialNumber',
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

/**
 * 以「自定义字段」为落点的角色
 *
 * 这一档在库里没有对应的内置字段，两个消费点各自需要它：
 * - 气泡要额外写一句「可以存到自定义字段」，否则用户按提示去库里找「编号」那一格会落空；
 * - 深链的搜索词换成**这一格叫什么**（字段标签文本），用户在自定义字段里写的标签正是同一串，
 *   于是检索面就是他自己起的那个字段名。其余角色的落点仍是库里的内置字段，搜索词取本人姓名。
 *
 * 它是 {@link IDENTITY_HINT_ROLES} 的子集，由 `tests/utils/identityHintRoles.test.ts` 钉住。
 */
export const CUSTOM_FIELD_LANDING_ROLES: readonly IdentityHintRole[] = ['serialNumber'];

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
