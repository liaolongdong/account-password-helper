/**
 * 密码库导入边界的容量与长度上界（单一事实来源）
 *
 * 导入文件（未加密 CSV/JSON、加密 `.aph` 备份）均为不可信输入：与身份库
 * `utils/identity/constants.ts` 的 `MAX_IDENTITIES` / `MAX_*_LEN` 同口径，
 * 在解析边界施加条数与逐字段长度上限，避免超大文件一次性写穿 storage 配额、
 * 或在同步解析时触发无界内存分配。
 *
 * 取值刻意放宽到「个人本地保险库 realistically 不会触及」的量级，只作为
 * 失控/恶意文件的兜底闸门，而非对正常数据的规整——合法自导出永不命中。
 */

/** 单次导入允许的最大条目数 */
export const MAX_PASSWORD_IMPORT_ENTRIES = 10_000;

/** 各文本字段的最大字符长度（按字段用途分别设定） */
export const MAX_USERNAME_LEN = 512;
export const MAX_PASSWORD_LEN = 1024;
export const MAX_URL_LEN = 2048;
export const MAX_TAG_LEN = 256;
export const MAX_REMARK_LEN = 8192;
export const MAX_TOTP_LEN = 2048;

/** `.aph` / `.json` 备份容器可接受的最高版本号（高于此值属前向不兼容文件） */
export const MAX_BACKUP_VERSION = 1;
