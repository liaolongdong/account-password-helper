import { createApp } from 'vue';
import ElementPlus from 'element-plus';
// @ts-ignore: CSS import for Element Plus styles
import 'element-plus/dist/index.css';
import App from './App.vue';
// import '@/utils/shadowDomStyles'

const app = createApp(App);
app.use(ElementPlus);
app.mount('#app');
