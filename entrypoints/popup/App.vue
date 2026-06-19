<template>
  <div class="popup-container">
    <div class="header">
      <BrandLogo class="logo" />
      <div class="header-title-group">
        <h3>账号密码管理助手</h3>
        <el-tag
          size="small"
          type="info"
          class="version-tag"
        >
          v{{ currentVersion }}
        </el-tag>
      </div>
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
            type="info"
            size="small"
            round
          >
            v{{ currentVersion }}
          </el-tag>
          <span class="update-arrow">&rarr;</span>
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
          :href="'mailto:' + CONTACT_EMAIL"
          class="email-link"
          @click="handleEmailClick"
        >
          {{ CONTACT_EMAIL }}
        </a>
      </el-text>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Lock, CircleCheckFilled, WarningFilled, UploadFilled } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import QuickFillIcon from '@/components/QuickFillIcon.vue';
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { usePopupInit } from '@/composables/usePopupInit';

/** 联系邮箱（常量，无需响应式） */
const CONTACT_EMAIL = '924902324@qq.com';

// ==================== 组合 usePopupInit（会话、快捷键、版本更新、锁定） ====================
const {
  isSessionValid,
  passwordCount,
  domainMatchCount,
  shortcuts,
  currentVersion,
  updateInfo,
  lockLoading,
  lockSession,
  openUpdatePage,
} = usePopupInit();

// ==================== 导航操作（与 UI 交互紧密，保留在组件内） ====================

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
            alert('自动打开侧边栏失败，请手动点击地址栏右侧的扩展图标打开侧边栏');
          }
        } catch (bgError) {
          logger.error('通过background脚本打开侧边栏也失败:', bgError);
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
  const mailtoLink = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
  window.open(mailtoLink, '_blank');
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

.header-title-group {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.lock-btn {
  flex-shrink: 0;
}

.version-tag {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: #909399;
  cursor: default;
  user-select: none;
}

.update-arrow {
  font-size: 12px;
  color: #909399;
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
