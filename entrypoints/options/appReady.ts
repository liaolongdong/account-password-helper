/**
 * Options 首屏就绪信号
 *
 * 静态骨架只在真正的首屏视图（设置主密码 / 验证主密码 / 列表或空态）完成绘制后淡出，
 * 避免「骨架被 Vue 挂载清掉 → 认证/解密期间白屏 → 数据出现」的断层。
 */
export const OPTIONS_READY_EVENT = 'aph:options-ready';

/** 由 App.vue 在首屏视图完成绘制后调用；main.ts 监听并淡出静态骨架 */
export function markOptionsReady(): void {
  window.dispatchEvent(new Event(OPTIONS_READY_EVENT));
}
