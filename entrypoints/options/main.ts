import { createAndMountApp } from '@/utils/createVueApp';
import App from '@/entrypoints/options/App.vue';
// ElMessageBox 样式仅在 options 页面使用（确认删除、重置密码等弹窗）
import 'element-plus/es/components/message-box/style/css';

createAndMountApp(App);
