<template>
  <Teleport to="body">
    <div
      v-if="isActive"
      class="tour"
      :class="{ 'tour--centered': placement.side === 'center' }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descId"
    >
      <!-- 拦截层：吃掉幕布区域的点击，避免用户在引导里误触背后的真实按钮 -->
      <div class="tour__block"></div>

      <!-- 无锚点步（欢迎）用整屏薄纱；有锚点时幕布由聚光框的巨型外扩阴影生成 -->
      <div
        v-if="placement.side === 'center'"
        class="tour__veil"
        aria-hidden="true"
      ></div>
      <div
        v-else
        class="tour__spot"
        :style="spotStyle"
        aria-hidden="true"
      >
        <span class="tour__spot-glow"></span>
      </div>

      <div
        :ref="bindCard"
        class="tour__card"
        :class="`tour__card--${placement.side}`"
        :style="cardStyle"
        tabindex="-1"
      >
        <span
          class="tour__rail"
          aria-hidden="true"
        ></span>
        <span
          class="tour__dial"
          aria-hidden="true"
        ></span>

        <div class="tour__head">
          <p class="tour__counter">
            <span class="tour__counter-current">{{ counterCurrent }}</span>
            <span class="tour__counter-total">/ {{ counterTotal }}</span>
          </p>
          <p class="tour__kicker">{{ t('onboarding.kicker') }}</p>
        </div>

        <div
          class="tour__progress"
          aria-hidden="true"
        >
          <span
            class="tour__progress-fill"
            :style="{ width: `${progress}%` }"
          ></span>
        </div>

        <!-- key 绑步骤 id：换步时这三块重新挂载，入场动效才会重演一次 -->
        <div
          :key="currentStep?.id"
          class="tour__body"
        >
          <h3
            :id="titleId"
            class="tour__title"
          >
            {{ stepTitle }}
          </h3>
          <p
            :id="descId"
            class="tour__desc"
          >
            {{ stepDesc }}
          </p>
          <p
            v-if="stepTip"
            class="tour__tip"
          >
            {{ stepTip }}
          </p>

          <!-- 「打开侧边栏」这一步独有的卡内动作：侧边栏不在本页 DOM 里，聚光灯圈不到，
               这一步只能由按钮自己把东西开出来；失败后原位换成快捷键提示 -->
          <div
            v-if="isSidepanelStep"
            class="tour__action"
          >
            <button
              v-if="!sidepanelFallback"
              type="button"
              class="tour__btn tour__btn--primary tour__action-btn"
              @click="openSidePanel()"
            >
              <span
                class="tour__btn-sweep"
                aria-hidden="true"
              ></span>
              <span class="tour__btn-text">{{ t('onboarding.sidepanel.action') }}</span>
            </button>
            <p
              v-else
              class="tour__action-fallback"
              role="status"
            >
              {{ shortcutHint }}
            </p>
          </div>
        </div>

        <!-- 进度点与键盘提示同处一行：两者都是「关于这一步的位置」，
             挤在按钮行里会让三枚按钮在 340px 卡宽下被迫折字 -->
        <div class="tour__meta">
          <ol class="tour__dots">
            <li
              v-for="(step, index) in steps"
              :key="step.id"
            >
              <button
                type="button"
                class="tour__dot"
                :class="{ 'tour__dot--current': index === stepIndex }"
                :aria-label="dotLabel(index)"
                :aria-current="index === stepIndex ? 'step' : undefined"
                @click="tour.goToStep(index)"
              ></button>
            </li>
          </ol>
          <p class="tour__hint">{{ t('onboarding.keyboardHint') }}</p>
        </div>

        <!-- 末步给一条「看完去哪查」的退路：页内指引离线可读，在线说明随版本更新 -->
        <p
          v-if="isLast"
          class="tour__docs"
        >
          {{ t('onboarding.docsLead') }}
          <a
            class="tour__docs-link"
            href="#guide"
            >{{ t('onboarding.docsGuide') }}</a
          ><span class="tour__docs-sep">·</span
          ><a
            class="tour__docs-link"
            :href="PRODUCT_DOCS_URL"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t('onboarding.docsOnline') }}</a
          >
        </p>

        <div class="tour__foot">
          <button
            type="button"
            class="tour__btn tour__btn--ghost"
            @click="tour.skip()"
          >
            {{ t('onboarding.skip') }}
          </button>
          <button
            v-if="!isFirst"
            type="button"
            class="tour__btn tour__btn--ghost"
            @click="tour.prev()"
          >
            {{ t('onboarding.prev') }}
          </button>
          <button
            type="button"
            class="tour__btn tour__btn--primary"
            @click="isLast ? tour.finish() : tour.next()"
          >
            <span
              class="tour__btn-sweep"
              aria-hidden="true"
            ></span>
            <span class="tour__btn-text">{{ isLast ? t('onboarding.finish') : t('onboarding.next') }}</span>
          </button>
        </div>
      </div>

      <p
        class="tour__live"
        aria-live="polite"
      >
        {{ announcement }}
      </p>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { OnboardingTourApi } from '@/composables/useOnboardingTour';
