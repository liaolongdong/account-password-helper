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
              <span
                class="copy-icon-wrapper"
                @click.stop.prevent="copyUsername(password.username)"
                @mousedown.stop
                title="复制账号"
              >
                <el-icon class="copy-icon">
                  <CopyDocument />
                </el-icon>
              </span>
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
import {
  MessageType,
  type PasswordEntry,
  type PasswordCache,
  type PingResponse,
  type FillResult,
} from '../../utils/types';
import { StorageUtils } from '../../utils/storage';
import { useChromeListeners } from '../../composables/useChromeListeners';
import { getTagType } from '../../utils/tagUtils';
import { logger } from '../../utils/logger';

const loading = ref(true);
const searchKeyword = ref('');
const passwords = ref<PasswordEntry[]>([]);
const currentDomain = ref('');
const isAuthenticated = ref(false);
const showSidepanel = ref(true);
const sortConfig = ref<{ prop: string; order: string } | null>(null);

// 使用 Chrome 事件监听 composable
const { onStorageChange, onMessage, onTabUpdated, onTabActivated, onDocumentEvent, onWindowEvent } =
  useChromeListeners();

/**
 * 判断是否为本地开发环境域名
 * 针对 localhost 和 127.0.0.1 域名，默认匹配所有账号密码，方便开发人员快速填充
 * @param domain 当前页面域名
 * @returns 是否为本地开发域名
 */
const isLocalDevDomain = (domain: string): boolean => {
  return domain === 'localhost' || domain === '127.0.0.1';
};

// 域名匹配优先级：0=匹配, 1=不匹配
const getDomainPriority = (entry: PasswordEntry): number => {
  if (!currentDomain.value) return 0;
  const hasUrl = entry.url && entry.url.trim() !== '';
  if (hasUrl && (currentDomain.value.includes(entry.url) || entry.url.includes(currentDomain.value))) return 0;
  return 1;
};

// 同步排序（使用缓存的 sortConfig）
const applySortConfig = (list: PasswordEntry[]) => {
  const config = sortConfig.value;
  if (!config) {
    list.sort((a, b) => {
      const dp = getDomainPriority(a) - getDomainPriority(b);
      return dp !== 0 ? dp : b.updateTime - a.updateTime;
    });
    return;
  }
  list.sort((a, b) => {
    const dp = getDomainPriority(a) - getDomainPriority(b);
    if (dp !== 0) return dp;
    let aVal: any, bVal: any;
    switch (config.prop) {
      case 'username':
        aVal = a.username;
        bVal = b.username;
        break;
      case 'url':
        aVal = a.url;
        bVal = b.url;
        break;
      case 'tag':
        aVal = a.tag;
        bVal = b.tag;
        break;
      case 'remark':
        aVal = a.remark;
        bVal = b.remark;
        break;
      case 'createTime':
        aVal = a.createTime;
        bVal = b.createTime;
        break;
      case 'updateTime':
        aVal = a.updateTime;
        bVal = b.updateTime;
        break;
      default:
        return b.updateTime - a.updateTime;
    }
    let cmp = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') cmp = aVal.localeCompare(bVal);
    else if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
    else return b.updateTime - a.updateTime;
    return config.order === 'ascending' ? cmp : -cmp;
  });
};

// 计算属性
const filteredPasswords = computed(() => {
  let result = [...passwords.value];

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

  applySortConfig(result);
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
    logger.error('SidePanel: 检查会话状态失败:', error);
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

// 与 background 建立 port 连接，用于可靠的状态追踪和关闭通信
let bgPort: chrome.runtime.Port | null = null;

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
    logger.error('更新当前域名失败:', error);
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
    logger.error('获取当前标签页失败:', error);
  }
};

// 加载密码列表
const loadPasswords = async () => {
  try {
    loading.value = true;

    // 检查会话是否有效
    const sessionValid = await StorageUtils.isSessionValid();
    if (!sessionValid) {
      // 会话无效，清空密码列表并显示未认证状态
      isAuthenticated.value = false;
      passwords.value = [];
      return;
    }

    // 加载排序配置
    try {
      sortConfig.value = await StorageUtils.getSortConfig();
    } catch {
      sortConfig.value = null;
    }

    // 会话有效，直接获取数据（StorageUtils 内部会自动判断是否需要解密）
    let loadedPasswords: PasswordEntry[];
    if (currentDomain.value) {
      // 本地开发环境（localhost / 127.0.0.1）默认匹配所有账号密码
      if (isLocalDevDomain(currentDomain.value)) {
        loadedPasswords = await StorageUtils.getAllPasswords();
      } else {
        loadedPasswords = await StorageUtils.getPasswordsByUrl(currentDomain.value);
      }
    } else {
      loadedPasswords = await StorageUtils.getAllPasswords();
    }

    passwords.value = loadedPasswords;

    // 更新缓存
    await updatePasswordCacheInBackground(loadedPasswords, currentDomain.value, isAuthenticated.value);
  } catch (error) {
    logger.error('加载密码列表失败:', error);
    ElMessage.error('加载密码列表失败');
  } finally {
    loading.value = false;
  }
};

