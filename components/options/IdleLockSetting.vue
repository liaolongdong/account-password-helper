<template>
  <el-dialog
    :model-value="modelValue"
    title="自动锁定设置"
    width="500px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-form
        label-width="140px"
        size="large"
      >
        <el-form-item label="闲置锁定时间">
          <el-select
            v-model="idleMinutes"
            style="width: 100%"
          >
            <el-option
              label="不锁定"
              :value="0"
            />
            <el-option
              label="5 分钟"
              :value="5"
            />
            <el-option
              label="10 分钟"
              :value="10"
            />
            <el-option
              label="30 分钟"
              :value="30"
            />
            <el-option
              label="60 分钟"
              :value="60"
            />
          </el-select>
          <div class="form-tip">系统闲置超过设定时间后，将自动清除主密码会话并锁定密码管理</div>
        </el-form-item>
        <el-form-item label="浏览器重启锁定">
          <el-switch v-model="relockOnBrowserRestart" />
          <div class="form-tip">
            开启后，完全关闭并重新打开浏览器时需重新输入主密码（更安全）；关闭则在有效期内自动保持登录，无需重复输入。
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

const idleMinutes = ref(0);
/** 关闭浏览器后是否需要重新输入主密码 */
const relockOnBrowserRestart = ref(false);
const saveLoading = ref(false);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    const config = await StorageUtils.getIdleLockConfig();
    idleMinutes.value = config.idleLockMinutes;
    relockOnBrowserRestart.value = config.relockOnBrowserRestart ?? false;
  } catch (error) {
    logger.error('IdleLockSetting: 加载配置失败:', error);
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
    await StorageUtils.saveIdleLockConfig({
      idleLockMinutes: idleMinutes.value,
      relockOnBrowserRestart: relockOnBrowserRestart.value,
    });
    ElMessage.success('自动锁定设置已保存');
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('IdleLockSetting: 保存配置失败:', error);
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
