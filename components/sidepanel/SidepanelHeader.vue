<script setup lang="ts">
import { Setting } from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';
import { githubIconSvg, questionIconSvg } from '@/entrypoints/sidepanel/icons';

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
</script>

<template>
  <div class="header">
    <div class="header-left">
      <h3>
        <BrandLogo class="logo" />
        快速填充
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
      <button
        type="button"
        class="icon-btn"
        title="查看开源仓库"
        @click="$emit('openGithub')"
      >
        <span
          class="icon-btn__svg"
          v-html="githubIconSvg"
        ></span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="操作指引与常见问题"
        @click="$emit('openHelp')"
      >
        <span
          class="icon-btn__svg"
          v-html="questionIconSvg"
        ></span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="设置"
        @click="$emit('openSettings')"
      >
        <el-icon><Setting /></el-icon>
      </button>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 16px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  gap: 0;
  align-items: center;
}

.icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  color: #374151;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.icon-btn:hover {
  background: rgb(0 0 0 / 6%);
}

.icon-btn:active {
  background: rgb(0 0 0 / 10%);
}

.icon-btn .el-icon,
.icon-btn svg {
  width: 18px;
  height: 18px;
  font-size: 18px;
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
  color: #409eff;
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
