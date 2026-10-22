import { OPTIONS_FIRST_VIEW_STORAGE_KEY, type OptionsFirstView } from '@/utils/optionsFirstView';

/**
 * Options 首屏就绪与骨架形态信号
 *
 * 静态骨架只在真正的首屏视图（设置主密码 / 验证主密码 / 列表或空态）完成绘制后淡出，
 * 避免「骨架被 Vue 挂载清掉 → 认证/解密期间白屏 → 数据出现」的断层。
 *
 * 骨架形态由 `html[data-options-first-view]` 控制：head 里的同步脚本先按 URL / sessionStorage
 * 预判首帧，认证分支落定后由 {@link markOptionsFirstView} 校正，并把结果记回 sessionStorage，
 * 供同一标签页下一次刷新直接落到正确形态。
 */
export const OPTIONS_READY_EVENT = 'aph:options-ready';

/** 记住已解析的首个视图（只存视图名，不含账号数据；失败时静默） */
export function rememberOptionsFirstView(view: OptionsFirstView): void {
  try {
    sessionStorage.setItem(OPTIONS_FIRST_VIEW_STORAGE_KEY, view);
  } catch {
    // 隐私模式或存储被禁用：只影响下一次刷新的首帧预判，不影响本次渲染
  }
}

/** 认证分支落定后调用：切换骨架形态并记住结果，供刷新预判 */
export function markOptionsFirstView(view: OptionsFirstView): void {
  document.documentElement.dataset.optionsFirstView = view;
  rememberOptionsFirstView(view);
}

/** 由 App.vue 在首屏视图完成绘制后调用；main.ts 监听并淡出静态骨架 */
export function markOptionsReady(): void {
  window.dispatchEvent(new Event(OPTIONS_READY_EVENT));
}
