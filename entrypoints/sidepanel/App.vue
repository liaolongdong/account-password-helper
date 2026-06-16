<template>
  <div
    v-show="showSidepanel"
    class="sidepanel-container"
    @keydown="handleKeydown"
  >
    <!-- 头部 -->
    <div class="header">
      <div class="header-left">
        <h3>
          <BrandLogo class="logo" />
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
      <div class="header-actions">
        <button
          type="button"
          class="icon-btn"
          title="查看开源仓库"
          @click="openGithub"
        >
          <span
            class="icon-btn__svg"
            v-html="githubIconSvg"
          ></span>
        </button>
        <button
          type="button"
          class="icon-btn"
          title="操作指引与常见问题"
          @click="showHelpDialog = true"
        >
          <span
            class="icon-btn__svg"
            v-html="questionIconSvg"
          ></span>
        </button>
        <button
          type="button"
          class="icon-btn"
          title="设置"
          @click="openSettingsDialog"
        >
          <el-icon><Setting /></el-icon>
        </button>
      </div>
    </div>

    <!-- 搜索框 -->
    <div
      v-if="isAuthenticated"
      class="search-section"
    >
      <el-input
        ref="searchInputRef"
        v-model="searchKeyword"
        placeholder="搜索用户名、URL、标签、备注..."
        :prefix-icon="Search"
        clearable
        @input="handleSearch"
      />
      <el-tooltip
        :content="favoriteOnly ? '显示全部' : '只看收藏'"
        placement="top"
        :show-after="400"
      >
        <el-button
          :icon="favoriteOnly ? StarFilled : Star"
          circle
          size="small"
          :type="favoriteOnly ? 'warning' : 'default'"
          @click="favoriteOnly = !favoriteOnly"
        />
      </el-tooltip>
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
          class="auth-verify-btn"
          type="primary"
          :icon="BrandLogo"
          size="large"
          @click="openOptions"
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
          v-for="(password, index) in filteredPasswords"
          :key="password.id"
          class="password-item"
          :class="{ active: activeIndex === index }"
          title="点击快速填充账号和密码"
          @click="fillPassword(password)"
          @mouseenter="activeIndex = index"
        >
          <div class="password-info">
            <div class="username">
              <el-icon><User /></el-icon>
              {{ password.username }}
              <span
                class="copy-icon-wrapper"
                title="复制账号"
                @click.stop.prevent="copyUsername(password.username)"
                @mousedown.stop
              >
                <el-icon class="copy-icon">
                  <CopyDocument />
                </el-icon>
              </span>
              <span
                class="copy-icon-wrapper copy-password"
                title="复制密码"
                @click.stop.prevent="copyPassword(password.password)"
                @mousedown.stop
              >
                <el-icon class="copy-icon">
                  <Key />
                </el-icon>
              </span>
            </div>
            <div class="details">
              <el-tooltip
                v-for="t in parseTags(password.tag)"
                :key="t"
                :content="t"
                placement="top"
                :show-after="300"
                :popper-style="{ maxWidth: '500px', wordBreak: 'break-all' }"
              >
                <el-tag
                  :type="getTagType(t)"
                  size="small"
                  class="tag-item"
                >
                  {{ t }}
                </el-tag>
              </el-tooltip>
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
            <el-icon
              class="action-icon favorite-icon"
              :class="{ 'is-favorite': password.favorite }"
              :title="password.favorite ? '取消收藏' : '收藏'"
              @click.stop="toggleFavorite(password)"
            >
              <StarFilled v-if="password.favorite" />
              <Star v-else />
            </el-icon>
            <el-icon
              class="action-icon auto-login-icon"
              title="填充并登录"
              @click.stop="handleFillAndLogin(password)"
            >
              <VideoPlay />
            </el-icon>
            <el-icon class="action-icon"><Right /></el-icon>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="footer">
      <el-button
        :icon="BrandLogo"
        class="footer-manage-btn"
        @click="openOptions"
      >
        密码管理
      </el-button>
    </div>

    <!-- 操作指引与常见问题弹窗 -->
    <HelpDialog
      v-model="showHelpDialog"
      @go-to-options="openOptions"
    />

    <!-- 悬浮按钮设置弹窗（与悬浮按钮共用同一套 HTML/CSS/事件） -->
    <div
      v-if="showSettingsDialog"
      class="sp-settings-host"
    >
      <div
        ref="settingsOverlayEl"
        class="settings-overlay visible"
      ></div>
      <div
        ref="settingsPanelEl"
        class="settings-panel visible"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import {
  Search,
  User,
  Right,
  Setting,
  Loading,
  CopyDocument,
  Key,
  Star,
  StarFilled,
  VideoPlay,
} from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import HelpDialog from '@/components/HelpDialog.vue';
import {
  MessageType,
  type PasswordEntry,
  type PasswordCache,
  type PingResponse,
  type FillResult,
  type FloatingButtonConfig,
} from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { useChromeListeners } from '@/composables/useChromeListeners';
import { getTagType, parseTags } from '@/utils/tagUtils';
import { logger } from '@/utils/logger';
import { githubIconSvg, questionIconSvg } from '@/entrypoints/sidepanel/icons';
import {
  getSettingsPanelHTML,
  bindSettingsPanelView,
  settingsPanelViewStyles,
  type SettingsPanelViewHandle,
} from '@/entrypoints/content/floatingButtons/settingsPanelView';

