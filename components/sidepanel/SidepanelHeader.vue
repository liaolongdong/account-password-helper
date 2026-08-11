<script setup lang="ts">
import { watch } from 'vue';
import { Setting, Timer } from '@element-plus/icons-vue';
import { githubIconSvg, questionIconSvg } from '@/entrypoints/sidepanel/icons';
import { useI18n } from '@/utils/i18n';
import { useSessionCountdown } from '@/composables/useSessionCountdown';
// 品牌 Logo 静态导入：App.vue 已静态引用同组件（已在入口 chunk 内），
// 异步包装无体积收益反增一次 resolve tick，导致品牌图标晚一帧出现
import BrandLogo from '@/components/BrandLogo.vue';

interface Props {
  /** 当前插件版本号 */
  currentVersion: string;
  /** 当前页面域名 */
  currentDomain: string;
  /** 会话是否有效（仅认证态启动倒计时，锁屏态零开销） */
  isAuthenticated: boolean;
}

interface Emits {
  /** 打开 GitHub 仓库 */
  openGithub: [];
  /** 打开帮助弹窗 */
  openHelp: [];
  /** 打开偏好设置弹窗 */
  openSettings: [];
  /** 点击会话倒计时胶囊，跳转有效期设置续期 */
  openValidity: [];
}

const props = defineProps<Props>();
defineEmits<Emits>();

const { t } = useI18n();

// 会话倒计时：仅认证态启动（会话失效时展示倒计时无意义）；
// 会话过期/清除后 isAuthenticated 回落时停止，避免无用轮询
const { remainingText, isUrgent, isCritical, start, stop } = useSessionCountdown();
watch(
  () => props.isAuthenticated,
  authed => {
    if (authed) start();
    else stop();
  },
  { immediate: true },
);
</script>

<template>
  <div class="header">
    <div class="header-left">
      <h3>
        <BrandLogo class="logo" />
        {{ t('common.quickFill') }}
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
        <!-- 会话剩余时间：可点击胶囊，点击直达有效期设置续期；紧迫态（≤10 分钟）转警示橙、危急态（≤1 分钟）转警示红 -->
        <button
          v-if="remainingText"
          type="button"
          class="session-pill"
          :class="{ 'session-pill--urgent': isUrgent, 'session-pill--critical': isCritical }"
          :title="t('sidepanel.sessionRemainingTitle')"
          @click="$emit('openValidity')"
        >
          <el-icon><Timer /></el-icon>
          {{ remainingText }}
        </button>
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
          :title="t('common.preferences')"
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
  display: flex;
  gap: 6px;
  align-items: center;
  overflow: hidden;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.current-url :deep(.el-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 会话剩余时间胶囊：中性灰底，紧迫态转警示橙，危急态转警示红；点击直达有效期设置续期 */
.session-pill {
  display: inline-flex;
  flex-shrink: 0;
  gap: 3px;
  align-items: center;
  padding: 1px 7px;
  font-family: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  color: #64748b;
  cursor: pointer;
  background: #f1f5f9;
  border: none;
  border-radius: 999px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.session-pill:hover {
  background: #e2e8f0;
}

.session-pill:active {
  transform: scale(0.96);
}

.session-pill:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

.session-pill .el-icon {
  font-size: 12px;
}

.session-pill--urgent {
  color: #fff;
  background: #e6a23c;
}

.session-pill--urgent:hover {
  background: #db9a37;
}

/* 危急态（≤1 分钟）：需写在紧迫态之后以覆盖背景色 */
.session-pill--critical {
  background: #f56c6c;
}

.session-pill--critical:hover {
  background: #f05959;
}
</style>
