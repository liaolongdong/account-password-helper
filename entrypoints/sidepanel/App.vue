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
                :type="getTagType(password.tag)"
                size="small"
                class="tag-item"
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
  console.log('SidePanel: 开始初始化');
  try {
    console.log('SidePanel: 开始检查会话状态...');
    // 检查会话是否有效
    const isSessionValid = await StorageUtils.isSessionValid();
    console.log('SidePanel: 会话是否有效:', isSessionValid);
    
    if (!isSessionValid) {
      // 会话无效，跳转到选项页面进行验证
      console.log('SidePanel: 会话无效，跳转到选项页面');
      openOptions();
      return;
    }
    
    console.log('SidePanel: 会话有效，加载数据');
    await loadCurrentTab();
    await loadPasswords();
  } catch (error) {
    console.error('SidePanel: 初始化失败:', error);
    // 出错时也跳转到选项页面
    openOptions();
  }
  console.log('SidePanel: 初始化完成');
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
    console.log('SidePanel: 开始加载密码列表');

    // 获取会话主密码
    const masterPassword = StorageUtils.getSessionMasterPassword();
    console.log('SidePanel: 获取到的会话主密码:', masterPassword ? '存在' : '不存在');

    // 根据当前域名获取匹配的密码
    if (currentDomain.value) {
      passwords.value = await StorageUtils.getPasswordsByUrl(currentDomain.value, masterPassword);
    } else {
      passwords.value = await StorageUtils.getAllPasswords(masterPassword);
    }
    console.log('SidePanel: 密码列表加载完成，数量:', passwords.value.length);
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
  console.log('SidePanel: 打开选项页面');
  // chrome.runtime.openOptionsPage();

  // 获取选项页面的完整URL
  const optionsUrl = chrome.runtime.getURL('options.html');
  // 在新标签页中创建并打开
  chrome.tabs.create({ url: optionsUrl });
  console.log('SidePanel: 选项页面打开完成');
};

// 标签颜色映射缓存
const tagColorCache = new Map<string, string>();

// 获取标签颜色类型
const getTagType = (tag: string): string => {
  const tagLower = tag.toLowerCase();

  // 工作相关标签
  if (
    tagLower.includes('工作') ||
    tagLower.includes('work') ||
    tagLower.includes('office') ||
    tagLower.includes('公司')
  ) {
    return 'primary';
  }

  // 个人相关标签
  if (tagLower.includes('个人') || tagLower.includes('personal') || tagLower.includes('私人')) {
    return 'success';
  }

  // 学习相关标签
  if (
    tagLower.includes('学习') ||
    tagLower.includes('study') ||
    tagLower.includes('课程') ||
    tagLower.includes('教育')
  ) {
    return 'warning';
  }

  // 游戏相关标签
  if (tagLower.includes('游戏') || tagLower.includes('game') || tagLower.includes('娱乐')) {
    return 'danger';
  }

  // 购物相关标签
  if (
    tagLower.includes('购物') ||
    tagLower.includes('shop') ||
    tagLower.includes('电商') ||
    tagLower.includes('淘宝') ||
    tagLower.includes('京东')
  ) {
    return 'info';
  }

  // 社交相关标签
  if (
    tagLower.includes('社交') ||
    tagLower.includes('social') ||
    tagLower.includes('微信') ||
    tagLower.includes('qq')
  ) {
    return 'success';
  }

  // 金融相关标签
  if (
    tagLower.includes('银行') ||
    tagLower.includes('金融') ||
    tagLower.includes('支付') ||
    tagLower.includes('理财')
  ) {
    return 'warning';
  }

  // 开发相关标签
  if (
    tagLower.includes('开发') ||
    tagLower.includes('dev') ||
    tagLower.includes('github') ||
    tagLower.includes('代码')
  ) {
    return 'primary';
  }

  // 媒体相关标签
  if (
    tagLower.includes('视频') ||
    tagLower.includes('音乐') ||
    tagLower.includes('直播') ||
    tagLower.includes('媒体')
  ) {
    return 'danger';
  }

  // 对于未匹配的标签，使用随机颜色但保持一致性
  if (tagColorCache.has(tag)) {
    return tagColorCache.get(tag)!;
  }

  // 生成随机颜色类型（排除空字符串，确保有颜色）
  const randomTypes = ['primary', 'success', 'warning', 'danger', 'info'];
  const randomType = randomTypes[Math.abs(hashString(tag)) % randomTypes.length];

  // 缓存颜色映射，确保同一标签始终使用相同颜色
  tagColorCache.set(tag, randomType);

  return randomType;
};

// 字符串哈希函数，用于生成一致的随机颜色
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash);
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
  margin: 0 0 8px;
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

/* 标签样式 */
.tag-item {
  font-weight: 500;
  border-radius: 4px;
  padding: 2px 6px;
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  min-width: 0;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
