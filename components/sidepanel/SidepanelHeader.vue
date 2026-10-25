<script setup lang="ts">
import { computed, watch } from 'vue';
import { Plus, Setting, Timer } from '@element-plus/icons-vue';
import GithubIcon from '@/components/GithubIcon.vue';
import HelpQuestionIcon from '@/components/HelpQuestionIcon.vue';
import { useI18n } from '@/utils/i18n';
import { useSessionCountdown } from '@/composables/useSessionCountdown';
import type { EnvChipOption } from '@/utils/envFamily';
// 品牌 Logo 静态导入：App.vue 已静态引用同组件（已在入口 chunk 内），
// 异步包装无体积收益反增一次 resolve tick，导致品牌图标晚一帧出现
import BrandLogo from '@/components/BrandLogo.vue';

interface Props {
  /** 当前页面域名 */
  currentDomain: string;
  /** 会话是否有效（仅认证态启动倒计时，锁屏态零开销） */
  isAuthenticated: boolean;
  /** 是否展示本站匹配信息（认证态且非本地开发域名；与底部信息带上移前的展示条件一致） */
  showMatchInfo: boolean;
  /** 本站匹配账号数（0 时转为添加邀请） */
  matchCount: number;
  /**
   * 端口芯片文案（如 `:8443`），空串即不渲染
   *
   * 由父级按「持久化策略为 strict 且当前页确实带非默认端口」决定，本组件不判域名与端口。
   */
  portLabel: string;
  /** 端口隔离是否已被本站临时放宽（芯片据此切换文案与态） */
  portRelaxed: boolean;
  /**
   * 本地开发页可绑定的环境选项（由父级从条目网址派生）
   *
   * 空数组即不渲染芯片：非环回页面、或库里没有可识别的环境，都不该多出一颗点了没反应的按钮。
   */
  envOptions: EnvChipOption[];
  /** 当前生效的绑定主机；空串表示未绑定 */
  envActiveHost: string;
  /** 环境选择器是否展开 */
  envPickerOpen: boolean;
}

interface Emits {
  /** 打开 GitHub 仓库 */
  openGithub: [];
  /** 打开帮助弹窗 */
  openHelp: [];
  /** 打开偏好设置弹窗 */
  openSettings: [];
  /** 点击会话倒计时胶囊，跳转有效期设置续期 */
  openValidity: [];
  /** 点击添加邀请（0 匹配）或常驻「+」（有匹配），打开快速添加弹窗（预填当前站点域名） */
  addSitePassword: [];
  /** 点击端口芯片：在本站临时显示/收回其他端口的账号（不落盘） */
  togglePortRelax: [];
  /** 展开/收起环境选择器（面板本体由父级在头部卡片下方渲染，避免被 overflow 裁掉） */
  toggleEnvPicker: [];
}

const props = defineProps<Props>();
defineEmits<Emits>();

const { t } = useI18n();

/** 当前绑定的那个候选（未绑定或库里已删光该环境时为 null） */
const activeEnvOption = computed(() => props.envOptions.find(option => option.host === props.envActiveHost) ?? null);

/**
 * 环境芯片文案
 *
 * 未绑定时说「选环境」，绑定后直接说绑到了哪：芯片此刻是状态指示，不只是入口。
 */
const envPillLabel = computed(() => activeEnvOption.value?.label ?? (props.envActiveHost || t('sidepanel.env.pick')));

/** 当前绑定是否线上/无法识别的环境（决定警示色） */
const envIsProduction = computed(() => activeEnvOption.value?.production === true);

/** 芯片 title：绑定态把「还有多少条在同环境其他子主机」说清楚，避免计数对不上被当成 bug */
const envPillTitle = computed(() => {
  const active = activeEnvOption.value;
  if (!active) return t('sidepanel.env.pickHint');
  return active.siblingCount > 0
    ? t('sidepanel.env.activeHintWithSiblings', { host: active.host, count: active.siblingCount })
    : t('sidepanel.env.activeHint', { host: active.host });
});

// 会话倒计时：仅认证态启动（会话失效时展示倒计时无意义）；
// 会话过期/清除后 isAuthenticated 回落时停止，避免无用轮询
const { remainingText, isUrgent, isCritical, start, stop } = useSessionCountdown();
watch(
  () => props.isAuthenticated,
  authed => {
    if (authed) start();
    else stop();
  },
  { immediate: true },
);
</script>

