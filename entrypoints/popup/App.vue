<template>
  <div class="popup-container">
    <div class="header">
      <BrandLogo class="logo" />
      <h3>账号密码管理助手</h3>
      <el-button
        v-if="isSessionValid"
        class="lock-btn"
        :icon="Lock"
        circle
        size="small"
        :loading="lockLoading"
        :disabled="lockLoading"
        title="锁定（清除会话）"
        @click="lockSession"
      />
    </div>

    <!-- 会话状态指示器 -->
    <div
      v-if="isSessionValid"
      class="session-status"
    >
      <el-tag
        type="success"
        size="small"
      >
        <el-icon><CircleCheckFilled /></el-icon>
        已验证
      </el-tag>
      <el-text
        type="info"
        size="small"
      >
        共 {{ passwordCount }} 条密码
      </el-text>
      <el-text
        v-if="domainMatchCount > 0"
        type="success"
        size="small"
      >
        · 当前页面匹配 {{ domainMatchCount }} 条
      </el-text>
    </div>

    <!-- 版本更新提示卡片 -->
    <div
      v-if="updateInfo"
      class="update-card"
      role="button"
      tabindex="0"
      @click="openUpdatePage"
      @keydown.enter="openUpdatePage"
      @keydown.space.prevent="openUpdatePage"
    >
      <div class="update-card__icon update-card__icon--warn">
        <el-icon><UploadFilled /></el-icon>
      </div>
      <div class="update-card__content">
        <div class="update-card__title">
          发现新版本
          <el-tag
            type="danger"
            size="small"
            round
          >
            v{{ updateInfo.latestVersion }}
          </el-tag>
        </div>
        <div class="update-card__desc">点击前往下载更新</div>
      </div>
    </div>

    <div
      v-else
      class="session-status"
    >
      <el-tag
        type="warning"
        size="small"
      >
        <el-icon><WarningFilled /></el-icon>
        未验证
      </el-tag>
      <el-text
        type="info"
        size="small"
      >
        请先验证主密码
      </el-text>
    </div>

    <div class="action-list">
      <div
        class="action-card"
        role="button"
        tabindex="0"
        @click="openOptions"
        @keydown.enter="openOptions"
        @keydown.space.prevent="openOptions"
      >
        <div class="action-card__icon action-card__icon--primary">
          <BrandLogo />
        </div>
        <div class="action-card__content">
          <div class="action-card__title">密码管理</div>
          <div class="action-card__desc">管理所有已保存的账号密码</div>
        </div>
        <kbd class="action-card__shortcut">{{ shortcuts.open_options }}</kbd>
      </div>

      <div
        class="action-card"
        role="button"
        tabindex="0"
        @click="openSidePanel"
        @keydown.enter="openSidePanel"
        @keydown.space.prevent="openSidePanel"
      >
        <div class="action-card__icon action-card__icon--secondary">
          <QuickFillIcon />
        </div>
        <div class="action-card__content">
          <div class="action-card__title">快速填充</div>
          <div class="action-card__desc">在当前页面快速填充账号密码</div>
        </div>
        <kbd class="action-card__shortcut">{{ shortcuts.toggle_sidepanel }}</kbd>
      </div>
    </div>

    <!-- 联系方式 -->
    <div class="contact-info">
      <el-text
        type="info"
        size="small"
      >
        如有任何问题或者建议，请联系
        <a
          :href="'mailto:' + contactEmail"
          class="email-link"
          @click="handleEmailClick"
        >
          {{ contactEmail }}
        </a>
      </el-text>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Lock, CircleCheckFilled, WarningFilled, UploadFilled } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import QuickFillIcon from '@/components/QuickFillIcon.vue';
import { StorageUtils } from '@/utils/storage';
import { MessageType, type PasswordEntry, type UpdateInfo } from '@/utils/types';
import { logger } from '@/utils/logger';
import { getCachedUpdateInfo } from '@/utils/updateChecker';

/**
 * 格式化快捷键显示文本
 * 将 Chrome API 返回的快捷键字符串转换为更友好的显示格式
 * @param shortcut - Chrome API 返回的快捷键，如 "Ctrl+Shift+P" 或 "Command+Shift+L"
 * @returns 格式化后的快捷键文本
 */
