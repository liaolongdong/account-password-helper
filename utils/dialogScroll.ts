/**
 * 弹窗内容区滚动（DOM 侧的无状态小工具）
 *
 * 解析 / 解密类弹窗在数据落进列表后要把内容区滚到底部，让用户看见最新一行。
 * 「等 DOM 更新 → 再等一帧表格渲染 → 滚动」这条时序此前在三个调用点各写了一遍
 * （导入解析成功、备份文件选中、备份解密成功），连 150ms 这个魔数也是抄的三份；
 * 而真正的坑正是抄漏：三处都写死了 `behavior: 'smooth'`，媒体查询对 JS 无效，
 * 「减弱动效」在这三处一律免疫。收在这里之后，时序与减弱动效判据只有一个版本。
 */
import { nextTick } from 'vue';
import { scrollBehavior } from '@/utils/a11y';

/** 等待表格 / 列表完成一次渲染的时长：`nextTick` 只保证虚拟 DOM 已更新，真实布局还需一帧 */
const RENDER_SETTLE_MS = 150;

/**
 * 把弹窗内容区滚动到底部
 *
 * 失败路径一律静默：滚动只是锦上添花的引导，选择器没命中（弹窗已关、类名改了）
 * 不应该把调用方的成功流程改判成错误，也不值得为此弹一条提示。
 *
 * @param containerSelector 内容区选择器，如 `.import-dialog .dialog-body-scroll`
 * @param settleMs 渲染落定时长，仅在调用方有更慢的重型内容时覆盖
 */
export async function scrollDialogBodyToBottom(
  containerSelector: string,
  settleMs: number = RENDER_SETTLE_MS,
): Promise<void> {
  await nextTick();
  setTimeout(() => {
    const container = document.querySelector<HTMLElement>(containerSelector);
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: scrollBehavior() });
  }, settleMs);
}
