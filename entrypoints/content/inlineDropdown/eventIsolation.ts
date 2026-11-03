/**
 * 注入式 UI 的宿主级事件隔离
 *
 * Shadow DOM 只隔离样式，不隔离事件传播：注入 UI 的宿主挂在 body 下、位于页面弹窗
 * DOM 子树之外，内部（触发图标/面板/胶囊）的 pointerdown/mousedown/mouseup/click/touch
 * 事件以宿主为 retarget 目标冒泡到 document 后，会被弹窗组件「点击外部关闭」的
 * document 级监听误判为外部交互而关闭弹窗（如豆包手机号登录弹窗点击钥匙图标即闪退）。
 *
 * 元素级 `stopPropagation` 只覆盖了部分节点与部分事件类型（历史上仅拦截了 click，
 * 而现代组件库多在 pointerdown/mousedown 阶段做外部检测，click 时弹窗早已关闭），
 * 本模块改为在宿主冒泡阶段统一终结整棵注入子树的事件传播，
 * 新增的内部 UI（含运行时动态创建的节点）自动被覆盖，无遗漏面。
 *
 * 边界说明：
 * - 扩展自身的「外部按下关闭面板」检测挂在 document 捕获阶段，先于宿主冒泡执行，不受影响；
 * - 页面若以 document 捕获阶段监听这些事件，冒泡阶段的隔离无法拦截（无通解，
 *   主流「click outside」实现均为冒泡阶段监听）；
 * - 监听器绑定在宿主元素自身，宿主节点 `remove()` 时随之释放，无需显式解绑。
 *
 * @module entrypoints/content/inlineDropdown/eventIsolation
 */

/** 需要在宿主层终结传播的事件类型（覆盖弹窗外部点击检测与各组件库的按下即收起路径） */
const ISOLATED_EVENT_TYPES = [
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
] as const;

/** 已完成隔离的宿主集合：防止复用方漏掉创建守卫时静默叠加监听（随宿主节点回收） */
const isolatedHosts = new WeakSet<HTMLElement>();

/**
 * 在 Shadow 宿主上绑定冒泡阶段传播终结监听（幂等：同一宿主重复调用只生效一次）
 *
 * 只对宿主挂唯一的一个 stopPropagation 处理器（不 preventDefault），
 * 注入 UI 内部的既有监听器位于更内层（目标/冒泡先于宿主），行为不受影响；
 * 默认动作（聚焦保持等）仍由既有 mousedown preventDefault 在各元素上处理。
 *
 * @param host - 已 attachShadow 并挂载到文档流的宿主元素
 */
export function attachHostEventIsolation(host: HTMLElement): void {
  if (isolatedHosts.has(host)) {
    return;
  }
  isolatedHosts.add(host);
  for (const type of ISOLATED_EVENT_TYPES) {
    host.addEventListener(type, e => e.stopPropagation());
  }
}
