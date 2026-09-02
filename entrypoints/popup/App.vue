<template>
  <div class="popup-container">
    <div class="header">
      <BrandLogo class="logo" />
      <div class="header-title-group">
        <h3>{{ t('popup.title') }}</h3>
      </div>
      <el-button
        v-if="isSessionValid"
        class="lock-btn"
        :icon="Lock"
        circle
        size="small"
        :loading="lockLoading"
        :disabled="lockLoading"
        :title="lockBtnTitle"
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
        {{ t('popup.verified') }}
      </el-tag>
      <el-text
        type="info"
        size="small"
      >
        {{ t('popup.passwordCount', { count: passwordCount }) }}
      </el-text>
      <el-text
        v-if="domainMatchCount > 0"
        type="success"
        size="small"
      >
        · {{ t('popup.domainMatch', { count: domainMatchCount }) }}
      </el-text>
      <!-- 会话剩余时间：可点击倒计时胶囊（右对齐），点击直达有效期设置续期；紧迫态转警示橙，危急态转警示红 -->
      <button
        v-if="sessionRemainingText"
        type="button"
        class="session-remaining-chip"
        :class="{
          'session-remaining-chip--urgent': sessionIsUrgent,
          'session-remaining-chip--critical': sessionIsCritical,
        }"
        :title="t('popup.sessionRemainingTitle')"
        @click="openValiditySetting"
      >
        <el-icon><Timer /></el-icon>
        {{ sessionRemainingText }}
      </button>
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
        {{ t('popup.unverified') }}
      </el-tag>
      <el-text
        type="info"
        size="small"
      >
        {{ t('popup.verifyFirst') }}
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
          {{ t('popup.newVersion') }}
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
        <div class="update-card__desc">{{ t('popup.clickToUpdate') }}</div>
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
          <div class="action-card__title">{{ t('popup.passwordManagement') }}</div>
          <div class="action-card__desc">{{ t('popup.passwordManagementDesc') }}</div>
        </div>
        <kbd
          v-if="shortcutAssigned.open_options"
          class="action-card__shortcut"
          >{{ shortcuts.open_options }}</kbd
        >
        <button
          v-else
          type="button"
          class="action-card__shortcut action-card__shortcut-btn"
          :title="t('popup.goToShortcuts')"
          @click.stop="openShortcutsPage"
          @keydown.enter.stop.prevent="openShortcutsPage"
          @keydown.space.stop.prevent="openShortcutsPage"
        >
          {{ t('popup.setShortcut') }}
        </button>
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
          <div class="action-card__title">{{ t('common.quickFill') }}</div>
          <div class="action-card__desc">{{ t('popup.quickFillDesc') }}</div>
        </div>
        <kbd
          v-if="shortcutAssigned.toggle_sidepanel"
          class="action-card__shortcut"
          >{{ shortcuts.toggle_sidepanel }}</kbd
        >
        <button
          v-else
          type="button"
          class="action-card__shortcut action-card__shortcut-btn"
          :title="t('popup.goToShortcuts')"
          @click.stop="openShortcutsPage"
          @keydown.enter.stop.prevent="openShortcutsPage"
          @keydown.space.stop.prevent="openShortcutsPage"
        >
          {{ t('popup.setShortcut') }}
        </button>
      </div>

      <div
        class="action-card"
        role="button"
        tabindex="0"
        @click="triggerDirectFill"
        @keydown.enter="triggerDirectFill"
        @keydown.space.prevent="triggerDirectFill"
      >
        <div class="action-card__icon action-card__icon--accent">
          <el-icon><Position /></el-icon>
        </div>
        <div class="action-card__content">
          <div class="action-card__title">{{ t('popup.directFill') }}</div>
          <div class="action-card__desc">{{ t('popup.directFillDesc') }}</div>
        </div>
        <kbd
          v-if="shortcutAssigned.quick_fill"
          class="action-card__shortcut"
          >{{ shortcuts.quick_fill }}</kbd
        >
        <button
          v-else
          type="button"
          class="action-card__shortcut action-card__shortcut-btn"
          :title="t('popup.goToShortcuts')"
          @click.stop="openShortcutsPage"
          @keydown.enter.stop.prevent="openShortcutsPage"
          @keydown.space.stop.prevent="openShortcutsPage"
        >
          {{ t('popup.setShortcut') }}
        </button>
      </div>

      <div
        class="action-card"
        role="button"
        tabindex="0"
        @click="triggerInlineDropdown"
        @keydown.enter="triggerInlineDropdown"
        @keydown.space.prevent="triggerInlineDropdown"
      >
        <div class="action-card__icon action-card__icon--tint">
          <InlineKeyIcon />
        </div>
        <div class="action-card__content">
          <div class="action-card__title">{{ t('popup.inlineDropdown') }}</div>
          <div class="action-card__desc">{{ t('popup.inlineDropdownDesc') }}</div>
        </div>
        <kbd
          v-if="shortcutAssigned.open_inline_dropdown"
          class="action-card__shortcut"
          >{{ shortcuts.open_inline_dropdown }}</kbd
        >
        <button
          v-else
          type="button"
          class="action-card__shortcut action-card__shortcut-btn"
          :title="t('popup.goToShortcuts')"
          @click.stop="openShortcutsPage"
          @keydown.enter.stop.prevent="openShortcutsPage"
          @keydown.space.stop.prevent="openShortcutsPage"
        >
          {{ t('popup.setShortcut') }}
        </button>
      </div>
    </div>

    <!-- 联系方式：版本号从头部标题行下沉至此，弱化右对齐展示 -->
    <div class="contact-info">
      <el-text
        type="info"
        size="small"
      >
        {{ t('popup.contact') }}
        <a
          :href="'mailto:' + CONTACT_EMAIL"
          class="email-link"
          @click="handleEmailClick"
        >
          {{ CONTACT_EMAIL }}
        </a>
      </el-text>
      <a
        class="popup-version"
        :href="GITHUB_RELEASES_PAGE_URL"
        target="_blank"
        rel="noopener noreferrer"
        :title="t('popup.versionLinkTitle')"
        >v{{ currentVersion }}</a
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { Lock, CircleCheckFilled, WarningFilled, UploadFilled, Position, Timer } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import QuickFillIcon from '@/components/QuickFillIcon.vue';
import InlineKeyIcon from '@/components/InlineKeyIcon.vue';
import { MessageType } from '@/utils/types';
import { GITHUB_RELEASES_PAGE_URL, CHROME_SHORTCUTS_PAGE_URL } from '@/utils/urls';
import { logger } from '@/utils/logger';
import { markSidepanelOpenRequested } from '@/utils/perfMetrics';
import { preWarmServiceWorker } from '@/utils/preWarmSw';
import { usePopupInit } from '@/composables/usePopupInit';
import { useIdleLockSettings } from '@/composables/useIdleLockSettings';
import { useSessionCountdown } from '@/composables/useSessionCountdown';
import { useI18n } from '@/utils/i18n';