const formatShortcut = (shortcut: string): string => {
  if (!shortcut) return '';
  return shortcut
    .replace(/Command/gi, '⌘')
    .replace(/Ctrl/gi, 'Ctrl')
    .replace(/Shift/gi, '⇧')
    .replace(/Alt/gi, '⌥')
    .replace(/\+/g, '');
};

/** 命令名称到快捷键的映射 */
const shortcuts = ref<Record<string, string>>({
  open_options: formatShortcut('Ctrl+Shift+P'),
  toggle_sidepanel: formatShortcut('Ctrl+Shift+L'),
});

/**
 * 从 Chrome API 动态获取已绑定的快捷键
 * 用户在 chrome://extensions/shortcuts 修改后会自动同步
 */
const loadShortcuts = async () => {
  try {
    const commands = await chrome.commands.getAll();
    const map: Record<string, string> = {};
    for (const cmd of commands) {
      if (cmd.name && cmd.shortcut) {
        map[cmd.name] = formatShortcut(cmd.shortcut);
      }
    }
    shortcuts.value = {
      open_options: map.open_options || shortcuts.value.open_options,
      toggle_sidepanel: map.toggle_sidepanel || shortcuts.value.toggle_sidepanel,
    };
  } catch (error) {
    logger.warn('Popup: 获取快捷键失败，使用默认值:', error);
  }
};

/** 联系邮箱 */
const contactEmail = ref('924902324@qq.com');

/** 版本更新信息 */
const updateInfo = ref<UpdateInfo | null>(null);

/** 会话状态 */
const isSessionValid = ref(false);

/** 锁定操作 loading 状态 */
const lockLoading = ref(false);

/** 密码列表 */
const allPasswords = ref<PasswordEntry[]>([]);

/** 当前域名 */
const currentDomain = ref('');

/** 密码总数 */
const passwordCount = computed(() => allPasswords.value.length);

/** 当前域名匹配数 */
const domainMatchCount = computed(() => {
  if (!currentDomain.value) return 0;
  return allPasswords.value.filter(p => {
    if (!p.url) return false;
    return currentDomain.value.includes(p.url) || p.url.includes(currentDomain.value);
  }).length;
});

onMounted(async () => {
  try {
    // 并行加载：会话状态 + 快捷键 + 更新信息
    const [sessionValid, , cachedUpdate] = await Promise.all([
      StorageUtils.isSessionValid(),
      loadShortcuts(),
      getCachedUpdateInfo(),
    ]);
    isSessionValid.value = sessionValid;
    updateInfo.value = cachedUpdate;

    // 获取当前域名
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        const url = new URL(tab.url);
        currentDomain.value = url.hostname;
      } catch {
        // URL 解析失败，忽略
      }
    }

    // 加载密码列表
    if (isSessionValid.value) {
      allPasswords.value = await StorageUtils.getAllPasswords();
    }
  } catch (error) {
    logger.error('Popup: 初始化失败:', error);
  }
});

/** 锁定会话 */
const lockSession = async () => {
  lockLoading.value = true;
  try {
    await StorageUtils.clearSession();
    isSessionValid.value = false;
    allPasswords.value = [];

    // 通知 background 使密码缓存失效
    try {
      await chrome.runtime.sendMessage({ type: MessageType.INVALIDATE_PASSWORD_CACHE });
    } catch {
      // background 可能未就绪，忽略
    }

    // 广播会话过期到所有上下文（sidepanel、options），确保各处立即切换到未验证状态
    try {
      await chrome.runtime.sendMessage({ type: MessageType.SESSION_EXPIRED });
    } catch {
      // 无监听者时忽略
    }

    ElMessage.success('已锁定');
  } catch (error) {
    logger.error('锁定失败:', error);
  } finally {
    lockLoading.value = false;
  }
};

/**
 * 打开选项页面
 * 统一由 background 的 OPEN_OPTIONS_PAGE 处理：若已存在则激活最近访问的 tab，否则创建新 tab
 */
const openOptions = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_PAGE });
  } catch (error) {
    logger.error('打开选项页面失败:', error);
  } finally {
    // 无论成功失败都关闭 popup
    window.close();
  }
};

/**
 * 打开侧边栏
 * 会话无效时跳转到选项页面进行验证，会话有效时尝试打开侧边栏
 */
