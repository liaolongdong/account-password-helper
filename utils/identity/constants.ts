/**
 * 身份信息库领域常量（纯常量，无存储/加密依赖）
 *
 * 存储键名不在此重复：单一事实来源为 `utils/storageKeys.ts` 的
 * `STORAGE_KEYS.IDENTITY`，由 `utils/storage/identityCrud.ts` 引用。
 */
import type { IdentityCategory } from './types';

/** 单用户身份条目数上限（超出拒绝新增；仅影响一次性解密批大小） */
export const MAX_IDENTITIES = 30;

/** 每条记录的自定义字段数量上限 */
export const MAX_CUSTOM_FIELDS = 10;

/**
 * 单个导入文件的字节上限（读盘前的第一道闸门）
 *
 * 与密码库 `utils/backup/constants.ts` 的 `MAX_PASSWORD_IMPORT_INPUT_BYTES` 同口径，
 * 但按身份库实际容量重算：`MAX_IDENTITIES = 30` 条 × 每条最坏
 * （10 个自定义字段 × `MAX_FIELD_VALUE_LEN` 200 + 标签 30 + 备注 1000 ≈ 3,030 字符），
 * 全 CJK 按 UTF-8 每字符 3 字节计 ≈ 273 KB；`.aphid` 只多 28 字节 salt/iv 头，
 * 明文 `.json` 只多 JSON 转义。4 MB 在其上留约 15 倍余量，合法自导出永不命中。
 *
 * 条数与逐字段上限都要等整份文件读进内存并解析后才生效，挡不住「一次读取把
 * 任意大的输入拉进内存」这一步，故本闸门设在取字节之前。
 */
export const MAX_IDENTITY_IMPORT_INPUT_BYTES = 4 * 1024 * 1024;

/** 自定义字段标签长度上限（字符） */
export const MAX_LABEL_LEN = 30;

/** 自定义字段值长度上限（字符） */
export const MAX_FIELD_VALUE_LEN = 200;

/** 备注长度上限（字符），与 PasswordEntry.remark 同口径 */
export const MAX_REMARK_LEN = 1000;

/** 记录 id 长度上限（字符）：合法 id 由 generateId() 产出（`uuid-<36>`，约 41 字符），
 *  此处给足余量，仅用于约束不可信导入输入、防止无界字符串 */
export const MAX_ID_LEN = 64;

/** 类别展示顺序（数组顺序即 UI 顺序） */
export const CATEGORY_ORDER = [
  'person',
  'id_card',
  'bank_card',
  'address',
] as const satisfies readonly IdentityCategory[];

/** 身份信息备份容器 kind 标识（区分于密码库的 .aph） */
export const APHID_KIND = 'aphid';

/** 身份信息备份容器格式版本 */
export const APHID_VERSION = 1;
