<template>
  <section
    class="backup-nudge"
    :class="`backup-nudge--${state}`"
    role="status"
    aria-labelledby="backup-nudge-title"
  >
    <el-icon class="backup-nudge__icon"><WarningFilled /></el-icon>
    <div class="backup-nudge__text">
      <h3
        id="backup-nudge-title"
        class="backup-nudge__title"
      >
        {{ t('options.backupNudge.title') }}
      </h3>
      <p class="backup-nudge__desc">
        {{
          state === 'never' ? t('options.backupNudge.never', { file }) : t('options.backupNudge.stale', { days, file })
        }}
      </p>
    </div>
    <div class="backup-nudge__actions">
      <el-button
        type="primary"
        size="small"
        @click="$emit('backup')"
      >
        {{ t('options.backupNudge.action') }}
      </el-button>
      <el-button
        link
        size="small"
        @click="$emit('dismiss')"
      >
        {{ t('options.backupNudge.dismiss') }}
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';

/**
 * 会话内备份轻提醒（R1）
 *
 * 纯展示：什么时候出现由调用方按「徽标档位 + 本次会话是否真的改过数据」决定，
 * 关闭只作用于当前页面会话（不新增持久化键、不加闹钟与桌面通知）。
 * 与「安全起步清单」互斥出现——清单在场时它已经说了同一件事，不叠第二条横幅。
 */
const props = defineProps<{
  /** `never` = 一次都没通过自检导出过；`stale` = 有备份但期间又改过 / 太久没备 */
  state: 'never' | 'stale';
  /** 距上次成功备份的整天数，仅 `stale` 档使用 */
  days: number;
  /** 欠的是哪一份备份：两库互不覆盖，文案必须点名对应的文件形态 */
  vault: 'passwords' | 'identity';
}>();

defineEmits<{
  backup: [];
  dismiss: [];
}>();

const { t } = useI18n();

/** 密码库对应 `.aph`，个人信息库对应 `.aphid`（后者只在库内弹窗里导出） */
const file = computed(() => (props.vault === 'identity' ? '.aphid' : '.aph'));
</script>

<style scoped>
.backup-nudge {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 18px;
  margin-bottom: 16px;
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: 10px;
}

.backup-nudge--never {
  background: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger-light-7);
}

.backup-nudge__icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 18px;
  color: var(--el-color-warning);
}

.backup-nudge--never .backup-nudge__icon {
  color: var(--el-color-danger);
}

.backup-nudge__text {
  flex: 1;
  min-width: 0;
}

.backup-nudge__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.backup-nudge__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.backup-nudge__actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  align-self: center;
}

/* 小屏：动作按钮换到下一行，不把正文挤成一列竖条 */
@media (width <= 720px) {
  .backup-nudge {
    flex-wrap: wrap;
  }

  .backup-nudge__actions {
    justify-content: flex-end;
    width: 100%;
  }
}
</style>
