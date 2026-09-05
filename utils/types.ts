import type { ThemeName } from '@/utils/theme';
import type { SidepanelOpenTrigger } from '@/utils/perfMetrics';

/**
 * 页面填充模式
 * - sidepanel：聚焦登录框时自动打开侧边栏（默认，保持历史交互）
 * - inline：聚焦登录框时在页面内弹出内联填充下拉
 */
export type FillMode = 'sidepanel' | 'inline';

/**
 * 账号密码数据接口
 */
export interface PasswordEntry {
  /**
   * 账号密码数据ID
   */
  id: string;
  /**
   * 账号/邮箱/手机号/用户名/用户号
   */
  username: string;
  /**
   * 密码
   */
  password: string;
  /**
   * 网址
   */
  url: string;
  /**
   * 标签
   */
  tag: string;
  /**
   * 备注
   */
  remark: string;
  /**
   * 两步验证（TOTP）密钥
   *
   * 存储 `otpauth://totp/...` 标准 URI 或裸 Base32 密钥；
   * 作为敏感字段随主密码体系加密存储，动态码在本地按 RFC 6238 计算。
   * 未配置 2FA 时为空字符串或 undefined。
   */
  totp?: string;
  /**
   * 创建时间
   */
  createTime: number;
  /**
   * 更新时间
   */
  updateTime: number;
  /**
   * 是否收藏（收藏条目置顶显示）
   */
  favorite?: boolean;
  /**
   * 收藏最后使用时间戳（LRU 淘汰依据），未收藏或从未使用时为 undefined
   */
  favoriteUsedAt?: number;
  /**
   * 最后使用时间戳（侧边栏填充时刷新），从未使用时为 undefined
   */
  lastUsedAt?: number;
  /**
   * 排列顺序
   */
  order: number;
}

/**
 * 带UI状态的密码条目（用于列表展示）
 */
export interface PasswordEntryWithUI extends PasswordEntry {
  /** 是否显示明文密码 */
  showPassword: boolean;
}

/**
 * 带加密标识的密码条目（用于存储层区分加密/明文数据）
 */
export interface EncryptedPasswordEntry extends PasswordEntry {
  /** 是否已加密 */
  encrypted?: boolean;
}

/**
 * 用户主密码配置
 */
export interface MasterPasswordConfig {
  hashedPassword: string;
  salt: string;
  /**
   * 校验哈希使用的 KDF 算法标记
   *
   * - `'pbkdf2-sha256'`：PBKDF2-SHA256 慢哈希（当前版本）
   * - 缺失（undefined）：旧版单轮 SHA-256，在下次成功验证时透明迁移升级
   */
  kdf?: 'pbkdf2-sha256';
}

/**
 * 消息类型枚举
 */
