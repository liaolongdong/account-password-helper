import { defineConfig } from 'wxt';
import path from 'path';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Vite 配置，包括路径别名
  vite: () => ({
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@/components': path.resolve(__dirname, './components'),
        '@/utils': path.resolve(__dirname, './utils'),
        '@/entrypoints': path.resolve(__dirname, './entrypoints'),
        '@/assets': path.resolve(__dirname, './assets')
      }
    }
  }),
  manifest: {
    name: 'Account Password Helper',
    description: '账号密码管理助手 - 自动填充和保存账号密码',
    version: '1.0.0',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    host_permissions: ['<all_urls>']
    // 通过这种方式并没有实现整屏展示options页面
    // options_ui: {
    //   page: 'options.html',
    //   open_in_tab: true // 强制在新标签页打开
    // }
  }
});
