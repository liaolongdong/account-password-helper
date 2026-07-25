import { defineConfig } from 'wxt';
import path from 'path';
import { readFileSync } from 'fs';
import Components from 'unplugin-vue-components/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { visualizer } from 'rollup-plugin-visualizer';

// 从 package.json 读取版本号，确保单一版本源（release-please 自动维护）
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  dev: {
    server: {
      port: 8899,
    },
  },
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
      rollupOptions: {
        checks: {
          // 将 invalidAnnotation 设为 false，以消除 @vueuse/core 中无效注释的构建警告。
          invalidAnnotation: false,
        },
      },
    },
    // Vite 顶层 esbuild 配置：生产环境移除 console/debugger
    esbuild: process.env.NODE_ENV === 'production' ? { drop: ['console', 'debugger'] } : {},
    plugins: [
      process.env.ANALYZE === 'true' && visualizer({ open: true, filename: 'dist/stats.html', gzipSize: true }),
      // SidePanel 非阻塞 CSS 加载：将外部样式表设为 media="print"，避免阻塞首次绘制。
      // 通过 sidepanel/main.ts 在脚本执行后立即切换为 media="all"，实现 CSP 安全的非阻塞加载。
      // 仅作用于 sidepanel.html，不影响 options/popup 等入口。
      {
        name: 'wxt:nonblocking-css-for-sidepanel',
        enforce: 'post' as const,
        transformIndexHtml(html: string, ctx: { filename: string }) {
          if (!ctx.filename.includes('sidepanel')) return html;
          // 将 <link rel="stylesheet" ...> 改为 <link rel="stylesheet" media="print" ...>
          // 保留已有的 media 属性（如 media="print"）不变
          return html.replace(/<link\s+rel="stylesheet"(?![^>]*\bmedia=)/g, '<link rel="stylesheet" media="print"');
        },
      },
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
    // Chrome应用商店描述字符不能超过132个字符，超出会导致 zip 包上传失败。
    description:
      '本地密码管理工具，AES-256-GCM 加密、零网络传输，密码不出浏览器。智能识别登录表单、一键填充自动登录、自动保存账号密码、批量导入导出、加密备份、TOTP 两步验证、安全体检仪表盘、修改主密码、回收站、密码修改历史、密码可见性切换、闲时锁定、密码强度检测、密码生成器，开源免费。',
    version: pkg.version,
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'sidePanel',
      'alarms',
      'notifications',
      'idle',
      'clipboardWrite',
      'clipboardRead',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Account Password Helper',
    },
    // 内容安全策略：MV3 默认策略，显式声明确保安全基线
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
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