export enum MessageType {
  /**
   * 心跳消息类型
   */
  PING = 'PING',
  /**
   * 填充密码消息类型
   */
  FILL_PASSWORD = 'FILL_PASSWORD',
  /**
   * 填充手机号消息类型
   */
  FILL_MOBILE_CODE = 'FILL_MOBILE_CODE', // 新增手机号+验证码填充消息类型
  /**
   * 填充 TOTP 两步验证码消息类型（填入页面检测到的验证码输入框）
   */
  FILL_TOTP = 'FILL_TOTP',
  /**
   * 显示侧边栏消息类型
   */
  SHOW_SIDEPANEL = 'SHOW_SIDEPANEL',
  /**
   * 隐藏侧边栏消息类型
   */
  HIDE_SIDEPANEL = 'HIDE_SIDEPANEL',
  /**
   * 切换侧边栏消息类型（用于悬浮按钮）
   */
  TOGGLE_SIDEPANEL = 'TOGGLE_SIDEPANEL',
  /**
   * 关闭侧边栏消息类型（发送给sidepanel，让它自己关闭）
   */
  CLOSE_SIDEPANEL = 'CLOSE_SIDEPANEL',
  /** Side Panel Port 完成 window/tab 身份确认的内部握手消息。 */
  SIDEPANEL_READY = 'SIDEPANEL_READY',
  /**
   * URL变化消息类型
   */
  URL_CHANGED = 'URL_CHANGED',
  /**
   * 打开密码管理页面
   */
  OPEN_OPTIONS_PAGE = 'OPEN_OPTIONS_PAGE',
  /**
   * 触发 background 预热/刷新密码缓存（无载荷，由 background 自行去重解密填充）
   */
  UPDATE_PASSWORD_CACHE = 'UPDATE_PASSWORD_CACHE',
  /**
   * 使密码缓存失效
   */
  INVALIDATE_PASSWORD_CACHE = 'INVALIDATE_PASSWORD_CACHE',
  /**
   * 自动保存密码消息类型
   */
  AUTO_SAVE_PASSWORD = 'AUTO_SAVE_PASSWORD',
  /**
   * 会话过期/锁定通知消息类型（由 background 广播，各 UI 上下文接收后切换到未验证状态）
   */
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  /**
   * 从侧边栏跳转到密码管理页并编辑指定条目
   */
  OPEN_OPTIONS_AND_EDIT = 'OPEN_OPTIONS_AND_EDIT',
  /**
   * 从侧边栏跳转到密码管理页并自动打开添加密码弹窗
   */
  OPEN_OPTIONS_AND_ADD = 'OPEN_OPTIONS_AND_ADD',
  /**
   * 跳转到密码管理页并自动打开有效期设置弹窗（Popup 倒计时胶囊点击续期）
   */
  OPEN_OPTIONS_AND_VALIDITY = 'OPEN_OPTIONS_AND_VALIDITY',
  /**
   * 主动触发版本更新检测
   */
  CHECK_UPDATE = 'CHECK_UPDATE',
  /**
   * 获取侧边栏初始化数据（会话验证 + 密码列表 + 排序配置）
   *
   * 性能优化：将原 sidepanel 端的多步操作（session 验证 + storage 读取 + 排序读取）
   * 合并为 background SW 端的单次调用，利用 SW 保活机制（Phase 1）使数据在 20-50ms 内返回。
   * 消除 Windows 上 sidepanel 端的 storage IPC 开销和加密模块解析开销。
   */
  GET_INITIAL_DATA = 'GET_INITIAL_DATA',
  /**
   * 侧边栏预唤醒消息（由 sidepanel/content script 发送，触发 SW 启动和缓存预热）
   */
  SIDEPANEL_PRELOAD = 'SIDEPANEL_PRELOAD',
  /**
   * 内联下拉：获取当前域名匹配账号的元数据列表（仅标题/用户名，绝不含密码）
   */
  GET_MATCHING_ACCOUNTS = 'GET_MATCHING_ACCOUNTS',
  /**
   * 内联下拉：按条目 ID 触发填充（由 background 取明文后复用 FILL_PASSWORD 下发）
   */
  FILL_BY_ID = 'FILL_BY_ID',
  /**
   * 内联下拉：按条目 ID 获取当前 TOTP 动态码（background 本地计算，仅返回
   * 30 秒自失效的一次性动态码与到期时间，绝不下发 TOTP 密钥本身）
   */
  GET_INLINE_TOTP = 'GET_INLINE_TOTP',
  /**
   * 内联下拉：按条目 ID 填充 TOTP 动态码（background 本地计算后经 FILL_TOTP 回填发起 frame）
   */
  FILL_TOTP_BY_ID = 'FILL_TOTP_BY_ID',
  /**
   * 两步接力：内容脚本查询待接力的两步验证条目 ID（账密填充成功后跨页面衔接验证码场景）
   *
   * background 校验发起标签页域名与待接力域名一致后，仅返回条目 ID，不含任何敏感信息。
   */
  GET_PENDING_TOTP = 'GET_PENDING_TOTP',
  /**
   * 两步接力：清除待接力标记（验证码填充成功或用户关闭接力胶囊时调用）
   */
  CLEAR_PENDING_TOTP = 'CLEAR_PENDING_TOTP',
  /**
   * 两步接力：侧边栏填充成功后通知 background 记录待接力标记
   *
   * 侧边栏填充（FILL_PASSWORD）不经 SW 路由，故由侧边栏显式上报；
   * hostname 仍由 SW 侧 chrome.tabs.get 获取，不信任调用方自报。
   */
  SET_PENDING_TOTP = 'SET_PENDING_TOTP',
  /**
   * 自动保存预检查：查询当前域名+账号的凭证状态，决定是否/如何弹出保存确认弹窗
   */
  CHECK_CREDENTIAL_STATUS = 'CHECK_CREDENTIAL_STATUS',
  /**
   * 一键填充：由 Popup 或快捷键触发，Background 自动匹配当前域名并填充
   */
  QUICK_FILL = 'QUICK_FILL',
  /**
   * 内联下拉：由快捷键或 Popup 触发，content script 定位登录字段后直接展开内联填充面板
   * （与点击输入框内钥匙图标一致）
   */
  OPEN_INLINE_DROPDOWN = 'OPEN_INLINE_DROPDOWN',
  /**
   * 侧边栏委托 background 更新条目非敏感元数据（lastUsedAt/favoriteUsedAt 等）
   *
   * 侧边栏填充成功后立即隐藏面板，页面上下文中的防抖批量写入定时器
   * 会随页面卸载被销毁导致更新丢失，故委托长生命周期的 SW 上下文持久化。
   */
  UPDATE_PASSWORD_METADATA = 'UPDATE_PASSWORD_METADATA',
  /**
   * 侧边栏快速添加条目：由 SidePanel 快速添加弹窗发起，委托 background 加密落盘
   *
   * 与 AUTO_SAVE_PASSWORD 不同：发起方是扩展页面（无 sender.tab），
   * URL 为用户自报的当前站点域名，仅用于条目展示，不参与安全裁决。
   */
  QUICK_ADD_PASSWORD = 'QUICK_ADD_PASSWORD',
  /**
   * 右键菜单填充：由 background 下发到用户右键点击所在 frame，
   * 将解析好的明文值（用户名/密码/TOTP 动态码/生成的强密码）填入被右键的输入框
   *
   * 与 FILL_PASSWORD 暴露面一致：仅经 tabs.sendMessage 定向单一 frame，
   * 下发前经 isFrameFillable 门控，跨域 iframe 会被拒绝。
   */
  CONTEXT_MENU_FILL = 'CONTEXT_MENU_FILL',
}