const loading = ref(true);
const searchKeyword = ref('');
/** 是否仅显示收藏条目 */
const favoriteOnly = ref(false);
const passwords = ref<PasswordEntry[]>([]);
const currentDomain = ref('');
const isAuthenticated = ref(false);
const showSidepanel = ref(true);
const sortConfig = ref<{ prop: string; order: string } | null>(null);
const activeIndex = ref(0);
const searchInputRef = ref();

// 头部功能图标相关状态
const GITHUB_URL = 'https://github.com/liaolongdong/account-password-helper';
const showHelpDialog = ref(false);
const showSettingsDialog = ref(false);
const floatingConfig = ref<FloatingButtonConfig>(StorageUtils.getDefaultFloatingButtonConfig());

// 设置弹窗 DOM 引用与共用视图句柄
const settingsPanelEl = ref<HTMLElement | null>(null);
const settingsOverlayEl = ref<HTMLElement | null>(null);
let settingsViewHandle: SettingsPanelViewHandle | null = null;

// 打开 GitHub 仓库
const openGithub = () => {
  chrome.tabs.create({ url: GITHUB_URL });
};

// 关闭设置弹窗
const closeSettingsDialog = () => {
  settingsViewHandle?.destroy();
  settingsViewHandle = null;
  showSettingsDialog.value = false;
};

// 打开设置弹窗：先从存储加载最新配置，再通过共用视图模块渲染与绑定事件
const openSettingsDialog = async () => {
  try {
    floatingConfig.value = await StorageUtils.getFloatingButtonConfig();
  } catch (error) {
    logger.error('SidePanel: 加载悬浮按钮配置失败:', error);
  }
  showSettingsDialog.value = true;

  await nextTick();
  if (!settingsPanelEl.value) return;

  settingsPanelEl.value.innerHTML = getSettingsPanelHTML(floatingConfig.value);
  settingsViewHandle = bindSettingsPanelView(settingsPanelEl.value, settingsOverlayEl.value, floatingConfig.value, {
    onConfigChange: patch => {
      void updateFloatingConfig(patch);
    },
    onClose: closeSettingsDialog,
  });
};

