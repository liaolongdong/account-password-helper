<template>
  <el-alert
    v-if="exhausted"
    class="capacity-alert"
    type="error"
    :closable="false"
    show-icon
    :title="t('options.capacity.alertFull', { current: currentCount ?? 0, max: MAX_PASSWORD_ENTRIES })"
  />
  <el-alert
    v-else-if="skipped > 0"
    class="capacity-alert"
    type="warning"
    :closable="false"
    show-icon
    :title="
      t('options.capacity.alertOverLimit', {
        current: currentCount ?? 0,
        max: MAX_PASSWORD_ENTRIES,
        incoming,
        remaining,
        skipped,
      })
    "
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/utils/i18n';
import { MAX_PASSWORD_ENTRIES } from '@/utils/storage/vaultCapacity';

/**
 * 导入预览页的条目总量额度告警
 *
 * 只在真正撞上剩余额度时渲染（两档：还能导入一部分 → 告警；一条都导不进 → 错误），
 * 读不到当前条数时 `currentCount` 为 null 且 `remaining` 为 Infinity，两档均不命中，
 * 因而不会出现"额度未知却先吓用户一跳"的闪现误报。
 * 本组件只呈现事实，收口仍在 `batchSavePasswords` 的容量守卫里。
 */
const props = defineProps<{
  /** 当前已有条数；null 表示尚未读取成功（此时不呈现任何告警） */
  currentCount: number | null;
  /** 本次待导入条数 */
  incoming: number;
  /** 剩余额度；额度未知时为 Infinity */
  remaining: number;
  /** 本次将被忽略的条数 */
  skipped: number;
}>();

const { t } = useI18n();

/** 额度已用尽：一条都写不进去 */
const exhausted = computed(() => props.currentCount !== null && props.remaining === 0);
</script>

<style scoped>
.capacity-alert {
  margin-bottom: 12px;
}
</style>
