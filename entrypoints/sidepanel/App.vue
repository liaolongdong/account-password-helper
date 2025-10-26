<template>
  <div
    class="sidepanel-container"
    v-show="showSidepanel"
  >
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
    <div
      v-if="isAuthenticated"
      class="search-section"
    >
      <el-input
        v-model="searchKeyword"
        placeholder="搜索用户名、标签、备注..."
        :prefix-icon="Search"
        clearable
        @input="handleSearch"
      />
    </div>

    <!-- 未验证状态 -->
    <div
      v-if="!isAuthenticated"
      class="auth-required"
    >
      <el-empty
        :image-size="100"
        description="需要验证主密码"
      >
        <template #description>
          <div class="auth-description">
            <p>请先验证主密码以使用快速填充功能</p>
            <p class="auth-tip">验证后即可搜索和填充保存的密码</p>
          </div>
        </template>
        <el-button
          type="primary"
          :icon="Key"
          @click="openOptions"
          size="large"
        >
          去验证主密码
        </el-button>
      </el-empty>
    </div>

    <!-- 密码列表 -->
    <div
      v-else
      class="password-list"
    >
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
          title="点击快速填充账号和密码"
          @click="fillPassword(password)"
        >
          <div class="password-info">
            <div class="username">
              <el-icon><User /></el-icon>
              {{ password.username }}
              <el-icon
                class="copy-icon"
                @click.stop="copyUsername(password.username)"
              >
                <CopyDocument />
              </el-icon>
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
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { Key, Search, User, Right, Setting, Loading, CopyDocument } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { MessageType, type PasswordEntry } from '../../utils/types';
import { StorageUtils } from '../../utils/storage';

const loading = ref(true);
const searchKeyword = ref('');
const passwords = ref<PasswordEntry[]>([]);
const currentDomain = ref('');
const isAuthenticated = ref(false);
const showSidepanel = ref(true);

// 计算属性
const filteredPasswords = computed(() => {
  let result = [...passwords.value]; // 创建副本以避免修改原始数据

  // 搜索过滤
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      p =>
        p.username.toLowerCase().includes(keyword) ||
        p.tag.toLowerCase().includes(keyword) ||
        p.remark.toLowerCase().includes(keyword) ||
        p.url.toLowerCase().includes(keyword),
    );
  }

  // 按保存的排序配置进行排序
  sortPasswords(result);

  return result;
});

// 监听会话状态变化
const handleSessionChange = async () => {
  // SidePanel: 检测到会话状态变化，重新检查认证状态
  try {
    const isSessionValid = await StorageUtils.isSessionValid();
    if (isSessionValid && !isAuthenticated.value) {
      // 会话变为有效，重新加载数据
      // SidePanel: 会话已恢复，重新加载数据
      isAuthenticated.value = true;
      await loadCurrentTab();
      await loadPasswords();
    } else if (!isSessionValid && isAuthenticated.value) {
      // 会话变为无效，显示未验证状态
      // SidePanel: 会话已过期，显示未验证状态
      isAuthenticated.value = false;
      passwords.value = [];
    }
  } catch (error) {
    console.error('SidePanel: 检查会话状态失败:', error);
  }
};

// 监听存储变化
const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
  // 检查是否为主密码相关的存储变化
  const sessionKeys = ['session_master_password', 'session_password_expiry', 'session_validity_hours'];
  const hasSessionChange = Object.keys(changes).some(key => sessionKeys.includes(key));

  if (hasSessionChange) {
    // SidePanel: 检测到会话存储变化
    handleSessionChange();
  }
};

// 监听来自background的消息
const handleMessage = (message: any, sender: chrome.runtime.MessageSender, sendResponse: Function) => {
  // SidePanel: 收到消息

  switch (message.type) {
    case MessageType.URL_CHANGED:
      // SidePanel: 检测到URL变化，更新数据
      updateCurrentDomainAndLoadPasswords();
      sendResponse({ success: true, message: 'URL变化处理完成' });
      break;
    default:
      sendResponse({ success: false, message: '未知消息类型' });
      break;
  }
};

// 监听页面可见性变化
const handleVisibilityChange = () => {
  if (!document.hidden) {
    // SidePanel: 页面变为可见，检查会话状态
    handleSessionChange();
  }
};

// 监听标签页更新
const handleTabUpdated = async (tabId: number, changeInfo: any, tab: any) => {
  // 当标签页完成加载且URL存在时，更新数据
  if (changeInfo.status === 'complete' && tab.url) {
    // SidePanel: 检测到标签页更新
    await updateCurrentDomainAndLoadPasswords();
  }
};

