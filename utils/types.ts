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
   * 网站或应用地址
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
   * 检测表单消息类型
   */
  DETECT_FORM = 'DETECT_FORM',
  /**
   * 填充密码消息类型
   */
  FILL_PASSWORD = 'FILL_PASSWORD',
  /**
   * 填充手机号消息类型
   */
  FILL_MOBILE_CODE = 'FILL_MOBILE_CODE', // 新增手机号+验证码填充消息类型
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
  /**
   * URL变化消息类型
   */
  URL_CHANGED = 'URL_CHANGED',
  /**
   * 获取密码列表消息类型
   */
  GET_PASSWORDS = 'GET_PASSWORDS',
  /**
   * 打开密码管理页面
   */
  OPEN_OPTIONS_PAGE = 'OPEN_OPTIONS_PAGE',
  /**
   * 切换悬浮按钮显示状态
   */
  TOGGLE_FLOATING_BUTTONS = 'TOGGLE_FLOATING_BUTTONS',
  /**
   * 获取缓存的密码列表
   */
  GET_CACHED_PASSWORDS = 'GET_CACHED_PASSWORDS',
  /**
   * 更新密码缓存
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
   * 主动触发版本更新检测
   */
  CHECK_UPDATE = 'CHECK_UPDATE',
}

/**
 * 消息接口
 */
export interface Message {
  type: MessageType;
  data?: any;
}

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
  details: {
    usernameField: FieldFillResult;
    passwordField: FieldFillResult;
    strategy: FillStrategy;
  };
}
