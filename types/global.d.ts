// 全局类型声明文件
// 用于解决 CSS 文件导入的 TypeScript 类型问题

/**
 * Vite / WXT 注入的构建期环境变量类型声明
 * - DEV: `npm run dev` 时为 true
 * - PROD: `npm run build` 时为 true
 * - MODE: 当前构建模式（'development' | 'production' 等）
 */
interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly BASE_URL: string;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vue 单文件组件声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, any>;
  export default component;
}

// 通用 CSS 模块声明
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module '*.scss' {
  const content: Record<string, string>;
  export default content;
}

declare module '*.less' {
  const content: Record<string, string>;
  export default content;
}

// Element Plus 样式文件的特定声明
declare module 'element-plus/dist/index.css' {
  const content: any;
  export = content;
}

declare module 'element-plus/theme-chalk/index.css' {
  const content: any;
  export = content;
}

/**
 * chrome.sidePanel.close() 类型补充
 * Chrome 129+ 新增 API，当前 @types/chrome 尚未包含
 * 官方文档: https://developer.chrome.com/docs/extensions/reference/api/sidePanel#method-close
 */
declare namespace chrome.sidePanel {
  export interface CloseOptions {
    /** The tab for which to close the side panel. If unspecified, closes the side panel for the current active tab. */
    tabId?: number;
    /** The window for which to close the side panel. */
    windowId?: number;
  }

  /**
   * @since Chrome 129
   * Closes the side panel for the extension.
   */
  export function close(options?: CloseOptions): Promise<void>;
}

/**
 * chrome.tabs.sendMessage / sendScript 的 documentId 投递目标类型补充
 * Chrome 132+ 起 `MessageOptions` 支持 `documentId`（把消息投递到指定文档实例，
 * 文档导航后旧 documentId 不再命中），当前 @types/chrome 的接口尚未收录。
 * 本仓所有明文凭据投递都改用它绑定接收文档，见 utils/frameFill.ts。
 * 官方文档: https://developer.chrome.com/docs/extensions/reference/api/tabs#type-MessageOptions
 */
declare namespace chrome.tabs {
  export interface MessageOptions {
    /**
     * The ID of the document to send the message to. Must be a document ID obtained from
     * `webNavigation.getAllFrames` or `MessageSender.documentId`. When `frameId` is also
     * provided, both must match the same document; the message is not delivered if the
     * frame has since navigated to a new document.
     * @since Chrome 132
     */
    documentId?: string;
  }
}