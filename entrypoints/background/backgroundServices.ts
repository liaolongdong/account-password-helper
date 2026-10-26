import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { SESSION_MEMORY_KEYS, STORAGE_KEYS } from '@/utils/storageKeys';
import {
  SESSION_STORAGE_KEYS,
  markSessionInvalid,
  requestReEncryptAtRest,
  adoptRekeyedSession,
  resetSessionMemoryState,
} from '@/utils/sessionManager-storage';
import {
  checkForUpdate,
  getCachedUpdateInfo,
  getReleasesPageUrl,
  UPDATE_CHECK_ALARM_NAME,
  UPDATE_CHECK_INTERVAL_MINUTES,
} from '@/utils/updateChecker';
import { getSidePanelPorts } from './sidePanelManager';
import { openOptionsPage } from './optionsPageManager';
import {
  invalidatePasswordCache,
  warmPasswordCache,
  applyMetadataOnlyUpdate,
  consumeMetadataFlushMarker,
  isMetadataOnlyChange,
  clearAllPendingTotp,
  resetCredentialAccessBarrierForStartup,
  resetDomainMatchModeMirror,
} from './passwordCache';
import { tl } from '@/utils/i18n-lite';
import { refreshActionIcon, setActionIconState } from './actionIcon';
import { UNLOCK_NOTIFICATION_ID } from './quickFillHandler';
import {
  decidePasswordBackupReminder,
  isBackupRelevantIdentityChange,
  isBackupRelevantPasswordChange,
  isKeyRotationBatch,
} from '@/utils/backup/changeDetection';
import {
  markBrowserStartupRelockCurrentSessionReady,
  setBrowserStartupRelockState,
  waitForBrowserStartupRelockMarker,
} from '@/utils/browserStartupRelock';

/**
 * 惰性加载 StorageUtils
 *
 * backgroundServices 对 StorageUtils 的调用均发生在事件回调（alarm/idle/onStartup）中，
 * 而非 SW 启动同步路径。动态导入将 storage 层的模块初始化延迟到首次事件触发时，
 * 与 messageRouter 的惰性加载模式一致。注：SW 产物被 WXT 内联为单文件，
 * 此懒加载不减少冷启动解析/编译量。
 */
let _storageModule: typeof import('@/utils/storage') | null = null;
async function _getStorageUtils(): Promise<(typeof import('@/utils/storage'))['StorageUtils']> {
  if (!_storageModule) {
    _storageModule = await import('@/utils/storage');
  }
  return _storageModule.StorageUtils;
}

/** 自动备份提醒闹钟名称 */
const AUTO_BACKUP_ALARM_NAME = 'auto-backup-passwords';

/** 回收站过期清理闹钟名称 */
const TRASH_CLEANUP_ALARM_NAME = 'trash-cleanup';

/** 密码到期提醒检查闹钟名称 */
const PASSWORD_REMINDER_ALARM_NAME = 'password-reminder-check';

/** 密码提醒检查间隔（分钟）：每 12 小时执行一次 */
const PASSWORD_REMINDER_INTERVAL_MINUTES = 12 * 60;

/** 回收站清理间隔（分钟）：每 24 小时执行一次 */
const TRASH_CLEANUP_INTERVAL_MINUTES = 24 * 60;

/**
 * Service Worker 保活闹钟名称（复活入口）
 *
 * 保活机制分两层协作（所有平台统一常驻，不区分会话状态）：
 * - 心跳层（连续保活）：SW 存活期间以 setInterval 每 20s 调用一次轻量扩展 API，
 *   Chrome ≥110 任何扩展 API 调用都会重置 SW 的 30s 空闲计时器，实现确定性连续保活；
 * - 闹钟层（复活入口）：SW 一旦被强杀（浏览器内存压力/崩溃恢复等），心跳随之消失，
 *   由本闹钟在下个周期唤醒 SW，SW 启动路径（syncSwKeepaliveAlarm）重新拉起心跳。
 *
 * 注意：chrome.alarms 轮询粒度 ≥30s（多闹钟错相会被合并到同一轮询，无法收窄间隔），
 * 故闹钟只承担「死亡后复活」职责，「存活期不死亡」由心跳层保证。
 *
 * 保活的业务价值（全平台、全会话状态）：
 * - 会话有效期内：保持 passwordCache（内存缓存）常驻，使侧边栏首屏走缓存竞速快速通道。
 * - 会话失效后：保持热 SW，使侧边栏任何打开路径（悬浮按钮消息 / 快捷键命令）都无需
 *   等待 SW 全量冷启动；保活 tick 内的资源预热持续温热侧边栏文件，避免磁盘缓存
 *   逐出后的冷读白屏（Mac 间隔一段时间后打开 4 秒白屏的根治手段）。
 */
const SW_KEEPALIVE_ALARM_NAME = 'sw-keepalive';

/** SW 心跳间隔（毫秒）：< 30s 空闲阈值并留足调度余量 */
const SW_HEARTBEAT_INTERVAL_MS = 20000;

/** SW 心跳定时器（模块级，SW 生命周期内有效；SW 重启后由 syncSwKeepaliveAlarm 重建） */
let _swHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * SW 复活闹钟间隔（分钟）
 *
 * Chrome 扩展 MV3 的 chrome.alarms.create 最小 periodInMinutes 为 0.5（30 秒），
 * 且 alarms 轮询粒度 ≥30s，无法进一步收窄。SW 存活期的连续保活由 20s 心跳层
 * 负责（见 SW_HEARTBEAT_INTERVAL_MS），本闹钟仅作为 SW 被强杀后的复活入口，
 * 将「死亡 → 复活」的最长等待封顶在一个周期内；
 * 不支持 0.5 的旧版 Chrome 会自动上钳到 1 分钟，安全兼容。
 */
const SW_KEEPALIVE_INTERVAL_MINUTES = 0.5;

/**
 * 设置插件图标更新徽标
 */
async function showUpdateBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#409eff' });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.action.setBadgeText({ text: 'new' });
    logger.debug('Background: 更新徽标已显示');
  } catch (error) {
    logger.error('Background: 设置更新徽标失败:', error);
  }
}