import { useFocusTrap } from '@/composables/useFocusTrap';
import { useShortcuts } from '@/composables/useShortcuts';
import { useI18n } from '@/utils/i18n';
import { PRODUCT_DOCS_URL } from '@/utils/urls';
import { SIDEPANEL_STEP_ID, tourKey } from '@/utils/onboardingTour';

/**
 * 聚光式新手引导（Vault Spotlight）
 *
 * 深色幕布上挖出一个跟随锚点的聚光框，卡片贴着框说话。整体只在引导期间存在，
 * 关闭后 Options 页面回到日常浅色界面，因此可以做得比日常 UI 更戏剧化。
 *
 * 本组件是纯展示层：状态与几何全部来自 `props.tour`（由 Options 根组件持有的
 * `useOnboardingTour`），它自己既不查 DOM 也不写存储，好处是卸载即干净。
 */

const props = defineProps<{
  /** 引导状态机（由调用方持有，保证状态所有权单一） */
  tour: OnboardingTourApi;
}>();

const { t } = useI18n();

const {
  isActive,
  steps,
  spot,
  placement,
  progress,
  isFirst,
  isLast,
  total,
  stepIndex,
  currentStep,
  sidepanelFallback,
  openSidePanel,
} = props.tour;

/** 卡片根节点，供焦点陷阱与测试定位 */
const cardEl = ref<HTMLElement | null>(null);

/**
 * 模板引用回调：把卡片节点交回 composable
 *
 * composable 需要它来测高度（方位翻转的判据依赖卡片实际高度），而 `ref="名字"`
 * 只能绑到本组件的局部 ref，因此这里显式转发一次——走 composable 暴露的
 * `setCard()` 而不是直接写它的 ref，跨边界的状态变更收成一处可调用的入口。
 */
function bindCard(element: Element | null): void {
  const node = element instanceof HTMLElement ? element : null;
  cardEl.value = node;
  props.tour.setCard(node);
}

// 模态语义必须由焦点陷阱兜底：Tab 圈在卡片内，关闭后焦点还给唤起方
useFocusTrap(cardEl, isActive);

/** 标题 / 描述的元素 id，供 aria-labelledby 与 aria-describedby 引用 */
const uid = useId();
const titleId = computed(() => `${uid}-title`);
const descId = computed(() => `${uid}-desc`);

/** 当前步骤的标题、描述与可选提示（键名由步骤 id 推导，见 utils/onboardingTour） */
const stepTitle = computed(() => (currentStep.value ? t(tourKey(currentStep.value.id, 'title')) : ''));
const stepDesc = computed(() => (currentStep.value ? t(tourKey(currentStep.value.id, 'desc')) : ''));
const stepTip = computed(() => (currentStep.value?.hasTip ? t(tourKey(currentStep.value.id, 'tip')) : ''));

/** 当前是否走到「打开侧边栏」那一步（无锚点，动作只能长在卡里） */
const isSidepanelStep = computed(() => currentStep.value?.id === SIDEPANEL_STEP_ID);

