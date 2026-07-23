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
 * 保存确认弹窗的展示模式
 *
 * - `save`：新账号，展示「保存」弹窗（默认）
 * - `update`：已存账号且密码发生变化，展示「更新」弹窗
 */
export type SavePromptMode = 'save' | 'update';

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
  /** 展示模式（save/update），缺省为 save */
  mode?: SavePromptMode;
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

/**
 * showSavePasswordPrompt 返回的弹窗实时更新控制接口
 *
 * 用于弹窗显示期间，宿主页面表单字段变化时实时同步弹窗内展示的用户名和密码文本。
 */
export interface SavePromptControls {
  /** 更新弹窗中展示的用户名文本 */
  updateUsername: (username: string) => void;
  /** 更新弹窗中展示的密码文本（自动转为圆点显示） */
  updatePassword: (password: string) => void;
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
  /** 弹窗展示模式（save/update），由库级预检查判定，缺省为 save */
  mode?: SavePromptMode;
}

// ── PasswordVisibilityToggle 相关 ──

/**
 * 每个被托管的密码输入框的状态记录
 *
 * 采用零侵入方案：按钮作为 input 的兄弟节点插入同一父元素，
 * 不对 input 做任何 DOM 包裹或样式修改，仅将父元素设为 position: relative
 * 以创建定位上下文（无视觉影响）。
 *
 * 垂直居中由 CSS（top: 50%; transform: translateY(-50%)）处理，
 * 水平位置由 JS 计算，无需 ResizeObserver 或 scroll 追踪。
 */
export interface ToggleEntry {
  /** 原始密码输入框 */
  input: HTMLInputElement;
  /** input 的父元素（按钮挂载在此，设为 position: relative 作为定位上下文） */
  parent: HTMLElement;
  /** 切换按钮（position: absolute 定位在 input 右侧） */
  button: HTMLButtonElement;
  /** input 事件监听器引用（用于解绑） */
  onInput: () => void;
  /** click 事件监听器引用（用于解绑） */
  onClick: () => void;
  /** 父元素原始的 style.position 值（用于 cleanup 恢复） */
  originalParentPosition: string;
}