/**
 * 清除插件图标更新徽标
 */
async function clearUpdateBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: '' });
    logger.debug('Background: 更新徽标已清除');
  } catch (error) {
    logger.error('Background: 清除更新徽标失败:', error);
  }
}

/**
 * 设置闲置锁定检测
 *
 * 将用户配置的闲置分钟数写入 chrome.idle 检测阈值（仅影响 'idle' 状态判定）。
 * 阈值存于浏览器进程内存，浏览器重启后回落默认 60s，故除 onInstalled / 配置变更外，
 * SW 每次启动也须重新应用（见 setupBackgroundServices）。
 */
async function setupIdleLock() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDLE_LOCK_CONFIG);
    const config = result[STORAGE_KEYS.IDLE_LOCK_CONFIG] as { idleLockMinutes: number } | undefined;
    const minutes = config?.idleLockMinutes ?? 0;

    if (minutes > 0) {
      chrome.idle.setDetectionInterval(minutes * 60);
      logger.debug(`Background: 闲置锁定已启用，间隔 ${minutes} 分钟`);
    } else {
      logger.debug('Background: 闲置锁定未启用');
    }
  } catch (error) {
    logger.error('Background: 设置闲置锁定失败:', error);
  }
}

/**
 * 设置版本更新检测闹钟
 */
async function setupUpdateCheckAlarm() {
  try {
    await chrome.alarms.clear(UPDATE_CHECK_ALARM_NAME);
    await chrome.alarms.create(UPDATE_CHECK_ALARM_NAME, {
      periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
      delayInMinutes: 1,
    });
    logger.info(`Background: 版本更新检测闹钟已设置，间隔 ${UPDATE_CHECK_INTERVAL_MINUTES} 分钟`);
  } catch (error) {
    logger.error('Background: 设置版本更新检测闹钟失败:', error);
  }
}

/**
 * 设置密码到期提醒检查闹钟
 *
 * 每 12 小时执行一次，检查是否有到期的密码提醒并发送通知。
 */
async function setupPasswordReminderAlarm() {
  try {
    await chrome.alarms.clear(PASSWORD_REMINDER_ALARM_NAME);
    await chrome.alarms.create(PASSWORD_REMINDER_ALARM_NAME, {
      periodInMinutes: PASSWORD_REMINDER_INTERVAL_MINUTES,
      delayInMinutes: 10, // 延迟 10 分钟后首次执行，避免 SW 启动时竞争
    });
    logger.debug('Background: 密码提醒检查闹钟已设置，间隔 12 小时');
  } catch (error) {
    logger.error('Background: 设置密码提醒闹钟失败:', error);
  }
}

/**
 * 执行密码到期提醒检查
 *
 * 检查所有已到期且未通知的提醒，逐条发送桌面通知。
 * 每条提醒独立捕获异常：系统通知配额耗尽、通知服务不可用等单条失败，
 * 只跳过该条（下一周期 12 小时后仍会重试），不能连带丢掉后续所有到期提醒。
 */
async function performReminderCheck() {
  try {
    const { getDueReminders, markNotified } = await import('@/utils/storage/reminderManager');
    const dueReminders = await getDueReminders();

    if (dueReminders.length === 0) return;

    for (const reminder of dueReminders) {
      // 只记 entryId：账号名属敏感标识，不入日志（与 reminderManager 的日志口径一致）
      try {
        const notificationId = `password-reminder-${reminder.entryId}`;
        await chrome.notifications.create(notificationId, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon/128.png'),
          title: tl('bg.reminder.title'),
          message: tl('bg.reminder.message', { username: reminder.username }),
        });
        await markNotified(reminder.entryId);
        logger.info(`Background: 密码提醒已发送 [${reminder.entryId}]`);
      } catch (error) {
        logger.error(`Background: 单条密码提醒发送失败，跳过 [${reminder.entryId}]:`, error);
      }
    }
  } catch (error) {
    logger.error('Background: 密码提醒检查失败:', error);
  }
}

/**
 * 设置回收站过期清理闹钟
 *
 * 每 24 小时执行一次，清理超过 30 天的回收站条目。
 */
async function setupTrashCleanupAlarm() {
  try {
    await chrome.alarms.clear(TRASH_CLEANUP_ALARM_NAME);
    await chrome.alarms.create(TRASH_CLEANUP_ALARM_NAME, {
      periodInMinutes: TRASH_CLEANUP_INTERVAL_MINUTES,
      delayInMinutes: 5, // 延迟 5 分钟后首次执行，避免 SW 启动时竞争
    });
    logger.debug('Background: 回收站清理闹钟已设置，间隔 24 小时');
  } catch (error) {
    logger.error('Background: 设置回收站清理闹钟失败:', error);
  }
}

/**
 * 执行回收站过期清理
 *
 * 密码库与身份库两个回收站共用本闹钟（同一 30 天保留期口径），
 * 各自独立容错——一侧清理失败不阻断另一侧。
 */
async function performTrashCleanup() {
  try {
    const { cleanExpiredTrash } = await import('@/utils/storage/trashManager');
    await cleanExpiredTrash();
  } catch (error) {
    logger.error('Background: 回收站过期清理失败:', error);
  }
  try {
    const { cleanExpiredIdentityTrash } = await import('@/utils/storage/identityTrashManager');
    await cleanExpiredIdentityTrash();
  } catch (error) {
    logger.error('Background: 身份回收站过期清理失败:', error);
  }
}

/**
 * 执行版本更新检测并发送桌面通知
 */
export async function performUpdateCheck() {
  try {
    const updateInfo = await checkForUpdate();

    if (updateInfo) {
      await showUpdateBadge();

      await chrome.notifications.create('extension-update-available', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title: tl('bg.update.title'),
        message: tl('bg.update.message', { version: updateInfo.latestVersion }),
      });
      logger.info(`Background: 更新通知已发送，最新版本 v${updateInfo.latestVersion}`);
    } else {
      await clearUpdateBadge();
    }

    return updateInfo;
  } catch (error) {
    logger.error('Background: 执行版本更新检测失败:', error);
    return null;
  }
}

