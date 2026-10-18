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
export type IdentityBuiltinFieldKey =
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
  key: IdentityBuiltinFieldKey;
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

/**
 * 列表标题回退链：name ?? cardHolder ?? email ?? phone ?? 类别名
 *
 * 纯函数（`t` 形参注入），供列表 composable 与回收站弹窗共用同一口径——
 * 两处各写一份回退链，会让「同一条目在列表和回收站里叫不同名字」成为静默缺陷。
 */
export function identityDisplayTitle(payload: IdentityPayload, t: Translate): string {
  return (
    payload.name || payload.cardHolder || payload.email || payload.phone || t(`identity.category.${payload.category}`)
  );
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

/**
 * 每一格在真实表单里被叫作什么（中英两侧，静态词表，**不上屏**）
 *
 * 存在的理由是一条实测：库里的严格检索口径是「关键词 ⊆ 那一格显示的名字」，
 * 而用户打进来的是页面上那行字（`联系电话号码` / `社会保障号码` / `Contact Number`）。
 * 拿分类器账本里落在内置档的 102 行真实写法当语料，严格口径命中 **0 行**——
 * 那一串两三字的译名太短，装不下页面愿意写的长说法。于是补一条只在严格检索为空时
 * 才打开的通道：把这行字认成「我要某一格」，词表就是这条通道的全部词汇。
 *
 * 词表刻意**只收页面写法**，与分类器的角色词典同源 curated（见
 * `docs/reports/PII_FIELD_HINT_MATCHING.md` §5.7 与 §12 的漂移守卫）：页面提示得出来的那一格，
 * 库里就该搜得到那一格。三条收词规矩：
 * - 不收单字（`号` 这种一个字符能把整库放宽）；
 * - 不收别人的名字（`收货人` / `乘客` / `监护人` 在分类器侧本就不归本人，挂到「姓名」上是错的）；
 * - 不收严格口径已经覆盖的裸短词（`name` 单独一条没有增量，却会让长句里的 `name` 也来放宽）。
 */
export const IDENTITY_FIELD_NAME_STEMS: Readonly<Record<IdentityBuiltinFieldKey, readonly string[]>> = {
  name: ['姓名', '真实姓名', '本人姓名', '名字', 'full name', 'real name', 'true name', 'your name', 'preferred name'],
  idNumber: [
    '证件号',
    '证件号码',
    '身份证号',
    '社会保障号',
    '社保号',
    '军官证',
    '警官证',
    '士兵证',
    '驾驶证号',
    '回乡证',
    '居住证',
    '台胞证',
    '个人税号',
    '个税号',
    'id number',
    'identity number',
    'identification number',
    'national id',
    'personal id',
    'tax number',
    'ssn',
    'social security number',
    'social security no',
    '医保卡',
    '社会保障卡',
    '个税编号',
    '社保卡号',
    '社保编号',
    'identity card',
    'id card',
    'medicare number',
    'medicare no',
    'health insurance number',
    'health insurance no',
    'nino',
    'driving licence',
    'driving license',
    'drivers license',
    'driver license',
    'license number',
    'licence number',
  ],
  phone: [
    '手机号',
    '手机号码',
    '联系电话',
    '联系号码',
    '电话号码',
    '手机',
    '电话',
    'mobile',
    'phone number',
    'telephone',
    'cell phone',
    'contact number',
    'landline',
  ],
  email: ['邮箱', '电子邮箱', '邮件地址', '邮箱地址', '信箱', '电子邮件', 'email', 'e-mail'],
  address: [
    '住址',
    '居住地',
    '地址',
    '详细地址',
    '通讯地址',
    '家庭地址',
    '户籍地址',
    '街道',
    '门牌',
    '小区',
    '楼栋',
    '单元',
    '房间号',
    '楼层',
    'street address',
    'delivery address',
    'home address',
    'work address',
    'mailing address',
    'billing address',
    'shipping address',
    'residential address',
    '邮寄地址',
    '账单地址',
    '收货地址',
    '居住地址',
    'address line',
    'house number',
    'apartment',
  ],
  cardNo: [
    '银行卡号',
    '银行账号',
    '银行帐号',
    '信用卡号',
    '借记卡号',
    '储蓄卡号',
    '卡号',
    '账户号',
    '银行账户',
    'card number',
    'card no',
    'bank account',
    'iban',
    'sort code',
    'routing number',
  ],
  cardBank: ['开户行', '开户银行', '发卡行', '银行名称', '所属银行', 'bank name', 'issuing bank', 'beneficiary bank'],
  cardHolder: [
    '持卡人',
    '持卡人姓名',
    '开户人',
    '户名',
    '开户名',
    '账户姓名',
    '开户姓名',
    'cardholder',
    'card holder',
    'account holder',
  ],
  cardExpiry: ['有效期', '到期日', '失效日期', 'expiration', 'expiry', 'valid thru', 'expire'],
  // 「验证码」刻意不收：那一串是短信/邮箱动态口令，不是卡背那三位数。
  cardCvv: ['安全码', '安全代码', 'cvv', 'cvc', 'cvn'],
  remark: ['备注', '附言', '注释', '说明', 'note', 'notes'],
};

/** 名字通道参与比较的最短长度：低于它的字符串会把不相干的长句一并放宽 */
const MIN_NAME_LENGTH = 2;

/**
 * 这一格可能被叫作的所有写法：屏上那串译名打头，后接中英词表。
 *
 * 译名排第一是有讲究的——用户打的如果就是屏上那几个字，严格检索早就命中了，
 * 轮不到放宽；把它放进名字空间是为了让这条通道的判据只有一条（见 {@link requestedFieldName}）。
 *
 * @param fieldKey 内置字段键
 * @param label 当前界面语言下那一格显示的名字
 * @returns 去空白、去重后的名字集合（label 恒在第 0 位）
 */
export function identityFieldNameSet(fieldKey: IdentityBuiltinFieldKey, label: string): string[] {
  const names = [label.trim(), ...IDENTITY_FIELD_NAME_STEMS[fieldKey].map(stem => stem.trim())];
  return [...new Set(names.filter(name => name.length > 0))];
}

/**
 * 「用户打进来的这行字」是不是在要这些格子中的某一格
 *
 * 判据是**名字整串出现在关键词里**（`名字 ⊆ 关键词`），与严格检索的方向相反：
 * 页面愿意写 `联系电话号码`，而库里那一格只叫 `手机号`。比较不分语言（词表中英两侧都收，
 * 英文界面里的中文页面照样认得出），大小写不敏感。
 *
 * 只回答「这句话是不是某一格的名字」这一件事，所以**不做拼音与首字母**：
 * `lxdh` 不是任何一格的名字，让它落回空态那句出路，比把它猜成「联系电话」更诚实。
 *
 * @param keyword 已 trim 的搜索词
 * @param names 某一格的全部写法（{@link identityFieldNameSet}，或用户自拟的自定义字段名）
 * @returns 任一名字整串出现在关键词里返回 true
 */
export function requestedFieldName(keyword: string, names: readonly string[]): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  return names.some(name => name.trim().length >= MIN_NAME_LENGTH && kw.includes(name.trim().toLowerCase()));
}