// 监听标签页激活
const handleTabActivated = async (activeInfo: any) => {
  // SidePanel: 检测到标签页激活
  await updateCurrentDomainAndLoadPasswords();
};

// 更新当前域名并加载密码
const updateCurrentDomainAndLoadPasswords = async () => {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      const newDomain = url.hostname;

      // 只有当域名发生变化时才更新
      if (currentDomain.value !== newDomain) {
        // SidePanel: 域名发生变化
        currentDomain.value = newDomain;

        // 如果已认证，重新加载密码数据
        if (isAuthenticated.value) {
          await loadPasswords();
        }
      }
    }
  } catch (error) {
    console.error('更新当前域名失败:', error);
  }
};

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
    // SidePanel: 开始加载密码列表

    // 获取会话主密码
    const masterPassword = StorageUtils.getSessionMasterPassword();
    // SidePanel: 获取到的会话主密码

    // 根据当前域名获取匹配的密码
    if (currentDomain.value) {
      passwords.value = await StorageUtils.getPasswordsByUrl(currentDomain.value, masterPassword);
    } else {
      passwords.value = await StorageUtils.getAllPasswords(masterPassword);
      // 应用保存的排序配置
      sortPasswords(passwords.value);
    }
    // SidePanel: 密码列表加载完成
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
    // 开始填充密码

    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      ElMessage.error('无法获取当前页面信息');
      return;
    }

    // 确保content script已注入
    try {
      // 尝试注入content script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/content.js'],
      });
      // Content script 注入成功
      // 稍待片刻再发送消息
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (injectError) {
      console.error('Content script 注入失败:', injectError);
      ElMessage.error('无法在当前页面中注入脚本，请刷新页面后重试');
      return;
    }

    // 根据密码条目类型发送不同的填充消息
    let response;
    // todo:手机号+短信验证码组合也按照账号密码填充
    // if (password.isMobileCode) {
    //   // 手机号+验证码类型
    //   response = await chrome.tabs.sendMessage(tab.id, {
    //     type: MessageType.FILL_MOBILE_CODE,
    //     data: {
    //       mobile: password.username, // 手机号存储在username字段
    //       code: password.password, // 验证码存储在password字段
    //     },
    //   });
    // } else {
    //   // 账号+密码类型
    //   response = await chrome.tabs.sendMessage(tab.id, {
    //     type: MessageType.FILL_PASSWORD,
    //     data: {
    //       username: password.username,
    //       password: password.password,
    //     },
    //   });
    // }

    // 账号+密码组合（包含手机号+短信验证码组合）
    response = await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.FILL_PASSWORD,
      data: {
        username: password.username,
        password: password.password,
      },
    });

    // 填充响应

    if (response && response.success) {
      ElMessage.success('密码填充成功');
      // 密码填充成功，则隐藏密码快速填充侧边栏
      await chrome.runtime.sendMessage({ type: MessageType.HIDE_SIDEPANEL });
      // 这里使用隐藏侧边栏dom节点的方式来hack实现隐藏侧边栏
      // showSidepanel.value = false;
    } else {
      const errorMsg = response?.message || '填充可能未完成，请检查页面表单';
      ElMessage.warning(errorMsg);
    }
  } catch (error: any) {
    console.error('填充密码失败:', error);
    if (error.message && error.message.includes('Could not establish connection')) {
      ElMessage.error('无法连接到页面脚本，请刷新页面后重试');
    } else {
      ElMessage.error('填充密码失败，请确保页面已加载完成');
    }
  }
};

// 复制用户名到剪贴板
const copyUsername = async (username: string) => {
  try {
    await navigator.clipboard.writeText(username);
    ElMessage.success('用户名已复制到剪贴板');
  } catch (error) {
    console.error('复制用户名失败:', error);
    ElMessage.error('复制用户名失败');
  }
};

