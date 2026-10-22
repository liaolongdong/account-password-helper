<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.growth.whatsNew.title')"
    width="min(520px, 92vw)"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="whats-new__lead">{{ t('options.growth.whatsNew.desc', { version }) }}</p>
    <ul class="whats-new__list">
      <li
        v-for="item in items"
        :key="item.text"
      >
        <span
          class="whats-new__icon"
          aria-hidden="true"
          >{{ item.icon }}</span
        >
        <span>{{ item.text }}</span>
      </li>
    </ul>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">
        {{ t('options.growth.whatsNew.dismiss') }}
      </el-button>
      <el-button
        type="primary"
        @click="$emit('cta')"
      >
        {{ t('options.growth.whatsNew.cta') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/utils/i18n';

/**
 * 一次性版本更新弹窗
 *
 * 只在已有密码库的用户升级后打开一次；首次安装由页面直接记为已读，不弹窗。
 * 组件不读存储、不打开外链，关闭/CTA 由 Options 页面统一处理并写回已读版本。
 * 亮点条目是版本相关文案，发版时同步修改 `options.growth.whatsNew.item.1..N`
 * 与配套的 `icon.1..N`，并把下面的条数改成实际数量。
 * 图标只选「默认就是 emoji 呈现」的码位（⚡👆🚀），或像 ♻️ 那样显式补 U+FE0F：
 * ⌨(U+2328)、🖱(U+1F5B1) 这类默认走文字呈现的字形，以及 🩺(U+1FA7A) 这种过新码位，
 * 在部分系统字库里退化成灰白描边甚至豆腐块（实测无头 Chrome 里 🖱️ 几乎不可见）。
 * 发版前在真机弹窗里看一眼图标，别只看代码。
 */
defineProps<{
  modelValue: boolean;
  version: string;
}>();

defineEmits<{
  'update:modelValue': [boolean];
  cta: [];
}>();

/** 本次更新亮点条数：与语言包里 item.N / icon.N 的最大编号保持一致 */
const ITEM_COUNT = 6;

const { t } = useI18n();
const items = computed(() =>
  Array.from({ length: ITEM_COUNT }, (_, index) => ({
    icon: t(`options.growth.whatsNew.icon.${index + 1}`),
    text: t(`options.growth.whatsNew.item.${index + 1}`),
  })),
);
</script>

<style scoped>
.whats-new__lead {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.whats-new__list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.whats-new__list li {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 7px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.whats-new__icon {
  flex: none;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Segoe UI Symbol', sans-serif;
  font-size: 15px;
  line-height: 1.6;
}
</style>
