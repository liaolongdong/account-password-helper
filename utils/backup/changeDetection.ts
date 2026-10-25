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

/** `chrome.storage.StorageChange` 的最小结构镜像：本模块不引入 chrome 类型依赖 */
export interface StorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * 一批 `storage.onChanged` 变更是否由「换钥匙」引起（rekey）
 *
 * 修改主密码会把五个加密域整库重加密，并与新的包裹数据密钥**同批**落盘
 * （见 `changeMasterPassword` 第 11 步那次 `chrome.storage.local.set()`）。逐字段比对的
 * `isBackupRelevantPasswordChange` 因此会看到「每条密文都变了」并判为变更，把待备份时间戳
 * 往前推一格——可那只是同一份内容换了一把钥匙加密：`.aph` 用的是导出当时的密码与容器自带
 * salt，与当前主密码无关，备份内容一个字节都没变。不排掉它，用户每改一次主密码就凭空欠一次备份，
 * 徽标与桌面通知会一起报出这个假「待备份」。
 *
 * 判据取「这批 changes 里带着新的校验配置，或 `session_wrapped_data_key` 带着新值出现」：
 * - `master_password_config` 带 `newValue`：只有「首次设置主密码 / 改密 / 离线恢复换钥」这条
 *   链路会写它，用户增删改条目从不触碰；五域整库重加密与它在同一次 `set()` 里落盘，
 *   因此这一条同时覆盖改密与恢复两种形态。
 * - 包裹数据密钥带 `newValue` = 换钥后紧接着发布了新会话密钥，同样是 rekey；
 * - 该键被移除（`newValue === undefined`）是**锁定**语义，绝不能单独算在这里，
 *   否则一次上锁会吞掉紧随其后的真实变更；
 * - 普通解锁也写这两个键，但那次 `set()` 不含 `PASSWORDS` / `IDENTITY`，走不到本判据，
 *   因此不必再区分「首次建会话」与「换钥匙」。
 *
 * 为什么不能只看包裹密钥：离线恢复刻意不建立会话，提交前一步就是 `lockSession()`，
 * 那批整库重加密里根本没有 `session_wrapped_data_key` 的新值——只看它会漏掉恢复路径，
 * 让每次成功恢复都凭空报出一条「待备份」。
 *
 * @param wrappedDataKeyChange 该批 changes 中 `session_wrapped_data_key` 那一项（可缺省）
 * @param masterConfigChange 该批 changes 中 `master_password_config` 那一项（可缺省）
 * @returns true 表示这批变更由密钥建立/轮换引起，不应刷新待备份时间戳
 */
