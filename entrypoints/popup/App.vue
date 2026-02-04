<template>
  <div class="popup-container">
    <div class="header">
      <el-icon class="logo"><Key /></el-icon>
      <h3>密码管理助手</h3>
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
          href="mailto:924902324@qq.com"
          class="email-link"
          @click="handleEmailClick"
        >
          924902324@qq.com
        </a>
      </el-text>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Setting, Key, View } from '@element-plus/icons-vue';
import { StorageUtils } from '../../utils/storage';
import { MessageType } from '../../utils/types';

const passwordCount = ref(0);
const showPasswordCount = ref(false); // 控制是否显示密码数量

onMounted(async () => {
  // Popup: 开始初始化
  try {
    // Popup: 开始检查会话状态...
    // 检查会话是否有效
    const isSessionValid = await StorageUtils.isSessionValid();
    // Popup: 会话是否有效

    if (isSessionValid) {
      // 只有在会话有效时才获取密码数量
      // 获取会话主密码
      const masterPassword = StorageUtils.getSessionMasterPassword();
      // Popup: 获取到的会话主密码

      // 获取密码数量
      const passwords = await StorageUtils.getAllPasswords(masterPassword);
      passwordCount.value = passwords.length;
      showPasswordCount.value = true; // 设置显示密码数量
      // Popup: 密码数量
    } else {
      // 会话无效时不显示密码数量
      showPasswordCount.value = false;
      passwordCount.value = 0;
      // Popup: 会话无效，不显示密码数量
    }
  } catch (error) {
    console.error('Popup: 获取密码数量失败:', error);
    showPasswordCount.value = false;
    passwordCount.value = 0;
  }
  // Popup: 初始化完成
});

// 打开选项页面
const openOptions = async () => {
  try {
    // Popup: 打开选项页面

    // 获取选项页面的完整URL
    const optionsUrl = chrome.runtime.getURL('options.html');

    // 首先检查是否已有标签页打开了选项页面
    const tabs = await chrome.tabs.query({ url: optionsUrl });

    if (tabs.length > 0) {
      // 如果已有标签页打开了选项页面，激活该标签页
      const tab = tabs[0];
      // Popup: 发现已存在的选项页面标签页，激活该标签页
      await chrome.tabs.update(tab.id!, { active: true });

      // 如果该标签页在其他窗口中，也激活该窗口
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } else {
      // 如果没有已存在的标签页，创建新标签页
      // Popup: 未发现已存在的选项页面标签页，创建新标签页
      await chrome.tabs.create({ url: optionsUrl });
    }

    // 关闭当前弹窗
    window.close();
    // Popup: 选项页面打开完成
  } catch (error) {
    console.error('打开选项页面失败:', error);
  }
};

// 打开侧边栏
const openSidePanel = async () => {
  try {
    // Popup: 开始检查会话状态以打开侧边栏...
    // 检查会话是否有效
    const isSessionValid = await StorageUtils.isSessionValid();
    // Popup: 会话是否有效

    if (!isSessionValid) {
      // 会话无效，打开选项页面进行验证
      // Popup: 会话无效，跳转到选项页面
      await openOptions();
      return;
    }

    // Popup: 会话有效，打开侧边栏
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

// 处理邮件链接点击
const handleEmailClick = (event: Event) => {
  event.preventDefault();
  const email = '924902324@qq.com';
  const subject = '密码管理助手反馈';
  const mailtoLink = `mailto:${email}?subject=${encodeURIComponent(subject)}`;

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