/**
 * 设置自动备份提醒闹钟
 */
async function setupAutoBackupAlarm() {
  try {
    await chrome.alarms.clear(AUTO_BACKUP_ALARM_NAME);

    const StorageUtils = await _getStorageUtils();
    const config = await StorageUtils.getEmailBackupConfig();

    if (config.autoBackup && config.email) {
      const periodInMinutes = config.autoBackupIntervalDays * 24 * 60;

      let delayInMinutes = 1;
      const lastBackupTime = await StorageUtils.getLastAutoBackupTime();
      if (lastBackupTime) {
        const elapsedMinutes = (Date.now() - lastBackupTime) / (60 * 1000);
        const remainingMinutes = Math.max(periodInMinutes - elapsedMinutes, 1);
        delayInMinutes = Math.min(remainingMinutes, periodInMinutes);
        logger.debug(
          `Background: 距上次备份已过 ${Math.round(elapsedMinutes)} 分钟，下次提醒延迟 ${Math.round(delayInMinutes)} 分钟`,
        );
      }

      await chrome.alarms.create(AUTO_BACKUP_ALARM_NAME, {
        periodInMinutes,
        delayInMinutes,
      });
      logger.info(`Background: 自动备份提醒闹钟已设置，间隔 ${config.autoBackupIntervalDays} 天`);
    } else {
      logger.debug('Background: 自动备份未启用或未配置邮箱');
    }
  } catch (error) {
    logger.error('Background: 设置自动备份闹钟失败:', error);
  }
}

/**
 * 记录「与备份相关」的变更时间戳（密码库 + 身份库）
 *
 * 由 `storage.onChanged` 每次 local 区变更时调用。两个判据都是纯函数
 * （`utils/backup/changeDetection`），只在真的发生用户数据变更时落时间戳：
 * 使用痕迹（每次自动填充都会 bump 的 `lastUsedAt` / `favoriteUsedAt`）被排除，
 * 否则「越常用密码越常被提醒备份」，与用户诉求相反。
 *
 * 身份库刻意**不**加进上面的 `relevantKeys`——那个数组驱动的是密码缓存失效，
 * 身份域与密码缓存无关，加进去会让身份库的每次编辑误触发 `invalidatePasswordCache()`，
 * 把侧边栏打回全量解密回温路径。这里单独读 `changes[STORAGE_KEYS.IDENTITY]`。
 *
 * 写入的是另外三个键，不在 `relevantKeys` 内，因此本函数触发的 `onChanged`
 * 不会再回到这里，无自激循环。失败只记 warn：提醒退化回纯时间驱动，不影响任何数据。
 *
 * 换钥匙（修改主密码）单独排除在外：那一批写入会把五个加密域整库重加密，逐字段比对
 * 必然判成「内容变了」，但备份文件与当前主密码无关，用户并没有真的欠一次备份。
 * 判据与理由见 `isKeyRotationBatch` 的注释。
 *
 * @param changes `storage.onChanged` 的变更集
 */
async function recordBackupRelevantChanges(changes: Record<string, chrome.storage.StorageChange>): Promise<void> {
  try {
    const StorageUtils = await _getStorageUtils();
    const now = Date.now();

    if (isKeyRotationBatch(changes[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY], changes[STORAGE_KEYS.MASTER_PASSWORD])) {
      logger.debug('Background: 该批变更来自换钥匙（rekey），内容未变，不刷新待备份时间戳');
      return;
    }

    const passwordsChange = changes[STORAGE_KEYS.PASSWORDS];
    if (passwordsChange && isBackupRelevantPasswordChange(passwordsChange.oldValue, passwordsChange.newValue)) {
      await StorageUtils.setLastPasswordChangeAt(now);
      logger.debug('Background: 检测到与备份相关的密码变更，已记录时间戳');
    }

    const identityChange = changes[STORAGE_KEYS.IDENTITY];
    if (identityChange && isBackupRelevantIdentityChange(identityChange.oldValue, identityChange.newValue)) {
      // 只比对主列表 IDENTITY，与密码库同口径（其 recordBackupRelevantChanges 只读
      // PASSWORDS、从不读 TRASH）：软删/恢复都改变主列表活动条目，本分支已覆盖；
      // 而彻底删除/清空/TTL 自动清理只动 IDENTITY_TRASH、活动条目不变，`.aphid` 备份
      // 又不含回收站——若为回收站单独刷新时间戳，会点亮「重新导出也无法消除」的假提醒
      //（备份内容与上次一致却判为未备份），违背本模块「只在有内容可备时出声」的契约。
      await StorageUtils.setLastIdentityChangeAt(now);
      logger.debug('Background: 检测到与备份相关的身份信息变更，已记录时间戳');
    }
  } catch (error) {
    logger.warn('Background: 记录备份变更时间戳失败，提醒退回纯时间驱动:', error);
  }
}

/**
 * 执行自动备份提醒
 */