export function isKeyRotationBatch(
  wrappedDataKeyChange: StorageChangeLike | undefined,
  masterConfigChange?: StorageChangeLike,
): boolean {
  return wrappedDataKeyChange?.newValue !== undefined || masterConfigChange?.newValue !== undefined;
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

// ==================== 头部备份徽标 ====================

/** 一天的毫秒数（徽标按「天」表达时长，与既有 `backupStatusDays` 文案同一口径） */
const DAY_MS = 86_400_000;

/**
 * 徽标档位：严重度只由「有没有备份」与「备份后是否又改过」决定
 *
 * 档位刻意只到三档有色 + 一档隐藏，**不做「超过 2×下限再升红」**：红色在本仓已被
 * 体检与危急会话占用，留给「从未备份」这一唯一真正不可挽回的状态；
 * 超期只把文案从「N 天前已备份」换成「N 天未备份」，靠文字而非颜色区分，
 * 满足「不能只用颜色表达状态」。
 */
export type BackupChipLevel = 'critical' | 'urgent' | 'warning' | 'ok';

/** 单个库的备份档位（`hidden` 表示该库无条目，不参与徽标） */
export type BackupVaultVerdict = 'hidden' | 'never' | 'pending' | 'stale' | 'ok';

/** 徽标输入：两库各自的三个事实，全部来自 `chrome.storage.local` 的时间戳与条目存在性 */
export interface BackupVaultInput {
  /** 该库是否有条目。空库不参与判定——没有可备份的东西就不该有提醒 */
  hasData: boolean;
  /** 最近一次通过完整性自检的备份导出时间戳（密码 `.aph` / 身份 `.aphid` 各自独立） */
  lastBackupAt: number | null;
  /** 最近一次「与备份相关」的变更时间戳，由 Service Worker 的 `storage.onChanged` 写入 */
  lastChangeAt: number | null;
}

/** 单个库在徽标明细里的呈现要素 */
export interface BackupVaultChipDetail {
  /** 该库档位 */
  verdict: BackupVaultVerdict;
  /** 距该库上次备份的整天数（从未备份时为 null） */
  ageDays: number | null;
}

/** 徽标判定结果 */
export interface BackupChipState {
  /** 是否展示（两库皆空即隐藏） */
  visible: boolean;
  /** 徽标档位，取两库里最严重的一档 */
  level: BackupChipLevel;
  /** 决定档位的那一库，供文案与 `aria-label` 指明范围 */
  worstVault: 'passwords' | 'identity';
  /** 最差库的备份时间戳（从未备份时为 null），供「N 天」计算 */
  worstLastBackupAt: number | null;
  /** 两库各自档位与天数，供 tooltip / `aria-label` 分行陈述，不让徽标替两个库撒一个统一的谎 */
  perVault: { passwords: BackupVaultChipDetail; identity: BackupVaultChipDetail };
  /** 距最差库上次备份的整天数；从未备份时为 null */
  ageDays: number | null;
}

/**
 * 判定单个库的备份档位
 *
 * 只看时间戳，**绝不为徽标解密身份库**：`hasPendingIdentityBackup` 需要解密后的
 * `records`，那是弹窗打开时才付的成本；这里走 `lastChangeAt` 一条信号即可覆盖增 / 改 / 删
 * （删除会让记录消失、`records` 反而「看起来都已备份」，而 `LAST_IDENTITY_CHANGE_AT`
 * 存在的理由正是补这个盲区）。
 *
 * @param vault 该库的条目存在性与两个时间戳
 * @param floorMs 兜底下限，沿用 `autoBackupIntervalDays`（与 `decidePasswordBackupReminder` 同源）
 * @param now 当前时间（由调用方注入，便于测试）
 * @returns 该库档位
 */
export function decideVaultBackupVerdict(vault: BackupVaultInput, floorMs: number, now: number): BackupVaultVerdict {
  if (!vault.hasData) return 'hidden';
  if (vault.lastBackupAt === null) return 'never';
  if (vault.lastChangeAt !== null && vault.lastChangeAt > vault.lastBackupAt) return 'pending';
  if (now - vault.lastBackupAt > floorMs) return 'stale';
  return 'ok';
}

/** 档位严重度序（越大越严重），供两库取最差 */
const VERDICT_SEVERITY: Record<BackupVaultVerdict, number> = {
  hidden: -1,
  ok: 0,
  stale: 1,
  pending: 2,
  never: 3,
};

/** 档位 → 徽标颜色档 */
const VERDICT_TO_LEVEL: Record<Exclude<BackupVaultVerdict, 'hidden'>, BackupChipLevel> = {
  ok: 'ok',
  stale: 'warning',
  pending: 'urgent',
  never: 'critical',
};

/**
 * 该档是否「现在就该催用户去备份」
 *
 * 与 `VERDICT_TO_LEVEL` 的 `never → critical` / `pending → urgent` 同一意图：只有「从未备份」
 * 和「备份后又改过」值得出声。`stale`（备份已久但期间没动过）没有新数据要丢，`ok` 与
 * `hidden`（空库）更不该提。横幅自身的出现门槛写在 `entrypoints/options/App.vue` 的
 * `backupNudge` 里，判的是档位不是库档——两处若有一处扩档，另一处要一起对过。
 *
 * @param verdict 单个库的备份档位
 * @returns true 表示该库值得在此刻提醒用户备份
 */
export function isVerdictOwedNow(verdict: BackupVaultVerdict): boolean {
  return verdict === 'never' || verdict === 'pending';
}

/**
 * 判定头部备份徽标
 *
 * 徽标只取两库里更严重的一档：一库「从未备份」一库「今日已备份」时显示绿色就是撒谎。
 * 时间戳缺失或非有限值一律按「无该库备份记录」保守处理——提醒漏报的代价是用户丢数据，
 * 误报的代价只是多一条橙色徽标，与本模块既有判据同一取向。
 *
 * @param input 两库输入、兜底下限与当前时间
 * @returns 徽标状态
 */
export function decideBackupChipState(input: {
  passwords: BackupVaultInput;
  identity: BackupVaultInput;
  floorMs: number;
  now: number;
}): BackupChipState {
  const passwords = decideVaultBackupVerdict(input.passwords, input.floorMs, input.now);
  const identity = decideVaultBackupVerdict(input.identity, input.floorMs, input.now);
  const detail = (verdict: BackupVaultVerdict, lastBackupAt: number | null): BackupVaultChipDetail => ({
    verdict,
    ageDays: verdict === 'hidden' || lastBackupAt === null ? null : Math.floor((input.now - lastBackupAt) / DAY_MS),
  });

  if (passwords === 'hidden' && identity === 'hidden') {
    return {
      visible: false,
      level: 'ok',
      worstVault: 'passwords',
      worstLastBackupAt: null,
      perVault: { passwords: detail(passwords, null), identity: detail(identity, null) },
      ageDays: null,
    };
  }

  const passwordSeverity = VERDICT_SEVERITY[passwords];
  const identitySeverity = VERDICT_SEVERITY[identity];
  // 同档时取「更久没备份」的那一库：徽标只有一枚，展示的天数必须是最坏情况，不能粉饰。
  // 从未备份（null）在同档里不会发生（`never` 恒为最高档），故按 +∞ 排在最新一侧即可。
  const identityIsWorst =
    identitySeverity > passwordSeverity ||
    (identitySeverity === passwordSeverity &&
      (input.identity.lastBackupAt ?? Number.POSITIVE_INFINITY) <
        (input.passwords.lastBackupAt ?? Number.POSITIVE_INFINITY));
  const worstVault: 'passwords' | 'identity' = identityIsWorst ? 'identity' : 'passwords';
  const worstVerdict = identityIsWorst ? identity : passwords;
  const worstBackupAt = (identityIsWorst ? input.identity : input.passwords).lastBackupAt;

  return {
    visible: true,
    level: VERDICT_TO_LEVEL[worstVerdict as Exclude<BackupVaultVerdict, 'hidden'>],
    worstVault,
    worstLastBackupAt: worstBackupAt,
    perVault: {
      passwords: detail(passwords, input.passwords.lastBackupAt),
      identity: detail(identity, input.identity.lastBackupAt),
    },
    ageDays: worstBackupAt === null ? null : Math.floor((input.now - worstBackupAt) / DAY_MS),
  };
}
