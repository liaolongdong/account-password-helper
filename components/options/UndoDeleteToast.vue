<template>
  <Transition name="undo-toast">
    <div
      v-if="visible"
      class="undo-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
      @focusin="onFocusIn"
      @focusout="onFocusOut"
    >
      <span class="undo-toast__message">{{ message }}</span>
      <button
        type="button"
        class="undo-toast__action"
        @click="$emit('undo')"
      >
        {{ actionLabel }}
      </button>
      <button
        type="button"
        class="undo-toast__close"
        :aria-label="closeLabel"
        @click="$emit('close')"
      >
        &times;
      </button>
      <span
        :key="resetKey"
        class="undo-toast__progress"
        :style="{
          animationDuration: `${duration}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }"
        aria-hidden="true"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

/**
 * 删除回执与撤销窗口
 *
 * 只在 Options 页使用：删除成功后固定展示一条回执，窗口内可撤销；
 * 鼠标悬停暂停倒计时，移开后按剩余时间继续，避免用户正要点击时回执消失。
 * 倒计时状态只存在组件内，不写入 storage，也不包含任何条目内容。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean;
    message: string;
    actionLabel: string;
    closeLabel: string;
    duration?: number;
    /** 每次新删除递增；同一可见态下的连续删除据此重置计时器与进度条 */
    resetKey?: number;
  }>(),
  { duration: 5000, resetKey: 0 },
);

const emit = defineEmits<{
  undo: [];
  close: [];
  expire: [];
}>();

/**
 * 计时器唯一真源在组件内：父层只负责显示/隐藏，不再并存第二只 5 秒时钟。
 * 悬停与键盘焦点都会暂停倒计时，两者可叠加，任意一个仍在就保持暂停。
 */
const hovering = ref(false);
const focused = ref(false);
const paused = computed(() => hovering.value || focused.value);

let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;
let remaining = props.duration;

const clearTimer = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
};

const startTimer = (): void => {
  clearTimer();
  startedAt = Date.now();
  timer = setTimeout(
    () => {
      timer = null;
      emit('expire');
    },
    Math.max(0, remaining),
  );
};

watch(
  [() => props.visible, () => props.resetKey],
  ([visible], previous) => {
    const wasVisible = previous?.[0] ?? false;
    if (!visible) {
      clearTimer();
      hovering.value = false;
      focused.value = false;
      remaining = props.duration;
      return;
    }
    // 第一次出现时清掉上一次残留的悬停/焦点原因；连续删除只重置剩余时长与进度条
    if (!wasVisible) {
      hovering.value = false;
      focused.value = false;
    }
    remaining = props.duration;
    clearTimer();
    if (!paused.value) startTimer();
  },
  { immediate: true },
);

// 暂停原因从 0 → 1 时记录已消耗时长；从 1 → 0 时按剩余时间继续
watch(paused, isPaused => {
  if (!props.visible) return;
  if (isPaused) {
    clearTimer();
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    return;
  }
  if (remaining <= 0) {
    emit('expire');
    return;
  }
  startTimer();
});

const onMouseEnter = (): void => {
  hovering.value = true;
};

const onMouseLeave = (): void => {
  hovering.value = false;
};

const onFocusIn = (): void => {
  focused.value = true;
};

const onFocusOut = (): void => {
  focused.value = false;
};

onBeforeUnmount(clearTimer);
</script>

<style scoped>
.undo-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  z-index: 3000;
  display: flex;
  gap: 10px;
  align-items: center;
  width: calc(100% - 32px);
  max-width: 520px;
  padding: 12px 14px 13px;
  overflow: hidden;
  font-size: 14px;
  color: var(--el-text-color-primary, #303133);
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  transform: translateX(-50%);
}

.undo-toast__message {
  flex: 1;
  min-width: 0;
  line-height: 1.4;
}

.undo-toast__action,
.undo-toast__close {
  flex-shrink: 0;
  padding: 4px 6px;
  font: inherit;
  color: var(--el-color-primary, #409eff);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
}

.undo-toast__action {
  font-weight: 600;
}

.undo-toast__close {
  font-size: 18px;
  line-height: 1;
  color: var(--el-text-color-secondary, #909399);
}

.undo-toast__action:hover,
.undo-toast__close:hover {
  background: var(--el-fill-color-light, #f5f7fa);
}

.undo-toast__action:focus-visible,
.undo-toast__close:focus-visible {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}

.undo-toast__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--el-color-primary, #409eff);
  transform-origin: left;
  animation-name: undo-toast-countdown;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes undo-toast-countdown {
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0);
  }
}

.undo-toast-enter-active,
.undo-toast-leave-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.18s ease-out;
}

.undo-toast-enter-from,
.undo-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (prefers-reduced-motion: reduce) {
  .undo-toast__progress {
    animation: none;
  }

  .undo-toast-enter-active,
  .undo-toast-leave-active {
    transition: none;
  }
}
</style>
