/**
 * 备份提醒的变更判据（纯函数：零 chrome / Vue / 加密依赖）
 *
 * 既有提醒是纯时间驱动的——闹钟到点就发通知，哪怕这段时间一条数据都没改。本模块提供
 * 「自上次成功备份以来是否真的有过变更」这一判据，让提醒只在有内容可备时出声。
 *
 * ## 为什么不复用 `passwordCrud` 的 `isMetadataOnlyChange`
 *
 * 两者形状相似、答案相反，刻意不合并：
 * - `isMetadataOnlyChange` 回答「这次变更需不需要重新解密」。它的白名单 `METADATA_FIELDS`
 *   含 `tag` / `order` / `updateTime`，因为改这些字段不动密文；
 * - 本模块回答「用户数据是否已与最近一次备份不一致」。改标签、拖排序确实不动密文，
 *   但**会让既有备份过期**，因此必须算作变更。
 *
 * 真正要排除的是**使用痕迹**：`lastUsedAt` / `favoriteUsedAt` 由每次自动填充机械 bump
 * （`flushMetadataUpdates` 还会顺带刷新 `updateTime`，见 `passwordCrud.ts` 的
 * `updateTime: updates.updateTime ?? Date.now()`）。若把它们算作变更，结果就是
 * 「越常用密码越常被提醒备份」，与用户诉求正好相反。
 *
 * 两条判据对同一批字段必须给出相反答案，这一点由 `tests/utils/backupChangeDetection.test.ts`
 * 用同一份输入并排断言，防止后人「顺手合并遍历」时把两份白名单合一：`favorite` / `tag` /
 * `order` 在 `isMetadataOnlyChange` 里为 true（不用重新解密）而在本模块为 true（备份已过期），
 * 语义正好相反；`lastUsedAt` / `favoriteUsedAt` / `updateTime` 则是字面意义上的
 * true（免解密）对 false（免提醒）。
 *
 * ## 为什么身份库另有一条判据
 *
 * 身份记录只有 `id` / `encryptedPayload` / `createTime` / `updateTime` 四个明文键，
 * 没有使用痕迹，所以 `updateTime` 在这里就是可信的变更信号。但仍不能用
 * 「取全库 `max(updateTime)`」代替比对新旧数组——`deleteIdentities` 会把记录移出主列表
 * （软删除进回收站），删掉最新那条后最大值会**变小**，删除因此判不出来。比对
 * `storage.onChanged` 的 oldValue / newValue 才能同时覆盖增、改、删。
 */

/**
 * 密码条目里不代表「用户数据变化」的字段
 *
 * `updateTime` 一并排除：真实编辑总会同时改动别的字段（密文、标签、顺序等），
 * 单看 `updateTime` 只会把使用痕迹落盘误判成变更。
 */
const PASSWORD_USAGE_TRACE_FIELDS: ReadonlySet<string> = new Set(['lastUsedAt', 'favoriteUsedAt', 'updateTime']);

/**
 * 逐条比对两份全量数组，判断差异是否超出「可忽略字段」
 *
 * @param oldValue 变更前全量条目（`storage.onChanged` 的 oldValue，首次写入时为 undefined）
 * @param newValue 变更后全量条目
 * @param ignorable 差异落在这些字段内即视为「无相关变更」
 * @returns true 表示发生了值得提醒备份的变更
 */
function hasRelevantArrayChange(oldValue: unknown, newValue: unknown, ignorable: ReadonlySet<string>): boolean {
  // 形状不明（含首次写入时 oldValue 为 undefined）一律保守判为「有变更」：
  // 备份提醒漏报的代价是用户丢数据，误报的代价只是多一条通知。
  if (!Array.isArray(oldValue) || !Array.isArray(newValue)) return true;
  // 长度变化即增删
  if (oldValue.length !== newValue.length) return true;

  for (let index = 0; index < newValue.length; index += 1) {
    const oldEntry = oldValue[index] as Record<string, unknown> | undefined;
    const newEntry = newValue[index] as Record<string, unknown> | undefined;
    if (!oldEntry || !newEntry) return true;
    // id 序列错位即重排或增删（拖拽排序会同时改 `order`，两条都能抓到）
    if (oldEntry.id !== newEntry.id) return true;

    const keys = new Set([...Object.keys(oldEntry), ...Object.keys(newEntry)]);
    for (const key of keys) {
      if (ignorable.has(key)) continue;
      if (oldEntry[key] !== newEntry[key]) return true;
    }
  }
  return false;
}

/**
 * 判断一次 PASSWORDS 全量写入是否值得提醒备份
 *
 * @param oldValue 变更前全量条目
 * @param newValue 变更后全量条目
 * @returns true 表示自上次以来用户数据发生了变化（增 / 删 / 改 / 重排 / 重加密）
 */
