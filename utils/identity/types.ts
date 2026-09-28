/**
 * 身份信息库（Identity Vault）领域类型
 *
 * 刻意与密码库（PasswordEntry）完全分离：身份库整块加密，落盘形状只有
 * id / encryptedPayload / createTime / updateTime 四个明文键（全部不可识别），
 * 其余字段（含 category）一律进密文，避免泄露「用户存了一张银行卡」这类事实。
 */

/** 身份信息类别（进密文，不明文落盘） */
export type IdentityCategory = 'person' | 'id_card' | 'bank_card' | 'address';

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