// 打开选项页面
const openOptions = async () => {
  try {
    // SidePanel: 打开选项页面

    // 获取选项页面的完整URL
    const optionsUrl = chrome.runtime.getURL('options.html');

    // 首先检查是否已有标签页打开了选项页面
    const tabs = await chrome.tabs.query({ url: optionsUrl });

    if (tabs.length > 0) {
      // 如果已有标签页打开了选项页面，激活该标签页
      const tab = tabs[0];
      // SidePanel: 发现已存在的选项页面标签页，激活该标签页
      await chrome.tabs.update(tab.id!, { active: true });

      // 如果该标签页在其他窗口中，也激活该窗口
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } else {
      // 如果没有已存在的标签页，创建新标签页
      // SidePanel: 未发现已存在的选项页面标签页，创建新标签页
      await chrome.tabs.create({ url: optionsUrl });
    }

    // SidePanel: 选项页面打开完成
  } catch (error) {
    console.error('SidePanel: 打开选项页面失败:', error);
  }
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

// 密码排序函数
const sortPasswords = (passwords: PasswordEntry[]) => {
  // 获取保存的排序配置
  StorageUtils.getSortConfig()
    .then(sortConfig => {
      if (sortConfig) {
        // 根据保存的排序配置进行排序
        passwords.sort((a, b) => {
          let aValue: any, bValue: any;

          switch (sortConfig.prop) {
            case 'username':
              aValue = a.username;
              bValue = b.username;
              break;
            case 'url':
              aValue = a.url;
              bValue = b.url;
              break;
            case 'tag':
              aValue = a.tag;
              bValue = b.tag;
              break;
            case 'remark':
              aValue = a.remark;
              bValue = b.remark;
              break;
            case 'createTime':
              aValue = a.createTime;
              bValue = b.createTime;
              break;
            case 'updateTime':
              aValue = a.updateTime;
              bValue = b.updateTime;
              break;
            default:
              // 默认按创建时间倒序排序
              passwords.sort((a, b) => b.createTime - a.createTime);
              return 0;
          }

          // 根据排序顺序进行比较
          let comparison = 0;
          if (typeof aValue === 'string' && typeof bValue === 'string') {
            comparison = aValue.localeCompare(bValue);
          } else if (typeof aValue === 'number' && typeof bValue === 'number') {
            comparison = aValue - bValue;
          } else {
            // 默认按创建时间倒序排序
            return b.createTime - a.createTime;
          }

          return sortConfig.order === 'ascending' ? comparison : -comparison;
        });
      } else {
        // 默认按创建时间倒序排序
        passwords.sort((a, b) => b.createTime - a.createTime);
      }
    })
    .catch(error => {
      console.error('获取排序配置失败，使用默认排序:', error);
      // 默认按创建时间倒序排序
      passwords.sort((a, b) => b.createTime - a.createTime);
    });
};

// 初始化
onMounted(async () => {
  // SidePanel: 开始初始化

  // 添加监听器
  chrome.storage.onChanged.addListener(handleStorageChange);
  chrome.runtime.onMessage.addListener(handleMessage);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('sessionExpired', handleSessionChange);

  // 添加标签页变化监听器
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onActivated.addListener(handleTabActivated);

  try {
    // SidePanel: 开始检查会话状态...
    // 检查会话是否有效
    const isSessionValid = await StorageUtils.isSessionValid();
    // SidePanel: 会话是否有效

    if (!isSessionValid) {
      // 会话无效，显示未验证状态
      // SidePanel: 会话无效，显示未验证状态
      isAuthenticated.value = false;
      loading.value = false;
      return;
    }

    // SidePanel: 会话有效，加载数据
    isAuthenticated.value = true;
    await loadCurrentTab();
    await loadPasswords();
  } catch (error) {
    console.error('SidePanel: 初始化失败:', error);
    // 出错时显示未验证状态
    isAuthenticated.value = false;
    loading.value = false;
  }
  // SidePanel: 初始化完成
});

// 组件卸载时移除监听器
onUnmounted(() => {
  chrome.storage.onChanged.removeListener(handleStorageChange);
  chrome.runtime.onMessage.removeListener(handleMessage);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('sessionExpired', handleSessionChange);

  // 移除标签页变化监听器
  chrome.tabs.onUpdated.removeListener(handleTabUpdated);
  chrome.tabs.onActivated.removeListener(handleTabActivated);
});
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

.copy-icon {
  margin-left: 8px;
  font-size: 14px;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.2s;
}

.copy-icon:hover {
  color: #409eff;
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

/* 未验证状态样式 */
.auth-required {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: #f8f9fa;
  min-height: 300px;
}

.auth-description {
  text-align: center;
  margin-bottom: 20px;
}

.auth-description p {
  margin: 8px 0;
  color: #666;
  font-size: 14px;
}

.auth-tip {
  color: #999 !important;
  font-size: 12px !important;
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