/**
 * 运行时消息判别联合类型
 *
 * 每个消息类型都有精确的 data 载荷类型（或无 data），
 * 在 switch/if 分支中 TypeScript 自动收窄类型，消除 `as any` 断言。
 */
export type RuntimeMessage =
  | { type: MessageType.PING }
  | { type: MessageType.FILL_PASSWORD; data: FillPasswordData }
  | { type: MessageType.FILL_MOBILE_CODE; data: FillMobileCodeData }
  | { type: MessageType.FILL_TOTP; data: FillTotpData }
  | { type: MessageType.SHOW_SIDEPANEL; data?: { tabId?: number; clickTs?: number; trigger?: SidepanelOpenTrigger } }
  | { type: MessageType.HIDE_SIDEPANEL; data?: { tabId?: number } }
  | { type: MessageType.TOGGLE_SIDEPANEL; data?: { tabId?: number; clickTs?: number } }
  | { type: MessageType.CLOSE_SIDEPANEL }
  | { type: MessageType.URL_CHANGED; data: { url: string } }
  | { type: MessageType.OPEN_OPTIONS_PAGE }
  | { type: MessageType.OPEN_OPTIONS_AND_EDIT; data: { editId: string } }
  | { type: MessageType.OPEN_OPTIONS_AND_ADD; data?: OpenOptionsAndAddData }
  | { type: MessageType.OPEN_OPTIONS_AND_VALIDITY }
  | { type: MessageType.UPDATE_PASSWORD_CACHE }
  | { type: MessageType.INVALIDATE_PASSWORD_CACHE }
  | { type: MessageType.AUTO_SAVE_PASSWORD; data: AutoSavePasswordData }
  | { type: MessageType.SESSION_EXPIRED }
  | { type: MessageType.CHECK_UPDATE }
  | { type: MessageType.GET_INITIAL_DATA; data?: { domain?: string } }
  | { type: MessageType.SIDEPANEL_PRELOAD }
  | { type: MessageType.GET_MATCHING_ACCOUNTS; data?: { domain?: string } }
  | { type: MessageType.FILL_BY_ID; data: FillByIdData }
  | { type: MessageType.GET_INLINE_TOTP; data: InlineTotpByIdData }
  | { type: MessageType.FILL_TOTP_BY_ID; data: InlineTotpByIdData }
  | { type: MessageType.GET_PENDING_TOTP }
  | { type: MessageType.CLEAR_PENDING_TOTP }
  | { type: MessageType.SET_PENDING_TOTP; data: SetPendingTotpData }
  | { type: MessageType.CHECK_CREDENTIAL_STATUS; data: CheckCredentialStatusData }
  | { type: MessageType.QUICK_FILL }
  | { type: MessageType.OPEN_INLINE_DROPDOWN; data?: { focusedOnly?: boolean } }
  | { type: MessageType.UPDATE_PASSWORD_METADATA; data: UpdatePasswordMetadataData }
  | { type: MessageType.QUICK_ADD_PASSWORD; data: QuickAddPasswordData }
  | { type: MessageType.CONTEXT_MENU_FILL; data: ContextMenuFillData };