/** 联系邮箱（常量，无需响应式） */
const CONTACT_EMAIL = '924902324@qq.com';

// ==================== 组合 usePopupInit（会话、快捷键、版本更新、锁定） ====================
const {
  isSessionValid,
  passwordCount,
  domainMatchCount,
  shortcuts,
  shortcutAssigned,
  currentVersion,
  updateInfo,
  lockLoading,
  lockSession,
  openUpdatePage,
} = usePopupInit();

// ==================== i18n（语言切换入口已移至密码管理页「偏好设置」面板） ====================
const { t } = useI18n();

// ==================== 锁按钮动态提示（闲置锁定时长） ====================
const { idleLockMinutes, loadIdleLockSettings } = useIdleLockSettings();

/**
 * 锁按钮 tooltip：启用闲置自动锁定时附带闲置时长，
 * 将配置信息附着在用户可操作的锁定控件上；未启用时退化为静态文案
 */
const lockBtnTitle = computed(() =>
  idleLockMinutes.value > 0 ? t('popup.lockWithIdle', { minutes: idleLockMinutes.value }) : t('popup.lock'),
);

// 加载闲置锁定配置（fire-and-forget，失败时保持静态文案不影响主流程）
onMounted(() => {
  loadIdleLockSettings();
});

// ==================== 会话剩余时间（仅会话有效时展示；popup 生命周期短，无需手动停止） ====================
const {
  remainingText: sessionRemainingText,
  isUrgent: sessionIsUrgent,
  isCritical: sessionIsCritical,
  start: startSessionCountdown,
} = useSessionCountdown();
watch(
  isSessionValid,
  valid => {
    if (valid) startSessionCountdown();
  },
  { immediate: true },
);