async function performAutoBackup() {
  try {
    const StorageUtils = await _getStorageUtils();
    const config = await StorageUtils.getEmailBackupConfig();

    if (!config.email) {
      logger.warn('Background: 未配置备份邮箱，跳过备份提醒');
      return;
    }

    const lastBackupTime = await StorageUtils.getLastAutoBackupTime();
    if (lastBackupTime) {
      const elapsedMs = Date.now() - lastBackupTime;
      const intervalMs = (config.autoBackupIntervalDays || 7) * 24 * 60 * 60 * 1000;
      if (elapsedMs < intervalMs) {
        const remainingHours = Math.round((intervalMs - elapsedMs) / (60 * 60 * 1000));
        logger.info(
          `Background: 距上次备份提醒不足 ${config.autoBackupIntervalDays} 天，跳过本次提醒 (剩余约 ${remainingHours} 小时)`,
        );
        return;
      }
    }

    const pwResult = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
    const rawPasswords = pwResult[STORAGE_KEYS.PASSWORDS] as unknown[] | undefined;
    const passwordCount = rawPasswords?.length ?? 0;

    /*
     * 这里**故意只看密码库**，不是漏了个人信息库——别顺手把 IDENTITY 加进来。
     * 本函数是「邮箱备份提醒」的通道：`utils/emailBackup.ts` 递出去的是
     * `passwords_*.csv` 或 `.aph`，作用域只覆盖密码库，`.aphid`（个人信息库）根本不在
     * 这条通道里。给一个只存证件/银行卡的用户发「请用邮箱备份」，是在引导他做一件
     * 备不到自己数据的动作，比不提醒更糟。
     * 个人信息库的欠备份状态由管理页横幅承担（两库结论见 `decideBackupChipState`
     * 的 `perVault`，另一库也欠时点名「下一份」），那是能直接指到 `.aphid` 导出入口的面。
     * 想给身份库加站外提醒，前提是先有一条带 `.aphid` 的定时通道——属产品决策，不是 bug。
     */
    if (passwordCount === 0) {
      logger.info('Background: 无密码数据，跳过备份提醒');
      return;
    }

    // 变更触发判定：只在「自上次成功备份后确有变更」或「距上次成功备份已超过兜底下限」时出声。
    // 兜底下限沿用 autoBackupIntervalDays —— 没有它，长期不改密码的重度用户会永远收不到提醒，
    // 而他们恰恰是换机/重装时最容易丢数据的一群人。
    const verdict = decidePasswordBackupReminder({
      lastChangeAt: await StorageUtils.getLastPasswordChangeAt(),
      lastVerifiedBackupAt: await StorageUtils.getLastVerifiedBackupAt(),
      floorMs: (config.autoBackupIntervalDays || 7) * 24 * 60 * 60 * 1000,
      now: Date.now(),
    });

    // 无论出声与否都推进「上次提醒」时间戳：本次改动只决定这一拍要不要响，
    // 不改闹钟节奏，因此提醒频率上限与既有实现完全一致。
    await StorageUtils.setLastAutoBackupTime();

    if (verdict === null) {
      logger.info('Background: 自上次成功备份后无内容变更、且未超过兜底下限，跳过本次备份提醒');
      return;
    }

    await chrome.notifications.create('auto-backup-reminder', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: tl('bg.backup.title'),
      message: tl(verdict === 'changed' ? 'bg.backup.messageChanged' : 'bg.backup.message', { count: passwordCount }),
    });

    logger.info(`Background: 自动备份提醒已发送（${verdict}），密码条目数: ${passwordCount}`);
  } catch (error) {
    logger.error('Background: 发送自动备份提醒失败:', error);
  }
}

/**
 * 设置 Service Worker 保活闹钟
 *
 * 每隔 SW_KEEPALIVE_INTERVAL_MINUTES 分钟唤醒 SW 一次，
 * 防止因 30 秒空闲超时被 Chrome 终止。SW 存活意味着 passwordCache（内存缓存）
 * 持续可用，使侧边栏首屏加载能通过缓存竞速快速通道在 20-50ms 内获得数据。
 *
 * 所有平台统一常驻启用（含会话失效后，见 syncSwKeepaliveAlarm），
 * 以消除侧边栏打开时的冷启动白屏；不存在按平台/会话状态停活的路径。
 */
async function setupSwKeepaliveAlarm(): Promise<void> {
  try {
    // 心跳层：每 20s 一次轻量扩展 API 调用（storage.session 单键读），
    // 重置 SW 30s 空闲计时器实现连续保活；重复启用时先清旧定时器保证单实例
    if (_swHeartbeatTimer) {
      clearInterval(_swHeartbeatTimer);
    }
    _swHeartbeatTimer = setInterval(() => {
      try {
        void chrome.storage.session.get('sw_heartbeat').catch(() => {});
      } catch {
        // 扩展上下文异常时静默忽略，闹钟层兜底
      }
    }, SW_HEARTBEAT_INTERVAL_MS);

    // 闹钟层（复活入口）：免相位重置——闹钟已存在时不重建，
    // clear+create 会把下次触发推迟整周期，使 SW 被强杀后的复活等待最大化
    const existing = await chrome.alarms.get(SW_KEEPALIVE_ALARM_NAME);
    if (!existing) {
      await chrome.alarms.create(SW_KEEPALIVE_ALARM_NAME, {
        periodInMinutes: SW_KEEPALIVE_INTERVAL_MINUTES,
      });
      logger.debug('Background: SW 保活已启用（心跳 + 复活闹钟）');
    }
  } catch (error) {
    logger.error('Background: 设置 SW 保活失败:', error);
  }
}

/**
 * 同步 SW 保活闹钟（所有平台统一常驻保活）
 *
 * 保活策略统一为常驻、不再区分平台与会话状态（历史演进见 git 日志：
 * Windows 差异化保活 → 双层保活 + 引导期 → 会话失效宽限期保活 → 统一常驻）。
 * 原因：会话失效后停活 → SW 空闲 30s 死亡 → 资源预热 tick（挂在保活闹钟上）
 * 停止 → OS 磁盘缓存逐出扩展文件 → 下次打开侧边栏命中「SW 冷启 + 渲染进程
 * 冷创建 + 文件冷读 + storage.session 快照失效」四冷叠加白屏（Mac 间隔一段时间
 * 后打开 4 秒白屏的直接根因）。常驻保活使侧边栏任何打开路径（悬浮按钮消息 /
 * 快捷键命令）都命中热 SW 与温热文件，与 Windows 秒开体验对齐。
 *
 * 在 SW 启动、会话创建/清除、上锁等时机调用，作为「确保保活」的集中决策点
 * （幂等：心跳定时器与复活闹钟已存在时不重复创建）。
 */
export async function syncSwKeepaliveAlarm(): Promise<void> {
  try {
    await setupSwKeepaliveAlarm();
  } catch (error) {
    logger.error('Background: 同步 SW 保活闹钟状态失败:', error);
  }
}