// 更新悬浮按钮配置（content 会通过 chrome.storage.onChanged 自动同步）
const updateFloatingConfig = async (patch: Partial<FloatingButtonConfig>) => {
  Object.assign(floatingConfig.value, patch);
  try {
    await StorageUtils.saveFloatingButtonConfig(patch);
  } catch (error) {
    logger.error('SidePanel: 保存悬浮按钮配置失败:', error);
    ElMessage.error('保存设置失败');
  }
};

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
    let cmp;
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

  if (favoriteOnly.value) {
    result = result.filter(p => p.favorite);
  }

  applySortConfig(result);

  // 收藏条目始终置顶
  result.sort((a, b) => {
    const favA = a.favorite ? 1 : 0;
    const favB = b.favorite ? 1 : 0;
    if (favA !== favB) return favB - favA;
    return 0; // 保持 applySortConfig 的排序
  });

  return result;
});

/** 收藏过滤变化时重置选中索引 */
watch(favoriteOnly, () => {
  activeIndex.value = 0;
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

  // 密码数据变化时，重新加载密码列表（解决自动保存后快速填充列表不刷新的问题）
  if (changes['account_passwords']) {
    logger.debug('SidePanel: 检测到密码数据变动，重新加载');
    if (isAuthenticated.value) {
      void loadPasswords();
    }
  }
};

// 与 background 建立 port 连接，用于可靠的状态追踪和关闭通信
let bgPort: chrome.runtime.Port | null = null;

// 监听来自background的消息
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) => {
  switch (message.type) {
    case MessageType.URL_CHANGED:
      // SidePanel: 检测到URL变化，更新数据
      updateCurrentDomainAndLoadPasswords();
      sendResponse({ success: true, message: 'URL变化处理完成' });
      return true;
    case MessageType.SESSION_EXPIRED:
      // 锁定/会话过期：立即切换到未验证状态，清空密码列表防止乱码
      logger.debug('SidePanel: 收到锁定广播消息，立即切换到未验证状态');
      isAuthenticated.value = false;
      passwords.value = [];
      sendResponse({ success: true });
      return true;
    default:
      return false; // 不响应，让消息传递给 background 处理
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
const handleTabActivated = async (_activeInfo: any) => {
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
  activeIndex.value = 0; // 搜索时重置选中索引
};

// 键盘导航处理
const handleKeydown = (e: KeyboardEvent) => {
  const list = filteredPasswords.value;
  if (!list.length) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      activeIndex.value = Math.min(activeIndex.value + 1, list.length - 1);
      scrollToActiveItem();
      break;
    case 'ArrowUp':
      e.preventDefault();
      activeIndex.value = Math.max(activeIndex.value - 1, 0);
      scrollToActiveItem();
      break;
    case 'Enter':
      e.preventDefault();
      if (activeIndex.value >= 0 && activeIndex.value < list.length) {
        fillPassword(list[activeIndex.value]);
      }
      break;
    case 'Escape':
      e.preventDefault();
      window.close();
      break;
    case 'c':
    case 'C':
      if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift+C: 复制密码 暂不需要（注释，别删除）
        // e.preventDefault();
        // if (activeIndex.value >= 0 && activeIndex.value < list.length) {
        //   copyPassword(list[activeIndex.value].password);
        // }
      } else if (e.ctrlKey) {
        // Ctrl+C: 复制用户名
        e.preventDefault();
        if (activeIndex.value >= 0 && activeIndex.value < list.length) {
          copyUsername(list[activeIndex.value].username);
        }
      }
      break;
  }
};