// 搜索处理
const handleSearch = () => {
  // 搜索逻辑已通过计算属性实现
};

/**
 * 向content script发送PING消息，验证就绪状态
 * @param tabId 标签页ID
 * @param maxRetries 最大重试次数
 * @returns PingResponse或null
 */
const pingContentScript = async (tabId: number, maxRetries: number = 3): Promise<PingResponse | null> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: MessageType.PING });
      if (response && response.success) {
        return response as PingResponse;
      }
    } catch (error) {
      // PING失败，等待后重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return null;
};

/**
 * 等待字段检测完成
 * 使用指数退避策略轮询检查
 */
const waitForFieldsDetected = async (tabId: number, maxRetries: number = 10): Promise<boolean> => {
  let delay = 100; // 初始延迟100ms
  const maxDelay = 2000; // 最大延迟2s

  for (let i = 0; i < maxRetries; i++) {
    const pingResponse = await pingContentScript(tabId, 1);
    if (pingResponse && pingResponse.fieldsDetected) {
      const { username, password, mobile } = pingResponse.fieldsDetected;
      if (username > 0 || password > 0 || mobile > 0) {
        return true;
      }
    }

    // 等待后重试
    await new Promise(resolve => setTimeout(resolve, delay));

    // 指数退避，但不超过最大延迟
    delay = Math.min(delay * 1.5, maxDelay);
  }

  return false;
};

// 填充密码
const fillPassword = async (password: PasswordEntry) => {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      ElMessage.error('无法获取当前页面信息');
      return;
    }

    const tabId = tab.id;

    // 步骤1: 先检查 content script 是否已就绪（通过 PING）
    let pingResponse = await pingContentScript(tabId, 2);

    // 步骤2: 只有在 PING 失败时才尝试注入 content script
    if (!pingResponse) {
      logger.debug('Content script 未就绪，尝试注入...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/content.js'],
        });
        // 注入后等待脚本初始化和字段检测（给足够时间）
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (injectError) {
        logger.error('Content script 注入失败:', injectError);
        ElMessage.error('无法在当前页面中注入脚本，请刷新页面后重试');
        return;
      }

      // 注入后重新 PING 验证
      pingResponse = await pingContentScript(tabId, 5);
      if (!pingResponse) {
        ElMessage.error('页面脚本未就绪，请刷新页面后重试');
        return;
      }
    }

    // 步骤3: 检查字段是否已检测到，如果没有则等待
    const hasFields =
      pingResponse.fieldsDetected &&
      (pingResponse.fieldsDetected.username > 0 ||
        pingResponse.fieldsDetected.password > 0 ||
        pingResponse.fieldsDetected.mobile > 0);

    if (!hasFields) {
      // 等待字段检测完成
      const detected = await waitForFieldsDetected(tabId);
      if (!detected) {
        ElMessage.warning('未检测到登录表单，请确保页面包含登录输入框');
        return;
      }
    }

    // 步骤4: 发送填充消息
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: MessageType.FILL_PASSWORD,
      data: {
        username: password.username,
        password: password.password,
      },
    })) as FillResult;

    // 步骤5: 根据响应显示结果
    if (response && response.success) {
      ElMessage.success(response.message || '密码填充成功');
      // 隐藏侧边栏
      await chrome.runtime.sendMessage({ type: MessageType.HIDE_SIDEPANEL });
    } else {
      const errorMsg = response?.message || '填充可能未完成，请检查页面表单';
      ElMessage.warning(errorMsg);
    }
  } catch (error: any) {
    logger.error('填充密码失败:', error);
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
    logger.error('复制用户名失败:', error);
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
    logger.error('SidePanel: 打开选项页面失败:', error);
  }
};

