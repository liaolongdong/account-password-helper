/**
 * 身份信息库（Identity Vault）领域类型
 *
 * 刻意与密码库（PasswordEntry）完全分离：身份库整块加密，落盘形状只有
 * id / encryptedPayload / createTime / updateTime 四个明文键（全部不可识别），
 * 其余字段（含 category）一律进密文，避免泄露「用户存了一张银行卡」这类事实。
 */

/** 身份信息类别（进密文，不明文落盘） */
export type IdentityCategory = 'person' | 'id_card' | 'bank_card' | 'address';

/**
 * 列表排序档位（纯视图偏好，明文单键落盘，不含任何 PII）
 *
 * - `updated` / `created` 记录级时间戳（明文键，无需解密即可比较）；
 * - `category` 按 `constants.ts` 的 `CATEGORY_ORDER` 固定档序分组，不跟随语言包译名，
 *   否则切语言会把顺序换一遍；
 * - `title` 用列表标题（`displayTitle` 回退链）按界面语言排序，走 Intl 拼写排序而非码位序；
 * - `manual` 用户手排：不比较记录本身，只查落盘的 id 顺序数组（`IDENTITY_MANUAL_ORDER`，
 *   明文 `string[]`、上限 30 条），未登记的 id 落到末尾而不会消失。
 */
export type IdentitySortMode = 'updated' | 'created' | 'category' | 'title' | 'manual';

/**
 * 手排档一次移动的落点侧
 *
 * 拖拽用鼠标落点（指针在目标卡上半 / 下半）换算，键盘 Alt+↑ / Alt+↓ 直接给出，
 * 两条写入路径因此共用同一个「移到某张卡的前 / 后」原语。
 */
export type IdentityMoveSide = 'before' | 'after';

/** 自定义字段（label/value 均为用户输入，secret 决定掩码与复制通道） */
export interface IdentityCustomField {
  /** 稳定 ID（generateId()），供 v-for 与删除定位 */
  id: string;
  /** 字段标签，≤ MAX_LABEL_LEN 字符，渲染一律走 textContent */
  label: string;
  /** 字段值，≤ MAX_FIELD_VALUE_LEN 字符 */
  value: string;
  /** true → 默认掩码 + 复制走 copySecretToClipboard */
  secret: boolean;
}

/** 身份条目明文负载（仅存在于解密后的内存与表单 model） */
export interface IdentityPayload {
  /** 负载版本，供前向兼容演进 */
  pv: 1;
  /** 类别；决定表单默认展开字段集，也参与列表过滤 */
  category: IdentityCategory;
  /** 兼作列表标题（displayTitle 回退链起点） */
  name?: string;
  /** 证件号码（护照/通行证可忽略校验位警告） */
  idNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  /** 银行卡号 */
  cardNo?: string;
  /** 发卡行 */
  cardBank?: string;
  /** 持卡人 */
  cardHolder?: string;
  /** 有效期（MM/YY） */
  cardExpiry?: string;
  /** CVV（高敏，默认掩码） */
  cardCvv?: string;
  /** 备注，≤ MAX_REMARK_LEN 字符 */
  remark?: string;
  /** 自定义字段，≤ MAX_CUSTOM_FIELDS 个 */
  customFields?: IdentityCustomField[];
}

/** 落盘形状：只有 4 个明文键，全部不可识别 */
export interface IdentityRecord {
  id: string;
  /** encryptData(JSON.stringify(payload), dataKey) 的密文 */
  encryptedPayload: string;
  createTime: number;
  /** 兼作并发令牌：updateIdentity 据此拒绝过期写 */
  updateTime: number;
}

/** 解密后的内存形状（仅在 Options 上下文，会话失效即销毁） */
export interface IdentityEntry extends IdentityRecord {
  payload: IdentityPayload;
}
