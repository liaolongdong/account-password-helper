import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import {
  SESSION_STORAGE_KEYS,
  invalidateSessionCache,
  markSessionInvalid,
  requestReEncryptAtRest,
  adoptRekeyedSession,
} from '@/utils/sessionManager-storage';
import {
  checkForUpdate,
  getCachedUpdateInfo,
  getReleasesPageUrl,
  UPDATE_CHECK_ALARM_NAME,
  UPDATE_CHECK_INTERVAL_MINUTES,
} from '@/utils/updateChecker';
import { detectWindowsPlatform } from '@/utils/platform';
import { getSidePanelPort } from './sidePanelManager';
import {
  invalidatePasswordCache,
  warmPasswordCache,
  applyMetadataOnlyUpdate,
  consumeMetadataFlushMarker,
  isMetadataOnlyChange,
} from './passwordCache';
import { tl } from '@/utils/i18n-lite';

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
 * 保活机制分两层协作（启停门控一致：Windows 常驻 / 非 Windows 仅会话有效期）：
 * - 心跳层（连续保活）：SW 存活期间以 setInterval 每 20s 调用一次轻量扩展 API，
 *   Chrome ≥110 任何扩展 API 调用都会重置 SW 的 30s 空闲计时器，实现确定性连续保活；
 * - 闹钟层（复活入口）：SW 一旦被强杀（浏览器内存压力/崩溃恢复等），心跳随之消失，
 *   由本闹钟在下个周期唤醒 SW，SW 启动路径（syncSwKeepaliveAlarm）重新拉起心跳。
 *
 * 注意：chrome.alarms 轮询粒度 ≥30s（多闹钟错相会被合并到同一轮询，无法收窄间隔），
 * 故闹钟只承担「死亡后复活」职责，「存活期不死亡」由心跳层保证。
 *
 * 保活的业务价值：
 * - 会话有效期内（全平台）：保持 passwordCache（内存缓存）常驻，使侧边栏首屏走缓存竞速快速通道。
 * - Windows 会话失效后（差异化策略）：保持热 SW，使侧边栏任何打开路径（悬浮按钮消息 /
 *   快捷键命令）都无需等待 SW 全量冷启动（Windows 冷盘+杀软场景可达数秒，白屏主因）。
 */
const SW_KEEPALIVE_ALARM_NAME = 'sw-keepalive';

/** SW 心跳间隔（毫秒）：< 30s 空闲阈值并留足调度余量 */
const SW_HEARTBEAT_INTERVAL_MS = 20000;

/** SW 心跳定时器（模块级，SW 生命周期内有效；SW 重启后由 syncSwKeepaliveAlarm 重建） */
let _swHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 浏览器启动引导期保活窗口时长（毫秒）
 *
 * 浏览器刚启动后 OS 磁盘缓存全冷、V8 无 code cache、SW 空闲即死，
 * 首次打开侧边栏命中「SW 冷启 + 渲染进程冷创建 + chunk 冷读编译」三冷叠加白屏
 * （Mac 重启后前几次打开的长白屏即此场景，多开几次后各级缓存变热才恢复秒开）。
 * 窗口内跨平台强制 SW 保活（无视平台/会话门控），把 SW 冷启动从首开链路中摘除；
 * 窗口截止后由保活 tick 内的重同步自动收敛回常规门控
 * （Windows 常驻 / 非 Windows 仅会话有效期），不增加 Mac 的常态电量开销。
 */
const BOOT_KEEPALIVE_WINDOW_MS = 10 * 60 * 1000;

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
 */
