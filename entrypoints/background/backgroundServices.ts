import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { StorageUtils } from '@/utils/storage';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import {
  checkForUpdate,
  getCachedUpdateInfo,
  getReleasesPageUrl,
  UPDATE_CHECK_ALARM_NAME,
  UPDATE_CHECK_INTERVAL_MINUTES,
} from '@/utils/updateChecker';
import { getSidePanelPort } from './sidePanelManager';
import { invalidatePasswordCache, warmPasswordCache } from './passwordCache';

/** 自动备份提醒闹钟名称 */
const AUTO_BACKUP_ALARM_NAME = 'auto-backup-passwords';

/**
 * Service Worker 保活闹钟名称
 *
 * 在会话有效期内定期唤醒 SW，防止因 30 秒空闲超时被终止，
 * 确保 passwordCache（内存缓存）持续可用，使侧边栏首屏加载走缓存竞速快速通道。
 */
const SW_KEEPALIVE_ALARM_NAME = 'sw-keepalive';

/**
 * SW 保活间隔（分钟）
 *
 * Chrome 扩展 MV3 的 chrome.alarms.create 最小 periodInMinutes 为 0.5（30 秒），
 * 但实际测试中部分 Chrome 版本限制为 1 分钟。使用 1 分钟确保兼容性。
 * 每次 alarm 触发会重置 SW 的 30 秒空闲计时器，从而保持 SW 存活。
 */
const SW_KEEPALIVE_INTERVAL_MINUTES = 1;

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
        title: '插件有新版本可用',
        message: `发现新版本 v${updateInfo.latestVersion}，点击前往下载更新。`,
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
      title: '密码备份提醒',
      message: `您配置的自动备份时间已到，共有 ${passwordCount} 条密码待备份。请在密码管理页面点击"备份到邮箱"按钮手动完成备份。`,
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
 * 仅在会话有效期内启用，会话过期后自动停止，避免无谓的 CPU 和电池消耗。
 */
async function setupSwKeepaliveAlarm(): Promise<void> {
  try {
    await chrome.alarms.clear(SW_KEEPALIVE_ALARM_NAME);
    await chrome.alarms.create(SW_KEEPALIVE_ALARM_NAME, {
      periodInMinutes: SW_KEEPALIVE_INTERVAL_MINUTES,
    });
    logger.debug('Background: SW 保活闹钟已启用');
  } catch (error) {
    logger.error('Background: 设置 SW 保活闹钟失败:', error);
  }
}

/**
 * 停止 Service Worker 保活闹钟
 *
 * 会话过期或清除时调用，避免无会话时的无效唤醒。
 */
async function clearSwKeepaliveAlarm(): Promise<void> {
  try {
    await chrome.alarms.clear(SW_KEEPALIVE_ALARM_NAME);
    logger.debug('Background: SW 保活闹钟已停止');
  } catch (error) {
    logger.error('Background: 停止 SW 保活闹钟失败:', error);
  }
}

/**
 * 根据会话状态同步 SW 保活闹钟
 *
 * 检查 storage 中是否存在有效的会话（session_master_password + session_password_expiry），
 * 有效则启用保活闹钟，无效则停止。在 SW 启动、会话创建/清除时调用。
 *
 * Windows 性能优化核心：SW 保活使 passwordCache 持续在内存中，
 * 侧边栏的缓存竞速（GET_CACHED_PASSWORDS）可在 20-50ms 内命中，
 * 避免因 SW 冷启动（Windows 300-800ms）导致竞速超时回退到慢速 storage 直读路径。
 */
export async function syncSwKeepaliveAlarm(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      SESSION_STORAGE_KEYS.MASTER_PASSWORD,
      SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
    ]);

    const hasSession = !!(
      result[SESSION_STORAGE_KEYS.MASTER_PASSWORD] &&
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
 * 初始化后台配置（在 onInstalled 时调用）
 * 创建闹钟和设置闲置锁定
 */
export function initBackgroundConfig(): void {
  setupAutoBackupAlarm();
  setupIdleLock();
  setupUpdateCheckAlarm();
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
          await StorageUtils.clearSession();
          logger.info('Background: 系统锁定，已清除主密码会话');

          invalidatePasswordCache();
          await clearSwKeepaliveAlarm();

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
        SESSION_STORAGE_KEYS.MASTER_PASSWORD,
        SESSION_STORAGE_KEYS.PASSWORD_EXPIRY,
      ];
      const hasRelevantChange = Object.keys(changes).some(key => relevantKeys.includes(key));

      if (hasRelevantChange) {
        logger.debug('Background: 检测到存储变化，使缓存失效');
        invalidatePasswordCache();
      }

      // 会话状态变化时同步 SW 保活闹钟（会话创建 → 启用，会话清除 → 停止）
      const sessionKeys = [SESSION_STORAGE_KEYS.MASTER_PASSWORD, SESSION_STORAGE_KEYS.PASSWORD_EXPIRY];
      if (Object.keys(changes).some(key => sessionKeys.includes(key))) {
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
    } else if (alarm.name === SW_KEEPALIVE_ALARM_NAME) {
      // SW 保活：alarm 触发本身即已唤醒 SW，重置 30 秒空闲计时器
      // 额外检查会话有效性，过期则停止保活闹钟以节省资源
      chrome.storage.local
        .get([SESSION_STORAGE_KEYS.PASSWORD_EXPIRY])
        .then(result => {
          const expiry = result[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] as number | undefined;
          if (!expiry || Date.now() >= expiry) {
            clearSwKeepaliveAlarm();
            logger.debug('Background: 会话已过期，SW 保活闹钟已自动停止');
          }
        })
        .catch(() => {
          // storage 读取失败时静默忽略，下次 alarm 触发会重试
        });
    }
  });
}
