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
   * 获取密码列表消息类型
   */
  GET_PASSWORDS = 'GET_PASSWORDS',
}

/**
 * 消息接口
 */
export interface Message {
  type: MessageType;
  data?: any;
}