<template>
  <div class="header">
    <div class="header-left">
      <h3>
        <BrandLogo class="logo" />
        {{ t('common.quickFill') }}
        <!-- 会话剩余时间：标题行右对齐胶囊，点击直达有效期设置续期；紧迫态（≤10 分钟）转警示橙、危急态（≤1 分钟）转警示红 -->
        <button
          v-if="remainingText"
          type="button"
          class="session-pill"
          :class="{ 'session-pill--urgent': isUrgent, 'session-pill--critical': isCritical }"
          :title="t('sidepanel.sessionRemainingTitle')"
          @click="$emit('openValidity')"
        >
          <el-icon><Timer /></el-icon>
          {{ remainingText }}
        </button>
      </h3>
      <div class="current-url">
        <el-text
          type="info"
          size="small"
          >{{ currentDomain }}</el-text
        >
        <!-- 端口芯片：端口隔离生效时把「当前页在哪个端口、被挡住了多少」递到手边，
             一键在本站临时放宽（不落盘），省去为看一眼而进设置弹窗 -->
        <button
          v-if="portLabel"
          type="button"
          class="port-pill"
          :class="{ 'port-pill--relaxed': portRelaxed }"
          :title="t(portRelaxed ? 'sidepanel.scope.portRelaxRestore' : 'sidepanel.scope.portRelaxHint')"
          :aria-pressed="portRelaxed"
          @click="$emit('togglePortRelax')"
        >
          {{ portLabel }}
          <span class="port-pill__state">{{
            t(portRelaxed ? 'sidepanel.scope.portRelaxed' : 'sidepanel.scope.portIsolated')
          }}</span>
        </button>
        <!-- 本地开发环境芯片：dev/fat/uat/prod 用的是同一个前端地址，「这一页连的是哪个后端」
             不在 URL 里，只能由用户点一次声明；候选集由库里的条目网址派生，不需要维护映射表。
             选择面板不在这里渲染：头部卡片 overflow: hidden，浮层会被裁掉，改由父级在卡片下方展开 -->
        <button
          v-if="envOptions.length"
          type="button"
          class="env-pill"
          :class="{ 'env-pill--active': !!envActiveHost, 'env-pill--danger': envIsProduction }"
          :title="envPillTitle"
          :aria-expanded="envPickerOpen"
          @click="$emit('toggleEnvPicker')"
        >
          {{ envPillLabel }}
        </button>
        <!-- 本站匹配数：域名派生指标随域名同行展示（信息就近原则），释放底部列表垂直空间；
             数字主题色高亮（一眼可见“本站有 N 个账号可用”），前后缀文案拆分以兼容中英文语序 -->
        <template v-if="showMatchInfo && matchCount > 0">
          <span class="match-count">
            {{ t('sidepanel.header.matchCountBefore') }}<span class="match-count__num">{{ matchCount }}</span
            >{{ t('sidepanel.header.matchCountAfter') }}
          </span>
          <!-- 常驻快速添加入口：有匹配时紧跟匹配数展示，覆盖“给本站再加一个账号”的高频场景 -->
          <button
            type="button"
            class="add-site-plus"
            :title="t('sidepanel.addSiteAccount')"
            :aria-label="t('sidepanel.addSiteAccount')"
            @click="$emit('addSitePassword')"
          >
            <el-icon><Plus /></el-icon>
          </button>
        </template>
        <!-- 0 匹配添加邀请：空屏即方向，点击打开快速添加弹窗（预填当前站点域名） -->
        <button
          v-else-if="showMatchInfo"
          type="button"
          class="add-site"
          :title="t('sidepanel.addSiteAccount')"
          @click="$emit('addSitePassword')"
        >
          {{ t('sidepanel.header.noMatch') }}
          <span class="add-site__action">{{ t('sidepanel.header.addAccount') }}</span>
        </button>
      </div>
    </div>
    <div class="header-actions">
      <div class="actions-pill">
        <button
          type="button"
          class="pill-btn"
          :title="t('sidepanel.header.github')"
          @click="$emit('openGithub')"
        >
          <span class="pill-btn__svg">
            <GithubIcon />
          </span>
        </button>
        <button
          type="button"
          class="pill-btn"
          :title="t('sidepanel.header.help')"
          @click="$emit('openHelp')"
        >
          <span class="pill-btn__svg">
            <HelpQuestionIcon />
          </span>
        </button>
        <button
          type="button"
          class="pill-btn"
          :title="t('common.preferences')"
          @click="$emit('openSettings')"
        >
          <el-icon><Setting /></el-icon>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 16px;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
}

/* 按钮组 pill 容器 */
.actions-pill {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  align-items: center;
  padding: 3px;
  background: #f1f5f9;
  border-radius: 20px;
}

.pill-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: #64748b;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition:
    color var(--aph-duration-mid) ease,
    background-color var(--aph-duration-mid) ease,
    box-shadow var(--aph-duration-mid) ease,
    transform var(--aph-duration-mid) ease,
    outline var(--aph-duration-mid) ease;
}

