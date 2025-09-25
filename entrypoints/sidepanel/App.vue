<template>
  <div class="sidepanel-container">
    <!-- 头部 -->
    <div class="header">
      <h3>
        <el-icon class="logo"><Key /></el-icon>
        快速填充
      </h3>
      <div class="current-url">
        <el-text
          type="info"
          size="small"
          >{{ currentDomain }}</el-text
        >
      </div>
    </div>

    <!-- 搜索框 -->
    <div class="search-section">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索用户名、标签、备注..."
        :prefix-icon="Search"
        clearable
        @input="handleSearch"
      />
    </div>

    <!-- 密码列表 -->
    <div class="password-list">
      <div
        v-if="loading"
        class="loading"
      >
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>

      <div
        v-else-if="filteredPasswords.length === 0"
        class="empty"
      >
        <el-empty
          :image-size="80"
          description="暂无匹配的密码"
        >
          <el-button
            type="primary"
            @click="openOptions"
          >
            去添加密码
          </el-button>
        </el-empty>
      </div>

      <div
        v-else
        class="password-items"
      >
        <div
          v-for="password in filteredPasswords"
          :key="password.id"
          class="password-item"
          @click="fillPassword(password)"
        >
          <div class="password-info">
            <div class="username">
              <el-icon><User /></el-icon>
              {{ password.username }}
            </div>
            <div class="details">
              <el-tag
                v-if="password.tag"
                size="small"
                type="info"
              >
                {{ password.tag }}
              </el-tag>
              <el-text
                v-if="password.url"
                type="info"
                size="small"
              >
                {{ password.url }}
              </el-text>
            </div>
            <div
              v-if="password.remark"
              class="remark"
            >
              <el-text
                type="info"
                size="small"
              >
                {{ password.remark }}
              </el-text>
            </div>
          </div>
          <div class="password-actions">
            <el-icon class="action-icon"><Right /></el-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="footer">
      <el-button
        :icon="Setting"
        text
        @click="openOptions"
      >
        密码管理
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Key, Search, User, Right, Setting, Loading } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import type { PasswordEntry } from '../../utils/types';
import { StorageUtils } from '../../utils/storage';

const loading = ref(true);
const searchKeyword = ref('');
const passwords = ref<PasswordEntry[]>([]);
const currentDomain = ref('');

// 计算属性
const filteredPasswords = computed(() => {
  if (!searchKeyword.value) return passwords.value;
  const keyword = searchKeyword.value.toLowerCase();
  return passwords.value.filter(
    p =>
      p.username.toLowerCase().includes(keyword) ||
      p.tag.toLowerCase().includes(keyword) ||
      p.remark.toLowerCase().includes(keyword) ||
      p.url.toLowerCase().includes(keyword)
  );
});

// 初始化
onMounted(async () => {
  await loadCurrentTab();
  await loadPasswords();
});

// 加载当前标签页信息
const loadCurrentTab = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.url) {
      const url = new URL(tab.url);
      currentDomain.value = url.hostname;
    }
  } catch (error) {
    console.error('获取当前标签页失败:', error);
  }
};

// 加载密码列表
const loadPasswords = async () => {
  try {
    loading.value = true;

    // 根据当前域名获取匹配的密码
    if (currentDomain.value) {
      passwords.value = await StorageUtils.getPasswordsByUrl(currentDomain.value);
    } else {
      passwords.value = await StorageUtils.getAllPasswords();
    }
  } catch (error) {
    console.error('加载密码列表失败:', error);
    ElMessage.error('加载密码列表失败');
  } finally {
    loading.value = false;
  }
};

// 搜索处理
const handleSearch = () => {
  // 搜索逻辑已通过计算属性实现
};

// 填充密码
const fillPassword = async (password: PasswordEntry) => {
  try {
    console.log('开始填充密码:', password);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      ElMessage.error('无法获取当前标签页');
      return;
    }

    console.log('发送填充消息到标签页:', tab.id);

    // 首先检查content script是否已加载
    try {
      const pingResponse = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      console.log('Content script 状态:', pingResponse);
    } catch (error) {
      console.log('Content script 未响应，尝试注入...');

      // 尝试注入content script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/content.js']
        });
        console.log('Content script 注入成功');
        // 稍待片刻再发送消息
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (injectError) {
        console.error('Content script 注入失败:', injectError);
        ElMessage.error('无法在当前页面中注入脚本，请刷新页面后重试');
        return;
      }
    }

    // 发送消息到content script进行填充
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'FILL_PASSWORD',
      data: {
        username: password.username,
        password: password.password
      }
    });

    console.log('填充响应:', response);

    if (response && response.success) {
      ElMessage.success('密码填充成功');
    } else {
      const errorMsg = response?.message || '填充可能未完成，请检查页面表单';
      ElMessage.warning(errorMsg);
    }
  } catch (error) {
    console.error('填充密码失败:', error);
    if (error.message && error.message.includes('Could not establish connection')) {
      ElMessage.error('无法连接到页面脚本，请刷新页面后重试');
    } else {
      ElMessage.error('填充密码失败，请确保页面已加载完成');
    }
  }
};

// 打开选项页面
const openOptions = () => {
  chrome.runtime.openOptionsPage();
};
</script>

<style scoped>
.sidepanel-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
}

.header {
  padding: 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.header h3 {
  display: flex;
  align-items: center;
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.logo {
  font-size: 20px;
  color: #409eff;
  margin-right: 8px;
}

.current-url {
  font-size: 12px;
  color: #6b7280;
}

.search-section {
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.password-list {
  flex: 1;
  overflow-y: auto;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #6b7280;
}

.loading .el-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.empty {
  padding: 20px;
}

.password-items {
  padding: 8px 0;
}

.password-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.2s;
}

.password-item:hover {
  background: #f8f9fa;
}

.password-info {
  flex: 1;
  min-width: 0;
}

.username {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  margin-bottom: 4px;
}

.username .el-icon {
  font-size: 16px;
  margin-right: 6px;
  color: #6b7280;
}

.details {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.details .el-tag {
  font-size: 11px;
}

.remark {
  font-size: 12px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.password-actions {
  display: flex;
  align-items: center;
  color: #d1d5db;
}

.action-icon {
  font-size: 16px;
}

.footer {
  padding: 12px 16px;
  background: white;
  border-top: 1px solid #e5e7eb;
  text-align: center;
}

/* 滚动条样式 */
.password-list::-webkit-scrollbar {
  width: 4px;
}

.password-list::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.password-list::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 2px;
}

.password-list::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