/**
 * 打开失败后的快捷键兜底文案
 *
 * 按键复用 `useShortcuts`：它已把「真实绑定优先、未绑定回退为按平台择一的 manifest
 * 建议值」这套口径收在一处，这里不再抄一份查表与格式化。加载在本组件 setup 里发起一次
 * 即可——组件经 `defineAsyncComponent` + `v-if` 只在引导播放期间存在，不像 HelpDialog
 * 那样身处侧边栏首屏关键路径，`chrome.commands.getAll()` 放在这里不违反秒开约束。
 */
const { shortcuts, loadShortcuts } = useShortcuts();
void loadShortcuts();
const shortcutHint = computed(() =>
  t('onboarding.sidepanel.shortcutHint', { shortcut: shortcuts.value.toggle_sidepanel }),
);

/**
 * 失败换文案时把焦点收回卡片
 *
 * 按钮被 `v-if` 卸载后焦点会掉回 `body`，而焦点陷阱的 Tab 监听挂在卡片容器上，
 * `body` 上的按键不会冒泡进容器——模态语义当场失效。卡片根节点本身带 `tabindex="-1"`，
 * 收回来既保住陷阱，也让键盘用户停在还能继续按 Tab 的地方。
 */
watch(sidepanelFallback, fallback => {
  if (fallback) cardEl.value?.focus({ preventScroll: true });
});

/** 两位数步序，避免「1 / 7」这种单薄读数 */
const counterCurrent = computed(() => String(stepIndex.value + 1).padStart(2, '0'));
const counterTotal = computed(() => String(total.value).padStart(2, '0'));

/** 聚光框定位：外扩矩形与圆角由 composable 算好，这里只做样式映射 */
const spotStyle = computed(() => {
  if (!spot.value) return {};
  return {
    top: `${spot.value.top}px`,
    left: `${spot.value.left}px`,
    width: `${spot.value.width}px`,
    height: `${spot.value.height}px`,
    borderRadius: `${spot.value.radius}px`,
  };
});

/** 卡片定位：`center` 交给 CSS 居中，其余方位用 composable 求解出的坐标 */
const cardStyle = computed(() => {
  if (placement.value.side === 'center') return {};
  return { top: `${placement.value.top}px`, left: `${placement.value.left}px` };
});

/** 读屏播报：与视觉一致地报出「第几步 / 共几步 + 标题」 */
const announcement = computed(() =>
  t('onboarding.progressAria', { current: stepIndex.value + 1, total: total.value, title: stepTitle.value }),
);

/**
 * 进度点的可访问名
 *
 * 当前点只报序号（它已经显式标为 `aria-current="step"`），其余点带标题，
 * 让读屏用户能在不依赖颜色的情况下知道每个点跳到哪一步。
 */
function dotLabel(index: number): string {
  if (index === stepIndex.value) return t('onboarding.dotCurrent', { index: index + 1 });
  const step = steps.value[index];
  return t('onboarding.dotJump', { index: index + 1, title: step ? t(tourKey(step.id, 'title')) : '' });
}
</script>

<style scoped>
/* ==================== 令牌 ====================
   口径：跟随主题的只有「强调」那一层（主色、描边、进度条、光环走 --aph-primary /
   --aph-primary-rgb），幕布、深色卡底与浅色文字是聚焦对比的功能必需，六套主题下都
   保持固定值——换肤换的是气质，不是把引导改成浅色。 */