.pill-btn:hover {
  color: #334155;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}

.pill-btn:active {
  transform: scale(0.95);
}

.pill-btn:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

.pill-btn .el-icon,
.pill-btn svg,
.pill-btn__svg {
  width: 18px;
  height: 18px;
}

.pill-btn__svg {
  display: flex;
  align-items: center;
  justify-content: center;
}

.header h3 {
  display: flex;
  align-items: center;
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.logo {
  margin-right: 8px;
  font-size: 20px;
  color: var(--aph-primary);
}

.current-url {
  display: flex;
  gap: 6px;
  align-items: center;
  overflow: hidden;
  font-size: 12px;
  color: #6b7280;
  white-space: nowrap;
}

.current-url :deep(.el-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 本站匹配数：域名的派生指标，弱化灰色随域名同行展示；数字为关键信号，主题色加粗高亮提升扫读性 */
.match-count {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.match-count__num {
  padding: 0 1px;
  font-weight: 600;
  color: var(--aph-primary-strong);
}

/* 端口芯片：与匹配数同处域名行（信息就近），等宽数字让 `:8443` 不随宽度跳动 */
.port-pill,
.env-pill {
  display: inline-flex;
  flex-shrink: 0;
  gap: 3px;
  align-items: center;
  padding: 1px 7px;
  font-family: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  color: var(--aph-text-muted);
  cursor: pointer;
  background: var(--aph-surface-2);
  border: 1px solid var(--aph-surface-line);
  border-radius: 999px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.port-pill:hover,
.env-pill:hover {
  background: var(--aph-surface-hover);
}

.port-pill:active,
.env-pill:active {
  transform: scale(0.96);
}

.port-pill:focus-visible,
.env-pill:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

/* 放宽态用主题色实心：芯片此刻表达的是「正在多显示」，需要比缺省的灰描边更醒目 */
.port-pill--relaxed {
  color: var(--aph-primary-strong-on-tint);
  background: var(--aph-primary-bg);
  border-color: var(--aph-primary-border);
}

.port-pill__state {
  font-size: 10px;
}

/* 绑定态与「已放宽」同构：此刻芯片表达的是「正在多显示另一个环境的账号」，需要比灰描边更醒目 */
.env-pill--active {
  color: var(--aph-primary-strong-on-tint);
  background: var(--aph-primary-bg);
  border-color: var(--aph-primary-border);
}

/* 线上/无法识别的环境用警示色：文字已写着 prod，颜色只是加强，不单独承担语义 */
.env-pill--danger {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger-light-7);
}

/* 0 匹配添加邀请：空屏即方向，点击打开快速添加弹窗 */
.add-site {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  align-items: center;
  padding: 0;
  font-size: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  transition: color 0.2s;
}

.add-site:hover {
  color: var(--aph-primary-strong);
}

.add-site:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
  border-radius: 3px;
}

.add-site__action {
  font-weight: 600;
  color: var(--aph-primary-strong);
}

/* 常驻快速添加入口（有匹配时）：匹配数旁的主题色描边小圆钮，
   hover 填充的交互语言与 .add-site 及内联下拉空态按钮一致 */
.add-site-plus {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--aph-primary-strong);
  cursor: pointer;
  background: transparent;
  border: 1px solid rgb(var(--aph-primary-rgb) / 45%);
  border-radius: 50%;
  transition:
    color var(--aph-duration-mid) ease,
    background-color var(--aph-duration-mid) ease,
    border-color var(--aph-duration-mid) ease,
    transform var(--aph-duration-mid) ease,
    outline var(--aph-duration-mid) ease;
}

.add-site-plus:hover {
  color: #fff;
  background: var(--aph-primary);
  border-color: var(--aph-primary);
}

.add-site-plus:active {
  transform: scale(0.9);
}

.add-site-plus:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

.add-site-plus .el-icon {
  width: 11px;
  height: 11px;
}

/* 会话剩余时间胶囊：标题行右对齐仪表，中性灰底，紧迫态转警示橙，危急态转警示红；点击直达有效期设置续期 */
.session-pill {
  display: inline-flex;
  flex-shrink: 0;
  gap: 3px;
  align-items: center;
  padding: 1px 7px;
  margin-left: auto;
  font-family: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  color: #64748b;
  cursor: pointer;
  background: #f1f5f9;
  border: none;
  border-radius: 999px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.session-pill:hover {
  background: #e2e8f0;
}

.session-pill:active {
  transform: scale(0.96);
}

.session-pill:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
}

.session-pill .el-icon {
  font-size: 12px;
}

.session-pill--urgent {
  color: #fff;
  background: #e6a23c;
}

.session-pill--urgent:hover {
  background: #db9a37;
}

/* 危急态（≤1 分钟）：需写在紧迫态之后以覆盖背景色 */
.session-pill--critical {
  background: #f56c6c;
}

.session-pill--critical:hover {
  background: #f05959;
}
</style>
