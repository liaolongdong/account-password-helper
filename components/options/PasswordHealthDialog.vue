<template>
  <el-dialog
    :model-value="modelValue"
    width="720px"
    align-center
    :close-on-click-modal="false"
    class="health-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="health-dialog__title">
        <el-icon><Aim /></el-icon>
        <span>安全体检</span>
      </div>
    </template>

    <div class="dialog-body-scroll">
      <!-- 空库：还没有密码 -->
      <div
        v-if="report.total === 0"
        class="health-empty"
      >
        <el-icon class="health-empty__icon"><FolderOpened /></el-icon>
        <p class="health-empty__title">还没有密码</p>
        <p class="health-empty__desc">先添加或导入账号密码，再回来查看安全体检报告。</p>
      </div>

      <div
        v-else
        class="health"
      >
        <!-- 评分区（hero） -->
        <section
          class="health-hero"
          :class="`grade-${report.grade}`"
        >
          <div class="score-wrap">
            <svg
              class="score-ring"
              :width="RING_SIZE"
              :height="RING_SIZE"
              :viewBox="`0 0 ${RING_SIZE} ${RING_SIZE}`"
              role="img"
              :aria-label="`安全评分 ${report.score} 分，${gradeText}`"
            >
              <circle
                class="ring-track"
                :cx="RING_CENTER"
                :cy="RING_CENTER"
                :r="RING_R"
                fill="none"
                :stroke-width="RING_STROKE"
              />
              <circle
                class="ring-progress"
                :cx="RING_CENTER"
                :cy="RING_CENTER"
                :r="RING_R"
                fill="none"
                :stroke-width="RING_STROKE"
                stroke-linecap="round"
                :stroke-dasharray="RING_C"
                :stroke-dashoffset="ringOffset"
              />
            </svg>
            <div class="score-center">
              <span class="score-num">{{ report.score }}</span>
              <span class="score-unit">分</span>
            </div>
          </div>

          <div class="hero-text">
            <div class="hero-grade">{{ gradeText }}</div>
            <p class="hero-summary">{{ summaryText }}</p>
            <p class="hero-total">共 {{ report.total }} 条账号密码 · 全程本地计算，不联网</p>
          </div>
        </section>

        <!-- 指标卡网格 -->
        <section class="metric-grid">
          <component
            :is="metric.clickable ? 'button' : 'div'"
            v-for="metric in metrics"
            :key="metric.key"
            class="metric-card"
            :class="[`tone-${metric.tone}`, { 'is-clickable': metric.clickable }]"
            :type="metric.clickable ? 'button' : undefined"
            :aria-label="
              metric.clickable ? `${metric.label}：${metric.count}，点击查看明细` : `${metric.label}：${metric.count}`
            "
            @click="metric.clickable ? scrollToIssue(metric.key) : undefined"
          >
            <span class="metric-icon">
              <el-icon><component :is="metric.icon" /></el-icon>
            </span>
            <span class="metric-count">{{ metric.count }}</span>
            <span class="metric-label">{{ metric.label }}</span>
            <span class="metric-caption">{{ metric.caption }}</span>
          </component>
        </section>

        <!-- 健康态：无任何问题 -->
        <div
          v-if="!hasIssues"
          class="health-allgood"
        >
          <el-icon class="health-allgood__icon"><CircleCheckFilled /></el-icon>
          <span>太棒了，未发现密码安全问题。</span>
        </div>

        <!-- 明细区 -->
        <section
          v-else
          class="health-details"
        >
          <el-collapse v-model="activePanels">
            <!-- 密码复用 -->
            <el-collapse-item
              v-if="report.reuseGroups.length"
              name="reuse"
              class="health-panel-reuse"
            >
              <template #title>
                <span class="panel-title">
                  <el-icon class="panel-title__icon tone-danger"><CopyDocument /></el-icon>
                  密码复用
                  <span class="panel-badge tone-danger">{{ report.reuseAffectedCount }}</span>
                </span>
              </template>
              <p class="panel-hint">这些账号共用了相同的密码，一处泄露将波及全部，建议逐一改为独立密码。</p>
              <div
                v-for="(group, gi) in report.reuseGroups"
                :key="gi"
                class="reuse-group"
              >
                <div class="reuse-group__head">
                  <el-icon><WarningFilled /></el-icon>
                  {{ group.count }} 个账号共用同一密码
                </div>
                <div
                  v-for="entry in group.entries"
                  :key="entry.id"
                  class="issue-row"
                >
                  <div class="issue-info">
                    <span class="issue-name">{{ entry.username || '（无用户名）' }}</span>
                    <span
                      v-if="entry.url"
                      class="issue-url"
                    >
                      {{ entry.url }}
                    </span>
                  </div>
                  <el-button
                    link
                    type="primary"
                    :icon="Edit"
                    @click="onEdit(entry.id)"
                  >
                    去处理
                  </el-button>
                </div>
              </div>
            </el-collapse-item>

            <!-- 弱密码 -->
            <el-collapse-item
              v-if="report.weak.length"
              name="weak"
              class="health-panel-weak"
            >
              <template #title>
                <span class="panel-title">
                  <el-icon class="panel-title__icon tone-danger"><WarningFilled /></el-icon>
                  弱密码
                  <span class="panel-badge tone-danger">{{ report.weak.length }}</span>
                </span>
              </template>
              <p class="panel-hint">这些密码强度较弱，建议增加长度并混合大小写字母、数字与特殊字符。</p>
              <div class="issue-card">
                <div
                  v-for="entry in report.weak"
                  :key="entry.id"
                  class="issue-row"
                >
                  <div class="issue-info">
                    <span class="issue-name">{{ entry.username || '（无用户名）' }}</span>
                    <span
                      v-if="entry.url"
                      class="issue-url"
                    >
                      {{ entry.url }}
                    </span>
                  </div>
                  <el-button
                    link
                    type="primary"
                    :icon="Edit"
                    @click="onEdit(entry.id)"
                  >
                    去处理
                  </el-button>
                </div>
              </div>
            </el-collapse-item>

            <!-- 长时间未更新 -->
            <el-collapse-item
              v-if="report.stale.length"
              name="stale"
              class="health-panel-stale"
            >
              <template #title>
                <span class="panel-title">
                  <el-icon class="panel-title__icon tone-warning"><Timer /></el-icon>
                  长时间未更新
                  <span class="panel-badge tone-warning">{{ report.stale.length }}</span>
                </span>
              </template>
              <p class="panel-hint">这些条目长时间未更新（以最后修改时间估算），建议定期更换重要账号的密码。</p>
              <div class="issue-card">
                <div
                  v-for="entry in report.stale"
                  :key="entry.id"
                  class="issue-row"
                >
                  <div class="issue-info">
                    <span class="issue-name">{{ entry.username || '（无用户名）' }}</span>
                    <span
                      v-if="entry.url"
                      class="issue-url"
                    >
                      {{ entry.url }}
                    </span>
                  </div>
                  <div class="issue-trailing">
                    <span
                      class="age-badge"
                      :class="`tone-${entry.severity === 'critical' ? 'danger' : 'warning'}`"
                    >
                      {{ formatAge(entry.ageDays) }}
                    </span>
                    <el-button
                      link
                      type="primary"
                      :icon="Edit"
                      @click="onEdit(entry.id)"
                    >
                      去处理
                    </el-button>
                  </div>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </section>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          type="primary"
          @click="$emit('update:modelValue', false)"
        >
          关闭
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import {
  Aim,
  CopyDocument,
  WarningFilled,
  Timer,
  Key,
  Edit,
  CircleCheckFilled,
  FolderOpened,
} from '@element-plus/icons-vue';
import type { HealthReport, HealthGrade } from '@/utils/passwordHealth';

