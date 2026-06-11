import { defineBackground } from '#imports';
import { Message, MessageType, PasswordCache, PasswordEntry, AutoSavePasswordData } from '../utils/types';
import { logger } from '../utils/logger';
import { STORAGE_KEYS } from '@/utils/encryption';
import { StorageUtils } from '@/utils/storage';
import type { EmailBackupConfig } from '../utils/types';

export default defineBackground(() => {
  // 通过 port 连接跟踪 sidepanel 的打开状态
  let sidePanelPort: chrome.runtime.Port | null = null;

  // 密码缓存
  let passwordCache: PasswordCache | null = null;

  // 插件安装时的初始化
  chrome.runtime.onInstalled.addListener(() => {
    logger.info('账号密码管理助手插件已安装');
    setupAutoBackupAlarm();
  });

  // 监听 sidepanel 的 port 连接，用于可靠地追踪打开/关闭状态
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'sidepanel') {
      logger.debug('SidePanel 已连接');
      sidePanelPort = port;

      // 监听 port 断开（sidepanel 关闭时触发）
      port.onDisconnect.addListener(() => {
        logger.debug('SidePanel 已断开连接');
        sidePanelPort = null;
      });
    }
  });

  // 监听快捷键命令
  // commands.onCommand 是合法的用户手势来源
  chrome.commands.onCommand.addListener(command => {
    if (command === 'open_options') {
      openOptionsPage();
    } else if (command === 'toggle_sidepanel') {
      // 快捷键触发：获取当前标签页并切换侧边栏
      // 使用 Promise 链而非 async/await，尽量保持用户手势链
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(tabs => {
          const tabId = tabs[0]?.id;
          if (!tabId) {
            logger.warn('Background: 无法获取当前标签页');
            return;
          }

          if (!chrome.sidePanel) {
            logger.error('Background: 当前Chrome版本不支持sidePanel API');
            return;
          }

          if (sidePanelPort) {
            // 侧边栏已打开 → 关闭
            closeSidePanel(tabId);
          } else {
            // 侧边栏未打开 → 打开
            chrome.sidePanel
              .open({ tabId })
              .then(() => logger.debug('Background: 侧边栏已打开 (快捷键)'))
              .catch(error => logger.error('Background: 快捷键打开侧边栏失败:', error));
          }
        })
        .catch(error => logger.error('Background: 快捷键切换侧边栏失败:', error));
    }
  });

  // 监听来自 content script 和 popup 的消息
  // 关键：SHOW_SIDEPANEL 和 TOGGLE_SIDEPANEL 必须在同步执行路径中调用 sidePanel.open()
  // 不能在调用 open() 之前使用 await，否则会打断用户手势链
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    switch (message.type) {
      case MessageType.SHOW_SIDEPANEL: {
        // 同步提取 tabId，不使用 await，保持用户手势链
        const tabId = getTabIdSync(sender, message);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        // 直接调用 open()，保持用户手势上下文
        chrome.sidePanel
          .open({ tabId })
          .then(() => {
            logger.debug('Background: 侧边栏已打开, tabId:' + tabId);
            sendResponse({ success: true, result: '侧边栏已打开' });
          })
          .catch(error => {
            logger.error('Background: 打开侧边栏失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }

      case MessageType.HIDE_SIDEPANEL: {
        const tabId = getTabIdSync(sender, message);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        closeSidePanelWithResponse(tabId, sendResponse);
        return true;
      }

      case MessageType.TOGGLE_SIDEPANEL: {
        // 同步提取 tabId，不使用 await，保持用户手势链
        const tabId = getTabIdSync(sender, message);
        if (!tabId) {
          sendResponse({ success: false, error: '无法获取标签ID' });
          break;
        }

        if (!chrome.sidePanel) {
          sendResponse({ success: false, error: '当前Chrome版本不支持sidePanel API' });
          break;
        }

        logger.debug('Background: 切换侧边栏, tabId:' + tabId + ', port状态:' + !!sidePanelPort);

        if (sidePanelPort) {
          // 侧边栏已打开 → 关闭（close 不要求用户手势）
          closeSidePanelWithResponse(tabId, sendResponse);
        } else {
          // 侧边栏未打开 → 打开（必须在用户手势上下文中同步调用）
          chrome.sidePanel
            .open({ tabId })
            .then(() => {
              logger.debug('Background: 侧边栏已打开');
              sendResponse({ success: true, result: '侧边栏已打开' });
            })
            .catch(error => {
              logger.error('Background: 打开侧边栏失败:', error);
              sendResponse({ success: false, error: error.message });
            });
        }
        return true;
      }

      case MessageType.URL_CHANGED: {
        const tabId = getTabIdSync(sender, message);
        if (tabId) {
          sendResponse({ success: true, result: 'URL变化处理完成' });
        } else {
          sendResponse({ success: false, error: '无法获取标签ID' });
        }
        break;
      }

      case MessageType.OPEN_OPTIONS_PAGE:
        openOptionsPage()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.error('处理OPEN_OPTIONS_PAGE失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case MessageType.GET_CACHED_PASSWORDS: {
        // 获取缓存的密码数据（异步）
        const requestedDomain = message.data?.domain;
        getCachedPasswords(requestedDomain).then(cachedData => {
          sendResponse({ success: true, data: cachedData });
        });
        return true; // 表示异步响应
      }

      case MessageType.UPDATE_PASSWORD_CACHE: {
        // 更新密码缓存
        const { passwords, domain, isAuthenticated } = message.data || {};
        if (passwords && domain !== undefined) {
          updatePasswordCache(passwords, domain, isAuthenticated);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: '缺少缓存数据' });
        }
        break;
      }

      case MessageType.INVALIDATE_PASSWORD_CACHE: {
        // 使缓存失效
        invalidatePasswordCache();
        sendResponse({ success: true });
        break;
      }

      case MessageType.AUTO_SAVE_PASSWORD: {
        // 保存密码（用户确认后由 content script 触发）
        const autoSaveData = message.data as AutoSavePasswordData;
        handleAutoSavePassword(autoSaveData).then(result => {
          sendResponse(result);
        });
        return true;
      }

      default:
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
  });

  /**
   * 同步获取 tabId（不使用 async/await，避免打断用户手势链）
   */
  function getTabIdSync(sender: chrome.runtime.MessageSender, message: Message): number | undefined {
    return (message.data?.tabId || sender.tab?.id) as number | undefined;
  }

  /**
   * 判断关闭侧边栏时的错误是否为预期错误
   * 预期错误场景：
   * - 侧边栏已被用户关闭或页面已导航，tab 上不存在 tab-specific side panel
   * - 扩展上下文失效（扩展重新加载）
   * - tabId 已失效
   */
  function isExpectedCloseError(error: unknown): boolean {
    const msg = (error as { message?: string } | undefined)?.message ?? String(error);
    return (
      msg.includes('No active tab-specific side panel') ||
      msg.includes('Extension context invalidated') ||
      msg.includes('No tab with id')
    );
  }

  /**
   * 关闭侧边栏（不需要用户手势）
   * 策略：优先使用 chrome.sidePanel.close() API，失败时降级到 setOptions 强制禁用/恢复 + port 通知 window.close()
   */
  function closeSidePanel(tabId: number): void {
    forceCloseSidePanel(tabId).catch(error => {
      logger.error('Background: 关闭侧边栏失败:', error);
    });
  }

  /**
   * 关闭侧边栏并发送响应
   */
  function closeSidePanelWithResponse(tabId: number, sendResponse: (response: any) => void): void {
    forceCloseSidePanel(tabId)
      .then(() => {
        sendResponse({ success: true, result: '侧边栏已关闭' });
      })
      .catch(error => {
        logger.error('Background: 关闭侧边栏失败:', error);
        // 即使失败也回复 success，避免调用方卡住；具体失败信息已记录日志
        sendResponse({ success: true, result: '侧边栏关闭请求已处理 (fallback)' });
      });
  }

  /**
   * 强制关闭侧边栏（多方案兜底）
   *
   * 关闭策略：
   * 1. 优先使用 chrome.sidePanel.close({ tabId }) API（Chrome 129+）
   * 2. 若 close API 不可用或失败：通过 setOptions({ enabled: false }) 强制禁用，
   *    随后恢复 enabled=true 保证下次能打开
   * 3. 同时通过 port 通知 sidepanel 执行 window.close() 作为 UI 层兜底
   */
  function forceCloseSidePanel(tabId: number): Promise<void> {
    // UI 层兜底：同时通过 port 通知 sidepanel 自行关闭
    trySendCloseViaPort();

    if (typeof chrome.sidePanel.close === 'function') {
      return chrome.sidePanel
        .close({ tabId })
        .then(() => {
          logger.debug('Background: 侧边栏已关闭 (close API)');
        })
        .catch(error => {
          if (isExpectedCloseError(error)) {
            logger.debug('Background: 侧边栏已不存在，视为关闭成功');
            sidePanelPort = null;
            return;
          }
          logger.warn('Background: close API 失败，尝试 setOptions 兜底:', error);
          return disableThenEnableSidePanel(tabId);
        });
    }

    // close API 不可用，直接走 setOptions 兜底
    return disableThenEnableSidePanel(tabId);
  }

  /**
   * 通过 setOptions 强制关闭并恢复侧边栏
   * 禁用 sidepanel 会使其立即关闭，随后恢复 enabled=true 以便下次能正常打开
   */
  function disableThenEnableSidePanel(tabId: number): Promise<void> {
    return chrome.sidePanel
      .setOptions({ tabId, enabled: false })
      .then(() => {
        logger.debug('Background: 侧边栏已强制禁用 (setOptions)');
        // 恢复 enabled=true，保证下次能正常打开
        return chrome.sidePanel.setOptions({
          tabId,
          path: 'sidepanel.html',
          enabled: true,
        });
      })
      .then(() => {
        logger.debug('Background: 侧边栏已恢复 enabled=true');
      })
      .catch(error => {
        if (isExpectedCloseError(error)) {
          logger.debug('Background: 侧边栏已不存在，视为关闭成功');
          sidePanelPort = null;
          return;
        }
        logger.error('Background: setOptions 兜底失败:', error);
        throw error;
      });
  }

  /**
   * 通过 port 发送关闭消息（降级方案）
   */
  function trySendCloseViaPort(): void {
    if (sidePanelPort) {
      try {
        sidePanelPort.postMessage({ type: MessageType.CLOSE_SIDEPANEL });
        logger.debug('Background: 侧边栏关闭消息已发送 (port)');
      } catch (err) {
        logger.error('Background: 通过 port 发送关闭消息失败:', err);
        sidePanelPort = null;
      }
    }
  }

  // 防止重复打开选项页面的标记
  let isOpeningOptionsPage = false;

  /**
   * 打开选项页面
   * - 使用同步标记 isOpeningOptionsPage 做去重，确保异步流程完成后再释放（避免慢速 tabs.create 期间重复触发）
   * - 若已存在 options 标签页：激活 lastAccessed 最大的一个并聚焦其所在窗口，不关闭其它历史标签页
   * - 若不存在：创建新的 options 标签页
   */
  async function openOptionsPage() {
    // 防止重复触发（流程完成后才释放）
    if (isOpeningOptionsPage) {
      logger.debug('Background: 正在打开选项页面，忽略重复请求');
      return;
    }
    isOpeningOptionsPage = true;

    try {
      const optionsUrl = chrome.runtime.getURL('options.html');
      // 查询所有标签页并按 URL 前缀过滤（兼容带 hash/query 的 options URL）
      const tabs = await chrome.tabs.query({});
      const matchingTabs = tabs.filter(tab => tab.url && tab.url.startsWith(optionsUrl));

      if (matchingTabs.length > 0) {
        // 选择最近访问的 tab（lastAccessed 可能为 undefined，做回退处理）
        const targetTab = matchingTabs.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));

        if (targetTab.id !== undefined) {
          await chrome.tabs.update(targetTab.id, { active: true });
          if (targetTab.windowId !== undefined) {
            await chrome.windows.update(targetTab.windowId, { focused: true });
          }
          logger.debug(
            'Background: 已激活最近访问的密码管理标签页 tabId=' + targetTab.id + '，匹配总数=' + matchingTabs.length,
          );
        }
      } else {
        // 不存在则创建新标签页
        await chrome.tabs.create({ url: optionsUrl });
        logger.debug('Background: 已创建新的密码管理标签页');
      }
    } catch (error) {
      logger.error('打开选项页面失败:', error);
    } finally {
      // 流程真正完成后再释放标记
      isOpeningOptionsPage = false;
    }
  }

  /**
   * 获取缓存有效期（毫秒）
   * 与主密码会话有效期保持一致
   */
  async function getCacheValidityMs(): Promise<number> {
    try {
      const result = await chrome.storage.local.get('master_password_validity');
      const validityHours = (result['master_password_validity'] as number | undefined) || 24;
      return validityHours * 60 * 60 * 1000; // 转换为毫秒
    } catch (error) {
      logger.error('Background: 获取缓存有效期失败:', error);
      return 24 * 60 * 60 * 1000; // 默认24小时
    }
  }

  /**
   * 获取缓存的密码数据
   * @param requestedDomain 请求的域名，用于检查缓存是否匹配
   */
  async function getCachedPasswords(requestedDomain?: string): Promise<PasswordCache | null> {
    if (!passwordCache) {
      return null;
    }

    // 动态获取缓存有效期（与主密码会话有效期一致）
    const cacheValidityMs = await getCacheValidityMs();

    // 检查缓存是否过期
    const now = Date.now();
    if (now - passwordCache.timestamp > cacheValidityMs) {
      logger.debug('Background: 密码缓存已过期');
      passwordCache = null;
      return null;
    }

    // 如果请求了特定域名，检查是否匹配
    if (requestedDomain && passwordCache.domain !== requestedDomain) {
      logger.debug('Background: 缓存域名不匹配，需要重新加载');
      return null;
    }

    logger.debug('Background: 返回缓存数据，条目数:' + passwordCache.passwords.length);
    return passwordCache;
  }

  /**
   * 更新密码缓存
   */
  function updatePasswordCache(passwords: PasswordEntry[], domain: string, isAuthenticated: boolean): void {
    passwordCache = {
      passwords,
      domain,
      timestamp: Date.now(),
      isAuthenticated,
    };
    logger.debug('Background: 密码缓存已更新，条目数:' + passwords.length + ' 域名:' + domain);
  }

  /**
   * 使密码缓存失效
   */
  function invalidatePasswordCache(): void {
    passwordCache = null;
    logger.debug('Background: 密码缓存已失效');
  }

  /**
   * 处理保存密码请求
   * 由 content script 在用户确认后触发，执行会话校验、域名匹配、去重更新和存储
   * @param data 自动保存密码数据
   * @returns 保存结果
   */
  async function handleAutoSavePassword(data: AutoSavePasswordData): Promise<{ success: boolean; message: string }> {
    try {
      const result = await StorageUtils.autoSavePassword(data);
      if (result.success) {
        // 保存成功后使密码缓存失效，确保下次加载时获取最新数据
        invalidatePasswordCache();

        // 主动通知 sidepanel 刷新数据（如果打开的话）
        if (sidePanelPort) {
          try {
            sidePanelPort.postMessage({ type: MessageType.URL_CHANGED });
          } catch {
            // port 可能已断开但尚未触发 disconnect 事件，忽略
          }
        }

        // 发送桌面通知提示用户已自动保存
        try {
          await chrome.notifications.create('auto-save-password', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon/128.png'),
            title: '账号密码已保存',
            message: `${data.username} - ${data.url} ${result.message}`,
          });
        } catch (notifyError) {
          logger.warn('Background: 桌面通知发送失败（可能系统通知权限未开启）:', notifyError);
        }
      }
      return result;
    } catch (error) {
      logger.error('Background: 处理自动保存密码失败:', error);
      return { success: false, message: '自动保存处理失败' };
    }
  }

  // 监听 storage 变化，自动使缓存失效
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      // 检查是否是密码数据或会话相关的变化
      const relevantKeys = ['account_passwords', 'session_master_password', 'session_password_expiry'];
      const hasRelevantChange = Object.keys(changes).some(key => relevantKeys.includes(key));

      if (hasRelevantChange) {
        logger.debug('Background: 检测到存储变化，使缓存失效');
        invalidatePasswordCache();
      }

      // 检查邮箱备份配置是否变化，重新设置 alarm
      if (STORAGE_KEYS.EMAIL_BACKUP_CONFIG in changes) {
        logger.debug('Background: 邮箱备份配置变化，重新设置自动备份闹钟');
        setupAutoBackupAlarm();
      }
    }
  });

  // 监听 alarm 事件，执行定时自动备份
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'auto-backup-passwords') {
      logger.info('Background: 触发自动备份闹钟');
      performAutoBackup();
    }
  });

  /**
   * 设置自动备份提醒闹钟
   * 读取邮箱备份配置，若启用自动备份则创建周期性 alarm
   */
  async function setupAutoBackupAlarm() {
    try {
      // 先清除已有的 alarm
      await chrome.alarms.clear('auto-backup-passwords');

      const result = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_BACKUP_CONFIG);
      const config = result[STORAGE_KEYS.EMAIL_BACKUP_CONFIG] as EmailBackupConfig | undefined;

      if (config?.autoBackup && config.email) {
        const periodInMinutes = config.autoBackupIntervalDays * 24 * 60;

        // 根据上次备份时间计算首次延迟，避免短时间内重复触发
        let delayInMinutes = 1; // 默认 1 分钟
        const lastTimeResult = await chrome.storage.local.get(STORAGE_KEYS.LAST_AUTO_BACKUP_TIME);
        const lastBackupTime = lastTimeResult[STORAGE_KEYS.LAST_AUTO_BACKUP_TIME] as number | undefined;
        if (lastBackupTime) {
          const elapsedMinutes = (Date.now() - lastBackupTime) / (60 * 1000);
          const remainingMinutes = Math.max(periodInMinutes - elapsedMinutes, 1);
          delayInMinutes = Math.min(remainingMinutes, periodInMinutes);
          logger.debug(
            `Background: 距上次备份已过 ${Math.round(elapsedMinutes)} 分钟，下次提醒延迟 ${Math.round(delayInMinutes)} 分钟`,
          );
        }

        await chrome.alarms.create('auto-backup-passwords', {
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
   * 仅发送桌面通知提醒用户手动备份，不自动下载密码文件（安全考虑）
   */
  async function performAutoBackup() {
    try {
      // 读取配置
      const result = await chrome.storage.local.get(STORAGE_KEYS.EMAIL_BACKUP_CONFIG);
      const config = result[STORAGE_KEYS.EMAIL_BACKUP_CONFIG] as EmailBackupConfig | undefined;

      if (!config?.email) {
        logger.warn('Background: 未配置备份邮箱，跳过备份提醒');
        return;
      }

      // 间隔检查：防止短时间内重复触发
      const lastTimeResult = await chrome.storage.local.get(STORAGE_KEYS.LAST_AUTO_BACKUP_TIME);
      const lastBackupTime = lastTimeResult[STORAGE_KEYS.LAST_AUTO_BACKUP_TIME] as number | undefined;
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

      // 统计密码数量（仅计数，不解密、不导出处密码内容）
      const pwResult = await chrome.storage.local.get(STORAGE_KEYS.PASSWORDS);
      const rawPasswords = pwResult[STORAGE_KEYS.PASSWORDS] as unknown[] | undefined;
      const passwordCount = rawPasswords?.length ?? 0;

      if (passwordCount === 0) {
        logger.info('Background: 无密码数据，跳过备份提醒');
        return;
      }

      // 记录本次提醒时间
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_AUTO_BACKUP_TIME]: Date.now(),
      });

      // 发送桌面提醒通知（引导用户手动备份，不自动下载文件）
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
});