async function performReminderCheck() {
  try {
    const { getDueReminders, markNotified } = await import('@/utils/storage/reminderManager');
    const dueReminders = await getDueReminders();

    if (dueReminders.length === 0) return;

    for (const reminder of dueReminders) {
      const notificationId = `password-reminder-${reminder.entryId}`;
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title: tl('bg.reminder.title'),
        message: tl('bg.reminder.message', { username: reminder.username }),
      });
      await markNotified(reminder.entryId);
      logger.info(`Background: 密码提醒已发送 [${reminder.username}]`);
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
 */
async function performTrashCleanup() {
  try {
    const { cleanExpiredTrash } = await import('@/utils/storage/trashManager');
    await cleanExpiredTrash();
  } catch (error) {
    logger.error('Background: 回收站过期清理失败:', error);
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

    if (passwordCount === 0) {
      logger.info('Background: 无密码数据，跳过备份提醒');
      return;
    }

    await StorageUtils.setLastAutoBackupTime();

    await chrome.notifications.create('auto-backup-reminder', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: tl('bg.backup.title'),
      message: tl('bg.backup.message', { count: passwordCount }),
    });

    logger.info(`Background: 自动备份提醒已发送，密码条目数: ${passwordCount}`);
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
 * 启用时机见 syncSwKeepaliveAlarm：非 Windows 仅会话有效期内启用（过期即停止以省资源）；
 * Windows 始终启用（含会话失效后），以消除侧边栏打开时的冷启动白屏。
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
 * 停止 Service Worker 保活（心跳定时器 + 复活闹钟一并停止）
 *
 * 非 Windows 在会话过期或清除时调用，避免无会话时的无效唤醒；
 * Windows 上因需常驻保活，各上锁路径改调 syncSwKeepaliveAlarm，不会走到此处停止。
 */
async function clearSwKeepaliveAlarm(): Promise<void> {
  try {
    if (_swHeartbeatTimer) {
      clearInterval(_swHeartbeatTimer);
      _swHeartbeatTimer = null;
    }
    await chrome.alarms.clear(SW_KEEPALIVE_ALARM_NAME);
    logger.debug('Background: SW 保活已停止');
  } catch (error) {
    logger.error('Background: 停止 SW 保活失败:', error);
  }
}

/**
 * 标记浏览器启动引导期保活窗口并立即同步保活状态
 *
 * 在 chrome.runtime.onStartup 时调用。窗口截止时间戳写入 storage.session：
 * 仅内存不落盘、浏览器重启自动清零——与「引导期」语义天然一致；
 * SW 空闲重启不清零，窗口内 SW 复活后仍能恢复强制保活。
 */
export async function markBrowserBootKeepaliveWindow(): Promise<void> {
  try {
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.SW_BOOT_KEEPALIVE_UNTIL]: Date.now() + BOOT_KEEPALIVE_WINDOW_MS,
    });
  } catch (error) {
    logger.error('Background: 标记启动引导期保活窗口失败:', error);
  }
  await syncSwKeepaliveAlarm();
}

/**
 * 判断当前是否处于浏览器启动引导期保活窗口内（读取失败按不在窗口内处理）
 */
async function isWithinBootKeepaliveWindow(): Promise<boolean> {
  try {
    const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.SW_BOOT_KEEPALIVE_UNTIL);
    const until = result[SESSION_MEMORY_KEYS.SW_BOOT_KEEPALIVE_UNTIL] as number | undefined;
    return !!until && Date.now() < until;
  } catch {
    return false;
  }
}

/**
 * 根据平台与会话状态同步 SW 保活闹钟
 *
 * - Windows（差异化策略）：始终启用保活闹钟，无论会话是否有效。使侧边栏任何打开路径
 *   （悬浮按钮消息 / 快捷键命令）都命中热 SW，从根上消除会话失效后 Chrome 冷启动
 *   （Windows 300-800ms 起，极端可达数秒）导致的白屏卡顿。
 * - 非 Windows：仅在会话有效期内启用，会话过期/清除后停止，避免无谓的 CPU 和电池消耗
 *   （Mac 冷启动足够快，本就秒开，无需常驻）。
 *
 * 在 SW 启动、会话创建/清除、上锁等时机调用，作为「是否保活」的集中决策点。
 */
