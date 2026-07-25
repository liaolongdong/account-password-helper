<script setup lang="ts">
import { Setting } from '@element-plus/icons-vue';
import { defineAsyncComponent } from 'vue';
import { githubIconSvg, questionIconSvg } from '@/entrypoints/sidepanel/icons';
import { useI18n } from '@/utils/i18n';

/** 品牌 Logo 异步加载（64 行纯 SVG，独立 chunk 避免阻塞 SidepanelHeader 首屏） */
const BrandLogo = defineAsyncComponent(() => import('@/components/BrandLogo.vue'));

interface Props {
  /** 当前插件版本号 */
  currentVersion: string;
  /** 当前页面域名 */
  currentDomain: string;
}

interface Emits {
  /** 打开 GitHub 仓库 */
  openGithub: [];
  /** 打开帮助弹窗 */
  openHelp: [];
  /** 打开设置弹窗 */
  openSettings: [];
}

defineProps<Props>();
defineEmits<Emits>();

const { t } = useI18n();
</script>

<template>
  <div class="header">
    <div class="header-left">
      <h3>
        <BrandLogo class="logo" />
        {{ t('popup.quickFill') }}
        <el-tag
          size="small"
          type="info"
          class="version-tag"
        >
          v{{ currentVersion }}
        </el-tag>
      </h3>
      <div class="current-url">
        <el-text
          type="info"
          size="small"
          >{{ currentDomain }}</el-text
        >
      </div>
    </div>
    <div class="header-actions">
      <div class="actions-pill">
        <button
          type="button"
          class="pill-btn"
          :title="t('sidepanel.header.github')"
          @click="$emit('openGithub')"
        >
          <!-- eslint-disable vue/no-v-html -->
          <span
            class="pill-btn__svg"
            v-html="githubIconSvg"
          ></span>
          <!-- eslint-enable vue/no-v-html -->
        </button>
        <button
          type="button"
          class="pill-btn"
          :title="t('sidepanel.header.help')"
          @click="$emit('openHelp')"
        >
          <!-- eslint-disable vue/no-v-html -->
          <span
            class="pill-btn__svg"
            v-html="questionIconSvg"
          ></span>
          <!-- eslint-enable vue/no-v-html -->
        </button>
        <button
          type="button"
          class="pill-btn"
          :title="t('options.header.settings')"
          @click="$emit('openSettings')"
        >
          <el-icon><Setting /></el-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 16px;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
}

/* 按钮组 pill 容器 */
.actions-pill {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  align-items: center;
  padding: 3px;
  background: #f1f5f9;
  border-radius: 20px;
}

.pill-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: #64748b;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.pill-btn:hover {
  color: #334155;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}

.pill-btn:active {
  transform: scale(0.95);
}

.pill-btn .el-icon,
.pill-btn svg,
.pill-btn__svg {
  width: 18px;
  height: 18px;
}

.pill-btn__svg {
  display: flex;
  align-items: center;
  justify-content: center;
}

.header h3 {
  display: flex;
  align-items: center;
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.logo {
  margin-right: 8px;
  font-size: 20px;
  color: var(--aph-primary);
}

.version-tag {
  flex-shrink: 0;
  padding: 0 6px;
  margin-left: 6px;
  font-size: 11px;
  line-height: 18px;
  color: #909399;
  cursor: default;
  user-select: none;
}

.current-url {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}
</style>