/**
 * 浏览器启动时按设置执行安全重锁
 *
 * 当用户开启「浏览器重启后重新锁定」时，浏览器/配置文件启动（chrome.runtime.onStartup）
 * 清除会话，使数据密钥不再从磁盘自动恢复——彻底关闭「活动会话期磁盘可解密」向量。
 * onStartup 仅在浏览器/配置文件启动时触发，Service Worker 空闲重启不会触发，
 * 因此不影响会话跨 SW 重启存活；默认关闭时行为完全不变。
 */
export async function handleBrowserStartupRelock(): Promise<boolean> {
  try {
    const StorageUtils = await _getStorageUtils();
    const config = await StorageUtils.getIdleLockConfig();
    if (!config.relockOnBrowserRestart) return true;

    // 显式、同步地完成清理：clearSession 触发的 storage.onChanged 虽也会失效缓存 / 同步保活闹钟，
    // 但此处不依赖该异步事件时序，直接调用以确保浏览器启动重锁即时生效（防御性冗余）。
    await StorageUtils.clearSession();
    invalidatePasswordCache();
    // 会话清除属安全边界：同步清除全部两步接力标记（不随缓存失效连带清除）
    void clearAllPendingTotp();
    // 经 syncSwKeepaliveAlarm 统一决策保活：全平台常驻，重启重锁后 SW 保持热态
    await syncSwKeepaliveAlarm();
    logger.info('Background: 已按设置在浏览器启动时清除会话，需重新输入主密码');
    return true;
  } catch (error) {
    logger.error('Background: 浏览器启动重锁处理失败:', error);
    return false;
  }
}

/** 当前 SW 生命周期内的浏览器启动重锁 Promise；消息路由可直接等待，消除异步清理竞态。 */
let _browserStartupRelockBarrier: Promise<boolean> | null = null;
let _browserStartupRelockRunning = false;

/**
 * 在 chrome.runtime.onStartup 回调入口同步创建屏障，并先写 storage.session pending 标记。
 * 监听器仍保持同步注册；真正的配置读取和会话清理在 Promise 内执行。
 */
export function beginBrowserStartupRelock(): void {
  if (_browserStartupRelockBarrier) return;
  // 必须在首个 await 前同步废弃本 SW 先前缓存的凭据放行结果。
  resetCredentialAccessBarrierForStartup();
  _browserStartupRelockRunning = true;
  _browserStartupRelockBarrier = (async () => {
    try {
      await setBrowserStartupRelockState('pending');
      const success = await handleBrowserStartupRelock();
      await setBrowserStartupRelockState(success ? 'complete' : 'failed');
      return success;
    } catch (error) {
      logger.error('Background: 建立浏览器启动重锁屏障失败:', error);
      try {
        await setBrowserStartupRelockState('failed');
      } catch {
        // storage.session 不可用时仍由内存 Promise 返回 false，保持 fail-closed
      }
      return false;
    } finally {
      _browserStartupRelockRunning = false;
    }
  })();
}

/**
 * onInstalled 的当前会话初始化：启动重锁正在执行时不写 recovery，且永不改写
 * startup state。调用方无需等待；失败仅意味着凭据入口继续 fail-closed。
 */
export async function markInstalledBrowserSessionReady(): Promise<boolean> {
  if (_browserStartupRelockRunning) return false;
  // storage.session 在完整浏览器重启时清空；只有已有锁定状态镜像才证明这是当前
  // 浏览器会话内的扩展安装/升级，而不是与 onStartup 交错的冷启动事件。
  const currentSession: Record<string, unknown> = await chrome.storage.session
    .get(SESSION_MEMORY_KEYS.SESSION_LOCK_STATE)
    .catch(() => ({}));
  if (_browserStartupRelockRunning || currentSession[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE] === undefined) {
    return false;
  }
  return markBrowserStartupRelockCurrentSessionReady();
}

/**
 * GET_INITIAL_DATA 的安全门：同一 SW 内优先等待内存 Promise，SW 被回收后则读取
 * storage.session 标记恢复状态。failed/读取失败一律拒绝返回会话期明文数据。
 */
export async function waitForBrowserStartupRelock(): Promise<boolean> {
  if (_browserStartupRelockRunning && _browserStartupRelockBarrier) return _browserStartupRelockBarrier;
  // 已结束的 failed 可能被随后显式认证的 recovery 精确恢复，必须重新读取持久标记。
  return waitForBrowserStartupRelockMarker();
}

/**
 * 读取闲置锁定配置（分钟数；未配置或「不锁定」时为 0）
 */
async function getIdleLockMinutes(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.IDLE_LOCK_CONFIG);
  const config = result[STORAGE_KEYS.IDLE_LOCK_CONFIG] as { idleLockMinutes: number } | undefined;
  return config?.idleLockMinutes ?? 0;
}

/**
 * 处理 chrome.idle 状态变化（闲置锁定核心逻辑）
 *
 * 触发锁定的两条线（均在闲置锁定启用即 minutes > 0 时生效）：
 * - 'locked'：系统锁屏/屏保激活，即时触发，与设定时间无关（OS 事件）；
 * - 'idle'：系统未锁且连续无用户输入达到 setDetectionInterval 设定的阈值，
 *   即用户配置的闲置分钟数，计时从最后一次 OS 级用户输入起算。
 * 'active' 等其他状态不处理。锁定动作复用与系统锁屏相同的清会话 + 广播路径。
 */