export function isBackupRelevantPasswordChange(oldValue: unknown, newValue: unknown): boolean {
  return hasRelevantArrayChange(oldValue, newValue, PASSWORD_USAGE_TRACE_FIELDS);
}

/**
 * 身份记录里不参与比对的字段：**没有**
 *
 * 身份库不记使用痕迹，四个明文键任一变化都意味着数据变了。这里给一个空集，
 * 让两条判据共用同一套遍历实现，同时把「身份库无可忽略字段」写成显式事实。
 */
const IDENTITY_IGNORABLE_FIELDS: ReadonlySet<string> = new Set();

/**
 * 判断一次 IDENTITY 全量写入是否值得提醒备份
 *
 * @param oldValue 变更前全量记录
 * @param newValue 变更后全量记录
 * @returns true 表示身份数据发生了变化（增 / 删 / 改 / 换主密码重加密）
 */
export function isBackupRelevantIdentityChange(oldValue: unknown, newValue: unknown): boolean {
  return hasRelevantArrayChange(oldValue, newValue, IDENTITY_IGNORABLE_FIELDS);
}

/** 密码备份提醒的判定输入（全部来自 storage 时间戳，无条目内容） */
export interface PasswordBackupReminderInput {
  /** 最近一次「与备份相关」的密码变更时间戳；本功能上线前的存量数据为 null */
  lastChangeAt: number | null;
  /** 最近一次通过完整性自检的 `.aph` 导出时间戳；从未导出时为 null */
  lastVerifiedBackupAt: number | null;
  /**
   * 兜底下限（毫秒）：距上次成功备份超过此值即提醒，与有无变更无关
   *
   * 没有这一条，「长期不改密码的重度用户」会永远收不到提醒，而他们恰恰是
   * 换机 / 重装时最容易丢数据的一群人。取值沿用既有的 `autoBackupIntervalDays`。
   */
  floorMs: number;
  /** 当前时间（由调用方注入，便于测试） */
  now: number;
}

/**
 * 密码备份提醒的判定结果
 *
 * - `'changed'`：自上次成功备份后有内容变更
 * - `'stale'`：无变更，但距上次成功备份已超过兜底下限（含从未备份过）
 * - `null`：本次不提醒
 */
export type PasswordBackupReminderVerdict = 'changed' | 'stale' | null;

/**
 * 判定这一拍要不要发密码备份提醒
 *
 * 刻意只决定「出声与否」，不改闹钟节奏：调用方在两种结果下都推进
 * `LAST_AUTO_BACKUP_TIME`，因此提醒频率上限与既有实现完全一致。
 *
 * @param input 时间戳与下限
 * @returns 判定结果；`null` 表示跳过本次提醒
 */
export function decidePasswordBackupReminder(input: PasswordBackupReminderInput): PasswordBackupReminderVerdict {
  // 从未成功导出过 .aph：无法证明有备份，保持既有行为（每拍都提醒）
  if (input.lastVerifiedBackupAt === null) return 'stale';
  if (input.lastChangeAt !== null && input.lastChangeAt > input.lastVerifiedBackupAt) return 'changed';
  if (input.now - input.lastVerifiedBackupAt > input.floorMs) return 'stale';
  return null;
}

/** 身份库备份提醒的判定输入 */
export interface IdentityBackupPendingInput {
  /** 当前解密后的身份记录（只读 createTime / updateTime 两个明文键） */
  records: ReadonlyArray<{ createTime: number; updateTime: number }>;
  /** 最近一次「与备份相关」的身份变更时间戳；本功能上线前的存量数据为 null */
  lastChangeAt: number | null;
  /** 最近一次**完整**导出加密 `.aphid` 的时间戳；从未导出时为 null */
  lastBackupAt: number | null;
}

/**
 * 判定身份库是否还有「未备份的变更」
 *
 * 两条判据取或，各自补对方的盲区：
 * - `records` 里有 createTime / updateTime 晚于上次备份的条目——即时反映新增与编辑，
 *   不受 Service Worker 写时间戳的先后影响（弹窗刚改完就读，不会有竞态假阴性）；
 * - `lastChangeAt` 晚于上次备份——补上删除，因为删除会让记录消失、
 *   单看 `records` 反而「看起来都已备份」。
 *
 * @param input 记录与两个时间戳
 * @returns true 表示应当展示备份提醒
 */
export function hasPendingIdentityBackup(input: IdentityBackupPendingInput): boolean {
  if (input.records.length === 0) return false;

  // 从未完整导出过：只要有条目就提醒（含本功能上线前既有的存量数据）
  if (input.lastBackupAt === null) return true;

  const touchedAfterBackup = input.records.some(
    record => record.createTime > input.lastBackupAt! || record.updateTime > input.lastBackupAt!,
  );
  if (touchedAfterBackup) return true;

  return input.lastChangeAt !== null && input.lastChangeAt > input.lastBackupAt;
}
