<template>
  <el-dialog
    :model-value="modelValue"
    title="收藏上限设置"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="140px"
        size="large"
      >
        <el-form-item label="收藏条目上限">
          <el-input-number
            v-model="favoriteLimit"
            :min="1"
            :max="50"
            :step="1"
            style="width: 100%"
          />
          <div class="form-tip">
            收藏条目达到上限后，新收藏将自动替换最近最少使用（LRU）的收藏条目，确保常用账号始终置顶
          </div>
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saveLoading"
          @click="handleSave"
        >
          保存
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { logger } from '@/utils/logger';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const favoriteLimit = ref(StorageUtils.DEFAULT_FAVORITE_LIMIT);
const saveLoading = ref(false);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    favoriteLimit.value = await StorageUtils.getFavoriteLimit();
  } catch (error) {
    logger.error('FavoriteLimitSetting: 加载配置失败:', error);
    ElMessage.error('加载配置失败');
  }
};

// 监听弹窗打开时加载配置
watch(
  () => props.modelValue,
  visible => {
    if (visible) loadConfig();
  },
  { immediate: true },
);

/**
 * 保存配置
 */
const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    await StorageUtils.setFavoriteLimit(favoriteLimit.value);
    ElMessage.success(`收藏上限已设置为 ${favoriteLimit.value} 条`);
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('FavoriteLimitSetting: 保存配置失败:', error);
    ElMessage.error('保存失败');
  } finally {
    saveLoading.value = false;
  }
};
</script>

<style scoped>
.form-tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
}

.dialog-body-scroll {
  max-height: 60vh;
  padding-right: 4px;
  overflow-y: auto;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
