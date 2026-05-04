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
        '@/assets': path.resolve(__dirname, './assets'),
      },
    },
  }),
  manifest: {
    name: 'Account Password Helper',
    description: '账号密码管理助手 - 自动填充和保存账号密码',
    version: '1.0.0',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    // 添加快捷键配置
    commands: {
      open_options: {
        suggested_key: {
          default: 'Ctrl+Shift+P',
          mac: 'Command+Shift+P',
        },
        description: '打开账号密码管理选项页面',
      },
      // todo 该功能还未正常实现（待实现）
      toggle_sidepanel: {
        suggested_key: {
          default: 'Ctrl+Shift+L',
          mac: 'Command+Shift+L',
        },
        description: '打开/关闭密码快速填充侧边栏',
      },
    },
  },
});