// 滚动到当前选中条目
const scrollToActiveItem = () => {
  nextTick(() => {
    const activeEl = document.querySelector('.password-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
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
    } catch (_error) {
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
const waitForFieldsDetected = async (tabId: number, maxRetries: number = 3): Promise<boolean> => {
  let delay = 100; // 初始延迟100ms
  const maxDelay = 1000; // 最大延迟1s

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
const fillPassword = async (password: PasswordEntry, options?: { autoLogin?: boolean }) => {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      ElMessage.error('无法获取当前页面信息');
      return;
    }

    const tabId = tab.id;
    const autoLogin = options?.autoLogin ?? false;

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
        autoLogin,
      },
    })) as FillResult;

    // 步骤5: 根据响应显示结果
    if (response && response.success) {
      ElMessage.success(response.message || '密码填充成功');
      // 隐藏侧边栏（必须携带 tabId，因为 sidepanel 发出的消息 sender.tab 为 undefined）
      await chrome.runtime.sendMessage({
        type: MessageType.HIDE_SIDEPANEL,
        data: { tabId },
      });
    } else {
      const rawMsg = response?.message || '';
      const isNoForm = rawMsg.includes('未检测到登录表单');
      const errorMsg = isNoForm ? '未检测到登录表单，请确保页面包含登录输入框' : rawMsg;
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

/** 填充密码并自动触发登录 */
const handleFillAndLogin = (password: PasswordEntry) => {
  fillPassword(password, { autoLogin: true });
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

/**
 * 复制密码到剪贴板
 * @param password 要复制的密码明文
 */
const copyPassword = async (password: string) => {
  try {
    await navigator.clipboard.writeText(password);
    ElMessage.success('密码已复制到剪贴板');
  } catch (error) {
    logger.error('复制密码失败:', error);
    ElMessage.error('复制密码失败');
  }
};

// 切换收藏状态
const toggleFavorite = async (password: PasswordEntry) => {
  try {
    const newFav = !password.favorite;
    await StorageUtils.updatePassword(password.id, { favorite: newFav, updateTime: password.updateTime });
    password.favorite = newFav;
    ElMessage.success(newFav ? '已收藏' : '已取消收藏');
  } catch (error) {
    logger.error('切换收藏失败:', error);
    ElMessage.error('操作失败');
  }
};

// 打开选项页面
// 统一由 background 的 OPEN_OPTIONS_PAGE 处理：若已存在则激活最近访问的 tab，否则创建新 tab
const openOptions = async () => {
  try {
    await chrome.runtime.sendMessage({ type: MessageType.OPEN_OPTIONS_PAGE });
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

// 将共用设置弹窗样式注入到 sidepanel 页面（仅注入一次）
const injectSettingsViewStyles = () => {
  const STYLE_ID = 'floating-settings-view-styles';
  if (document.getElementById(STYLE_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = settingsPanelViewStyles;
  document.head.appendChild(styleEl);
};

// 初始化
onMounted(async () => {
  // SidePanel: 开始初始化
  injectSettingsViewStyles();

  // 搜索框自动聚焦
  nextTick(() => {
    const inputEl = searchInputRef.value?.$el?.querySelector('input');
    if (inputEl) inputEl.focus();
  });

  // 建立与 background 的 port 连接，用于状态追踪和接收关闭消息
  try {
    bgPort = chrome.runtime.connect({ name: 'sidepanel' });
    bgPort.onMessage.addListener((message: any) => {
      if (message.type === MessageType.CLOSE_SIDEPANEL) {
        logger.debug('SidePanel: 收到关闭消息，正在关闭侧边栏');
        try {
          window.close();
        } catch (err) {
          logger.error('SidePanel: window.close() 失败:', err);
        }
      } else if (message.type === MessageType.SESSION_EXPIRED) {
        // 锁定/会话过期：立即切换到未验证状态，清空密码列表防止乱码
        logger.debug('SidePanel: 收到锁定消息（port），立即切换到未验证状态');
        isAuthenticated.value = false;
        passwords.value = [];
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
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f8f9fa;
}

.header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  gap: 0;
  align-items: center;
}

.icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  color: #374151;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.icon-btn:hover {
  background: rgb(0 0 0 / 6%);
}

.icon-btn:active {
  background: rgb(0 0 0 / 10%);
}

.icon-btn .el-icon,
.icon-btn svg {
  width: 18px;
  height: 18px;
  font-size: 18px;
}

.header h3 {
  display: flex;
  align-items: center;
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.logo {
  margin-right: 8px;
  font-size: 20px;
  color: #409eff;
}

.current-url {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.search-section {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.search-section :deep(.el-input) {
  flex: 1;
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
  margin-bottom: 8px;
  font-size: 24px;
}

.empty {
  padding: 20px;
}

.password-items {
  /* padding: 8px 0; */
}

.password-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  background: white;
  border-bottom: 1px solid #f0f0f0;
  transition: background-color 0.2s;
}

.password-item:last-child {
  border-bottom: none;
}

.password-item:hover {
  background: #f8f9fa;
}

.password-item.active {
  padding-left: 13px;
  background: #ecf5ff;
  border-left: 3px solid #409eff;
}

.password-info {
  flex: 1;
  min-width: 0;
}

.username {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-bottom: 4px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
}

.username > .el-icon {
  margin-right: 6px;
  font-size: 16px;
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

.copy-icon-wrapper.copy-password {
  margin-left: 0;
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
  gap: 4px;
  align-items: center;
  min-width: 0;
  margin-bottom: 4px;
  overflow: hidden;
}

.details .el-tag {
  font-size: 11px;
}

/* 标签样式 */
.tag-item {
  /* 单行展示，超长省略，配合外层 el-tooltip 显示完整内容 */
  min-width: 0;
  max-width: 200px;
  padding: 2px 6px;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  border-radius: 4px;
}

/* el-tag 内层文本节点继承省略策略，确保 inline-flex 下生效 */
.tag-item :deep(.el-tag__content) {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 多标签并列时的横向间距 */
.tag-item + .tag-item {
  margin-left: 2px;
}

/* URL 文本截断，防止长 URL 挤占右侧按钮 */
.details > .el-text {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remark {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.password-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  color: #d1d5db;
}

.action-icon {
  font-size: 16px;
}

.favorite-icon {
  margin-right: 8px;
  color: #d1d5db;
  cursor: pointer;
  transition: color 0.2s;
}

.favorite-icon:hover {
  color: #e6a23c;
}

.favorite-icon.is-favorite {
  color: #e6a23c;
}

.auto-login-icon {
  margin-right: 8px;
  color: #d1d5db;
  cursor: pointer;
  transition: color 0.2s;
}

.auto-login-icon:hover {
  color: #67c23a;
}

.footer {
  padding: 10px 16px;
  text-align: center;
  background: white;
  border-top: none;
  box-shadow: 0 -2px 8px rgb(0 0 0 / 4%);
}

/* 密码管理按钮：浅蓝背景 + hover 变实心蓝 */
:deep(.footer-manage-btn) {
  width: 100%;
  padding: 10px 0;
  font-size: 14px;
  font-weight: 500;
  color: #409eff;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 8px;
  transition: all 0.25s ease;
}

:deep(.footer-manage-btn:hover) {
  color: #fff;
  background: #409eff;
  border-color: #409eff;
  box-shadow: 0 2px 8px rgb(64 158 255 / 30%);
  transform: translateY(-1px);
}

:deep(.footer-manage-btn .el-icon) {
  font-size: 18px;
}

/* 未验证状态样式 */
.auth-required {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 40px 20px;
  background: #f8f9fa;
}

.auth-description {
  margin-bottom: 20px;
  text-align: center;
}

.auth-description p {
  margin: 8px 0;
  font-size: 14px;
  color: #666;
}

.auth-tip {
  font-size: 12px !important;
  color: #999 !important;
}

/* 去验证主密码按钮：放大钥匙图标并与文字拉开间距 */
.auth-verify-btn :deep(.el-icon) {
  margin-right: -4px;
  font-size: 20px;
}

.auth-verify-btn :deep(.el-icon svg) {
  width: 1em;
  height: 1em;
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

<style>
html,
body {
  height: 100%;
  padding: 0;
  margin: 0;
  overflow: hidden;
}

#app {
  height: 100%;
}
</style>