/**
 * 悬浮按钮配置接口
 */
export interface FloatingButtonConfig {
  /**
   * 是否显示悬浮按钮
   */
  visible: boolean;
  /**
   * 按钮位置（左侧/右侧）
   */
  position: 'left' | 'right';
  /**
   * 垂直偏移量（像素）
   */
  offsetY: number;
  /**
   * 按钮透明度（0-1）
   */
  opacity: number;
  /**
   * 输入框获取焦点时是否自动展示侧边栏
   */
  autoShowSidepanel: boolean;
  /**
   * 点击侧边栏快速填充密码后是否自动触发登录操作（仅作用于账号密码场景）
   */
  autoTriggerLogin: boolean;
  /**
   * 是否在密码输入框内注入显示/隐藏切换按钮
   */
  passwordVisibilityToggle: boolean;
  /**
   * 页面填充模式（侧边栏 / 页面内联下拉），默认 'inline'（仅新安装生效；
   * 存量用户由升级钩子 freezeLegacyFillDefaults 冻结为历史的 'sidepanel' 行为）
   */
  fillMode: FillMode;
  /**
   * 界面主题名，默认 'sky'（晴空蓝，等同历史配色）
   */
  theme: ThemeName;
}

/**
 * 密码缓存接口
 */
export interface PasswordCache {
  /**
   * 缓存的密码列表
   */
  passwords: PasswordEntry[];
  /**
   * 缓存对应的域名
   */
  domain: string;
  /**
   * 缓存时间戳
   */
  timestamp: number;
  /**
   * 是否已认证
   */
  isAuthenticated: boolean;
}

/**
 * 侧边栏初始化数据响应接口
 *
 * 由 background SW 在 GET_INITIAL_DATA 消息处理中返回，
 * 包含会话验证结果、密码列表和排序配置，使 sidepanel 无需自行执行加密验证。
 */
export interface InitialDataResponse {
  /** 会话是否有效 */
  sessionValid: boolean;
  /** 密码列表（会话有效时返回，已按域名过滤） */
  passwords: PasswordEntry[];
  /** 排序配置 */
  sortConfig: { prop: string; order: string } | null;
}

/**
 * 填充密码数据接口
 */
export interface FillPasswordData {
  username: string;
  password: string;
  autoLogin?: boolean;
}

/**
 * 填充手机号验证码数据接口
 */
export interface FillMobileCodeData {
  mobile: string;
  code: string;
}

/**
 * 填充 TOTP 两步验证码数据接口
 */
export interface FillTotpData {
  /** 本地计算得到的动态验证码 */
  code: string;
}

/**
 * 内联下拉：单个匹配账号的元数据（不含密码，供内容脚本安全展示）
 */
export interface MatchingAccountMeta {
  /** 条目 ID */
  id: string;
  /** 展示标题（标签 / 网址 / 用户名，择优） */
  title: string;
  /** 用户名（展示用） */
  username: string;
  /** 标签 */
  tag: string;
  /** 备注（hover 展示） */
  remark: string;
  /** 网址 */
  url: string;
  /** 是否收藏 */
  favorite: boolean;
  /** 是否配置了两步验证 */
  hasTotp: boolean;
  /**
   * 网站图标 dataURL（`data:image/...;base64,...`）
   *
   * 由 background 经 Chrome 本地 `_favicon/` 端点读取转码后下发（零外部网络），
   * 避免将 `_favicon/*` 暴露为 web_accessible_resources 引入网页探测浏览历史的
   * 隐私风险；无图标/获取失败时为空字符串，内容脚本降级渲染钥匙图标。
   */
  favicon: string;
}

