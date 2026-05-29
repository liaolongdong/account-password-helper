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
   * 是否在密码输入框内注入显示/隐藏切换按钮（若页面自带切换按钮则自动跳过）
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
}

/**
 * 填充手机号验证码数据接口
 */
export interface FillMobileCodeData {
  mobile: string;
  code: string;
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
