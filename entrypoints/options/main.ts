import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/options/App.vue';
import { initThemeSync } from '@/utils/theme';
import { initI18n } from '@/utils/i18n';
// ElMessageBox 样式仅在 options 页面使用（确认删除、重置密码等弹窗）
import 'element-plus/es/components/message-box/style/css';
import '@/assets/theme/tokens.css';

// 尽早读取并应用主题（fire-and-forget），并监听配置变更实时切换
initThemeSync();

// 初始化 i18n（等待语言偏好与语言包加载完成后再挂载，避免非中文用户首帧闪中文）
initI18n().then(() => {
  createAndMountApp(App);
});