/**
 * 密码健康仪表盘弹窗
 *
 * 展示由 `utils/passwordHealth.buildHealthReport` 计算出的安全评分、弱密码、
 * 密码复用、长时间未更新与未开启两步验证统计。所有数据均来自父组件已解密的
 * 内存报告，本组件不做任何解密、存储或网络操作。点击「去处理」通过 `edit`
 * 事件通知父组件跳转到对应条目的编辑流程。
 */
const props = defineProps<{
  /** 控制弹窗显示 */
  modelValue: boolean;
  /** 密码健康报告 */
  report: HealthReport;
}>();

const emit = defineEmits<{
  /** 弹窗显隐变更 */
  (e: 'update:modelValue', value: boolean): void;
  /** 点击「去处理」，携带目标条目 ID */
  (e: 'edit', id: string): void;
}>();

/** 环形进度几何参数（纯 SVG，避免引入图表库增大打包体积） */
const RING_SIZE = 112;
const RING_STROKE = 10;
const RING_CENTER = RING_SIZE / 2;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/** 当前展开的明细面板 */
const activePanels = ref<string[]>([]);

/** 用于开场动画的评分（从 0 过渡到真实评分，驱动环形 dashoffset） */
const animatedScore = ref(0);

/** 环形进度偏移量：评分越高，空缺越小 */
const ringOffset = computed(() => RING_C * (1 - animatedScore.value / 100));

