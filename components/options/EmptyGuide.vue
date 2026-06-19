<template>
  <div class="empty-guide">
    <el-empty
      :image-size="120"
      description="还没有保存的密码，开始添加吧"
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
        <div class="empty-guide__card-title">手动添加</div>
        <div class="empty-guide__card-desc">逐条添加账号密码信息</div>
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
        <div class="empty-guide__card-title">导入数据</div>
        <div class="empty-guide__card-desc">从 Excel 文件批量导入</div>
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
        <div class="empty-guide__card-title">恢复备份</div>
        <div class="empty-guide__card-desc">从备份文件或邮箱恢复</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Upload, Unlock } from '@element-plus/icons-vue';

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
  box-shadow: 0 4px 12px rgb(64 158 255 / 12%);
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
