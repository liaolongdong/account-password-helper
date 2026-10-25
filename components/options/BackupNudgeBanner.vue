<template>
  <section
    class="backup-nudge"
    :class="`backup-nudge--${state}`"
    role="status"
    aria-labelledby="backup-nudge-title"
  >
    <el-icon
      class="backup-nudge__icon"
      aria-hidden="true"
    >
      <CircleCloseFilled v-if="state === 'never'" />
      <WarningFilled v-else />
    </el-icon>
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
      <p
        v-if="otherVault"
        class="backup-nudge__other"
      >
        {{ t('options.backupNudge.otherOwed', { vault: otherVaultLabel, file: otherVaultFile }) }}
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
import { CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';

/**
 * 会话内备份轻提醒（R1）
 *
 * 纯展示：什么时候出现由调用方按「徽标档位 + 本次会话是否真的改过数据」决定，
 * 关闭只作用于当前页面会话（不新增持久化键、不加闹钟与桌面通知）。
 * 与「安全起步清单」互斥出现——清单在场时它已经说了同一件事，不叠第二条横幅。
 * 两库是两份互不覆盖的备份，所以横幅一次只推一份，`otherVault` 用来预告下一份。
 */
const props = defineProps<{
  /** `never` = 一次都没通过自检导出过；`stale` = 有备份但期间又改过 / 太久没备 */
  state: 'never' | 'stale';
  /** 距上次成功备份的整天数，仅 `stale` 档使用 */
  days: number;
  /** 欠的是哪一份备份：两库互不覆盖，文案必须点名对应的文件形态 */
  vault: 'passwords' | 'identity';
  /** 另一库此刻也到了该备份的时候（`never` / `pending`）；为空则不提第二份 */
  otherVault?: 'passwords' | 'identity' | null;
}>();

defineEmits<{
  backup: [];
  dismiss: [];
}>();

const { t } = useI18n();

/**
 * 库 → 备份文件形态：密码库 `.aph`，个人信息库 `.aphid`（后者只在库内弹窗里导出）。
 * 主句与副句点名的是两个不同的库，必须共用这一份映射，各写一遍三元就会漂移。
 */
const fileOf = (vault: 'passwords' | 'identity'): string => (vault === 'identity' ? '.aphid' : '.aph');
const file = computed(() => fileOf(props.vault));

/** 副句点名另一库，扩展名与库名都跟着那一个库走，不能沿用主句的那一套 */
const otherVaultLabel = computed(() =>
  props.otherVault === 'identity'
    ? t('options.header.backupChipIdentityLabel')
    : t('options.header.backupChipPasswordsLabel'),
);
const otherVaultFile = computed(() => fileOf(props.otherVault ?? props.vault));
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

  /* 18px 图标在 24px 首行里光学居中：三块（图标 / 标题 / 动作）都从内容框顶边起，
     不再让动作块飘到多行文本的垂直正中。 */
  margin-top: 3px;
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
  line-height: 24px;
  color: var(--el-text-color-primary);
}

.backup-nudge__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

/* 副句只说「下一份还欠着」这一件事，视觉上低正文一档就够了；刻意不降到
   `--el-text-color-secondary`——那个灰压在告警 / 危险浅底上只有约 2.6:1，不达 WCAG AA。 */
.backup-nudge__other {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.backup-nudge__actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
}

/* 两枚动作都要够 24×24 的最小命中区（WCAG 2.5.8）：EP 的 link 小按钮实测只有 18px 高，
   且它挨着主按钮、8px 间距也补不回「足够间距」那条豁免。 */
.backup-nudge__actions :deep(.el-button) {
  min-height: 24px;
}

.backup-nudge__actions :deep(.el-button.is-link) {
  padding: 4px 8px;
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
