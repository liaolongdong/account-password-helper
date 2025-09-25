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

      <div
        class="stats"
        v-if="passwordCount > 0"
      >
        <el-text
          type="info"
          size="small"
        >
          已保存 {{ passwordCount }} 个密码
        </el-text>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Setting, Key, View } from '@element-plus/icons-vue';
import { StorageUtils } from '../../utils/storage';

const passwordCount = ref(0);

onMounted(async () => {
  // 获取密码数量
  const passwords = await StorageUtils.getAllPasswords();
  passwordCount.value = passwords.length;
});

// 打开选项页面
const openOptions = () => {
  // chrome.runtime.openOptionsPage();
  // window.close();

  // 获取选项页面的完整URL
  const optionsUrl = chrome.runtime.getURL('options.html');
  // 在新标签页中创建并打开
  chrome.tabs.create({ url: optionsUrl });
};

// 打开侧边栏
const openSidePanel = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    }
  } catch (error) {
    console.error('打开侧边栏失败:', error);
  }
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

.stats {
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.stats .el-text {
  display: block;
}
</style>
