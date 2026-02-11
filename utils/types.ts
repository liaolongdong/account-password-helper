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
}