export async function syncSwKeepaliveAlarm(): Promise<void> {
  try {
    // 启动引导期窗口（跨平台，先于平台/会话门控判定）：浏览器重启后全冷阶段
    // 强制保活，覆盖 Mac 重启后前几次打开的三冷叠加白屏；
    // 顺带覆盖引导期内平台判定异常的场景（此时更不能让 SW 死亡）
    if (await isWithinBootKeepaliveWindow()) {
      await setupSwKeepaliveAlarm();
      return;
    }

    // 三态平台判定：null = 判定不可得（getPlatformInfo 异常且无持久化兜底）。
    // fail-safe：判定不可得时维持现有闹钟状态不动——宁可多保活一轮，
    // 也不可把 Windows 的常驻保活误清（误清 → 失效期 SW 死亡 → 点击打开
    // 撞全量冷启动 → 数秒白屏），下次同步时机自然重试
    const isWin = await detectWindowsPlatform();
    if (isWin === null) {
      logger.warn('Background: 平台判定不可得，保活闹钟维持现状（fail-safe）');
      return;
    }

    // Windows：始终常驻保活，短路返回，不依赖会话状态
    if (isWin) {
      await setupSwKeepaliveAlarm();
      return;
    }

    // 非 Windows：仅会话有效期内保活
    const result = await chrome.storage.local.get([
      SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY,
      SESSION_STORAGE_KEYS.MASTER_PASSWORD,
      SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    ]);

    const hasSession = !!(
      (result[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY] || result[SESSION_STORAGE_KEYS.MASTER_PASSWORD]) &&
      result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] &&
      Date.now() < (result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number)
    );

    if (hasSession) {
      await setupSwKeepaliveAlarm();
    } else {
      await clearSwKeepaliveAlarm();
    }
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
export async function handleBrowserStartupRelock(): Promise<void> {
  try {
    const StorageUtils = await _getStorageUtils();
    const config = await StorageUtils.getIdleLockConfig();
    if (!config.relockOnBrowserRestart) return;

    // 显式、同步地完成清理：clearSession 触发的 storage.onChanged 虽也会失效缓存 / 同步保活闹钟，
    // 但此处不依赖该异步事件时序，直接调用以确保浏览器启动重锁即时生效（防御性冗余）。
    await StorageUtils.clearSession();
    invalidatePasswordCache();
    // 经 syncSwKeepaliveAlarm 统一决策保活：非 Windows 会话已清除→停止；Windows→保持常驻热 SW。
    await syncSwKeepaliveAlarm();
    logger.info('Background: 已按设置在浏览器启动时清除会话，需重新输入主密码');
  } catch (error) {
    logger.error('Background: 浏览器启动重锁处理失败:', error);
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
  // SW 启动时同步保活闹钟状态：会话有效则启用，无效则停止
  syncSwKeepaliveAlarm();

  // 延迟预热密码缓存：SW 启动后 500ms 异步执行，不阻塞其他初始化
  // 当会话有效时从 storage 加载密码列表到内存缓存，
  // 使首次 sidepanel 打开时 GET_INITIAL_DATA 可直接命中缓存（~1ms）
  setTimeout(() => warmPasswordCache(), 500);

  // 监听闲置状态变化
  chrome.idle.onStateChanged.addListener(async newState => {
    if (newState === 'locked') {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.IDLE_LOCK_CONFIG);
        const config = result[STORAGE_KEYS.IDLE_LOCK_CONFIG] as { idleLockMinutes: number } | undefined;
        const minutes = config?.idleLockMinutes ?? 0;

        if (minutes > 0) {
          const StorageUtils = await _getStorageUtils();
          await StorageUtils.clearSession();
          logger.info('Background: 系统锁定，已清除主密码会话');

          invalidatePasswordCache();
          // 经 syncSwKeepaliveAlarm 统一决策保活：非 Windows 会话已清除→停止；Windows→保持常驻热 SW。
          await syncSwKeepaliveAlarm();

          const port = getSidePanelPort();
          if (port) {
            try {
              port.postMessage({ type: MessageType.SESSION_EXPIRED });
            } catch {
              // port 可能已断开
            }
          }

          try {
            await chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
          } catch {
            // 无监听者时 sendMessage 会抛错，忽略
          }
        }
      } catch (error) {
        logger.error('Background: 闲置锁定处理失败:', error);
      }
    }
  });

  // 启动时检查缓存的更新信息，恢复徽标状态
  getCachedUpdateInfo().then(info => {
    if (info) {
      showUpdateBadge();
    }
  });

  // 监听通知点击事件
  chrome.notifications.onClicked.addListener(notificationId => {
    if (notificationId === 'extension-update-available') {
      chrome.tabs.create({ url: getReleasesPageUrl() });
      chrome.notifications.clear('extension-update-available');
      clearUpdateBadge();
    } else if (notificationId.startsWith('password-reminder-')) {
      // 密码提醒通知点击：打开选项页面
      chrome.runtime.openOptionsPage();
      chrome.notifications.clear(notificationId);
    }
  });

  // 监听 storage 变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (STORAGE_KEYS.IDLE_LOCK_CONFIG in changes) {
        setupIdleLock();
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
      // 稳态全密文时 some() 快速返回、无副作用；迁移写回全密文后不再触发，无循环。
      if (passwordsChange) {
        const newPasswords = passwordsChange.newValue as { encrypted?: boolean }[] | undefined;
        if (Array.isArray(newPasswords) && newPasswords.some(e => e.encrypted !== true)) {
          requestReEncryptAtRest();
        }
      }

      // 会话状态变化时同步 SW 保活闹钟（会话创建 → 启用，会话清除 → 停止）
      const sessionKeys = [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY, SESSION_STORAGE_KEYS.PASSWORD_EXPIRY];
      const sessionKeyChanges = Object.entries(changes).filter(([key]) => sessionKeys.includes(key));

      if (sessionKeyChanges.length > 0) {
        // 检测会话键是否被删除（clearSession 从任意上下文调用都会触发 storage 变化）
        // 这是通用安全网：覆盖手动清除（弹窗）、自动过期、锁定按钮等所有清除路径
        const sessionRemoved = sessionKeyChanges.some(([, change]) => change.newValue === undefined);

        if (sessionRemoved) {
          // 会话被清除：清除 BG 的会话验证缓存，防止 isSessionValid() 返回过期的 true
          invalidateSessionCache();

          // 通知所有打开的 UI 上下文切换到未验证状态
          const port = getSidePanelPort();
          if (port) {
            try {
              port.postMessage({ type: MessageType.SESSION_EXPIRED });
            } catch {
              // port 可能已断开
            }
          }
          try {
            chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
          } catch {
            // 无监听者时忽略
          }

          logger.debug('Background: 检测到会话清除，已通知所有上下文');
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
        }

        syncSwKeepaliveAlarm();
        // 会话创建后主动预热缓存，确保首次 sidepanel 打开时数据就绪
        warmPasswordCache();
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
      // Windows 借本次保活唤醒顺带预热侧边栏渲染资源（温热磁盘/JS chunk 缓存，
      // 缓解冷启动白屏）。懒 import 延迟模块初始化（SW 产物已内联）；函数内自带平台
      // 门控与 5min 持久化节流（storage.session，SW 重启不归零），非 Windows 直接跳过，
      // Windows 不区分会话状态（磁盘缓存逐出与会话有效性无关）。
      void import('@/utils/warmSidePanelResources').then(m => m.maybeWarmSidePanelResources()).catch(() => {});

      // 定期重同步保活门控（幂等、开销为 1-2 次 storage 读）：
      // 启动引导期窗口截止后，非 Windows 会话失效场景经此收敛停活
      // （无此重同步，引导期启用的保活会因无其他同步时机而永久存续）
      void syncSwKeepaliveAlarm();

      // SW 保活：alarm 触发本身即已唤醒 SW，重置 30 秒空闲计时器。
      // 仅当「会话键存在且已过期」时执行一次性上锁；expiry 为空（无会话，含已上锁）
      // 或未来（会话有效）时不做任何处理，仅借本次唤醒保持 SW 热。
      // 该条件天然防止 Windows 常驻场景下每 30 秒重复上锁 / 重复广播 SESSION_EXPIRED：
      // clearSession 会删除 PASSWORD_EXPIRY，后续 alarm 读到 expiry 为空即跳过。
      chrome.storage.local
        .get([SESSION_STORAGE_KEYS.PASSWORD_EXPIRY])
        .then(async result => {
          const expiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | undefined;
          if (expiry && Date.now() >= expiry) {
            invalidatePasswordCache();
            // 使用 markSessionInvalid() 而非 invalidateSessionCache()：
            // 时间过期场景下 storage 中的会话键仍然存在，invalidateSessionCache() 设为 null
            // 会导致 isSessionValid() 回退到 storage 检查并误判为有效；
            // markSessionInvalid() 直接标记 {valid: false}，5s TTL 内立即返回 false
            markSessionInvalid();

            // 主动锁定：会话仍存活的 SW 中一次性完成「加密全部密码 + 删除会话键」，
            // 使用户之后打开侧边栏走 isSessionValid 的「无会话键 → 立即 false」快路径，
            // 从根上避免打开侧边栏时才触发全量重加密（Windows Web Crypto 慢导致数秒卡顿）。
            const StorageUtils = await _getStorageUtils();
            await StorageUtils.clearSession().catch(e => {
              logger.error('Background: SW 保活闹钟过期锁定失败:', e);
            });

            // 经 syncSwKeepaliveAlarm 统一决策保活：非 Windows 会话已清除→停止闹钟以省资源；
            // Windows→保持常驻，使会话失效后打开侧边栏仍走热 SW，消除白屏。
            await syncSwKeepaliveAlarm();

            // 通知打开的侧边栏切换到未验证状态
            const port = getSidePanelPort();
            if (port) {
              try {
                port.postMessage({ type: MessageType.SESSION_EXPIRED });
              } catch {
                // port 可能已断开
              }
            }
            try {
              chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
            } catch {
              // 无监听者时忽略
            }

            logger.debug('Background: 会话已过期，已锁定并加密，缓存已清除，保活闹钟状态已按平台同步');
          }
        })
        .catch(() => {
          // storage 读取失败时静默忽略，下次 alarm 触发会重试
        });
    }
  });
}