.tour {
  /* 幕布底色：深墨蓝而非纯黑，保留一丝冷光，避免遮住浅色界面时显得「坏掉了」 */
  --tour-veil: rgb(9 13 26 / 82%);
  --tour-card-bg: linear-gradient(158deg, #182034 0%, #0b101f 54%, #0d1424 100%);
  --tour-ink: #f2f5fb;
  --tour-ink-soft: rgb(226 232 240 / 76%);
  --tour-ink-faint: rgb(203 213 225 / 68%);

  /* 卡片描边：主题色的极淡一层，让深色卡在当前主题下收口而不是浮着一圈中性灰边 */
  --tour-line: rgb(var(--aph-primary-rgb) / 22%);

  /* 强调色：任何主题 pastel 提到这个亮度都能在深底上过 WCAG 对比度 */
  --tour-accent: color-mix(in srgb, var(--aph-primary) 62%, #fff);
  --tour-ease: cubic-bezier(0.22, 1, 0.36, 1);

  position: fixed;
  inset: 0;

  /* 高于命令面板（3000）与 EP 弹层（2000+），保证引导始终在最前 */
  z-index: 3200;
  font-variant-numeric: tabular-nums;
}

.tour__block {
  position: absolute;
  inset: 0;
}

.tour__veil {
  position: absolute;
  inset: 0;
  background: var(--tour-veil);
}

/* ==================== 聚光框 ====================
   9999px 的实阴影同时充当幕布，所以「挖洞」与「压暗」是一件事，
   两层不会因过渡时长不同而出现边缘错位 */
.tour__spot {
  position: fixed;
  pointer-events: none;
  box-shadow: 0 0 0 9999px var(--tour-veil);
  transition:
    top 0.5s var(--tour-ease),
    left 0.5s var(--tour-ease),
    width 0.5s var(--tour-ease),
    height 0.5s var(--tour-ease),
    border-radius 0.5s var(--tour-ease);
}

.tour__spot-glow {
  position: absolute;
  inset: -2px;
  border: 1px solid rgb(var(--aph-primary-rgb) / 78%);
  border-radius: inherit;
  box-shadow:
    0 0 0 5px rgb(var(--aph-primary-rgb) / 14%),
    0 0 38px 6px rgb(var(--aph-primary-rgb) / 30%);
  animation: tour-breathe 3.2s ease-in-out infinite;
}

@keyframes tour-breathe {
  0%,
  100% {
    opacity: 0.72;
  }

  50% {
    opacity: 1;
  }
}

/* ==================== 卡片 ==================== */
.tour__card {
  position: fixed;
  box-sizing: border-box;
  width: 340px;
  padding: 18px 20px 16px;
  overflow: hidden;
  outline: none;
  background: var(--tour-card-bg);
  border: 1px solid var(--tour-line);
  border-radius: 16px;
  box-shadow:
    0 28px 70px -22px rgb(2 6 18 / 78%),
    0 10px 26px -14px rgb(2 6 18 / 60%),
    inset 0 1px 0 rgb(255 255 255 / 7%);
  transition:
    top 0.42s var(--tour-ease),
    left 0.42s var(--tour-ease);
  animation: tour-card-in 0.5s var(--tour-ease) both;
}

.tour__card--center {
  top: 50%;
  left: 50%;
  width: 380px;
  transform: translate(-50%, -50%);

  /* 居中态自带位移，入场关键帧必须把这段位移算进去，否则首帧会斜着飞进来 */
  animation-name: tour-card-in-center;
}

@keyframes tour-card-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.985);
  }
}

@keyframes tour-card-in-center {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 14px)) scale(0.985);
  }
}

/* 左侧强调轨：主题色由上而下淡出，把卡片「钉」在当前主题上 */
.tour__rail {
  position: absolute;
  top: 16px;
  bottom: 16px;
  left: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--tour-accent) 0%, rgb(var(--aph-primary-rgb) / 12%) 100%);
  border-radius: 0 3px 3px 0;
}

/* 保险柜转盘意象：同心细环只在居中欢迎步显形，日常步骤不抢文案 */
.tour__dial {
  position: absolute;
  top: -46px;
  right: -46px;
  width: 150px;
  height: 150px;
  background: repeating-radial-gradient(circle at 50% 50%, rgb(255 255 255 / 9%) 0 1px, transparent 1px 8px);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.6s var(--tour-ease);
}

.tour--centered .tour__dial {
  opacity: 1;
}

/* ==================== 头部读数 ==================== */
.tour__head {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
}

.tour__counter {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin: 0;
}

.tour__counter-current {
  font-family: Georgia, 'Times New Roman', 'Songti SC', serif;
  font-size: 26px;
  font-weight: 500;
  line-height: 1;
  color: var(--tour-ink);
}