/**
 * 内联下拉：GET_MATCHING_ACCOUNTS 的响应数据
 */
export interface MatchingAccountsResponse {
  /** 会话是否已锁定（锁定时 accounts 为空，前端提示解锁） */
  locked: boolean;
  /** 匹配当前域名的账号元数据列表 */
  accounts: MatchingAccountMeta[];
  /** 是否未设置主密码（true 时引导用户先设置主密码） */
  noMasterPassword?: boolean;
}

/**
 * 右键菜单填充动作类型
 *
 * - username/password/totp：background 按当前域名解析最优匹配条目后下发对应值
 * - generate：background 现场生成强密码下发，不依赖任何条目
 */
export type ContextMenuFillAction = 'username' | 'password' | 'totp' | 'generate';

/**
 * 右键菜单填充：CONTEXT_MENU_FILL 的请求数据
 *
 * 明文值由 background 解析（条目查询/动态码计算/密码生成），
 * content script 只负责填入被右键的输入框，不参与条目选择。
 */
export interface ContextMenuFillData {
  /** 填充动作类型（区分反馈与日志） */
  action: ContextMenuFillAction;
  /** 待填充的明文值 */
  value: string;
}

/**
 * 内联下拉：FILL_BY_ID 的请求数据
 */
export interface FillByIdData {
  /** 目标条目 ID */
  id: string;
  /** 是否填充后自动触发登录 */
  autoLogin?: boolean;
}

/**
 * 内联下拉：GET_INLINE_TOTP / FILL_TOTP_BY_ID 的请求数据
 */
export interface InlineTotpByIdData {
  /** 目标条目 ID */
  id: string;
}

/**
 * 两步接力：GET_PENDING_TOTP 的响应数据
 */
export interface PendingTotpData {
  /** 待接力条目 ID；无待接力标记、域名不匹配或已过期时为空 */
  entryId?: string;
}

/**
 * 两步接力：SET_PENDING_TOTP 的请求数据（侧边栏填充成功后上报）
 */
export interface SetPendingTotpData {
  /** 填充目标标签页 ID（侧边栏消息无 sender.tab，须显式携带） */
  tabId: number;
  /** 刚填充成功的条目 ID */
  entryId: string;
}

/**
 * 内联下拉：GET_INLINE_TOTP 的响应数据
 *
 * 安全约定：仅包含一次性动态码（period 秒自失效）与到期时间戳，
 * 绝不包含 TOTP 密钥，内容脚本据此做本地倒计时展示与复制。
 */
export interface InlineTotpCodeData {
  /** 当前 TOTP 动态码（左补零到指定位数） */
  code: string;
  /** 动态码到期时间戳（毫秒，epoch） */
  expiresAt: number;
  /** 时间步长（秒，供倒计时进度计算） */
  period: number;
}

/**
 * 侧边栏元数据更新：UPDATE_PASSWORD_METADATA 的请求数据
 *
 * 仅允许非敏感元数据字段（与 passwordCrud 的 MetadataUpdate 对齐），
 * 敏感字段变更必须走 updatePassword 的解密-重加密路径。
 * 跨上下文消息无法传递 undefined，字段需删除时（如取消收藏的 favoriteUsedAt）
 * 传 null，由 SW 侧转换为 undefined 后落盘时自然删除该键。
 */
export interface UpdatePasswordMetadataData {
  /** 目标条目 ID */
  id: string;
  /**
   * 要更新的非敏感元数据字段（传 null 表示删除该字段）
   *
   * 字段集必须与 passwordCrud.METADATA_FIELDS 单一事实源保持一致
   * （本文件为纯类型模块，不引入运行时常量以避免循环依赖），
   * 新增字段时两处同步修改。
   */
  updates: {
    [K in 'favorite' | 'favoriteUsedAt' | 'lastUsedAt' | 'updateTime' | 'tag' | 'order']?: PasswordEntry[K] | null;
  };
}

/**
 * 「跳转管理页并新增密码」消息数据
 */
export interface OpenOptionsAndAddData {
  /** 预填到新增表单 URL 字段的当前站点域名（侧边栏「添加本站账号」携带，可选） */
  url?: string;
}

