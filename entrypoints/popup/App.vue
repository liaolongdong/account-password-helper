<template>
  <div class="popup-container">
    <div class="header">
      <el-icon class="logo"><Key /></el-icon>
      <h3>账号密码管理助手</h3>
    </div>

    <div class="content">
      <el-button
        type="primary"
        :icon="Setting"
        @click="openOptions"
        class="main-button"
        size="large"
        title="打开密码管理快捷键（Ctrl+Shift+P）"
      >
        管理密码
      </el-button>

      <div class="quick-actions">
        <el-button
          :icon="View"
          @click="openSidePanel"
          class="action-button"
          text
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
import { ref, onMounted } from 'vue';
import { Setting, Key, View } from '@element-plus/icons-vue';
import { StorageUtils } from '../../utils/storage';
import { MessageType } from '../../utils/types';

/** 联系邮箱 */
const contactEmail = ref('924902324@qq.com');

// TODO: 密码数量展示功能，后续开放
// const passwordCount = ref(0);
// const showPasswordCount = ref(false);

onMounted(async () => {
  // TODO: 后续开放密码数量展示时取消注释
  // try {
  //   const isSessionValid = await StorageUtils.isSessionValid();
  //   if (isSessionValid) {
  //     const masterPassword = await StorageUtils.getSessionMasterPasswordDecrypted();
  //     const passwords = await StorageUtils.getAllPasswords(masterPassword || undefined);
  //     passwordCount.value = passwords.length;
  //     showPasswordCount.value = true;
  //   } else {
  //     showPasswordCount.value = false;
  //     passwordCount.value = 0;
  //   }
  // } catch (error) {
  //   console.error('获取密码数量失败:', error);
  //   showPasswordCount.value = false;
  //   passwordCount.value = 0;
  // }
});

/**
 * 打开选项页面
 * 如果已有标签页打开了选项页面则激活该标签页，否则创建新标签页
 */
const openOptions = async () => {
  try {
    const optionsUrl = chrome.runtime.getURL('options.html');
    const tabs = await chrome.tabs.query({ url: optionsUrl });

    if (tabs.length > 0) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id!, { active: true });

      // 如果该标签页在其他窗口中，也激活该窗口
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url: optionsUrl });
    }

    window.close();
  } catch (error) {
    console.error('打开选项页面失败:', error);
  }
};

/**
 * 打开侧边栏
 * 会话无效时跳转到选项页面进行验证，会话有效时尝试打开侧边栏
 */
const openSidePanel = async () => {
  try {
    const isSessionValid = await StorageUtils.isSessionValid();

    if (!isSessionValid) {
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
        console.error('直接打开侧边栏失败:', sidePanelError);

        // 如果直接调用失败，尝试通过background脚本发送普通消息
        try {
          const response = await chrome.runtime.sendMessage({
            type: MessageType.SHOW_SIDEPANEL,
            data: { tabId: tab.id },
          });

          if (response.success) {
            console.log('通过background脚本成功打开侧边栏');
            window.close();
          } else {
            console.error('通过background脚本打开侧边栏失败:', response.error);

            // 如果仍然失败，提示用户手动打开
            alert('自动打开侧边栏失败，请手动点击地址栏右侧的扩展图标打开侧边栏');
          }
        } catch (bgError) {
          console.error('通过background脚本打开侧边栏也失败:', bgError);

          // 如果仍然失败，提示用户手动打开
          alert('自动打开侧边栏失败，请手动点击地址栏右侧的扩展图标打开侧边栏');
        }
      }
    }
  } catch (error) {
    console.error('打开侧边栏失败:', error);
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
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.logo {
  font-size: 24px;
  color: #409eff;
  margin-right: 8px;
}

.header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.content {
  text-align: center;
}

.main-button {
  width: 100%;
  height: 48px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.quick-actions {
  margin-bottom: 16px;
}

.action-button {
  font-size: 14px;
}

.pwd-save-count {
  position: relative;
  top: -12px;
  text-align: center;
}

.contact-info {
  padding-top: 20px;
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