.tour__counter-total {
  font-family: Georgia, 'Times New Roman', 'Songti SC', serif;
  font-size: 12px;
  color: var(--tour-ink-faint);
}

.tour__kicker {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--tour-accent);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

/* 进度轨：2px，填充段随步骤推进生长（轨道与填充同属「进度条」，一起跟随主题） */
.tour__progress {
  --tour-delay: 0.04s;

  height: 2px;
  margin: 12px 0 14px;
  overflow: hidden;
  background: rgb(var(--aph-primary-rgb) / 16%);
  border-radius: 999px;
}

.tour__progress-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgb(var(--aph-primary-rgb) / 45%) 0%, var(--tour-accent) 100%);
  border-radius: 999px;
  transition: width 0.5s var(--tour-ease);
}

/* ==================== 文案 ==================== */
.tour__title {
  --tour-delay: 0.08s;

  margin: 0 0 8px;
  font-family: Georgia, 'Times New Roman', 'Songti SC', serif;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.34;
  color: var(--tour-ink);
  letter-spacing: 0.01em;
}

.tour__desc {
  --tour-delay: 0.12s;

  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--tour-ink-soft);
}

.tour__tip {
  --tour-delay: 0.16s;

  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--tour-accent);
}

/* ==================== 卡内动作（仅「打开侧边栏」步） ====================
   这一步聚光灯圈不到东西——侧边栏不在本页 DOM 里，于是「讲它」换成「演一次」：
   整宽按钮比挤进底部那三枚里更能说明「点它真的会开一个东西」 */
.tour__action {
  --tour-delay: 0.18s;

  margin-top: 14px;
}

.tour__action-btn {
  box-sizing: border-box;
  width: 100%;
}

/* 兜底态：打开失败后原位换成快捷键提示。`.tour__action` 的入场动画此时早已跑完，
   文案替换不再叠一次位移，免得用户视线被第二次跳动带走 */
.tour__action-fallback {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--tour-accent);
}

/* ==================== 进度点 + 键盘提示 ====================
   这一行只负责「我在哪儿」，按钮行只负责「我往哪儿走」；
   两件事挤在同一行时，340px 卡宽下三枚按钮会被压到折字 */
.tour__meta {
  --tour-delay: 0.2s;

  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.tour__dots {
  display: flex;
  flex: none;
  gap: 7px;
  align-items: center;
  padding: 0;
  margin: 0;
  list-style: none;
}

.tour__dot {
  width: 7px;
  height: 7px;
  padding: 0;
  cursor: pointer;
  background: rgb(var(--aph-primary-rgb) / 34%);
  border: none;
  border-radius: 50%;
  transition:
    background-color 0.25s ease,
    transform 0.25s var(--tour-ease);
}

.tour__dot:hover {
  background: rgb(var(--aph-primary-rgb) / 64%);
  transform: scale(1.25);
}

.tour__dot--current {
  background: var(--tour-accent);
  transform: scale(1.35);
}

.tour__dot:focus-visible {
  outline: 2px solid var(--tour-accent);
  outline-offset: 2px;
}

/* ==================== 底部动作 ====================
   `flex-wrap` 是给极端语言包留的保险：宁可整枚按钮换到第二行，
   也不能让按钮内部折字（下面的 nowrap 已禁掉内部折行），更不能被
   卡片的 `overflow: hidden` 裁掉。 */
.tour__foot {
  --tour-delay: 0.24s;

  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 10px;
}

.tour__hint {
  min-width: 0;
  margin: 0;
  font-size: 11px;
  color: var(--tour-ink-faint);
  text-align: right;
  letter-spacing: 0.04em;
}

/* 末步的文档退路：小字弱色，不与步骤正文抢注意力。
   左对齐与卡片里其余文字同侧——居中时折出来的第二行只剩几个字，看着像孤字 */
.tour__docs {
  --tour-delay: 0.2s;

  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--tour-ink-faint);
  text-align: left;
}

