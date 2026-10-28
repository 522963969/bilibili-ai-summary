<script setup lang="ts">
import { APP_VERSION } from '@/core/config/app';
import SettingsSection from './SettingsSection.vue';
</script>

<template>
  <SettingsSection title="关于与安全" description="数据流向、权限范围与已知限制。">
    <ul class="security-list">
      <li>视频信息与字幕只在本机处理；除用户配置的模型服务外，扩展不向任何第三方发送内容。</li>
      <li>API Key 保存在 chrome.storage.local，不参与账号同步，不写入页面脚本、源码或日志。</li>
      <li>本地存储不具备系统级密钥库的保护强度，能访问本机浏览器配置的人可能读取到该值。</li>
      <li>扩展未申请 cookies、webRequest、debugger 或 tabs 等宽泛权限，不读取浏览器 Cookie。</li>
      <li>模型域名按 origin 逐个授权，不使用 https://*/* 的常驻权限。</li>
      <li>不加载远程 JavaScript；所有可执行代码都随扩展打包。</li>
    </ul>
    <div class="about-meta">
      <span>版本 v{{ APP_VERSION }}</span>
      <span>正式版</span>
      <span>Manifest V3</span>
      <span>前端 Vue 3 + Vite + CRXJS</span>
    </div>
  </SettingsSection>
</template>
