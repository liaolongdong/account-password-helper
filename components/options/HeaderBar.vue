<template>
  <div class="header">
    <!-- 第一行：标题和Logo -->
    <div class="header-title-row">
      <div class="header-title">
        <h1>
          <BrandLogo class="logo" />
          {{ t('appName') }}
          <!-- 版本号可点击：与 Popup / 帮助弹窗的版本链接心智一致，跳转 GitHub Releases 查看最新版本与下载 -->
          <a
            class="version-tag-link"
            :href="GITHUB_RELEASES_PAGE_URL"
            target="_blank"
            rel="noopener noreferrer"
            :title="t('options.header.versionLinkTitle')"
          >
            <el-tag
              size="small"
              type="info"
              class="version-tag"
            >
              v{{ currentVersion }}
            </el-tag>
          </a>
        </h1>
      </div>
      <!-- 会话剩余时间徽标：一级界面常驻可见，紧迫态（≤10 分钟）转警示橙、危急态（≤1 分钟）转警示红，点击直达有效期设置 -->
      <button
        v-if="remainingText"
        type="button"
        class="session-chip"
        :class="{ 'session-chip--urgent': isUrgent, 'session-chip--critical': isCritical }"
        :title="t('options.header.sessionChipTitle')"
        @click="$emit('openValidity')"
      >
        <span
          class="session-chip__pulse"
          aria-hidden="true"
        ></span>
        <el-icon><Timer /></el-icon>
        <span class="session-chip__time">{{ remainingText }}</span>
      </button>
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
                command="import"
                :icon="Upload"
              >
                {{ t('options.header.importData') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="downloadTemplate"
                :icon="Document"
              >
                {{ t('options.header.downloadTemplate') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
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
                command="backup"
                :icon="Message"
              >
                {{ t('options.header.emailBackup') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
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
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('settingsCommand', cmd)"
        >
          <el-button :icon="Setting">
            {{ t('options.header.securitySettings') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
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
                command="idleLock"
                :icon="Clock"
              >
                {{ t('options.header.idleLock') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="autoSave"
                :icon="FolderChecked"
              >
                {{ t('options.header.autoSave') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="clipboard"
                :icon="DocumentCopy"
              >
                {{ t('options.header.clipboard') }}
              </el-dropdown-item>
              <el-dropdown-item
                command="favoriteLimit"
                :icon="Star"
              >
                {{ t('options.header.favoriteLimit') }}
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="passwordHistory"
                :icon="Document"
              >
                {{ t('options.historySetting.title') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <el-button
        :icon="Brush"
        @click="$emit('openPersonalization')"
      >
        {{ t('options.header.personalization') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
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
  Document,
  Brush,
} from '@element-plus/icons-vue';
import type { HealthGrade } from '@/utils/passwordHealth';
import BrandLogo from '@/components/BrandLogo.vue';
import { GITHUB_RELEASES_PAGE_URL } from '@/utils/urls';
import { useI18n } from '@/utils/i18n';
import { useSessionCountdown } from '@/composables/useSessionCountdown';

/**
 * Options 页面头部组件
 *
 * 包含标题、版本号、会话剩余时间徽标、安全体检入口、数据管理/安全设置下拉菜单以及偏好设置按钮。
 * 「安全设置」聚焦主密码与会话安全行为，「偏好设置」聚焦外观与填充交互，两者图标区分避免混淆。
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
  /** 安全设置菜单项点击 */
  settingsCommand: [command: string];
  /** 打开偏好设置弹窗 */
  openPersonalization: [];
  /** 点击会话徽标，打开有效期设置弹窗 */
  openValidity: [];
}>();

const { t } = useI18n();

// 会话倒计时：HeaderBar 仅在认证态挂载，挂载即启动；作用域销毁自动停止
const { remainingText, isUrgent, isCritical, start: startCountdown } = useSessionCountdown();
onMounted(() => {
  startCountdown();
});

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
  justify-content: space-between;
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

/* 版本号链接：弱化的可点击徽标，hover 提亮反馈，不争夺标题注意力 */
.header-title .version-tag-link {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: 10px;
  text-decoration: none;
  border-radius: 4px;
}

.header-title .version-tag-link:hover .version-tag {
  color: #fff;
  background: rgb(255 255 255 / 28%);
}

.header-title .version-tag-link:focus-visible {
  outline: 2px solid rgb(255 255 255 / 80%);
  outline-offset: 1px;
}

.header-title .version-tag {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: rgb(255 255 255 / 70%);
  cursor: pointer;
  user-select: none;
  background: rgb(255 255 255 / 15%);
  border-color: rgb(255 255 255 / 20%);
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
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

/* 会话剩余时间徽标：半透明 chip，与头部渐变背景融合；点击直达有效期设置。
   结构为「呼吸状态灯 + 计时图标 + 等宽数字」：状态灯表达会话存活，
   数字用 tabular-nums 避免逐秒跳动引起宽度抖动 */
.session-chip {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(255 255 255 / 90%);
  cursor: pointer;
  background: rgb(255 255 255 / 15%);
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 999px;
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

.session-chip:hover {
  background: rgb(255 255 255 / 22%);
  border-color: rgb(255 255 255 / 40%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}

.session-chip:focus-visible {
  outline: 2px solid rgb(255 255 255 / 70%);
  outline-offset: 2px;
}

.session-chip .el-icon {
  font-size: 14px;
}

.session-chip__time {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* 会话存活状态灯：柔和绿光晕，紧迫态转白并伴随扩散脉冲 */
.session-chip__pulse {
  width: 6px;
  height: 6px;
  background: #86efac;
  border-radius: 50%;
  box-shadow: 0 0 6px 1px rgb(134 239 172 / 60%);
}

/* 紧迫态（≤10 分钟）：转警示橙，轻脈动吸引注意但不干扰 */
.session-chip--urgent {
  color: #fff;
  background: rgb(230 162 60 / 85%);
  border-color: rgb(255 255 255 / 45%);
  animation: session-chip-pulse 2s ease-in-out infinite;
}

.session-chip--urgent .session-chip__pulse {
  background: #fff;
  box-shadow: none;
  animation: session-dot-pulse 1.2s ease-out infinite;
}

/* 危急态（≤1 分钟）：转警示红，脉冲加快强化紧迫感；需写在紧迫态之后以覆盖同名属性 */
.session-chip--critical {
  background: rgb(245 108 108 / 85%);
  animation: session-chip-pulse-critical 1.2s ease-in-out infinite;
}

@keyframes session-dot-pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(255 255 255 / 60%);
  }

  100% {
    box-shadow: 0 0 0 6px rgb(255 255 255 / 0%);
  }
}

@keyframes session-chip-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(230 162 60 / 45%);
  }

  50% {
    box-shadow: 0 0 0 5px rgb(230 162 60 / 0%);
  }
}

@keyframes session-chip-pulse-critical {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(245 108 108 / 50%);
  }

  50% {
    box-shadow: 0 0 0 5px rgb(245 108 108 / 0%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-chip--urgent,
  .session-chip--critical,
  .session-chip--urgent .session-chip__pulse {
    animation: none;
  }
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