/** 健康等级中文文案 */
const gradeText = computed(() => {
  const map: Record<HealthGrade, string> = {
    excellent: '优秀',
    good: '良好',
    fair: '一般',
    poor: '较差',
  };
  return map[props.report.grade];
});

/** 是否存在需要关注的问题（复用 / 弱密码 / 陈旧） */
const hasIssues = computed(
  () => props.report.reuseGroups.length > 0 || props.report.weak.length > 0 || props.report.stale.length > 0,
);

/** hero 区摘要文案 */
const summaryText = computed(() => {
  if (!hasIssues.value) return '账号密码结构健康，继续保持。';
  const categories = [
    props.report.reuseGroups.length > 0,
    props.report.weak.length > 0,
    props.report.stale.length > 0,
  ].filter(Boolean).length;
  return `发现 ${categories} 项需要关注`;
});

/** 指标卡数据（复用 / 弱密码 / 陈旧为可点击明细项，未开启两步验证仅信息展示） */
const metrics = computed(() => {
  const r = props.report;
  return [
    {
      key: 'reuse' as const,
      label: '密码复用',
      icon: CopyDocument,
      count: r.reuseAffectedCount,
      caption: r.reuseGroups.length ? `${r.reuseGroups.length} 组共用` : '无复用',
      tone: r.reuseAffectedCount > 0 ? 'danger' : 'ok',
      clickable: r.reuseGroups.length > 0,
    },
    {
      key: 'weak' as const,
      label: '弱密码',
      icon: WarningFilled,
      count: r.weak.length,
      caption: r.weak.length ? '建议增强' : '无弱密码',
      tone: r.weak.length > 0 ? 'danger' : 'ok',
      clickable: r.weak.length > 0,
    },
    {
      key: 'stale' as const,
      label: '长时间未更新',
      icon: Timer,
      count: r.stale.length,
      caption: r.stale.length ? '建议更换' : '较新',
      tone: r.stale.length > 0 ? 'warning' : 'ok',
      clickable: r.stale.length > 0,
    },
    {
      key: 'noTotp' as const,
      label: '未开启两步验证',
      icon: Key,
      count: r.noTotpCount,
      caption: r.noTotpCount ? '可选增强' : '已全部开启',
      tone: r.noTotpCount > 0 ? 'info' : 'ok',
      clickable: false,
    },
  ];
});

/**
 * 将天数格式化为友好的「未更新」文案
 * @param days 距最后更新的天数
 */
function formatAge(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `超过 ${years} 年未更新`;
  }
  return `${days} 天未更新`;
}

/**
 * 展开并滚动到指定问题面板
 * @param key 面板名（reuse / weak / stale）
 */
