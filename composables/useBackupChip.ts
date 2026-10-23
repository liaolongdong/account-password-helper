import { computed, onScopeDispose, ref } from 'vue';
import type { BackupChipState } from '@/utils/backup/changeDetection';
import { decideBackupChipState } from '@/utils/backup/changeDetection';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/**
 * 头部备份徽标的状态源
 *
 * 只做四件事：初始化读一次时间戳、把 `storage.onChanged` 里的时间戳与身份库条目数就地更新、
 * 用纯函数算出档位、暴露给 HeaderBar 消费。刻意保持薄：判据全在
 * `utils/backup/changeDetection` 的纯函数里，这里不复制任何业务规则。
 *
 * 三条约束（都来自本仓既有边界）：
 * - **不为徽标解密任何数据**：身份库只取 `IDENTITY` 数组长度（明文键，条目数即存在性），
 *   档位走时间戳判据，因此首屏与锁定态都不会因为一个徽标去碰 AES；
 * - **不轮询**：徽标表达的是「天」级信息，靠事件驱动刷新，不装 `setInterval`
 *   （会话徽标要秒级是另一回事，见 `useSessionCountdown`）；
 * - **不进首屏关键路径**：`refresh()` 由调用方在认证完成后 `void` 调用，
 *   读失败只降级为「无备份记录」，不抛、不挡渲染。
 */

/** 兜底下限的默认值（天）：与 `getEmailBackupConfig` 的 `autoBackupIntervalDays` 默认值同一口径 */
const DEFAULT_FLOOR_DAYS = 7;

/** `storage.onChanged` 里能直接刷新徽标的时间戳键 */
const CHIP_TIMESTAMP_KEYS = [
  STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT,
  STORAGE_KEYS.LAST_PASSWORD_CHANGE_AT,
  STORAGE_KEYS.LAST_IDENTITY_CHANGE_AT,
  STORAGE_KEYS.LAST_IDENTITY_BACKUP_AT,
] as const;