/**
 * 点击倒计时胶囊：打开密码管理页并直达「有效期设置」对话框
 * 与 options 头部徽标「点时间 = 续期」的交互心智保持一致
 */
const openValiditySetting = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_AND_VALIDITY });
  } catch (error) {
    logger.error('打开有效期设置失败:', error);
  }
};

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
 * 打开 Chrome 快捷键设置页
 * 用于命令未绑定 suggested_key（多因更新后新增命令）时，引导用户手动设置。
 */
const openShortcutsPage = async () => {
  try {
    await chrome.tabs.create({ url: CHROME_SHORTCUTS_PAGE_URL });
  } catch (error) {
    logger.error('打开快捷键设置页失败:', error);
  } finally {
    window.close();
  }
};

/**
 * 打开侧边栏
 * 始终打开侧边栏（与快捷键、悬浮按钮入口一致）；
 * 会话失效时由侧边栏内的「会话已失效」卡片引导去选项页验证。
 */
const openSidePanel = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      // 点击时刻：直接打开与回退路径共用，保证 clickToDocMs 起点一致
      const clickTs = Date.now();
      // 点击即预热：与悬浮按钮 handleSidepanelClick 保持一致，
      // 尽早唤醒可能已休眠的 SW，缩短后续 sidePanel.open() 的冷启动等待
      preWarmServiceWorker();
      try {
        // 性能埋点：记录打开请求时间戳与触发源（同步发起不 await，不打断用户手势链）
        markSidepanelOpenRequested({ clickTs, trigger: 'popup' });
        // 首先尝试直接调用，这在用户手势上下文中应该是有效的
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
      } catch (sidePanelError) {
        logger.error('直接打开侧边栏失败:', sidePanelError);

        // 如果直接调用失败，尝试通过background脚本发送普通消息；
        // 携带原始 clickTs 与 trigger，避免 router 侧覆盖为 'content' 导致埋点归因失真
        try {
          const response = await chrome.runtime.sendMessage({
            type: MessageType.SHOW_SIDEPANEL,
            data: { tabId: tab.id, clickTs, trigger: 'popup' as const },
          });
          if (response.success) {
            logger.info('通过background脚本成功打开侧边栏');
            window.close();
          } else {
            logger.error('通过background脚本打开侧边栏失败:', response.error);
            ElMessage.error(t('popup.openSidepanelFailed'));
          }
        } catch (bgError) {
          logger.error('通过background脚本打开侧边栏也失败:', bgError);
          ElMessage.error(t('popup.openSidepanelFailed'));
        }
      }
    }
  } catch (error) {
    logger.error('打开侧边栏失败:', error);
  }
};

/**
 * 触发一键填充
 * 发送 QUICK_FILL 消息到 background，由其自动匹配当前域名并填充。
 * 填充结果通过桌面通知反馈给用户。
 */
const triggerDirectFill = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.QUICK_FILL });
  } catch (error) {
    logger.error('一键填充触发失败:', error);
  } finally {
    window.close();
  }
};

/**
 * 触发内联下拉展开
 * 发送 OPEN_INLINE_DROPDOWN 消息到 background，由其在当前页面定位登录字段并展开内联面板
 * （与快捷键 Ctrl+Shift+K、点击输入框内钥匙图标一致）。无登录字段时通过桌面通知反馈。
 */
const triggerInlineDropdown = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_INLINE_DROPDOWN });
  } catch (error) {
    logger.error('内联下拉触发失败:', error);
  } finally {
    window.close();
  }
};

/**
 * 处理邮件链接点击，打开默认邮件客户端
 */
