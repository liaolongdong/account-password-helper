import { reactive } from 'vue';

/**
 * 主密码验证弹窗控制器
 *
 * 单例模式，提供命令式调用主密码验证弹窗的能力。
 * 弹窗组件（MasterPasswordVerifyDialog）通过 watch 监听状态变化自动打开/关闭，
 * 调用方通过 `open()` 返回的 Promise 获取验证结果。
 *
 * 替代 ElMessageBox.prompt 的一次性弹窗，支持：
 * - 校验失败后保持弹窗，用户可多次重试
 * - 内联错误提示 + 输入框抖动反馈
 * - 连续错误计数，超过阈值显示重置提示
 */

interface VerifyDialogState {
  /** 弹窗是否可见 */
  visible: boolean;
  /** 弹窗标题 */
  title: string;
  /** 弹窗描述/提示文本 */
  description: string;
}

const state = reactive<VerifyDialogState>({
  visible: false,
  title: '',
  description: '',
});

/** 当前等待中的 resolve 回调 */
let _resolve: ((value: string | null) => void) | null = null;

/**
 * 打开主密码验证弹窗
 *
 * @param title 弹窗标题
 * @param description 提示文本
 * @returns 验证通过返回主密码明文，用户取消返回 null
 */
export function openMasterPasswordVerifyDialog(title: string, description: string): Promise<string | null> {
  // 如果已有弹窗在等待中，先取消前一个
  if (_resolve) {
    _resolve(null);
    _resolve = null;
  }

  state.title = title;
  state.description = description;
  state.visible = true;

  return new Promise<string | null>(resolve => {
    _resolve = resolve;
  });
}

/** 弹窗组件调用：验证通过，返回主密码并关闭弹窗 */
export function _resolveVerifyDialog(password: string): void {
  if (_resolve) {
    _resolve(password);
    _resolve = null;
  }
  state.visible = false;
}

/** 弹窗组件调用：用户取消，关闭弹窗 */
export function _rejectVerifyDialog(): void {
  if (_resolve) {
    _resolve(null);
    _resolve = null;
  }
  state.visible = false;
}

/** 供弹窗组件读取的响应式状态 */
export function _getVerifyDialogState() {
  return state;
}
