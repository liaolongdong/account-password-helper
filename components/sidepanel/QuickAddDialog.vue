<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import type { FormInstance, FormRules, InputInstance } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import { MessageType } from '@/utils/types';
import type { RuntimeMessage, QuickAddPasswordData } from '@/utils/types';
import { logger } from '@/utils/logger';
import { useI18n, registerMessages } from '@/utils/i18n';
import { createPasswordFormRules } from '@/utils/formValidators';
import zhForm from '@/utils/i18n/locales/zh-CN/form.json';
import enForm from '@/utils/i18n/locales/en/form.json';

/** 懒加载 chunk 注册 form 命名空间（校验规则复用 Options 页已有文案，不占首屏体积） */
registerMessages('zh-CN', zhForm as Record<string, string>);
registerMessages('en', enForm as Record<string, string>);

/**
 * 侧边栏快速添加条目弹窗
 *
 * 轻量表单（仅用户名必填，密码可选——与密码管理页添加弹窗一致；
 * 网址预填当前站点）经 QUICK_ADD_PASSWORD 委托 background 加密落盘；
 * 完整字段（TOTP 等）经底部入口跳转密码管理页。
 * 保存成功后列表由 storage watcher 自动刷新，无需手动重载。
 */
const props = defineProps<{
  modelValue: boolean;
  /** 预填到网址字段的当前站点域名（可为空） */
  defaultUrl?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** 用户选择跳转密码管理页完整添加（含 TOTP 等全部字段） */
  openOptionsAdd: [];
}>();

const { t } = useI18n();

const formRef = ref<FormInstance>();
const usernameInputRef = ref<InputInstance>();
const saving = ref(false);

const form = reactive({
  username: '',
  password: '',
  url: '',
  tag: '',
  remark: '',
});

/** 表单校验规则（与密码管理页添加表单共用同一工厂，保证字段校验规则完全一致） */
const rules = computed<FormRules>(() => createPasswordFormRules(t));

/**
 * 打开时预填网址并聚焦首字段；关闭时清空表单（安全考虑：清除内存中的明文密码）
 *
 * immediate 为必需项：父组件用粘性标志 v-if 门控挂载本弹窗（把懒加载 chunk 拦在侧边栏首帧之外），
 * 首次打开时「挂载」与「modelValue 已为 true」发生在同一次渲染，
 * 非 immediate 的 watch 不会为初始值触发，将静默丢失网址预填与首字段聚焦。
 * 后续开关走同一条 watch 分支（组件首次打开后常驻，不随关闭卸载）。
 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      form.url = props.defaultUrl ?? '';
      nextTick(() => usernameInputRef.value?.focus());
    } else {
      form.username = '';
      form.password = '';
      form.url = '';
      form.tag = '';
      form.remark = '';
      formRef.value?.clearValidate();
    }
  },
  { immediate: true },
);

/** 提交快速添加：委托 background 校验会话并加密落盘 */
const handleSubmit = async () => {
  if (!formRef.value || saving.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  saving.value = true;
  try {
    const data: QuickAddPasswordData = {
      username: form.username.trim(),
      password: form.password,
      url: form.url.trim(),
      tag: form.tag.trim(),
      remark: form.remark.trim(),
    };
    const result = (await chrome.runtime.sendMessage({
      type: MessageType.QUICK_ADD_PASSWORD,
      data,
    } as RuntimeMessage)) as { success: boolean; message: string } | undefined;
    if (result?.success) {
      ElMessage.success(result.message);
      emit('update:modelValue', false);
    } else {
      ElMessage.error(result?.message || t('message.saveFailed'));
    }
  } catch (error) {
    logger.error('SidePanel: 快速添加条目失败:', error);
    ElMessage.error(t('message.saveFailed'));
  } finally {
    saving.value = false;
  }
};

/** 跳转密码管理页完整添加（保留旧路径作为高级入口） */
const handleOpenOptionsAdd = () => {
  emit('update:modelValue', false);
  emit('openOptionsAdd');
};
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('sidepanel.quickAdd.title')"
    width="90%"
    align-center
    :append-to-body="true"
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    class="quick-add-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- dialog-body-scroll：内容超长时仅弹窗内部滚动，底部按钮固定不随内容滚动（同 options 页弹窗约定） -->
    <div class="dialog-body-scroll">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        :disabled="saving"
      >
        <el-form-item
          :label="t('common.username')"
          prop="username"
        >
          <el-input
            ref="usernameInputRef"
            v-model="form.username"
            :placeholder="t('sidepanel.quickAdd.usernamePlaceholder')"
            maxlength="50"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-form-item
          :label="t('common.password')"
          prop="password"
        >
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="t('sidepanel.quickAdd.passwordPlaceholder')"
            maxlength="50"
            @keyup.enter="handleSubmit"
          >
            <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
            <template #password-icon="{ visible }">
              <el-icon>
                <Hide v-if="visible" />
                <View v-else />
              </el-icon>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item
          :label="t('common.url')"
          prop="url"
        >
          <el-input
            v-model="form.url"
            :placeholder="t('sidepanel.quickAdd.urlPlaceholder')"
            maxlength="100"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-form-item
          :label="t('common.tag')"
          prop="tag"
        >
          <el-input
            v-model="form.tag"
            :placeholder="t('sidepanel.quickAdd.tagPlaceholder')"
            maxlength="50"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-form-item
          :label="t('common.remark')"
          prop="remark"
        >
          <el-input
            v-model="form.remark"
            :placeholder="t('sidepanel.quickAdd.remarkPlaceholder')"
            maxlength="1000"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>
      </el-form>
    </div>

    <template #footer>
      <div class="quick-add-footer">
        <button
          type="button"
          class="quick-add-advanced"
          :disabled="saving"
          @click="handleOpenOptionsAdd"
        >
          {{ t('sidepanel.quickAdd.advancedAdd') }}
        </button>
        <div class="quick-add-actions">
          <el-button
            :disabled="saving"
            @click="$emit('update:modelValue', false)"
          >
            {{ t('common.cancel') }}
          </el-button>
          <el-button
            type="primary"
            :loading="saving"
            @click="handleSubmit"
          >
            {{ t('common.save') }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.quick-add-footer {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.quick-add-advanced {
  padding: 4px 0;
  font-size: 12px;
  color: rgb(var(--aph-primary-rgb));
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
}

.quick-add-advanced:hover {
  text-decoration: underline;
  opacity: 0.8;
}

.quick-add-advanced:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.quick-add-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
</style>

<!-- 非 scoped：el-dialog 经 append-to-body teleport 到 body，scoped 选择器无法命中（同 options 页约定） -->
<style>
/* 弹窗内容区滚动容器：内容超长时仅弹窗内部滚动，底部按钮固定不随内容滚动 */
.quick-add-dialog .dialog-body-scroll {
  max-height: 60vh;
  padding-right: 4px;
  overflow-y: auto;
}

/* 滚动条样式（与 options 页一致：纤细 4px，slate 色调，无轨道背景） */
.quick-add-dialog .dialog-body-scroll::-webkit-scrollbar {
  width: 4px;
}

.quick-add-dialog .dialog-body-scroll::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 4px;
}

.quick-add-dialog .dialog-body-scroll::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}
</style>
