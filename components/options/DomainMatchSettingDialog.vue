<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.header.domainMatch')"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="dialog-body-scroll">
      <el-radio-group
        v-model="mode"
        class="domain-match-group"
      >
        <el-radio
          v-for="option in modeOptions"
          :key="option.value"
          :value="option.value"
          class="domain-match-option"
        >
          <span class="option-label">{{ option.label }}</span>
          <span class="option-desc">{{ option.desc }}</span>
        </el-radio>
      </el-radio-group>

      <!-- 只在最宽松档提示：该档唯一的新增风险就是测试环境账号串到一起 -->
      <el-alert
        v-if="mode === 'sameMainDomain'"
        class="domain-match-warning"
        type="warning"
        :closable="false"
        show-icon
        :title="t('options.domainMatch.warning')"
      />

      <el-divider />

      <!-- 端口轴与上面的主机轴正交：主机轴管「哪些域名算本站」，这里管「同域名的不同端口要不要隔开」 -->
      <el-radio-group
        v-model="portScope"
        class="domain-match-group"
      >
        <el-radio
          v-for="option in portScopeOptions"
          :key="option.value"
          :value="option.value"
          class="domain-match-option"
        >
          <span class="option-label">{{ option.label }}</span>
          <span class="option-desc">{{ option.desc }}</span>
        </el-radio>
      </el-radio-group>

      <!-- 只在开启端口隔离时提示：这一档唯一的新增风险是「只写了域名的条目不再出现在非默认端口上」 -->
      <el-alert
        v-if="portScope === 'strict'"
        class="domain-match-warning"
        type="warning"
        :closable="false"
        show-icon
        :title="t('options.domainMatch.portWarning')"
      />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          size="large"
          @click="$emit('update:modelValue', false)"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          size="large"
          :loading="saveLoading"
          @click="handleSave"
        >
          {{ t('common.save') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { StorageUtils } from '@/utils/storage';
import { DEFAULT_DOMAIN_MATCH_MODE, DEFAULT_PORT_SCOPE } from '@/utils/storage/configManager';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import type { DomainMatchMode, PortScope } from '@/utils/domain';

/**
 * 站点匹配策略设置弹窗
 *
 * 两条正交的轴各一组单选：
 * - 主机轴：三档为包含关系（同主域名 ⊃ 通配条目 ⊃ 仅精确匹配），缺省 `off` 即 2026-07
 *   为多测试环境隔离引入的精确 host 口径。
 * - 端口轴：缺省 `loose`（公网域名不比端口、本地开发域名沿用既有端口过滤），
 *   `strict` 把所有主机统一到「声明端口必须一致、未声明端口只在默认端口可见」的口径。
 * 两者都只影响「哪些条目出现在本站」，不改判重、不改存储结构，落盘后由后台
 * storage.onChanged 镜像复位即时生效。
 */
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();

const mode = ref<DomainMatchMode>(DEFAULT_DOMAIN_MATCH_MODE);
const portScope = ref<PortScope>(DEFAULT_PORT_SCOPE);
const saveLoading = ref(false);

const modeOptions = computed<Array<{ value: DomainMatchMode; label: string; desc: string }>>(() => [
  { value: 'off', label: t('options.domainMatch.off'), desc: t('options.domainMatch.offDesc') },
  { value: 'wildcard', label: t('options.domainMatch.wildcard'), desc: t('options.domainMatch.wildcardDesc') },
  {
    value: 'sameMainDomain',
    label: t('options.domainMatch.sameMainDomain'),
    desc: t('options.domainMatch.sameMainDomainDesc'),
  },
]);

const portScopeOptions = computed<Array<{ value: PortScope; label: string; desc: string }>>(() => [
  { value: 'loose', label: t('options.domainMatch.portLoose'), desc: t('options.domainMatch.portLooseDesc') },
  { value: 'strict', label: t('options.domainMatch.portStrict'), desc: t('options.domainMatch.portStrictDesc') },
]);

/**
 * 从存储加载最新配置
 */
const loadConfig = async (): Promise<void> => {
  try {
    const config = await StorageUtils.getDomainMatchConfig();
    mode.value = config.mode;
    portScope.value = config.portScope;
  } catch (error) {
    logger.error('DomainMatchSettingDialog: 加载配置失败:', error);
    ElMessage.error(t('message.loadConfigFailed'));
  }
};

// 每次打开都重读：档位可能被侧边栏/其他 Options 标签页改动
watch(
  () => props.modelValue,
  visible => {
    if (visible) loadConfig();
  },
  { immediate: true },
);

/**
 * 保存站点匹配策略（两条轴一次写入）
 */
const handleSave = async (): Promise<void> => {
  saveLoading.value = true;
  try {
    await StorageUtils.saveDomainMatchConfig({ mode: mode.value, portScope: portScope.value });
    ElMessage.success(t('options.domainMatch.saved'));
    emit('update:modelValue', false);
  } catch (error) {
    logger.error('DomainMatchSettingDialog: 保存配置失败:', error);
    ElMessage.error(t('message.saveFailed'));
  } finally {
    saveLoading.value = false;
  }
};
</script>

<style scoped>
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

.domain-match-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* el-radio 默认单行等高（32px + nowrap），此处承载「标题 + 说明」两行 */
.domain-match-option {
  align-items: flex-start;
  height: auto;
  margin-right: 0;
  margin-bottom: 14px;
  white-space: normal;
}

/*
 * 圆点盒 `.el-radio__input` 是 inline-flex 且无显式高度，会缩到圆圈本身的 14px；
 * 而标题行盒是 21px（14px 字号 × 1.5 行高）。上一节的 `align-items: flex-start`
 * 让这两个盒子顶对齐，于是圆心比标题的光学中心高 3.5px（真机实测，见
 * e2e/domain-match-radio-alignment.spec.ts）。把圆点盒撑到与标题同一行盒高、
 * 并让圆圈在其中居中，两者中心即重合。用 `1.5em` 而不是写死 21px：em 取自
 * `.el-radio` 继承来的 14px 字号，与下方 `.el-radio__label` 的 `line-height: 1.5`
 * 同源，字号一旦调整两处一起动。
 */
.domain-match-option :deep(.el-radio__input) {
  align-items: center;
  height: 1.5em;
}

.domain-match-option:last-child {
  margin-bottom: 0;
}

.domain-match-option :deep(.el-radio__label) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.5;
}

.option-desc {
  font-size: 12px;
  color: var(--aph-text-muted);
}

.domain-match-warning {
  margin-top: 8px;
}
</style>
