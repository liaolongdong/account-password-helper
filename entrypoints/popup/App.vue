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

    <div class="content">
      <el-button
        type="primary"
        :icon="BrandLogo"
        class="main-button"
        size="large"
        title="打开密码管理快捷键(Ctrl+Shift+P)"
        @click="openOptions"
      >
        密码管理
      </el-button>

      <div class="quick-actions">
        <el-button
          :icon="QuickFillIcon"
          class="action-button"
          title="打开/关闭密码快速填充侧边(Ctrl+Shift+L)"
          text
          @click="openSidePanel"
        >
          快速填充
        </el-button>
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
import { Lock, CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import QuickFillIcon from '@/components/QuickFillIcon.vue';
import { StorageUtils } from '@/utils/storage';
import { MessageType, type PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';

/** 联系邮箱 */
const contactEmail = ref('924902324@qq.com');

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
    // 检查会话状态
    isSessionValid.value = await StorageUtils.isSessionValid();

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

.content {
  text-align: center;
}

.main-button {
  width: 100%;
  height: 48px;
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
}

.quick-actions {
  margin-bottom: 12px;
}

.action-button {
  font-size: 14px;
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
