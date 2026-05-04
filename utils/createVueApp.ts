import { createApp, type Component, type App } from 'vue';
import ElementPlus from 'element-plus';
// @ts-ignore: CSS import for Element Plus styles
import 'element-plus/dist/index.css';

/**
 * 抑制 Chromium / Element Plus 下的 ResizeObserver 良性警告
 * - "ResizeObserver loop completed with undelivered notifications."
 * - "ResizeObserver loop limit exceeded"
 * 这些警告不会影响功能，仅污染控制台，且会被错误监控误判为异常
 */
const RESIZE_OBSERVER_ERROR_PATTERNS = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
];

const SUPPRESS_FLAG = '__resizeObserverErrorSuppressed__';

function isResizeObserverError(message: unknown): boolean {
  return typeof message === 'string' && RESIZE_OBSERVER_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

function suppressResizeObserverError(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[SUPPRESS_FLAG]) return;
  w[SUPPRESS_FLAG] = true;

  window.addEventListener(
    'error',
    event => {
      if (isResizeObserverError(event.message)) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );

  window.addEventListener(
    'unhandledrejection',
    event => {
      const reason = event.reason as { message?: unknown } | string | undefined;
      const message = typeof reason === 'string' ? reason : reason?.message;
      if (isResizeObserverError(message)) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );
}

/**
 * 创建并挂载 Vue 应用
 * 统一的应用初始化工厂函数，用于 options、sidepanel、popup 等入口
 *
 * @param rootComponent 根组件
 * @param selector 挂载选择器，默认 '#app'
 * @returns Vue 应用实例
 */
export function createAndMountApp(rootComponent: Component, selector: string = '#app'): App {
  suppressResizeObserverError();
  const app = createApp(rootComponent);
  app.use(ElementPlus);
  app.mount(selector);
  return app;
}
