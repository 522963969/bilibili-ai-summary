import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import '@/styles/base.css';
import '@/popup/popup.css';
import App from '@/popup/App.vue';

const app = createApp(App);
app.use(createPinia());
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
