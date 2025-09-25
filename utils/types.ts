// 账号密码数据接口
export interface PasswordEntry {
  id: string;
  username: string;
  password: string;
  url: string;
  tag: string;
  remark: string;
  createTime: number;
  order: number;
}

// 用户主密码配置
export interface MasterPasswordConfig {
  hashedPassword: string;
  salt: string;
}

// 消息类型枚举
export enum MessageType {
  _DETECT_FORM = 'DETECT_FORM',
  _FILL_PASSWORD = 'FILL_PASSWORD',
  _SHOW_SIDEPANEL = 'SHOW_SIDEPANEL',
  _GET_PASSWORDS = 'GET_PASSWORDS'
}

// 消息接口
export interface Message {
  type: MessageType;
  data?: any;
}
