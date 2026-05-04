<template>
  <el-dialog
    v-model="dialogVisible"
    :title="isEdit ? '编辑密码' : '添加密码'"
    width="1000px"
    :fullscreen="false"
    class="password-form-dialog fixed-width-dialog"
    @close="handleClose"
  >
    <div class="form-container">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
      >
        <el-form-item
          label="用户名"
          prop="username"
        >
          <el-input
            v-model="form.username"
            placeholder="请输入用户名或邮箱"
          />
        </el-form-item>

        <el-form-item
          label="密码"
          prop="password"
        >
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item
          label="URL"
          prop="url"
        >
          <el-input
            v-model="form.url"
            placeholder="选填，不填则匹配所有网站"
          />
        </el-form-item>

        <el-form-item
          label="标签"
          prop="tag"
        >
          <el-input
            v-model="form.tag"
            placeholder="选填，如：工作、个人等"
          />
        </el-form-item>

        <el-form-item
          label="备注"
          prop="remark"
        >
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            placeholder="选填，备注信息"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button
        type="primary"
        :loading="loading"
        @click="handleSave"
      >
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { FormRules, FormInstance } from 'element-plus';
import type { PasswordEntry } from '../utils/types';
import { StorageUtils } from '../utils/storage';

interface Props {
  modelValue: boolean;
  passwordData?: PasswordEntry | null;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
});

const isEdit = computed(() => !!props.passwordData);

const formRef = ref<FormInstance>();
const loading = ref(false);
const form = ref({
  username: '',
  password: '',
  url: '',
  tag: '',
  remark: '',
});

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

// 监听弹窗显示状态和数据变化
watch([dialogVisible, () => props.passwordData], ([visible, passwordData]) => {
  if (visible) {
    if (passwordData) {
      // 编辑模式，填充数据
      form.value = {
        username: passwordData.username,
        password: passwordData.password,
        url: passwordData.url,
        tag: passwordData.tag,
        remark: passwordData.remark,
      };
    } else {
      // 新增模式，重置表单
      form.value = {
        username: '',
        password: '',
        url: '',
        tag: '',
        remark: '',
      };
    }
  }
});

// 处理关闭
const handleClose = () => {
  dialogVisible.value = false;
};

// 处理保存
const handleSave = async () => {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
    loading.value = true;

    if (isEdit.value && props.passwordData) {
      // 更新密码
      await StorageUtils.updatePassword(props.passwordData.id, {
        username: form.value.username.trim(),
        password: form.value.password,
        url: form.value.url.trim(),
        tag: form.value.tag.trim(),
        remark: form.value.remark.trim(),
        updateTime: Date.now(),
      });
      ElMessage.success('密码更新成功');
    } else {
      // 添加新密码
      const now = Date.now();
      await StorageUtils.savePassword({
        username: form.value.username.trim(),
        password: form.value.password,
        url: form.value.url.trim(),
        tag: form.value.tag.trim(),
        remark: form.value.remark.trim(),
        createTime: now,
        updateTime: now,
      });
      ElMessage.success('密码添加成功');
    }

    emit('saved');
    dialogVisible.value = false;
  } catch (error) {
    console.error('保存密码失败:', error);
    ElMessage.error('保存失败');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
/* 1000px固定宽度弹窗样式 */
:deep(.fixed-width-dialog .el-dialog) {
  width: 1000px !important;
  max-width: calc(100vw - 40px);
  margin-top: 5vh;
  border: 1px solid #e3f2fd;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgb(64 158 255 / 15%);
}

:deep(.fixed-width-dialog .el-overlay) {
  background-color: rgb(0 0 0 / 50%);
}

/* 弹窗头部优化 */
:deep(.fixed-width-dialog .el-dialog__header) {
  padding: 20px 24px;
  color: white;
  background: #409eff;
  border-radius: 12px 12px 0 0;
}

:deep(.fixed-width-dialog .el-dialog__title) {
  font-size: 18px;
  font-weight: 500;
}

/* 弹窗内容区域优化 */
:deep(.fixed-width-dialog .el-dialog__body) {
  max-height: 70vh;
  padding: 24px;
  overflow-y: auto;
  background: #fff;
}

/* 弹窗底部优化 */
:deep(.fixed-width-dialog .el-dialog__footer) {
  padding: 16px 24px;
  background: #fff;
  border-top: 1px solid #f0f0f0;
  border-radius: 0 0 12px 12px;
}

/* 表单容器优化 */
.form-container {
  width: 100%;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

/* 输入框美化 */
:deep(.fixed-width-dialog .el-input__wrapper) {
  padding: 12px 16px;
  border: 1px solid #d9ecff;
  border-radius: 6px;
  box-shadow: none;
  transition: all 0.2s ease;
}

:deep(.fixed-width-dialog .el-input__wrapper:hover) {
  border-color: #409eff;
}

:deep(.fixed-width-dialog .el-input__wrapper.is-focus) {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgb(64 158 255 / 10%);
}

:deep(.fixed-width-dialog .el-input__inner) {
  font-size: 14px;
  line-height: 1.5;
}

/* 按钮优化 */
:deep(.fixed-width-dialog .el-button--primary) {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 400;
  background: #409eff;
  border: 1px solid #409eff;
  border-radius: 6px;
  transition: all 0.2s ease;
}

:deep(.fixed-width-dialog .el-button--primary:hover) {
  background: #66b3ff;
  border-color: #66b3ff;
  box-shadow: 0 4px 12px rgb(64 158 255 / 30%);
  transform: translateY(-1px);
}

/* 表单标签优化 */
:deep(.fixed-width-dialog .el-form-item__label) {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #2c3e50;
}

:deep(.fixed-width-dialog .el-form-item) {
  margin-bottom: 20px;
}

/* 响应式设计 */
@media (width <= 1040px) {
  :deep(.fixed-width-dialog .el-dialog) {
    width: calc(100vw - 40px) !important;
    margin: 20px;
  }
}

@media (width <= 768px) {
  :deep(.fixed-width-dialog .el-dialog) {
    width: calc(100vw - 20px) !important;
    margin: 10px;
  }

  :deep(.fixed-width-dialog .el-dialog__body) {
    padding: 16px;
  }

  :deep(.fixed-width-dialog .el-dialog__header) {
    padding: 16px;
  }

  :deep(.fixed-width-dialog .el-dialog__footer) {
    padding: 12px 16px;
  }
}
</style>