export async function handleIdleStateChange(newState: string): Promise<void> {
  if (newState !== 'locked' && newState !== 'idle') return;

  try {
    const minutes = await getIdleLockMinutes();
    if (minutes <= 0) return;

    const StorageUtils = await _getStorageUtils();
    await StorageUtils.clearSession();
    logger.info(`Background: ${newState === 'locked' ? '系统锁定' : `闲置超过 ${minutes} 分钟`}，已清除主密码会话`);

    invalidatePasswordCache();
    // 闲置/系统锁定属安全边界：同步清除全部两步接力标记
    void clearAllPendingTotp();
    // 经 syncSwKeepaliveAlarm 统一决策保活：全平台常驻，锁定后 SW 保持热态
    await syncSwKeepaliveAlarm();

    for (const port of getSidePanelPorts()) {
      try {
        port.postMessage({ type: MessageType.SESSION_EXPIRED });
      } catch {
        // port 可能已断开
      }
    }

    // 广播会话过期：无监听者时异步 reject，统一用 .catch 兑底（与其余广播点写法一致；
    // 广播为本函数末尾 fire-and-forget，无下游依赖，不 await 亦无时序风险）
    chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED }).catch(() => {
      // 无监听者时忽略
    });
  } catch (error) {
    logger.error('Background: 闲置锁定处理失败:', error);
  }
}

/**
 * 初始化后台配置（在 onInstalled 时调用）
 * 创建闹钟和设置闲置锁定
 */
export function initBackgroundConfig(): void {
  setupAutoBackupAlarm();
  setupIdleLock();
  setupUpdateCheckAlarm();
  setupTrashCleanupAlarm();
  setupPasswordReminderAlarm();
}

/**
 * 设置后台服务的事件监听器
 * 在 Service Worker 启动时调用一次，注册所有持久监听器
 */
