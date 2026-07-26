<template>
  <div class="header">
    <!-- 第一行：标题和Logo -->
    <div class="header-title-row">
      <div class="header-title">
        <h1>
          <BrandLogo class="logo" />
          {{ t('appName') }}
          <el-tag
            size="small"
            type="info"
            class="version-tag"
          >
            v{{ currentVersion }}
          </el-tag>
        </h1>
      </div>
    </div>

    <!-- 第二行：操作按钮 -->
    <div class="header-actions-row">
      <div class="header-actions">
        <el-button
          type="primary"
          :icon="Plus"
          @click="$emit('addPassword')"
        >
          {{ t('options.header.addPassword') }}
        </el-button>
        <el-button
          :icon="Aim"
          :title="healthGrade ? t('options.header.healthScore', { score: healthScore ?? 0 }) : undefined"
          @click="$emit('openHealth')"
        >
          {{ t('options.header.healthCheck') }}
          <span
            v-if="healthGrade"
            class="health-dot"
            :style="{ backgroundColor: healthDotColor }"
            role="img"
            :aria-label="t('options.header.healthScore', { score: healthScore ?? 0 })"
          ></span>
        </el-button>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('dataCommand', cmd)"
        >
          <el-button :icon="FolderOpened">
            {{ t('options.header.data') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="downloadTemplate"
                :icon="Download"
              >
                {{ t('options.header.downloadTemplate') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="import"
                :icon="Upload"
              >
                {{ t('options.header.importData') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="export"
                :icon="Download"
              >
                {{ t('options.header.exportData') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="exportJson"
                :icon="Download"
              >
                {{ t('options.header.exportJson') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="backupExport"
                :icon="Lock"
              >
                {{ t('options.header.backupExport') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="backupImport"
                :icon="Unlock"
              >
                {{ t('options.header.backupImport') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="removeDuplicates"
                :icon="Delete"
              >
                {{ t('options.header.removeDuplicates') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="trash"
                :icon="Delete"
              >
                {{ t('options.header.trash') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="backup"
                :icon="Message"
              >
                {{ t('options.header.emailBackup') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('settingsCommand', cmd)"
        >
          <el-button :icon="Setting">
            {{ t('common.settings') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="changeMasterPassword"
                :icon="Key"
              >
                {{ t('options.header.changeMasterPassword') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="validity"
                :icon="Timer"
              >
                {{ t('options.header.validity') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="autoSave"
                :icon="FolderChecked"
              >
                {{ t('options.header.autoSave') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="idleLock"
                :icon="Clock"
              >
                {{ t('options.header.idleLock') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="favoriteLimit"
                :icon="Star"
              >
                {{ t('options.header.favoriteLimit') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="clipboard"
                :icon="DocumentCopy"
              >
                {{ t('options.header.clipboard') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <el-button
        :icon="Setting"
        @click="$emit('openPersonalization')"
      >
        {{ t('options.header.personalization') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  Plus,
  Download,
  Upload,
  Delete,
  Setting,
  Message,
  FolderChecked,
  ArrowDown,
  FolderOpened,
  Timer,
  Lock,
  Unlock,
  Clock,
  DocumentCopy,
  Star,
  Aim,
  Key,
} from '@element-plus/icons-vue';
import type { HealthGrade } from '@/utils/passwordHealth';
import BrandLogo from '@/components/BrandLogo.vue';
import { useI18n } from '@/utils/i18n';

/**
 * Options 页面头部组件
 *
 * 包含标题、版本号、安全体检入口、数据管理/设置下拉菜单以及偏好设置按钮。
 * 语言切换已迁移至「偏好设置」面板（与主题风格同组，三入口可达）。
 */
const props = defineProps<{
  /** 当前插件版本号 */
  currentVersion: string;
  /** 综合安全评分（0~100），空库时不传 */
  healthScore?: number;
  /** 健康等级，空库时不传（决定是否显示体检小圆点） */
  healthGrade?: HealthGrade;
}>();

defineEmits<{
  /** 点击添加密码按钮 */
  addPassword: [];
  /** 打开安全体检弹窗 */
  openHealth: [];
  /** 数据管理菜单项点击 */
  dataCommand: [command: string];
  /** 设置菜单项点击 */
  settingsCommand: [command: string];
  /** 打开偏好设置弹窗 */
  openPersonalization: [];
}>();

const { t } = useI18n();

/**
 * 体检小圆点颜色（一眼可见的红黄绿信号灯）
 * 优秀/良好为绿色（健康），一般为橙色（需关注），较差为红色（需尽快处理）。
 */
const healthDotColor = computed(() => {
  switch (props.healthGrade) {
    case 'poor':
      return '#f56c6c';
    case 'fair':
      return '#e6a23c';
    default:
      return '#67c23a';
  }
});
</script>

<style scoped>
.header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px;
  margin-bottom: 24px;
  color: white;
  background: linear-gradient(135deg, var(--aph-primary) 0%, var(--aph-primary-hover) 100%);
  border-radius: 0;
  box-shadow: 0 2px 12px rgb(var(--aph-primary-rgb) / 15%);
}

.header-title-row {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.header-title h1 {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 24px;
  font-weight: 500;
  color: white;
}

.header-title .logo {
  margin-right: 12px;
  font-size: 28px;
  color: #fff;
}

.header-title .version-tag {
  flex-shrink: 0;
  padding: 0 6px;
  margin-left: 10px;
  font-size: 11px;
  line-height: 18px;
  color: rgb(255 255 255 / 70%);
  cursor: default;
  user-select: none;
  background: rgb(255 255 255 / 15%);
  border-color: rgb(255 255 255 / 20%);
}

.header-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* 安全体检小圆点：一眼可见的健康信号灯 */
.health-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  vertical-align: middle;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 35%);
}

/* 下拉菜单触发按钮样式 */
:deep(.header-actions .el-dropdown .el-button) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-actions .el-dropdown .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

:deep(.header-actions .el-dropdown .el-button .el-icon--right) {
  margin-left: 4px;
}

:deep(.header-actions .el-button) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-actions .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

:deep(.header-actions .el-button--primary) {
  font-weight: 500;
  color: var(--aph-primary);
  background: #fff;
  border: 1px solid #fff;
}

:deep(.header-actions .el-button--primary:hover) {
  color: var(--aph-primary);
  background: var(--aph-surface-hover);
  border-color: var(--aph-surface-hover);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

/* 偏好设置按钮：半透明蓝样式，与数据管理/设置按钮视觉一致（位于 .header-actions 外部） */
:deep(.header-actions-row > .el-button) {
  font-weight: 400;
  color: white;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

:deep(.header-actions-row > .el-button:hover) {
  background: rgb(255 255 255 / 20%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);
  transform: translateY(-1px);
}

/* 响应式 */
@media (width <= 768px) {
  .header {
    padding: 20px;
  }

  .header-title h1 {
    font-size: 20px;
  }

  .header-actions {
    justify-content: center;
    width: 100%;
  }

  .header-actions-row {
    justify-content: center;
  }
}
</style>
