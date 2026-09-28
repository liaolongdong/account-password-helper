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
 *
 * 与表单容量（`utils/constants.ts` 的 `PASSWORD_FIELD_LIMITS`）是**有意的两层口径**：
 * 导入侧超容量时既不拒收也不截断（拒收会让用户自己的导出文件回灌不了，截断等于丢凭据），
 * 因此库里可能存在比表单容量更长的历史/外部条目。编辑侧对这类条目的处理是
 * 「按原长度放行、禁止变更长」（`createPasswordFormRules` 的 `initialLengths` 参数），
 * 输入框 `maxlength` 仍是标准容量。新增写入通道时按这个顺序对齐，别在本文件里抄容量值。
 */

/** 单次导入允许的最大条目数 */
export const MAX_PASSWORD_IMPORT_ENTRIES = 10_000;

/**
 * 单个导入文件的字节上限（读盘前的第一道闸门）
 *
 * 条数与逐字段长度上限都要等整份文件解码成字符串并逐行 parse 之后才生效，
 * 因此它们**防不住**「一次 `arrayBuffer()` 把任意大的输入拉进内存」这一步；
 * 本闸门专责把成本挡在读取之前（CSV 走 `arrayBuffer()` + 双编码回退，
 * 峰值同时持有字节缓冲与两份解码文本，比 JSON 更贵）。
 *
 * 取值口径（两条都落在闸门之下）：
 * - 手工录入的数据受 `PASSWORD_FIELD_LIMITS` 约束（用户名 50 + 密码 75 + 网址 100
 *   + 标签 50 + 备注 1000 ≈ 1,300 字符/条），配合 `MAX_PASSWORD_ENTRIES = 2000`
 *   的容量上限，整库自导出最坏约 2000 × 1,300 × 3（备注全是 CJK，UTF-8 每字符 3 字节）
 *   ≈ 7.8 MB，常见量级不足 1 MB；
 * - 经本导入器进来的数据本身就出自一份 ≤ 本闸门的文件，逐字段上限只约束单字段长度、
 *   不放大总量，再导出时只多一层引号与分隔符。
 *
 * 32 MB 在此之上留出 4 倍余量，「合法自导出永不命中」的承诺与本文件其余口径一致。
 */
export const MAX_PASSWORD_IMPORT_INPUT_BYTES = 32 * 1024 * 1024;

/** 各文本字段的最大字符长度（按字段用途分别设定） */
export const MAX_USERNAME_LEN = 512;
export const MAX_PASSWORD_LEN = 1024;
export const MAX_URL_LEN = 2048;
export const MAX_TAG_LEN = 256;
export const MAX_REMARK_LEN = 8192;
export const MAX_TOTP_LEN = 2048;

/** `.aph` / `.json` 备份容器可接受的最高版本号（高于此值属前向不兼容文件） */
export const MAX_BACKUP_VERSION = 1;
