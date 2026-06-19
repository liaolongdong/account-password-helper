import { onMounted, onUnmounted, type Ref } from 'vue';
import { MessageType, type PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';

/**
 * Runtime 消息监听 Composable
 *
 * 封装 chrome.runtime.onMessage 监听逻辑，
 * 处理来自 background/sidepanel 的锁定广播、编辑指令和添加指令。
 */
export function useRuntimeMessageHandler(options: {
  /** 密码列表数据 */
  passwords: Ref<PasswordEntry[]>;
  /** 是否已认证 */
  isAuthenticated: Ref<boolean>;
  /** 会话过期处理 */
  handleSessionExpired: () => void;
  /** 编辑密码 */
  editPassword: (entry: PasswordEntry) => void;
  /** 打开添加密码弹窗 */
  openPasswordDialog: () => void;
}) {
  const { passwords, isAuthenticated, handleSessionExpired, editPassword, openPasswordDialog } = options;

  /**
   * 等待密码列表加载完成
   * @param maxWaitMs 最大等待时间（毫秒）
   */
  const waitForPasswords = async (maxWaitMs = 3000) => {
    const interval = 100;
    const maxAttempts = Math.ceil(maxWaitMs / interval);
    for (let i = 0; i < maxAttempts; i++) {
      if (passwords.value.length > 0 || isAuthenticated.value) break;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  };

  /** 处理运行时消息 */
  const handleRuntimeMessage = (message: any) => {
    if (message.type === MessageType.SESSION_EXPIRED) {
      logger.debug('RuntimeMsg: 收到锁定广播消息，执行会话过期处理');
      handleSessionExpired();
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_EDIT) {
      const editId = message.data?.editId;
      if (!editId) return;
      logger.debug('RuntimeMsg: 收到侧边栏编辑指令，editId=' + editId);
      waitForPasswords().then(() => {
        const entry = passwords.value.find(p => p.id === editId);
        if (entry) {
          editPassword(entry);
        } else {
          ElMessage.warning('未找到对应的密码条目，可能已被删除');
        }
      });
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_ADD) {
      logger.debug('RuntimeMsg: 收到侧边栏添加密码指令');
      waitForPasswords().then(() => {
        // 密码列表有数据时才自动弹窗，空数据时不弹，让用户看到空状态引导
        if (passwords.value.length > 0) {
          openPasswordDialog();
        }
      });
    }
  };

  onMounted(() => {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  });

  onUnmounted(() => {
    chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  });
}