export function setupBackgroundServices(): void {
  // SW 启动时同步保活闹钟状态（全平台统一常驻，幂等）
  syncSwKeepaliveAlarm();

  // SW 每次启动重新应用闲置检测阈值：setDetectionInterval 存于浏览器进程内存，
  // 浏览器重启后回落默认 60s，不重设会导致「闲置 1 分钟即锁定」的回归
  void setupIdleLock();

  // 延迟预热密码缓存：SW 启动后 500ms 异步执行，不阻塞其他初始化
  // 当会话有效时从 storage 加载密码列表到内存缓存，
  // 使首次 sidepanel 打开时 GET_INITIAL_DATA 可直接命中缓存（~1ms）
  setTimeout(() => warmPasswordCache(), 500);

  // 监听闲置状态变化（'locked' 系统锁屏 / 'idle' 闲置达阈值，均触发锁定）
  chrome.idle.onStateChanged.addListener(newState => void handleIdleStateChange(newState));

  // 启动时检查缓存的更新信息，恢复徽标状态
  getCachedUpdateInfo().then(info => {
    if (info) {
      showUpdateBadge();
    }
  });

  // SW 每次启动对齐工具栏图标与会话状态：Chrome 的默认档位始终是 manifest 里的解锁态钥匙，
  // 而会话材料是落盘的——浏览器重启后仍「有材料但已过期」或「已锁定」时，不刷新就会留下
  // 「库是锁着的、图标却是钥匙」的错相。fire-and-forget，不阻塞其余初始化。
  void refreshActionIcon();

  // 监听通知点击事件
  chrome.notifications.onClicked.addListener(notificationId => {
    if (notificationId === 'extension-update-available') {
      chrome.tabs.create({ url: getReleasesPageUrl() });
      chrome.notifications.clear('extension-update-available');
      clearUpdateBadge();
    } else if (notificationId === UNLOCK_NOTIFICATION_ID) {
      // 「需解锁」通知：点击直达主密码验证页（options 页会话失效时自动展示验证表单）
      // 并收起通知，避免已跳转后通知仍挂在通知中心
      openOptionsPage();
      chrome.notifications.clear(UNLOCK_NOTIFICATION_ID);
    } else if (notificationId.startsWith('password-reminder-')) {
      // 密码提醒通知点击：打开选项页面
      openOptionsPage();
      chrome.notifications.clear(notificationId);
    }
  });

  // 监听 storage 变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (STORAGE_KEYS.IDLE_LOCK_CONFIG in changes) {
        setupIdleLock();
        // 用户在当前浏览器会话内修改配置不等同于浏览器重启；明确标记本会话已完成，
        // 避免“刚开启下次重启锁定”被缺失 marker 误判为当前会话需要立即锁定。
        void markBrowserStartupRelockCurrentSessionReady().catch(error => {
          logger.warn('Background: 更新启动重锁屏障状态失败:', error);
        });
      }

      // 跨子域档位变更：仅复位 SW 内存里的档位镜像。档位只影响过滤结果，
      // 不影响缓存明文与快照内容，因此刻意不走 invalidatePasswordCache——
      // 那会删除 storage.session 快照并触发全量解密回温，让「切档后侧边栏仍秒开」失效。
      if (STORAGE_KEYS.DOMAIN_MATCH_CONFIG in changes) {
        resetDomainMatchModeMirror();
      }

      const relevantKeys = [
        STORAGE_KEYS.PASSWORDS,
        // 侧边栏排序配置变更需同步失效缓存：否则 SW 内存的 _cachedSortConfig 与
        // storage.session 快照内嵌的 sortConfig 保持陈旧，侧边栏重开（快照直读路径）
        // 与内联下拉/一键填充（sortMatchesForDomain）会应用过期的排序方式
        STORAGE_KEYS.SIDEPANEL_SORT_CONFIG,
        SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
      ];
      const hasRelevantChange = Object.keys(changes).some(key => relevantKeys.includes(key));
      const passwordsChange = changes[STORAGE_KEYS.PASSWORDS];

      // 备份提醒的变更追踪与缓存失效互相独立：前者只读内容判据、只写时间戳键，
      // 不参与下面的缓存失效分支（身份库尤其不能进 relevantKeys）。
      void recordBackupRelevantChanges(changes);

      if (hasRelevantChange) {
        logger.debug('Background: 检测到存储变化，处理缓存失效');

        // 复合事件：Chrome 会把短时间内多次 set 合并为单个 onChanged 事件派发，
        // PASSWORDS 与 SIDEPANEL_SORT_CONFIG 同批到达时（排序切换与元数据 flush/
        // 自动保存落盘重叠），禁止走元数据原地修补路径——修补会沿用尚未重置的
        // _cachedSortConfig 重持久化快照，导致快照/内联下拉/一键填充停留旧排序；
        // 回退全量失效 + 回温，回温重读新排序配置并按新排序重建快照
        const sortConfigAlsoChanged = STORAGE_KEYS.SIDEPANEL_SORT_CONFIG in changes;

        if (passwordsChange && !sortConfigAlsoChanged) {
          // 元数据 flush 识别：使用痕迹落盘（lastUsedAt/favoriteUsedAt 防抖批量写）
          // 仅改非敏感元数据，命中时原地修补内存缓存与快照（零全量解密、
          // 快照无缺失时刻），避免内联/侧边栏填充后重开侧边栏白屏变长。
          // 双重保险：打标（证明有过 flush）+ oldValue/newValue 内容校验
          // （证明本次变更确实仅元数据，拦截标记残留/双消费竞态误判）；
          // 未命中或修补失败（缓存缺失）时回退全量失效 + 回温，回温把解密
          // 成本提前到写入后空闲，会话无效时 warmPasswordCache 内部门控自动跳过
          void (async () => {
            const marked = await consumeMetadataFlushMarker();
            if (marked && isMetadataOnlyChange(passwordsChange.oldValue, passwordsChange.newValue)) {
              const patched = await applyMetadataOnlyUpdate(passwordsChange.newValue).catch(error => {
                logger.error('Background: 元数据原地修补失败，回退全量失效:', error);
                return false;
              });
              if (patched) {
                logger.debug('Background: 元数据 flush 命中，已原地修补缓存与快照');
                return;
              }
            }
            invalidatePasswordCache();
            void warmPasswordCache();
          })();
        } else if (passwordsChange) {
          // PASSWORDS + SIDEPANEL_SORT_CONFIG 复合事件：全量失效（重置 _cachedSortConfig）
          // + 回温重读新排序并重建快照，不保留旧快照（内嵌排序已陈旧）
          invalidatePasswordCache();
          void warmPasswordCache();
        } else {
          // 纯排序配置变更：密码数据未变，覆盖式重建快照（读新 sortConfig）
          // 避免全量解密回温；同事件内伴随会话键变更时不保留重建（锁定/清除
          // 语义优先 fail-locked 删快照），其回温时机由下方会话分支自行处理
          const hasSessionKeyChange =
            SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY in changes || SESSION_STORAGE_KEYS.PASSWORD_EXPIRY in changes;
          invalidatePasswordCache(STORAGE_KEYS.SIDEPANEL_SORT_CONFIG in changes && !hasSessionKeyChange);
        }
      }

      // at-rest 安全网：旧版升级期并发 CRUD 写入可能把尚未迁移的明文重新写回，
      // 检测到明文残留时请求后台重跑一次密文化，尽快自愈明文再落盘窗口。
      // 回收站同等纳入：moveToTrash 原样搬移磁盘条目，明文窗口内的删除会把它带进回收站。
      // 稳态全密文时 some() 快速返回、无副作用；迁移写回全密文后不再触发，无循环。
      for (const atRestChange of [passwordsChange, changes[STORAGE_KEYS.TRASH]]) {
        const newValue = atRestChange?.newValue as { encrypted?: boolean }[] | undefined;
        if (Array.isArray(newValue) && newValue.some(e => e.encrypted !== true)) {
          requestReEncryptAtRest();
          break;
        }
      }

      // 会话状态变化时同步 SW 保活闹钟（统一常驻，幂等；会话创建/清除均收敛到保活）
      const sessionKeys: string[] = [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY, SESSION_STORAGE_KEYS.PASSWORD_EXPIRY];
      const sessionKeyChanges = Object.entries(changes).filter(([key]) => sessionKeys.includes(key));

      if (sessionKeyChanges.length > 0) {
        // 检测会话键是否被删除（clearSession 从任意上下文调用都会触发 storage 变化）
        // 这是通用安全网：覆盖手动清除（弹窗）、自动过期、锁定按钮等所有清除路径
        const sessionRemoved = sessionKeyChanges.some(([, change]) => change.newValue === undefined);

        // 工具栏图标跟随会话材料出现 / 消失：本分支天然覆盖全部锁定与解锁入口
        // （弹窗手动锁定、倒计时到期、浏览器重启重锁、闲置锁定、设置与验证主密码、换钥），
        // 因为它们最终都要么清除要么写入这两个键，无需在每个入口逐个接线
        setActionIconState(sessionRemoved ? 'locked' : 'unlocked');

        if (sessionRemoved) {
          // 会话被清除：重置 BG 的会话内存镜像与验证缓存，防止 isSessionValid() 依据
          // 陈旧镜像（另一上下文执行的 clearSession 不会清空本上下文的镜像）跳过回读
          // storage 而继续返回过期的 true
          resetSessionMemoryState();
          // 明文缓存必须显式失效：上方 hasRelevantChange 块在「元数据 flush + 会话清除」
          // 被 Chrome 合并进同一个 onChanged 事件时会走原地修补分支并保留缓存，
          // 那样锁定后 SW 仍持有整库明文。锁定语义优先于修补带来的快路径收益。
          invalidatePasswordCache();
          // 会话清除安全网：一次性收口所有锁定入口（弹窗手动锁定/倒计时到期/锁定按钮），
          // 同步清除全部两步接力标记
          void clearAllPendingTotp();

          // 通知所有打开的 UI 上下文切换到未验证状态
          for (const port of getSidePanelPorts()) {
            try {
              port.postMessage({ type: MessageType.SESSION_EXPIRED });
            } catch {
              // port 可能已断开
            }
          }
          chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED }).catch(() => {
            // 无监听者时忽略（sendMessage 无接收者会异步 reject，同步 try/catch 无法捕获）
          });

          logger.debug('Background: 检测到会话清除，已通知所有上下文');

          // 会话清除后经 syncSwKeepaliveAlarm 统一决策保活：全平台常驻，
          // 覆盖手动清除/自动过期/闲置锁定等所有经 storage 变化到达的清除路径
          void syncSwKeepaliveAlarm();
        } else {
          // rekey 自愈：包裹数据密钥被更新（修改主密码/重新登录）时，先失效 SW 内存中的
          // 旧数据密钥热缓存，确保下方 warmPasswordCache 用新密钥解密预热，
          // 避免旧密钥解密失败产出「已认证的空缓存」毒化 GET_INITIAL_DATA 热路径
          const wrappedKeyChange = changes[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY];
          if (wrappedKeyChange?.newValue !== undefined) {
            adoptRekeyedSession(
              wrappedKeyChange.newValue as string,
              changes[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]?.newValue as number | undefined,
              changes[SESSION_STORAGE_KEYS.VALIDITY_HOURS]?.newValue as number | undefined,
            );
          }

          syncSwKeepaliveAlarm();

          // 会话创建/rekey 后主动预热缓存，确保首次 sidepanel 打开时数据就绪。
          // 只放在本分支：锁定/清除路径不得重新预热——那会带着（可能仍陈旧的）会话密钥
          // 重建 SW 明文库与 storage.session 快照，把上锁刚销毁的密钥材料又放回去。
          void warmPasswordCache();
        }
      }

      if (STORAGE_KEYS.EMAIL_BACKUP_CONFIG in changes) {
        logger.debug('Background: 邮箱备份配置变化，重新设置自动备份闹钟');
        setupAutoBackupAlarm();
      }
    }
  });

  // 监听 alarm 事件
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === AUTO_BACKUP_ALARM_NAME) {
      logger.info('Background: 触发自动备份闹钟');
      performAutoBackup();
    } else if (alarm.name === UPDATE_CHECK_ALARM_NAME) {
      logger.info('Background: 触发版本更新检测闹钟');
      performUpdateCheck();
    } else if (alarm.name === TRASH_CLEANUP_ALARM_NAME) {
      logger.info('Background: 触发回收站过期清理闹钟');
      performTrashCleanup();
    } else if (alarm.name === PASSWORD_REMINDER_ALARM_NAME) {
      logger.info('Background: 触发密码到期提醒检查闹钟');
      performReminderCheck();
    } else if (alarm.name === SW_KEEPALIVE_ALARM_NAME) {
      // 复活闹钟触发（SW 被强杀后的唤醒入口；心跳存活期间本 tick 仅是例行唤醒）：
      // 借本次保活唤醒顺带预热侧边栏渲染资源（温热磁盘/JS chunk 缓存，
      // 缓解冷启动白屏）。懒 import 延迟模块初始化（SW 产物已内联）；函数内自带
      // 平台门控与 5min 持久化节流（storage.session，SW 重启不归零）：
      // Windows 全量预热且不区分会话状态（磁盘缓存逐出与会话有效性无关）；
      // 非 Windows 经 allowNonWindowsLightweight 轻量预热首屏关键资源 + 认证视图
      // 与本地数据直读关键 chunk（覆盖 macOS 磁盘缓存逐出后的认证态冷读白屏与
      // 浏览器重启快照失效后的本地路径冷读；保活常驻——持续温热，覆盖
      // Chrome 长时间聚焦无窗口切换事件的场景）
      void import('@/utils/warmSidePanelResources')
        .then(m => m.maybeWarmSidePanelResources({ allowNonWindowsLightweight: true }))
        .catch(() => {});

      // 定期重同步保活（幂等）：SW 被强杀复活后经此重建心跳定时器
      void syncSwKeepaliveAlarm();

      // SW 保活：alarm 触发本身即已唤醒 SW，重置 30 秒空闲计时器。
      // 仅当「会话键存在且已过期」时执行一次性上锁；expiry 为空（无会话，含已上锁）
      // 或未来（会话有效）时不做任何处理，仅借本次唤醒保持 SW 热。
      // 该条件天然防止常驻场景下每 30 秒重复上锁 / 重复广播 SESSION_EXPIRED：
      // clearSession 会删除 PASSWORD_EXPIRY，后续 alarm 读到 expiry 为空即跳过。
      chrome.storage.local
        .get([SESSION_STORAGE_KEYS.PASSWORD_EXPIRY])
        .then(async result => {
          const expiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | undefined;
          if (expiry && Date.now() >= expiry) {
            invalidatePasswordCache();
            // 会话到期锁定属安全边界：同步清除全部两步接力标记
            void clearAllPendingTotp();
            // 使用 markSessionInvalid() 而非 invalidateSessionCache()：
            // 时间过期场景下 storage 中的会话键仍然存在，invalidateSessionCache() 设为 null
            // 会导致 isSessionValid() 回退到 storage 检查并误判为有效；
            // markSessionInvalid() 直接标记 {valid: false}，5s TTL 内立即返回 false
            markSessionInvalid();

            // 主动锁定：在会话仍存活的 SW 中一次性销毁会话密钥材料与解密快照
            // （storage.local 本就是密文，无需整库重加密），
            // 使用户之后打开侧边栏走 isSessionValid 的「无会话键 → 立即 false」快路径，
            // 从根上把锁定开销留在后台，避免拖到打开侧边栏时才执行（Windows 慢磁盘下可达数秒）。
            const StorageUtils = await _getStorageUtils();
            await StorageUtils.clearSession().catch(e => {
              logger.error('Background: SW 保活闹钟过期锁定失败:', e);
            });

            // 经 syncSwKeepaliveAlarm 统一决策保活：全平台常驻，
            // 使会话失效后打开侧边栏仍走热 SW，消除白屏
            await syncSwKeepaliveAlarm();

            // 通知打开的侧边栏切换到未验证状态
            for (const port of getSidePanelPorts()) {
              try {
                port.postMessage({ type: MessageType.SESSION_EXPIRED });
              } catch {
                // port 可能已断开
              }
            }
            chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED }).catch(() => {
              // 无监听者时忽略（sendMessage 无接收者会异步 reject，同步 try/catch 无法捕获）
            });

            logger.debug('Background: 会话已过期，已锁定并加密，缓存已清除，保活闹钟状态已同步');
          }
        })
        .catch(() => {
          // storage 读取失败时静默忽略，下次 alarm 触发会重试
        });
    }
  });
}
