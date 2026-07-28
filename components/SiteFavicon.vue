<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getFaviconUrl } from '@/utils/favicon';

/**
 * 网站图标组件
 *
 * 通过 Chrome 本地 `_favicon/` 端点展示条目对应网站的图标（零网络请求），
 * 提升密码列表的视觉辨识度。加载失败（无缓存图标 / 不支持的浏览器）或
 * 条目未填写网址时，降级渲染默认插槽内容（如原有的 el-icon），
 * 固定尺寸占位保证布局零偏移，不影响原有展示与交互。
 */
const props = withDefaults(
  defineProps<{
    /** 网站地址（可不带协议，空值时直接渲染降级插槽） */
    url?: string;
    /** 显示尺寸（像素），内部按 2 倍尺寸请求图标以适配高分屏 */
    size?: number;
  }>(),
  { url: '', size: 16 },
);

/** 图标是否加载失败（失败后降级渲染插槽） */
const failed = ref(false);

/** URL 变化时重置失败态，重新尝试加载新图标 */
watch(
  () => props.url,
  () => {
    failed.value = false;
  },
);

/** 图标地址（按 2 倍尺寸请求，高分屏下清晰） */
const src = computed(() => getFaviconUrl(props.url, props.size * 2));
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :style="{ width: `${size}px`, height: `${size}px` }"
    class="site-favicon"
    alt=""
    aria-hidden="true"
    draggable="false"
    loading="lazy"
    @error="failed = true"
  />
  <slot v-else />
</template>

<style scoped>
.site-favicon {
  flex-shrink: 0;
  object-fit: contain;
  border-radius: 3px;
}
</style>