async function scrollToIssue(key: string): Promise<void> {
  if (!activePanels.value.includes(key)) {
    activePanels.value = [...activePanels.value, key];
  }
  await nextTick();
  const el = document.querySelector(`.health-panel-${key}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * 点击「去处理」：先关闭本弹窗，再通知父组件跳转编辑
 * @param id 目标条目 ID
 */
function onEdit(id: string): void {
  emit('update:modelValue', false);
  emit('edit', id);
}

/** 弹窗打开时：重置并触发环形开场动画、默认展开全部问题面板 */
watch(
  () => props.modelValue,
  visible => {
    if (!visible) return;
    activePanels.value = ['reuse', 'weak', 'stale'].filter(k => {
      if (k === 'reuse') return props.report.reuseGroups.length > 0;
      if (k === 'weak') return props.report.weak.length > 0;
      return props.report.stale.length > 0;
    });
    animatedScore.value = 0;
    nextTick(() => {
      requestAnimationFrame(() => {
        animatedScore.value = props.report.score;
      });
    });
  },
);
</script>

<style scoped>
/* ==================== 标题 ==================== */
.health-dialog__title {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}

/* ==================== 空库状态 ==================== */
.health-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  text-align: center;
}

.health-empty__icon {
  margin-bottom: 12px;
  font-size: 44px;
  color: var(--aph-primary);
}

.health-empty__title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
}

.health-empty__desc {
  max-width: 360px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #909399;
}

/* ==================== 评分区 hero ==================== */
.health {
  --hero-color: var(--aph-primary);
}

.health-hero {
  display: flex;
  gap: 20px;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: linear-gradient(135deg, var(--aph-surface) 0%, var(--aph-surface-2) 100%);
  border: 1px solid var(--aph-surface-line);
  border-radius: 12px;
}

.health-hero.grade-excellent {
  --hero-color: #67c23a;
}

.health-hero.grade-good {
  --hero-color: var(--aph-primary);
}

.health-hero.grade-fair {
  --hero-color: #e6a23c;
}

.health-hero.grade-poor {
  --hero-color: #f56c6c;
}

.score-wrap {
  position: relative;
  flex-shrink: 0;
  width: 112px;
  height: 112px;
}

.score-ring {
  transform: rotate(-90deg);
}

.ring-track {
  stroke: #ebeef5;
}

.ring-progress {
  stroke: var(--hero-color);
  transition: stroke-dashoffset 0.9s ease;
}

.score-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.score-num {
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--hero-color);
}

.score-unit {
  margin-left: 2px;
  font-size: 14px;
  color: #909399;
}

.hero-text {
  min-width: 0;
}

.hero-grade {
  margin-bottom: 6px;
  font-size: 20px;
  font-weight: 700;
  color: var(--hero-color);
}

.hero-summary {
  margin: 0 0 6px;
  font-size: 14px;
  color: #2c3e50;
}

.hero-total {
  margin: 0;
  font-size: 12px;
  color: #909399;
}

/* ==================== 指标卡网格 ==================== */
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-card {
  --metric-color: #909399;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 14px;
  font-family: inherit;
  text-align: left;
  background: #fff;
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(var(--aph-primary-rgb) / 8%);
}

.metric-card.tone-danger {
  --metric-color: #f56c6c;
}

.metric-card.tone-warning {
  --metric-color: #e6a23c;
}

.metric-card.tone-info {
  --metric-color: #909399;
}

.metric-card.tone-ok {
  --metric-color: #67c23a;
}

.metric-card.is-clickable {
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.metric-card.is-clickable:hover {
  box-shadow: 0 4px 12px rgb(var(--aph-primary-rgb) / 18%);
  transform: translateY(-2px);
}

.metric-card.is-clickable:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 2px;
}

.metric-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: 10px;
  font-size: 18px;
  color: var(--metric-color);
  background: color-mix(in srgb, var(--metric-color) 12%, transparent);
  border-radius: 8px;
}

.metric-count {
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: #2c3e50;
}

.metric-label {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #2c3e50;
}

.metric-caption {
  margin-top: 2px;
  font-size: 12px;
  color: var(--metric-color);
}

/* ==================== 健康态 ==================== */
.health-allgood {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font-size: 14px;
  color: #529b2e;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 8px;
}

.health-allgood__icon {
  font-size: 20px;
  color: #67c23a;
}

/* ==================== 明细区 ==================== */
.panel-title {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: #2c3e50;
}

.panel-title__icon {
  font-size: 16px;
}

.panel-title__icon.tone-danger {
  color: #f56c6c;
}

.panel-title__icon.tone-warning {
  color: #e6a23c;
}

.panel-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  border-radius: 10px;
}

.panel-badge.tone-danger {
  background: #f56c6c;
}

.panel-badge.tone-warning {
  background: #e6a23c;
}

.panel-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #909399;
}

.reuse-group,
.issue-card {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--aph-surface-2);
  border: 1px solid var(--aph-surface-line);
  border-radius: 8px;
}

/* link 型「去处理」按钮：抵消 options 全局 .el-button--primary 的实心背景/边框，
   恢复透明底 + 主色文字，避免主色文字压在同色背景上不可见 */
:deep(.el-button.is-link),
:deep(.el-button.is-link:hover) {
  background-color: transparent;
  border-color: transparent;
}

.reuse-group__head {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #e6a23c;
}

.issue-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  border-bottom: 1px solid var(--aph-surface-hover);
}

.issue-row:last-child {
  border-bottom: none;
}

.issue-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.issue-name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 500;
  color: #2c3e50;
  white-space: nowrap;
}

.issue-url {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}

.issue-trailing {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  align-items: center;
}

.age-badge {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.age-badge.tone-danger {
  color: #f56c6c;
}

.age-badge.tone-warning {
  color: #e6a23c;
}

/* 面板容器边框对齐 Element Plus 折叠面板 */
:deep(.el-collapse) {
  border-top: none;
}

:deep(.el-collapse-item__content) {
  padding-bottom: 12px;
}

/* ==================== 降级动画 ==================== */
@media (prefers-reduced-motion: reduce) {
  .ring-progress {
    transition: none;
  }

  .metric-card.is-clickable {
    transition: none;
  }

  .metric-card.is-clickable:hover {
    transform: none;
  }
}

/* ==================== 响应式 ==================== */
@media (width <= 640px) {
  .health-hero {
    flex-direction: column;
    text-align: center;
  }
}
</style>
