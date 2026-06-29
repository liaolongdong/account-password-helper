import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/encryption';
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
import { invalidatePasswordCache } from './passwordCache';

/** 自动备份提醒闹钟名称 */
const AUTO_BACKUP_ALARM_NAME = 'auto-backup-passwords';

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
    }
  });
}