/* 中文按字折行会把「在线说 / 明」劈开，链接内部禁折，折点只落在链接之间 */
.tour__docs-link {
  color: var(--tour-accent);
  white-space: nowrap;
  text-decoration: none;
}

.tour__docs-link:hover {
  text-decoration: underline;
}

.tour__docs-sep {
  margin: 0 4px;
  color: var(--tour-ink-faint);
}

.tour__btn {
  position: relative;
  flex: none;
  padding: 8px 15px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
  border-radius: 8px;
  transition:
    color 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s var(--tour-ease);
}

.tour__btn--ghost {
  color: var(--tour-ink-faint);
  background: transparent;
  border: 1px solid transparent;
}

/* 次级按钮的悬浮面是「中性交互底色」，不承担强调语义，因此不跟随主题色 */
.tour__btn--ghost:hover {
  color: var(--tour-ink);
  background: rgb(148 163 184 / 12%);
}

.tour__btn--primary {
  overflow: hidden;
  font-weight: 600;
  color: #0b101f;
  background: var(--tour-accent);
  border: 1px solid var(--tour-accent);
}

.tour__btn--primary:hover {
  box-shadow: 0 6px 18px -6px rgb(var(--aph-primary-rgb) / 60%);
  transform: translateY(-1px);
}

.tour__btn--primary:active {
  transform: translateY(0);
}

.tour__btn:focus-visible {
  outline: 2px solid var(--tour-accent);
  outline-offset: 2px;
}

/* 主按钮掠光：hover 时一道斜向高光扫过，给「下一步」一点向前的推力 */
.tour__btn-sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -60%;
  width: 40%;
  background: linear-gradient(100deg, transparent 0%, rgb(255 255 255 / 55%) 50%, transparent 100%);
  opacity: 0;
  transform: translateX(-10px);
}

.tour__btn--primary:hover .tour__btn-sweep {
  animation: tour-sweep 0.7s var(--tour-ease);
}

@keyframes tour-sweep {
  from {
    opacity: 0.9;
    transform: translateX(-10px);
  }

  to {
    opacity: 0;
    transform: translateX(190px);
  }
}

.tour__btn-text {
  position: relative;
}

/* 读屏播报专用：视觉隐藏但可被辅助技术读到（clip 已废弃，用 clip-path 挖空） */
.tour__live {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  clip-path: inset(50%);
}

/* ==================== 入场错落 ====================
   一次编排好的分页入场比一堆零散微交互更有分量：
   读数 → 进度轨 → 标题 → 描述 → 提示 → 卡内动作 → 圆点 → 底部按钮，逐级约 40ms 递进。
   节奏由各自规则里声明的 `--tour-delay` 提供，这里只写一条共享简写——
   重复点名同一批选择器会被 stylelint 判成重复选择器，也没法一眼看出递进关系 */
.tour__head,
.tour__progress,
.tour__title,
.tour__desc,
.tour__tip,
.tour__action,
.tour__meta,
.tour__docs,
.tour__foot {
  animation: tour-rise 0.44s var(--tour-ease) var(--tour-delay, 0s) both;
}

@keyframes tour-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

/* ==================== 窄屏与低视口 ==================== */
@media (width <= 560px) {
  .tour__card,
  .tour__card--center {
    width: calc(100vw - 24px);
  }

  .tour__hint {
    display: none;
  }
}

/* ==================== 减弱动效 ==================== */
@media (prefers-reduced-motion: reduce) {
  .tour__card,
  .tour__head,
  .tour__progress,
  .tour__title,
  .tour__desc,
  .tour__tip,
  .tour__action,
  .tour__meta,
  .tour__docs,
  .tour__foot,
  .tour__spot-glow {
    animation: none;
  }

  .tour__spot,
  .tour__card,
  .tour__progress-fill,
  .tour__dial {
    transition: none;
  }

  .tour__btn--primary:hover,
  .tour__dot:hover,
  .tour__dot--current {
    transform: none;
  }

  .tour__btn--primary:hover .tour__btn-sweep {
    animation: none;
  }
}
</style>