/**
 * 自动保存密码数据接口
 */
export interface AutoSavePasswordData {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 网站域名 */
  url: string;
  /** 页面标题，取自 document.title，用于 tag 字段 */
  tag: string;
  /** 备注信息，默认值为 "自动保存" */
  remark: string;
  /** 用户是否在弹窗中主动编辑了标签字段 */
  tagEdited: boolean;
  /** 用户是否在弹窗中主动编辑了备注字段 */
  remarkEdited: boolean;
}

/**
 * 侧边栏快速添加条目请求数据
 *
 * 由 SidePanel 快速添加弹窗发起，background 校验后加密落盘。
 * URL 为侧边栏自报的当前站点域名，仅作条目展示用途。
 */
export interface QuickAddPasswordData {
  /** 用户名 */
  username: string;
  /** 密码（允许为空，与密码管理页添加行为一致） */
  password: string;
  /** 网站域名（侧边栏当前站点，用户可编辑） */
  url: string;
  /** 标签（可选，默认空） */
  tag?: string;
  /** 备注（可选，默认空） */
  remark?: string;
}

/**
 * 密码表单字段模型
 *
 * 密码管理页 `passwordForm` 的形状，由 `usePasswordManagement` 持有，
 * 经 props 下发给添加/编辑弹窗渲染。
 */
export interface PasswordFormModel {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 网站域名 */
  url: string;
  /** 标签（英文逗号拼接字符串，写入前经归一化） */
  tag: string;
  /** 备注 */
  remark: string;
  /** TOTP 密钥 */
  totp: string;
}

/**
 * 密码表单弹窗可回写的字段补丁
 *
 * `tag` 不在此列：它由 `usePasswordManagement` 的 `tagArray` computed setter 独占写入
 * （含去重、长度与数量归一化及超限提示），弹窗内的本地副本不得回传，
 * 否则会用陈旧值覆盖用户刚选择的标签。
 */
export type PasswordFormPatch = Omit<PasswordFormModel, 'tag'>;

/**
 * 自动保存预检查请求数据
 *
 * 由 content script 在捕获登录凭证后、弹窗前发送，供 background 比对已保存密码库。
 */
export interface CheckCredentialStatusData {
  /** 用户名 */
  username: string;
  /** 密码（仅用于在 background 侧比对是否变化，绝不回传） */
  password: string;
  /** 网站域名（捕获帧 hostname） */
  url: string;
}

/**
 * 自动保存预检查结果状态
 *
 * - `new`：密码库中无匹配账号，应弹「保存」弹窗
 * - `identical`：账号已存在且密码相同，无需保存，静默跳过
 * - `password_changed`：账号已存在但密码不同，应弹「更新」弹窗
 * - `locked`：会话失效，跳过
 */
export type CredentialStatus = 'new' | 'identical' | 'password_changed' | 'locked';

/**
 * 保存前风险提示（非阻断）
 *
 * 由 background 预检查在**已解密的全量条目**上就地计算，随凭证状态一并返回，
 * 供 content script 的保存弹窗以内联警示形式呈现：只提醒不阻断，不引入二次确认。
 * 两个维度均可缺省，缺省即表示未命中。
 */
export interface SaveRiskHint {
  /** 密码强度较弱（与设置页安全体检同口径） */
  weak?: boolean;
  /** 与该密码相同的**其它**已存账号数量（不含本次要保存/更新的条目自身） */
  reusedCount?: number;
}

/**
 * 自动保存预检查响应数据
 *
 * 仅返回状态枚举与非密码元数据，绝不回传已存明文密码。
 */
export interface CredentialStatusResponse {
  /** 凭证状态 */
  status: CredentialStatus;
  /** 已存条目的标签/备注（仅 password_changed 时返回，用于弹窗预填，非密码） */
  existing?: { tag: string; remark: string };
  /**
   * 风险提示（仅 `new` 与 `password_changed` 返回，即实际需要弹窗的两个分支）
   *
   * `locked`（会话失效不弹窗）、`identical`（静默跳过）与异常兜底分支均不携带，
   * 避免在不会展示的路径上做无用计算。
   */
  risk?: SaveRiskHint;
}

/**
 * 域名匹配规则
 */
