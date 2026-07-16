<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEditing ? '编辑密码' : '添加密码'"
    width="600px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="$emit('closed')"
  >
    <div class="dialog-body-scroll">
      <el-form
        ref="localFormRef"
        :model="localForm"
        :rules="formRules"
        label-width="100px"
        size="large"
      >
        <el-form-item
          label="用户名"
          prop="username"
        >
          <el-input
            v-model="localForm.username"
            placeholder="请输入用户名或邮箱（最多50字符）"
            :disabled="loading"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          label="密码"
          prop="password"
        >
          <PasswordStrengthPopover
            v-model:visible="formPasswordInputFocused"
            title="密码强度"
            hint="请输入密码查看强度"
            :password="localForm.password"
            :strength="passwordStrength"
            :rules="passwordRules"
          >
            <el-input
              v-model="localForm.password"
              type="password"
              placeholder="选填，密码信息（最多50字符）"
              show-password
              :disabled="loading"
              maxlength="50"
              show-word-limit
              @focus="formPasswordInputFocused = true"
              @blur="formPasswordInputFocused = false"
            >
              <!-- 状态语义：明文显示睁眼，密文显示闭眼 -->
              <template #password-icon="{ visible }">
                <el-icon>
                  <View v-if="visible" />
                  <Hide v-else />
                </el-icon>
              </template>
            </el-input>
          </PasswordStrengthPopover>
          <PasswordGeneratorPopover
            :disabled="loading"
            @confirm="handleGeneratedPassword"
          />
        </el-form-item>

        <el-form-item
          label="网址"
          prop="url"
        >
          <el-input
            v-model="localForm.url"
            placeholder="选填，不填则匹配所有网站（最多100字符）"
            :disabled="loading"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>

        <el-form-item
          label="标签"
          prop="tag"
        >
          <el-select
            :model-value="tagArray"
            multiple
            filterable
            allow-create
            default-first-option
            clearable
            :disabled="loading"
            :multiple-limit="MAX_TAG_COUNT"
            :placeholder="`选填，最多选择${MAX_TAG_COUNT}个，可输入后回车新增`"
            style="width: 100%"
            @update:model-value="$emit('update:tagArray', $event)"
          >
            <el-option
              v-for="t in availableTags"
              :key="t"
              :label="t"
              :value="t"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          label="备注"
          prop="remark"
        >
          <el-input
            v-model="localForm.remark"
            type="textarea"
            :rows="3"
            placeholder="选填，备注信息（最多1000字符）"
            :disabled="loading"
            maxlength="1000"
            show-word-limit
          />
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
          :loading="loading"
          @click="$emit('save')"
        >
          {{ isEditing ? '更新' : '保存' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';
import { View, Hide } from '@element-plus/icons-vue';
import PasswordStrengthPopover from '@/components/options/PasswordStrengthPopover.vue';
import PasswordGeneratorPopover from '@/components/options/PasswordGeneratorPopover.vue';
import type { PasswordRuleItem, PasswordStrengthResult } from '@/composables/usePasswordStrength';
import { MAX_TAG_COUNT } from '@/composables/usePasswordManagement';

/**
 * 密码表单弹窗组件
 *
 * 提供添加和编辑密码的表单界面，包含用户名、密码（带强度检测）、
 * URL、标签多选和备注等字段。
 */
const props = defineProps<{
  /** 弹窗显隐状态 */
  modelValue: boolean;
  /** 是否为编辑模式 */
  isEditing: boolean;
  /** 表单数据 */
  form: { username: string; password: string; url: string; tag: string; remark: string };
  /** 表单校验规则 */
  formRules: FormRules;
  /** 提交加载状态 */
  loading: boolean;
  /** 下拉候选标签列表 */
  availableTags: string[];
  /** 当前标签数组视图 */
  tagArray: string[];
  /** 密码强度计算结果 */
  passwordStrength: PasswordStrengthResult;
  /** 密码规则逐条校验结果 */
  passwordRules: PasswordRuleItem[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:form': [value: { username: string; password: string; url: string; tag: string; remark: string }];
  'update:tagArray': [value: string[]];
  save: [];
  closed: [];
}>();

/** 本地表单模型，从 props 同步并通过事件回写 */
const localForm = reactive({
  username: props.form.username,
  password: props.form.password,
  url: props.form.url,
  tag: props.form.tag,
  remark: props.form.remark,
});

/** props -> local 同步（父组件重置时生效，如编辑/新增切换） */
watch(
  () => props.form,
  val => {
    localForm.username = val.username;
    localForm.password = val.password;
    localForm.url = val.url;
    localForm.tag = val.tag;
    localForm.remark = val.remark;
  },
);

/** local -> parent 同步 */
watch(localForm, val => {
  emit('update:form', { ...val });
});

/** 本地表单引用 */
const localFormRef = ref<FormInstance>();

/** 密码输入框焦点状态 */
const formPasswordInputFocused = ref(false);

/**
 * 处理密码生成器确认事件
 * @param password 生成的密码
 */
const handleGeneratedPassword = (password: string) => {
  localForm.password = password;
};

/** 暴露表单引用供父组件调用 validate / clearValidate */
defineExpose({ formRef: localFormRef });
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
