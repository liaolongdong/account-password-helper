import type { OptionsFirstView } from '@/composables/useAuthFlow';

/**
 * Options 首屏就绪信号
 *
 * 静态骨架只在真正的首屏视图（设置主密码 / 验证主密码 / 列表或空态）完成绘制后淡出，
 * 避免「骨架被 Vue 挂载清掉 → 认证/解密期间白屏 → 数据出现」的断层。
 * 首个视图结论在列表加载前单独上报，让骨架提前切到锁定 / 表格形态。
 */
export type { OptionsFirstView };

export const OPTIONS_READY_EVENT = 'aph:options-ready';

export const OPTIONS_FIRST_VIEW_EVENT = 'aph:options-first-view';

/** 由 useAuthFlow 在认证分支确定后、加载列表前调用；main.ts 监听并切换骨架形态 */
export function markOptionsFirstView(view: OptionsFirstView): void {
  window.dispatchEvent(new CustomEvent<OptionsFirstView>(OPTIONS_FIRST_VIEW_EVENT, { detail: view }));
}

/** 由 App.vue 在首屏视图完成绘制后调用；main.ts 监听并淡出静态骨架 */
export function markOptionsReady(): void {
  window.dispatchEvent(new Event(OPTIONS_READY_EVENT));
}