export interface DomainPattern {
  /** 规则唯一标识 */
  id: string;
  /** 域名或正则表达式，如 "github.com" 或 ".*\\.example\\.com" */
  pattern: string;
  /** 是否为正则表达式模式 */
  isRegex: boolean;
}

/**
 * 自动保存配置接口
 */
export interface AutoSaveConfig {
  /** 是否启用自动保存，默认 true */
  enabled: boolean;
  /** 域名匹配规则列表，为空时匹配所有域名 */
  domainPatterns: DomainPattern[];
  /** 已屏蔽的域名列表（用户点击「不再提示」后加入） */
  excludedDomains: string[];
}

/**
 * 字段检测状态接口
 */
export interface FieldsDetectedStatus {
  username: number;
  password: number;
  mobile: number;
  verifyCode: number;
}

/**
 * PING响应接口
 */
export interface PingResponse {
  success: boolean;
  ready: boolean;
  fieldsDetected: FieldsDetectedStatus;
}

/**
 * 邮箱备份配置接口
 */
export interface EmailBackupConfig {
  /** 备份目标邮箱地址 */
  email: string;
  /** 是否启用定时自动备份 */
  autoBackup: boolean;
  /** 自动备份间隔（天），如 1=每天, 7=每周 */
  autoBackupIntervalDays: number;
}

/**
 * 插件版本更新信息接口
 */
export interface UpdateInfo {
  /** 最新版本号（语义化版本，如 "1.2.0"） */
  latestVersion: string;
  /** 版本发布页面下载链接 */
  downloadUrl: string;
  /** 版本更新说明（Release body 摘要） */
  releaseNotes: string;
  /** 版本发布时间（ISO 8601） */
  publishedAt: string;
  /** 本次检测时间戳（毫秒） */
  checkedAt: number;
}

/**
 * 填充策略类型
 */
export type FillStrategy = 'native' | 'execCommand' | 'simulate';

/**
 * 剪贴板配置接口
 */
export interface ClipboardConfig {
  /** 是否启用复制密码后自动清除剪贴板，默认 true */
  autoClear: boolean;
  /** 清除延时（秒），默认 30 */
  clearAfterSeconds: number;
}

/**
 * 自动锁定配置接口
 */
export interface IdleLockConfig {
  /** 闲置多少分钟后自动锁定，0 表示不锁定 */
  idleLockMinutes: number;
  /** 关闭浏览器后是否需要重新输入主密码（默认 false，保持在有效期内跨浏览器重启免输入） */
  relockOnBrowserRestart?: boolean;
}

/**
 * 回收站条目接口
 *
 * 继承加密态密码条目，额外记录删除时间戳用于 30 天 TTL 自动清理。
 * 条目在回收站中保持密文存储，安全模型与主列表一致。
 */
export interface TrashedPasswordEntry extends EncryptedPasswordEntry {
  /** 移入回收站的时间戳（毫秒） */
  deletedAt: number;
}

/**
 * 密码修改历史记录
 *
 * 密码字段变更时快照旧密文，每条条目最多保留 5 条历史记录。
 * 历史密码以密文存储（同主密码体系加密），与数据库整体 rekey 联动。
 */
export interface PasswordHistoryRecord {
  /** 所属密码条目 ID */
  entryId: string;
  /** 历史密码（密文，同主密码体系 AES-256-GCM 加密） */
  password: string;
  /** 密码变更时间戳（毫秒） */
  changedAt: number;
}

/**
 * 密码历史记录配置
 *
 * 控制历史记录功能的启用状态和每条条目最多保留的历史记录数。
 */
export interface PasswordHistoryConfig {
  /** 是否启用密码修改历史记录 */
  enabled: boolean;
  /** 每条密码条目最多保留的历史记录数（1-10） */
  maxCount: number;
}

/**
 * 单个字段填充结果接口
 */
export interface FieldFillResult {
  found: boolean;
  filled: boolean;
  verified: boolean;
}

/**
 * 填充结果接口
 */
export interface FillResult {
  success: boolean;
  message: string;
  /** 结构化失败原因（跨语言稳定判断，替代对 message 文案的字符串匹配） */
  reason?: 'no_form';
  details: {
    usernameField: FieldFillResult;
    passwordField: FieldFillResult;
    strategy: FillStrategy;
  };
}
