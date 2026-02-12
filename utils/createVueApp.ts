import { createApp, type Component, type App } from 'vue';
import ElementPlus from 'element-plus';
// @ts-ignore: CSS import for Element Plus styles
import 'element-plus/dist/index.css';

/**
 * 创建并挂载 Vue 应用
 * 统一的应用初始化工厂函数，用于 options、sidepanel、popup 等入口
 *
 * @param rootComponent 根组件
 * @param selector 挂载选择器，默认 '#app'
 * @returns Vue 应用实例
 */
export function createAndMountApp(rootComponent: Component, selector: string = '#app'): App {
  const app = createApp(rootComponent);
  app.use(ElementPlus);
  app.mount(selector);
  return app;
}
