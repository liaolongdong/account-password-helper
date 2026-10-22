import { onMounted, onUnmounted, type Ref } from 'vue';
import { MessageType, type PasswordEntry, type RuntimeMessage } from '@/utils/types';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { normalizeSearchKeyword } from '@/utils/keywordMatch';

/**
 * Runtime 消息监听 Composable
 *
 * 封装 chrome.runtime.onMessage 监听逻辑，
 * 处理来自 background/sidepanel 的锁定广播、编辑指令、添加指令和有效期设置指令。
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
  /** 打开添加密码弹窗（可选携带预填 URL，来自侧边栏「添加本站账号」） */
  openPasswordDialog: (prefillUrl?: string) => void;
  /** 打开有效期设置弹窗（来自 Popup 倒计时胶囊点击续期，可选） */
  openValiditySetting?: () => void;
  /** 打开站点规则弹窗（可选携带预填域名，来自内容脚本填充失败就地引导） */
  openSiteRules?: (domain?: string) => void;
  /** 打开跨子域匹配设置弹窗（来自侧边栏/内联下拉的档位引导，无预填参数） */
  openDomainMatchSetting?: () => void;
  /** 应用全库检索关键词（来自内联下拉空态的「到全库找」，实现侧需一并清掉叠加筛选） */
  applySearchKeyword?: (keyword: string) => void;
  /**
   * 打开身份库，可选携带搜索词预填检索框
   *
   * 参数来自页面侧自报（词是用户自己刚打在页面上的本人姓名），已在本函数内收口过；
   * `keyword` 为空时按「不预填」传 `undefined`。类别档位不由这条指令决定，恒为「全部」。
   */
  openIdentityVault?: (keyword?: string) => void;
}) {
  const {
    passwords,
    isAuthenticated,
    handleSessionExpired,
    editPassword,
    openPasswordDialog,
    openValiditySetting,
    openSiteRules,
    openDomainMatchSetting,
    applySearchKeyword,
    openIdentityVault,
  } = options;

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
  const handleRuntimeMessage = (message: RuntimeMessage) => {
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
          ElMessage.warning(t('message.entryNotFound'));
        }
      });
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_ADD) {
      const prefillUrl = message.data?.url;
      logger.debug('RuntimeMsg: 收到侧边栏添加密码指令' + (prefillUrl ? `，预填 URL=${prefillUrl}` : ''));
      waitForPasswords().then(() => {
        // 密码列表有数据时才自动弹窗，空数据时不弹，让用户看到空状态引导
        if (passwords.value.length > 0) {
          openPasswordDialog(prefillUrl);
        }
      });
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_VALIDITY) {
      logger.debug('RuntimeMsg: 收到打开有效期设置指令');
      // 指令仅在存在会话时由 Popup 倒计时胶囊发出；认证未完成时弹窗内会话信息无意义，故加门禁
      waitForPasswords().then(() => {
        if (isAuthenticated.value) {
          openValiditySetting?.();
        }
      });
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_SITE_RULES) {
      const domain = message.data?.domain;
      logger.debug('RuntimeMsg: 收到打开站点规则指令' + (domain ? `，预填域名=${domain}` : ''));
      // 冷启动时会话校验尚未完成，直接判定会把「已解锁」误判成未解锁；等状态落地后再交给调用方决策。
      waitForPasswords().then(() => openSiteRules?.(domain));
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH) {
      logger.debug('RuntimeMsg: 收到打开跨子域匹配设置指令');
      // 与站点规则同一时序口径：设置对话框需等密码列表/会话状态就绪后再开
      waitForPasswords().then(() => openDomainMatchSetting?.());
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_SEARCH) {
      // 后台已收口一次（`normalizeSearchKeyword`），这里按「外部输入一律不可校验上游」再收一次：
      // 同一套归一（非字符串按缺失忽略、trim、截到 `MAX_SEARCH_KEYWORD_LENGTH`）由该函数单点定义，
      // 不在此处重写，否则两处的长度上限会各自漂移。
      const keyword = normalizeSearchKeyword(message.data?.keyword);
      // 关键词可能是账号名：只记指令本身，不回显取值
      if (!keyword) return;
      logger.debug('RuntimeMsg: 收到全库检索指令');
      // 无需等列表就绪：写入的是筛选条件本身，锁定态下同样成立，解锁后列表自然按此过滤
      applySearchKeyword?.(keyword);
    } else if (message.type === MessageType.OPEN_OPTIONS_AND_IDENTITY) {
      // 与站点规则同一时序口径：身份库要过复验门槛，等会话状态落地后再交给调用方决策。
      // 后台已收口过一次，这里按「外部输入一律不可校验上游」再收一次，且沿用同一个
      // `normalizeSearchKeyword`——两处的 64 字上限只有一份真源，不会各自漂移。
      // 载荷只剩这一个标签：页面角色不跨入口，深链恒落在「全部」类别档。
      const keyword = normalizeSearchKeyword(message.data?.keyword);
      // 词的内容可能是用户姓名，属 PII：只记指令本身，不回显取值
      logger.debug('RuntimeMsg: 收到打开身份库指令');
      // 没带词也照样开库：这条指令的本意是「带我去身份库」，预填词只是省一次手打，
      // 与「到全库找」那条（没词就没有检索可言，直接终止）刻意不同。
      // 但锁定态不能开：身份库解密依赖会话数据密钥，此时打开只会得到空列表。
      // 气泡侧已按会话有效性隐藏，这里兜住残留气泡与会话恰好在点击瞬间过期的竞态。
      waitForPasswords().then(() => {
        if (!isAuthenticated.value) return;
        openIdentityVault?.(keyword || undefined);
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