// 从 background 获取缓存的密码数据
const getCachedPasswordsFromBackground = async (domain?: string): Promise<PasswordCache | null> => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_CACHED_PASSWORDS,
      data: { domain },
    });
    if (response?.success && response.data) {
      return response.data as PasswordCache;
    }
    return null;
  } catch (error) {
    logger.error('SidePanel: 获取缓存数据失败:', error);
    return null;
  }
};

// 更新 background 中的密码缓存
const updatePasswordCacheInBackground = async (
  passwordList: PasswordEntry[],
  domain: string,
  authenticated: boolean,
): Promise<void> => {
  try {
    await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_PASSWORD_CACHE,
      data: {
        passwords: passwordList,
        domain,
        isAuthenticated: authenticated,
      },
    });
  } catch (error) {
    logger.error('SidePanel: 更新缓存失败:', error);
  }
};

// 初始化
onMounted(async () => {
  // SidePanel: 开始初始化

  // 建立与 background 的 port 连接，用于状态追踪和接收关闭消息
  try {
    bgPort = chrome.runtime.connect({ name: 'sidepanel' });
    bgPort.onMessage.addListener((message: any) => {
      if (message.type === MessageType.CLOSE_SIDEPANEL) {
        logger.debug('SidePanel: 收到关闭消息，正在关闭侧边栏');
        window.close();
      }
    });
    bgPort.onDisconnect.addListener(() => {
      bgPort = null;
    });
  } catch (err) {
    logger.error('SidePanel: 建立 port 连接失败:', err);
  }

  // 使用 composable 注册监听器（自动在组件卸载时清理）
  onStorageChange(handleStorageChange);
  onMessage(handleMessage);
  onDocumentEvent('visibilitychange', handleVisibilityChange);
  onWindowEvent('sessionExpired', handleSessionChange);
  onTabUpdated(handleTabUpdated);
  onTabActivated(handleTabActivated);

  try {
    // 先获取当前标签页域名
    await loadCurrentTab();

    // 尝试从缓存获取数据
    const cachedData = await getCachedPasswordsFromBackground(currentDomain.value);

    if (cachedData && cachedData.isAuthenticated) {
      // 有有效缓存，立即显示缓存数据
      logger.debug('SidePanel: 使用缓存数据，条目数:' + cachedData.passwords.length);
      passwords.value = cachedData.passwords;
      isAuthenticated.value = true;
      loading.value = false;

      // 后台验证会话状态，如果失效则重新加载
      verifySessionAndRefreshIfNeeded();
    } else {
      // 无缓存，走原有加载逻辑
      logger.debug('SidePanel: 无缓存，从存储加载数据');
      await loadFromStorage();
    }
  } catch (error) {
    logger.error('SidePanel: 初始化失败:', error);
    // 出错时显示未验证状态
    isAuthenticated.value = false;
    loading.value = false;
  }
  // SidePanel: 初始化完成
});

// 从存储加载数据（原有逻辑）
const loadFromStorage = async () => {
  // 检查会话是否有效
  const isSessionValid = await StorageUtils.isSessionValid();

  if (!isSessionValid) {
    // 会话无效，显示未验证状态
    isAuthenticated.value = false;
    loading.value = false;
    return;
  }

  // 会话有效，加载数据
  isAuthenticated.value = true;
  await loadPasswords();
};

// 验证会话状态，如果失效则重新加载
const verifySessionAndRefreshIfNeeded = async () => {
  try {
    const isSessionValid = await StorageUtils.isSessionValid();
    if (!isSessionValid) {
      // 会话已失效，清除显示并显示未验证状态
      logger.debug('SidePanel: 会话已失效，显示未验证状态');
      isAuthenticated.value = false;
      passwords.value = [];
    }
  } catch (error) {
    logger.error('SidePanel: 验证会话状态失败:', error);
  }
};

// 组件卸载时清理 port 连接
// 注意：Chrome 事件监听器由 useChromeListeners composable 自动清理
onUnmounted(() => {
  if (bgPort) {
    bgPort.disconnect();
    bgPort = null;
  }
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

.copy-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  margin-left: 4px;
  cursor: pointer;
  border-radius: 4px;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.copy-icon-wrapper:hover {
  background-color: rgb(64 158 255 / 10%);
}

.copy-icon-wrapper .copy-icon {
  font-size: 14px;
  color: #9ca3af;
  pointer-events: none;
}

.copy-icon-wrapper:hover .copy-icon {
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