const handleEmailClick = (event: Event) => {
  event.preventDefault();
  const subject = t('popup.feedbackSubject');
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
  color: var(--aph-primary);
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

.update-arrow {
  font-size: 12px;
  color: #909399;
}

.session-status {
  display: flex;
  flex-wrap: wrap; /* 英文文案较长（passwords in total / matches for this page），300px 宽度内允许换行 */
  gap: 4px 8px;
  align-items: center;
  margin-bottom: 12px;
}

/* 会话剩余时间倒计时胶囊：右对齐的行尾仪表，换行时自然独占一行；
   等宽数字避免逐秒跳动引起宽度抖动；点击直达有效期设置续期 */
.session-remaining-chip {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 1px 8px;
  margin-left: auto;
  font-family: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  color: #606266;
  white-space: nowrap;
  cursor: pointer;
  background: #f4f4f5;
  border: none;
  border-radius: 999px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.session-remaining-chip:hover {
  background: #ebeef5;
}

.session-remaining-chip:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

.session-remaining-chip .el-icon {
  font-size: 12px;
}

.session-remaining-chip--urgent {
  color: #b88230;
  background: #fdf6ec;
}

.session-remaining-chip--urgent:hover {
  background: #faecd8;
}

/* 危急态（≤1 分钟）：警示红，信号强度高于紧迫态 */
.session-remaining-chip--critical {
  color: #c45656;
  background: #fef0f0;
}

.session-remaining-chip--critical:hover {
  background: #fde2e2;
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
  background: var(--aph-primary-bg-hover);
  border-color: var(--aph-primary-border);
  box-shadow: 0 2px 8px rgb(var(--aph-primary-rgb) / 10%);
}

.action-card:active {
  background: var(--aph-primary-bg);
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
  transform: scale(0.99);
}

.action-card:focus-visible {
  border-color: var(--aph-primary);
  box-shadow: 0 0 0 2px rgb(var(--aph-primary-rgb) / 25%);
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

/* 三张操作卡图标为同一主题色的三层色阶家族（实心 / 描边 / 浅调渐变），
   全部由 --aph-primary 系列令牌派生，自动跟随 6 套主题切换；
   更新提醒卡片图标保持语义红色，不随主题变化 */
.action-card__icon--primary {
  color: #fff;
  background: var(--aph-primary);
}

.action-card__icon--secondary {
  /* 描边变体（导航类动作，最轻层级）：主题浅底 + 主题色圆环与图标；
     图标色向深色收敛保证淡雅主题（如青竹绿）下仍有足够对比度，
     inset 圆环不改变 36px 容器尺寸 */
  color: color-mix(in srgb, var(--aph-primary) 78%, #303133);
  background: var(--aph-primary-bg);
  box-shadow: inset 0 0 0 1.5px rgb(var(--aph-primary-rgb) / 45%);
}

.action-card__icon--accent {
  /* 浅调渐变变体（直达填充动作）：主题悬浮浅色 → 主题色的 135° 渐变，
     全由现成令牌派生，比实心主色卡更轻盈提亮，避免深色收敛带来的沉闷感 */
  color: #fff;
  background: linear-gradient(135deg, var(--aph-primary-hover) 0%, var(--aph-primary) 100%);
}

.action-card__icon--tint {
  /* 浅底纯调变体（内联下拉动作）：主题色 15% 透明浅底 + 主题色图标，无圆环；
     比 --aph-primary-bg（约 7% 色调）略深一档，保证圆形底在 #fafafa 卡片上清晰可辨，
     与描边变体形成层级递减，保持四卡同属一个主题色阶家族 */
  color: var(--aph-primary);
  background: rgb(var(--aph-primary-rgb) / 15%);
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

/* 未绑定快捷键时的“设置快捷键”入口按钮：复用 chip 视觉并叠加可点击态 */
.action-card__shortcut-btn {
  cursor: pointer;
  transition:
    color 0.2s,
    background-color 0.2s,
    border-color 0.2s;
}

.action-card__shortcut-btn:hover {
  color: #fff;
  background: var(--aph-primary);
  border-color: var(--aph-primary);
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
  flex-wrap: wrap; /* 英文标题 + 双版本号 tag 超出 300px 宽度时允许换行 */
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
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

/* 版本号弱化展示：静态信息不争夺注意力；点击可跳转 GitHub Releases 查看最新版本与下载 */
.popup-version {
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #909399;
  text-decoration: none;
  transition: color 0.2s;
}

.popup-version:hover {
  color: var(--aph-primary);
  text-decoration: underline;
}

.email-link {
  color: var(--aph-primary);
  text-decoration: none;
}

.email-link:hover {
  text-decoration: underline;
}
</style>
