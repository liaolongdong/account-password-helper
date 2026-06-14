import { defineConfig } from 'wxt';
import path from 'path';
import Components from 'unplugin-vue-components/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Vite 配置,包括路径别名和 Element Plus 按需引入
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
    build: {
      minify: 'esbuild',
    },
    // Vite 顶层 esbuild 配置：生产环境移除 console/debugger
    esbuild: process.env.NODE_ENV === 'production' ? { drop: ['console', 'debugger'] } : {},
    plugins: [
      process.env.ANALYZE === 'true' && visualizer({ open: true, filename: 'dist/stats.html', gzipSize: true }),
      // Element Plus 按需引入(包含组件和样式)
      AutoImport({
        imports: [
          'vue',
          // 显式导入 Element Plus 的命令式组件
          {
            'element-plus': ['ElMessage', 'ElMessageBox'],
          },
        ],
        resolvers: [
          ElementPlusResolver({
            importStyle: 'css', // 自动导入声明式组件样式
          }),
        ],
        dts: '.wxt/auto-imports.d.ts',
      }),
      Components({
        resolvers: [
          ElementPlusResolver({
            importStyle: 'css', // 自动导入组件样式
          }),
        ],
        dts: '.wxt/components.d.ts',
      }),
    ],
  }),
  // 扩展图标约定：图标来源于 public/icon/{16,32,48,96,128}.png，
  // WXT 会自动注入 manifest.icons 与 action.default_icon，无需在此显式声明。
  // 源 SVG 位于 assets/icons/icon.svg，通过 `npm run icons:build` 生成多尺寸 PNG。
  manifest: {
    name: 'Account Password Helper',
    description: '账号密码管理助手 - 管理账号密码、自动填充账号密码、自动触发登录',
    version: '1.0.0',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel', 'alarms', 'downloads', 'notifications', 'idle'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '账号密码管家',
    },
    // 添加快捷键配置
    commands: {
      open_options: {
        suggested_key: {
          default: 'Ctrl+Shift+P',
          mac: 'Command+Shift+P',
        },
        description: '打开账号密码管理选项页面',
      },
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