const openSidePanel = async () => {
  try {
    if (!isSessionValid.value) {
      await openOptions();
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      try {
        // 首先尝试直接调用，这在用户手势上下文中应该是有效的
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
      } catch (sidePanelError) {
        logger.error('直接打开侧边栏失败:', sidePanelError);

        // 如果直接调用失败，尝试通过background脚本发送普通消息
        try {
          const response = await chrome.runtime.sendMessage({
            type: MessageType.SHOW_SIDEPANEL,
            data: { tabId: tab.id },
          });
          if (response.success) {
            logger.info('通过background脚本成功打开侧边栏');
            window.close();
          } else {
            logger.error('通过background脚本打开侧边栏失败:', response.error);

            // 如果仍然失败，提示用户手动打开
            alert('自动打开侧边栏失败，请手动点击地址栏右侧的扩展图标打开侧边栏');
          }
        } catch (bgError) {
          logger.error('通过background脚本打开侧边栏也失败:', bgError);

          // 如果仍然失败，提示用户手动打开
          alert('自动打开侧边栏失败，请手动点击地址栏右侧的扩展图标打开侧边栏');
        }
      }
    }
  } catch (error) {
    logger.error('打开侧边栏失败:', error);
  }
};

/**
 * 处理邮件链接点击，打开默认邮件客户端
 */
const handleEmailClick = (event: Event) => {
  event.preventDefault();
  const subject = '账号密码管理助手反馈';
  const mailtoLink = `mailto:${contactEmail.value}?subject=${encodeURIComponent(subject)}`;

  // 尝试打开默认邮件客户端
  window.open(mailtoLink, '_blank');
};

/**
 * 打开版本更新下载页面
 * 跳转到 GitHub Release 页面，同时关闭 Popup
 */
const openUpdatePage = () => {
  if (updateInfo.value?.downloadUrl) {
    chrome.tabs.create({ url: updateInfo.value.downloadUrl });
  } else {
    chrome.tabs.create({ url: 'https://github.com/liaolongdong/account-password-helper/releases/latest' });
  }
  window.close();
};
</script>

<style scoped>
.popup-container {
  width: 300px;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
}

.header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.logo {
  margin-right: 0;
  font-size: 24px;
  color: #409eff;
}

.header h3 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.lock-btn {
  flex-shrink: 0;
}

.session-status {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.action-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.action-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  cursor: pointer;
  user-select: none;
  outline: none;
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  transition: all 0.2s ease;
}

.action-card:hover {
  background: #f0f7ff;
  border-color: #c6e2ff;
  box-shadow: 0 2px 8px rgb(64 158 255 / 10%);
}

.action-card:active {
  background: #e1effe;
  box-shadow: 0 1px 4px rgb(64 158 255 / 8%);
  transform: scale(0.99);
}

.action-card:focus-visible {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 25%);
}

.action-card__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  border-radius: 50%;
}

.action-card__icon--primary {
  color: #fff;
  background: #409eff;
}

.action-card__icon--secondary {
  color: #409eff;
  background: #ecf5ff;
}

.action-card__content {
  flex: 1;
  min-width: 0;
}

.action-card__title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #303133;
}

.action-card__desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.3;
  color: #909399;
}

.action-card__shortcut {
  flex-shrink: 0;
  padding: 3px 6px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: #606266;
  background: #e8eaed;
  border: 1px solid #d4d7de;
  border-radius: 4px;
  box-shadow: 0 1px 0 #c8c9cc;
}

.update-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  margin-bottom: 12px;
  cursor: pointer;
  user-select: none;
  outline: none;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 10px;
  transition: all 0.2s ease;
}

.update-card:hover {
  background: #fde2e2;
  border-color: #f56c6c;
  box-shadow: 0 2px 8px rgb(245 108 108 / 15%);
}

.update-card:active {
  background: #fcd5d5;
  box-shadow: 0 1px 4px rgb(245 108 108 / 10%);
  transform: scale(0.99);
}

.update-card:focus-visible {
  border-color: #f56c6c;
  box-shadow: 0 0 0 2px rgb(245 108 108 / 25%);
}

.update-card__icon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  border-radius: 50%;
}

.update-card__icon--warn {
  color: #fff;
  background: #f56c6c;
}

.update-card__content {
  flex: 1;
  min-width: 0;
}

.update-card__title {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #303133;
}

.update-card__desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.3;
  color: #909399;
}

.contact-info {
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.email-link {
  color: #409eff;
  text-decoration: none;
}

.email-link:hover {
  text-decoration: underline;
}
</style>
