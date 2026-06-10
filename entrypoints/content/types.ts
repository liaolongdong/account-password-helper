/**
 * content script 模块类型定义
 * 集中管理表单检测、通知弹窗、密码可见性切换等模块的 TypeScript 类型
 */

import type { FillStrategy } from '@/utils/types';

// ── InputFiller 相关 ──

/**
 * 输入框填充结果
 */
export interface InputFillResult {
  /** 是否成功填充 */
  filled: boolean;
  /** 填充值是否与预期一致 */
  verified: boolean;
  /** 使用的填充策略 */
  strategy: FillStrategy;
}

// ── LoginFormAnalyzer 相关 ──

/**
 * 表单字段集合，用于登录表单分析
 */
export interface FormFieldSets {
  /** 密码输入框列表 */
  passwordFields: HTMLInputElement[];
  /** 用户名输入框列表 */
  usernameFields: HTMLInputElement[];
  /** 手机号输入框列表 */
  mobileFields: HTMLInputElement[];
  /** 验证码输入框列表 */
  verifyCodeFields: HTMLInputElement[];
  /** 登录按钮列表 */
  loginButtons: HTMLElement[];
}

// ── NativeNotification 相关 ──

/**
 * 通知消息类型
 */
export type NotificationType = 'success' | 'warning' | 'info' | 'error';

/**
 * 各类型通知的样式颜色配置
 */
export interface NotificationColors {
  /** 背景色 */
  bgColor: string;
  /** 边框色 */
  borderColor: string;
  /** 文字色 */
  textColor: string;
}

// ── SavePasswordPrompt 相关 ──

/**
 * 保存确认弹窗所需的数据
 */
export interface SavePromptData {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 网站域名 */
  url: string;
  /** 标签默认值，通常为 document.title */
  tag: string;
  /** 备注默认值，通常为 "自动保存" */
  remark: string;
}

/**
 * 用户在弹窗中编辑后的保存数据
 */
export interface SavePromptEditedData {
  /** 用户编辑后的标签 */
  tag: string;
  /** 用户编辑后的备注 */
  remark: string;
  /** 用户是否主动编辑过标签输入框 */
  tagEdited: boolean;
  /** 用户是否主动编辑过备注输入框 */
  remarkEdited: boolean;
}

// ── LoginAutoSave 相关 ──

/**
 * 存储到 sessionStorage 的待确认凭证结构
 */
export interface PendingCredentials {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 网站域名 */
  url: string;
  /** 标签，取自 document.title */
  tag: string;
  /** 备注，默认为 "自动保存" */
  remark: string;
  /** 用户是否在弹窗中主动编辑了标签字段 */
  tagEdited: boolean;
  /** 用户是否在弹窗中主动编辑了备注字段 */
  remarkEdited: boolean;
  /** 凭证捕获时的时间戳 */
  timestamp: number;
}

// ── PasswordVisibilityToggle 相关 ──

/**
 * 每个被托管的密码输入框的状态记录
 */
export interface ToggleEntry {
  /** 原始密码输入框 */
  input: HTMLInputElement;
  /** 包裹容器 */
  wrapper: HTMLElement;
  /** 切换按钮 */
  button: HTMLButtonElement;
  /** input 事件监听器引用（用于解绑） */
  onInput: () => void;
  /** click 事件监听器引用（用于解绑） */
  onClick: () => void;
  /** 输入框原始 padding-right 值 */
  originalPaddingRight: string;
}
