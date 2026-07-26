<template>
  <div class="empty-guide">
    <el-empty
      :image-size="120"
      :description="t('options.emptyGuide.title')"
    />
    <div class="empty-guide__cards">
      <div
        class="empty-guide__card"
        @click="$emit('add')"
      >
        <el-icon
          :size="28"
          class="empty-guide__card-icon--primary"
        >
          <Plus />
        </el-icon>
        <div class="empty-guide__card-title">{{ t('options.emptyGuide.addTitle') }}</div>
        <div class="empty-guide__card-desc">{{ t('options.emptyGuide.addDesc') }}</div>
      </div>
      <div
        class="empty-guide__card"
        @click="$emit('import')"
      >
        <el-icon
          :size="28"
          class="empty-guide__card-icon--success"
        >
          <Upload />
        </el-icon>
        <div class="empty-guide__card-title">{{ t('options.emptyGuide.importTitle') }}</div>
        <div class="empty-guide__card-desc">{{ t('options.emptyGuide.importDesc') }}</div>
      </div>
      <div
        class="empty-guide__card"
        @click="$emit('restore')"
      >
        <el-icon
          :size="28"
          class="empty-guide__card-icon--warning"
        >
          <Unlock />
        </el-icon>
        <div class="empty-guide__card-title">{{ t('options.emptyGuide.restoreTitle') }}</div>
        <div class="empty-guide__card-desc">{{ t('options.emptyGuide.restoreDesc') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Upload, Unlock } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';

/**
 * 空数据引导组件
 *
 * 在密码列表为空时展示引导卡片，提供手动添加、
 * Excel 导入和备份恢复三种快捷入口。
 */
defineEmits<{
  add: [];
  import: [];
  restore: [];
}>();

const { t } = useI18n();
</script>

<style scoped>
.empty-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 20px 24px;
}

.empty-guide__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: center;
  margin-top: 20px;
}

.empty-guide__card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  width: 180px;
  padding: 18px 16px;
  cursor: pointer;
  background: var(--el-bg-color, #fff);
  border: 1px solid var(--el-border-color, #e4e7ed);
  border-radius: 12px;
  transition:
    border-color 0.25s,
    box-shadow 0.25s,
    transform 0.25s;
}

.empty-guide__card:hover {
  border-color: var(--el-color-primary);
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 12%);
  transform: translateY(-2px);
}

.empty-guide__card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
}

.empty-guide__card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  text-align: center;
}

.empty-guide__card-icon--primary {
  color: var(--el-color-primary);
}

.empty-guide__card-icon--success {
  color: var(--el-color-success);
}

.empty-guide__card-icon--warning {
  color: var(--el-color-warning);
}
</style>