/** 读取一个时间戳键的合法值（非有限数值一律按 null，与 `configManager` 的读端口径一致） */
function asTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 读取一个数组键的条目数（形状不明时按 0，宁可少显示一个徽标也不误报） */
function asCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function useBackupChip() {
  /**
   * 密码库条目数，由调用方写入
   *
   * 刻意不自己读 `PASSWORDS`：那是一份 2000 条量级的整包读，而调用方（管理页）本来就把
   * 解密后的列表握在手里。再读一遍等于给首屏 `preRowMs` 白加一次磁盘 IO。
   */
  const passwordCount = ref(0);
  const setPasswordCount = (count: number): void => {
    passwordCount.value = count;
  };

  const lastVerifiedBackupAt = ref<number | null>(null);
  const lastPasswordChangeAt = ref<number | null>(null);
  const lastIdentityChangeAt = ref<number | null>(null);
  const lastIdentityBackupAt = ref<number | null>(null);
  /** 身份库条目数（只取长度，不解密） */
  const identityCount = ref(0);
  /** 兜底下限毫秒数，取自邮箱备份配置，与桌面通知那条链路共用同一个用户设置 */
  const floorMs = ref(DEFAULT_FLOOR_DAYS * 86_400_000);

  const backupChip = computed<BackupChipState>(() =>
    decideBackupChipState({
      passwords: {
        hasData: passwordCount.value > 0,
        lastBackupAt: lastVerifiedBackupAt.value,
        lastChangeAt: lastPasswordChangeAt.value,
      },
      identity: {
        hasData: identityCount.value > 0,
        lastBackupAt: lastIdentityBackupAt.value,
        lastChangeAt: lastIdentityChangeAt.value,
      },
      floorMs: floorMs.value,
      // computed 内读 Date.now() 不是响应式源：天数由事件驱动刷新，
      // 而「天」这一粒度下一次写入带来的误差要等下一次事件才可见，可接受。
      now: Date.now(),
    }),
  );

  /** 初始化 / 主动重读全部输入（导出、导入等动作后可显式调用，事件路径已覆盖大部分场景） */
  const refresh = async (): Promise<void> => {
    try {
      const snap = await chrome.storage.local.get([
        ...CHIP_TIMESTAMP_KEYS,
        STORAGE_KEYS.IDENTITY,
        STORAGE_KEYS.EMAIL_BACKUP_CONFIG,
      ]);
      lastVerifiedBackupAt.value = asTimestamp(snap[STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT]);
      lastPasswordChangeAt.value = asTimestamp(snap[STORAGE_KEYS.LAST_PASSWORD_CHANGE_AT]);
      lastIdentityChangeAt.value = asTimestamp(snap[STORAGE_KEYS.LAST_IDENTITY_CHANGE_AT]);
      lastIdentityBackupAt.value = asTimestamp(snap[STORAGE_KEYS.LAST_IDENTITY_BACKUP_AT]);
      identityCount.value = asCount(snap[STORAGE_KEYS.IDENTITY]);
      const config = snap[STORAGE_KEYS.EMAIL_BACKUP_CONFIG] as { autoBackupIntervalDays?: number } | undefined;
      const days = config?.autoBackupIntervalDays;
      floorMs.value = (typeof days === 'number' && days > 0 ? days : DEFAULT_FLOOR_DAYS) * 86_400_000;
    } catch (error) {
      logger.error('读取备份徽标状态失败（降级为无备份记录）:', error);
    }
  };

  /**
   * 本次页面会话内是否真的发生过「与备份相关的变更」
   *
   * 供会话内轻提醒（R1）当触发条件：徽标已到「待备份」档不代表刚改过数据，
   * 可能只是上个月那次改动一直没备份。没有这个标志，提醒会在每次打开管理页时都推一次，
   * 变成噪音。初始读取不算变更，只有落盘时间戳**向前移动**时才算。
   */
  const mutatedThisSession = ref(false);

  /**
   * 就地跟随落盘变化
   *
   * 密码库变更不需要监听 `PASSWORDS`：调用方写入的是响应式条目数。
   * 而「与备份相关的变更时间戳」由 Service Worker 异步写入，正好由本监听接住——
   * 用户刚加完一条密码，徽标会在时间戳落盘的那一刻转橙。
   */
  const handleStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: chrome.storage.AreaName,
  ): void => {
    if (areaName !== 'local') return;
    for (const key of CHIP_TIMESTAMP_KEYS) {
      if (!(key in changes)) continue;
      const value = asTimestamp(changes[key].newValue);
      const previous =
        key === STORAGE_KEYS.LAST_PASSWORD_CHANGE_AT
          ? lastPasswordChangeAt.value
          : key === STORAGE_KEYS.LAST_IDENTITY_CHANGE_AT
            ? lastIdentityChangeAt.value
            : null;
      // 变更时间戳向前移动 = 这一页开着的时候真的改过数据（初始读取不算）
      if (value !== null && previous !== null && value > previous) mutatedThisSession.value = true;
      if (key === STORAGE_KEYS.LAST_VERIFIED_BACKUP_AT) lastVerifiedBackupAt.value = value;
      else if (key === STORAGE_KEYS.LAST_PASSWORD_CHANGE_AT) lastPasswordChangeAt.value = value;
      else if (key === STORAGE_KEYS.LAST_IDENTITY_CHANGE_AT) lastIdentityChangeAt.value = value;
      else lastIdentityBackupAt.value = value;
    }
    if (STORAGE_KEYS.IDENTITY in changes) {
      identityCount.value = asCount(changes[STORAGE_KEYS.IDENTITY].newValue);
    }
  };

  chrome.storage.onChanged.addListener(handleStorageChanged);
  onScopeDispose(() => {
    chrome.storage.onChanged.removeListener(handleStorageChanged);
  });

  return {
    backupChip,
    /** 徽标顺带持有的「最近一次通过自检的 `.aph` 导出时间」，供安全起步清单等既有消费方复用，避免同一键读两遍 */
    lastVerifiedBackupAt,
    refresh,
    setPasswordCount,
    mutatedThisSession,
  };
}
