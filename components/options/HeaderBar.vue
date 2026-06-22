<template>
  <div class="header">
    <!-- 第一行：标题和Logo -->
    <div class="header-title-row">
      <div class="header-title">
        <h1>
          <BrandLogo class="logo" />
          账号密码管理助手
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
          添加密码
        </el-button>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('dataCommand', cmd)"
        >
          <el-button :icon="FolderOpened">
            数据管理<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="downloadTemplate"
                :icon="Download"
              >
                下载模板
              </el-dropdown-item>
              <el-dropdown-item
                command="import"
                :icon="Upload"
              >
                导入数据
              </el-dropdown-item>
              <el-dropdown-item
                command="export"
                :icon="Download"
              >
                导出数据
              </el-dropdown-item>
              <el-dropdown-item
                command="exportJson"
                :icon="Download"
              >
                导出JSON
              </el-dropdown-item>
              <el-dropdown-item
                command="backupExport"
                :icon="Lock"
              >
                加密备份导出
              </el-dropdown-item>
              <el-dropdown-item
                command="backupImport"
                :icon="Unlock"
              >
                加密备份导入
              </el-dropdown-item>
              <el-dropdown-item
                command="removeDuplicates"
                :icon="Delete"
              >
                一键去重
              </el-dropdown-item>
              <el-dropdown-item
                divided
                command="backup"
                :icon="Message"
              >
                备份到邮箱
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => $emit('settingsCommand', cmd)"
        >
          <el-button :icon="Setting">
            设置<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="validity"
                :icon="Timer"
              >
                有效期设置
              </el-dropdown-item>
              <el-dropdown-item
                command="autoSave"
                :icon="FolderChecked"
              >
                自动保存设置
              </el-dropdown-item>
              <el-dropdown-item
                command="idleLock"
                :icon="Clock"
              >
                自动锁定设置
              </el-dropdown-item>
              <el-dropdown-item
                command="favoriteLimit"
                :icon="Star"
              >
                收藏上限设置
              </el-dropdown-item>
              <el-dropdown-item
                command="clipboard"
                :icon="DocumentCopy"
              >
                剪贴板设置
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="header-actions-right">
        <span class="floating-button-label">悬浮按钮</span>
        <el-switch
          :model-value="floatingButtonVisible"
          active-text=""
          inactive-text=""
          @change="(val: any) => $emit('toggleFloatingButton', val)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
} from '@element-plus/icons-vue';
import BrandLogo from '@/components/BrandLogo.vue';

/**
 * Options 页面头部组件
 *
 * 包含标题、版本号、数据管理/设置下拉菜单以及悬浮按钮开关。
 */
defineProps<{
  /** 当前插件版本号 */
  currentVersion: string;
  /** 悬浮按钮显示状态 */
  floatingButtonVisible: boolean;
}>();

defineEmits<{
  /** 点击添加密码按钮 */
  addPassword: [];
  /** 数据管理菜单项点击 */
  dataCommand: [command: string];
  /** 设置菜单项点击 */
  settingsCommand: [command: string];
  /** 悬浮按钮开关切换 */
  toggleFloatingButton: [visible: boolean];
}>();
</script>

<style scoped>
.header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 32px;
  margin-bottom: 24px;
  color: white;
  background: linear-gradient(135deg, #409eff 0%, #66b3ff 100%);
  border-radius: 0;
  box-shadow: 0 2px 12px rgb(64 158 255 / 15%);
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

.header-actions-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.floating-button-label {
  font-size: 14px;
  color: rgb(255 255 255 / 85%);
  white-space: nowrap;
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
  color: #409eff;
  background: #fff;
  border: 1px solid #fff;
}

:deep(.header-actions .el-button--primary:hover) {
  color: #1890ff;
  background: #f0f9ff;
  border-color: #f0f9ff;
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
