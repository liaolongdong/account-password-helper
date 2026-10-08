<template>
  <div
    ref="viewRef"
    class="guide-view"
  >
    <header
      ref="barRef"
      class="guide-bar"
    >
      <!-- 条带背景与下边框全宽，内容收进与正文同一根基准线的居中列，
           否则返回按钮贴视口左缘、下方导航却在 940px 列里，中间空出一条 gutter -->
      <div class="guide-bar__inner">
        <button
          type="button"
          class="guide-bar__back guide-pill"
          aria-keyshortcuts="Esc"
          @click="emit('back')"
        >
          <el-icon class="guide-bar__back-icon"><ArrowLeft /></el-icon>
          <span>{{ t('options.guide.back') }}</span>
        </button>
        <!-- Esc 早已能退出，但没有任何可见提示；键帽只作呈现，无障碍语义由按钮的 aria-keyshortcuts 承载 -->
        <kbd
          class="guide-bar__kbd"
          aria-hidden="true"
          >Esc</kbd
        >
        <h1 class="guide-bar__title">
          {{ t('options.header.guide') }}
          <a
            class="guide-bar__version"
            :href="GITHUB_RELEASES_PAGE_URL"
            target="_blank"
            rel="noopener noreferrer"
            :title="t('help.versionLinkTitle')"
            >{{ t('help.versionLabel', { version }) }}</a
          >
        </h1>
        <a
          class="guide-bar__online guide-pill"
          :href="PRODUCT_DOCS_URL"
          target="_blank"
          rel="noopener noreferrer"
        >
          <el-icon class="guide-bar__online-icon"><Document /></el-icon>
          <span>{{ t('options.guide.online') }}</span>
        </a>
      </div>
    </header>

    <div class="guide-layout">
      <nav
        class="guide-nav"
        :aria-label="t('options.guide.toc')"
      >
        <ul class="guide-nav__list">
          <li
            v-for="navItem in GUIDE_SECTIONS"
            :key="navItem.id"
          >
            <!-- 锚点交给浏览器原生跳转：写入 `#guide/<id>` 会触发 hashchange，
                 由父级回传 section 后统一滚动，前进 / 后退因此天然可用 -->
            <a
              class="guide-nav__link"
              :class="{ 'is-active': activeId === navItem.id }"
              :href="`#guide/${navItem.id}`"
              >{{ t(navItem.labelKey) }}</a
            >
            <ul
              v-if="navItem.children"
              class="guide-nav__sublist"
            >
              <li
                v-for="child in navItem.children"
                :key="child.id"
              >
                <a
                  class="guide-nav__link guide-nav__link--child"
                  :class="{ 'is-active': activeId === child.id }"
                  :href="`#guide/${child.id}`"
                  >{{ t(child.labelKey) }}</a
                >
              </li>
            </ul>
          </li>
        </ul>
      </nav>

      <main class="guide-body">
        <!-- ====== 产品说明 ====== -->
        <section
          id="guide-sec-product"
          class="guide-section"
        >
          <h2 class="guide-section__title">{{ t('options.guide.sectionProduct') }}</h2>
          <p class="guide-lead">{{ t('options.guide.productLead') }}</p>
          <ul class="guide-points">
            <li
              v-for="labelKey in PRODUCT_POINT_KEYS"
              :key="labelKey"
            >
              <RichText :source="t(labelKey)" />
            </li>
          </ul>
          <p class="guide-warn">
            <RichText :source="t('options.guide.pointWarn')" />
          </p>
        </section>

        <!-- ====== 操作指引：四组与侧边栏帮助弹窗同源同序 ====== -->
        <section
          id="guide-sec-gs"
          class="guide-section"
        >
          <h2 class="guide-section__title">
            <HelpGroupIcon kind="security" />
            {{ t('help.groupSecurity') }}
          </h2>
          <ol class="guide-list">
            <li
              v-for="(item, idx) in helpItems('help.gs', 11)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ol>
        </section>

        <section
          id="guide-sec-gb"
          class="guide-section"
        >
          <h2 class="guide-section__title">
            <HelpGroupIcon kind="basic" />
            {{ t('help.groupBasic') }}
          </h2>
          <ol class="guide-list">
            <li
              v-for="(item, idx) in helpItems('help.gb', 15)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ol>
        </section>

        <section
          id="guide-sec-gd"
          class="guide-section"
        >
          <h2 class="guide-section__title">
            <HelpGroupIcon kind="data" />
            {{ t('help.groupData') }}
          </h2>
          <ol class="guide-list">
            <li
              v-for="(item, idx) in helpItems('help.gd', 11)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ol>
        </section>

        <section
          id="guide-sec-gc"
          class="guide-section"
        >
          <h2 class="guide-section__title">
            <HelpGroupIcon kind="config" />
            {{ t('help.groupConfig') }}
          </h2>
          <ol class="guide-list">
            <li
              v-for="(item, idx) in helpItems('help.gc', 6)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ol>
        </section>

        <!-- ====== 快捷键 ====== -->
        <section
          id="guide-sec-shortcut"
          class="guide-section"
        >
          <h2 class="guide-section__title">{{ t('help.shortcutTitle') }}</h2>
          <ul class="guide-shortcut-list">
            <li
              v-for="entry in entries"
              :key="entry.id"
            >
              <div class="guide-shortcut-row">
                <span class="guide-shortcut-name">{{ t(SHORTCUT_LABEL_KEYS[entry.id]) }}</span>
                <ShortcutKeyCap
                  :text="entry.shortcut"
                  :muted="!entry.assigned"
                  :label="keycapLabel(entry)"
                />
              </div>
              <p
                v-if="!entry.assigned"
                class="guide-shortcut-warn"
              >
                {{ t('help.shortcutUnassigned') }}
              </p>
            </li>
          </ul>
          <p class="guide-note">
            <template v-if="isFirefox">{{ t('help.shortcutFirefoxHint') }}</template>
            <template v-else>
              {{ t('options.shortcuts.intro') }}
              <!-- 刻意不用 `link type="primary"`：Options 全局把实心主色背景压在 .el-button.is-link 之上，
                   抵消后仍是主色文字对 surface-2，六档主题下 2.37–3.04 均低于 WCAG AA 4.5:1。
                   与返回按钮同一套 ghost 形态，文字走中性主文本色，不动换肤体系主色即可达标 -->
              <button
                type="button"
                class="guide-note__btn guide-pill"
                @click="handleEditShortcuts"
              >
                {{ t('options.shortcuts.editAction') }}
              </button>
            </template>
          </p>
        </section>

        <!-- ====== 常见问题 ====== -->
        <section
          id="guide-sec-faq"
          class="guide-section"
        >
          <h2 class="guide-section__title">{{ t('help.faqTitle') }}</h2>

          <h3
            id="guide-sec-faq-s"
            class="guide-subtitle"
          >
            <HelpGroupIcon kind="security" />
            {{ t('help.groupSecurity') }}
          </h3>
          <ul class="guide-list faq">
            <li
              v-for="(item, idx) in helpItems('help.fs', 9)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ul>

          <h3
            id="guide-sec-faq-b"
            class="guide-subtitle"
          >
            <HelpGroupIcon kind="basic" />
            {{ t('help.groupBasic') }}
          </h3>
          <ul class="guide-list faq">
            <li
              v-for="(item, idx) in helpItems('help.fb', 9)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ul>

          <h3
            id="guide-sec-faq-d"
            class="guide-subtitle"
          >
            <HelpGroupIcon kind="data" />
            {{ t('help.groupData') }}
          </h3>
          <ul class="guide-list faq">
            <li
              v-for="(item, idx) in helpItems('help.fd', 7)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ul>

          <h3
            id="guide-sec-faq-c"
            class="guide-subtitle"
          >
            <HelpGroupIcon kind="config" />
            {{ t('help.groupConfig') }}
          </h3>
          <ul class="guide-list faq">
            <li
              v-for="(item, idx) in helpItems('help.fc', 13)"
              :key="idx"
            >
              <RichText :source="item" />
            </li>
          </ul>
        </section>

        <!-- 出口不再重复一份返回按钮：吸顶条常驻，滚到文末时它同样在视口里 -->
        <footer class="guide-footer">
          <a
            class="guide-footer__online"
            :href="PRODUCT_DOCS_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('options.guide.online') }}
          </a>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowLeft, Document } from '@element-plus/icons-vue';
import RichText from '@/components/RichText.vue';
import HelpGroupIcon from '@/components/HelpGroupIcon.vue';
import ShortcutKeyCap from '@/components/ShortcutKeyCap.vue';
import { useShortcuts, type ShortcutEntry } from '@/composables/useShortcuts';
import { SHORTCUT_LABEL_KEYS } from '@/utils/shortcutCommands';
import { scrollBehavior } from '@/utils/a11y';
import { isFirefox } from '@/utils/env';
import { GUIDE_ANCHORS, GUIDE_SECTIONS, guideFoldY, pickActiveId } from '@/utils/guideNav';
import { useI18n } from '@/utils/i18n';
import { GITHUB_RELEASES_PAGE_URL, PRODUCT_DOCS_URL } from '@/utils/urls';

/**
 * Options 页内「使用指引」文档中页
 *
 * 正文全部复用 `utils/i18n/locales/{locale}/help.json`（与侧边栏帮助弹窗同一份语言包），
 * 新增的只有「产品说明」一段，因此两处内容不会各说一套；条目按 `helpItems(prefix, N)`
 * 序号驱动，N 与语言包条数由 `tests/utils/i18nBundles.test.ts` 双向对齐守卫强制。
 *
 * 章节锚点走 `#guide/<sectionId>`：路由由父级（`entrypoints/options/App.vue`）持有，
 * 本组件只负责按传入的 `section` 定位，避免两处各写一份 hash 解析。
 */
const props = defineProps<{
  /** 当前锚定章节 id（来自 `#guide/<id>`）；为空表示刚进入、落在第一章 */
  section: string | null;
}>();

const emit = defineEmits<{
  /** 返回密码管理主视图 */
  back: [];
}>();

const { t } = useI18n();

/** 当前插件版本号，直接读取 manifest，零依赖 */
const version = chrome.runtime.getManifest().version;

/** 产品说明要点（`<b>标题</b> 正文`，与 FAQ 同一套写法） */
const PRODUCT_POINT_KEYS = [
  'options.guide.pointLocal',
  'options.guide.pointFill',
  'options.guide.pointAudit',
  'options.guide.pointBackup',
] as const;

/** 滚动容器与吸顶条：前者是 scroll 事件的宿主，后者的高度即折线基准 */
const viewRef = ref<HTMLElement>();
const barRef = ref<HTMLElement>();

/**
 * 导航高亮所在锚点：未锚定时落在第一章，与刚进入时的视口一致；
 * 之后交给滚动跟随校正——原先只读 `props.section`，往下滚高亮不动，目录等于失效
 */
const activeId = ref<string>(props.section ?? GUIDE_SECTIONS[0].id);

const { entries, loadShortcuts, openShortcutsPage } = useShortcuts();

/** 键帽的无障碍名：命令名 + 按键；未生效语义由列表内可见警示文本承载 */
const keycapLabel = (entry: ShortcutEntry): string => `${t(SHORTCUT_LABEL_KEYS[entry.id])} ${entry.shortcut}`;

/**
 * 按前缀批量取条目文案（key 形如 `${prefix}.1` ~ `${prefix}.${count}`）
 *
 * 与 `HelpDialog.vue` 同名同义：在模板渲染期调用，t() 内部读取 currentLocale
 * 使其随语言切换自动更新。
 * @param prefix 语言包 key 前缀
 * @param count 条目数量
 * @returns 条目文案数组（含内置 code/b 标记）
 */
const helpItems = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => t(`${prefix}.${i + 1}`));

/** 把章节滚到视口顶部（滚动容器的 `scroll-padding-top` 负责让开吸顶条） */
const scrollToSection = (id: string): void => {
  document.getElementById(`guide-sec-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
};

/** 程序化滚动的抑制窗口：平滑滚动途经中间章节时，不让跟随逻辑把高亮一路带走 */
const SCROLL_SUPPRESS_MS = 900;

/** 抑制窗口截止时刻（epoch 毫秒），0 表示未抑制 */
let suppressUntil = 0;

/** 待处理的 rAF 句柄 */
let spyFrame = 0;

/**
 * 按当前滚动位置校正高亮
 *
 * 折线由 `guideFoldY` 用吸顶条的**实测**高度算出，容差与落点口径见该函数注释。
 * 锚点按文档顺序收集，缺失（理论上不该发生，
 * 由 `tests/utils/guideNav.test.ts` 钉住）即跳过而不是中断整次取位。
 */
const updateActive = (): void => {
  const view = viewRef.value;
  const bar = barRef.value;
  if (!view || !bar || Date.now() < suppressUntil) return;
  const viewTop = view.getBoundingClientRect().top;
  const fold = guideFoldY(bar.getBoundingClientRect().height);
  const anchors: { id: string; top: number }[] = [];
  for (const anchor of GUIDE_ANCHORS) {
    const el = document.getElementById(`guide-sec-${anchor.id}`);
    if (el) anchors.push({ id: anchor.id, top: el.getBoundingClientRect().top - viewTop });
  }
  /* 滚到底这一档是兜底：末章内容比视口短时，它的锚点永远越不过折线，高亮会停在倒数第二节。
     2px 容差吸收分数级 DPI 下 `scrollTop + clientHeight` 与 `scrollHeight` 的舍入差 */
  const atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 2;
  const next = pickActiveId(anchors, fold, atBottom);
  if (next) activeId.value = next;
};

/** rAF 节流：一帧内多次 scroll 事件只量一次位置 */
const onScroll = (): void => {
  if (spyFrame) return;
  spyFrame = requestAnimationFrame(() => {
    spyFrame = 0;
    updateActive();
  });
};

/** 定位到某锚点：高亮立即置位，同时开抑制窗口，滚动落定后跟随逻辑再接管 */
const goToSection = (id: string): void => {
  activeId.value = id;
  suppressUntil = Date.now() + SCROLL_SUPPRESS_MS;
  void nextTick(() => scrollToSection(id));
};

/**
 * 锚点变化即定位
 *
 * 导航链接是原生 `<a href="#guide/...">`，跳转由浏览器完成、父级只回传新的 section，
 * 因此这里只跟随 props；父级尚未接管的首帧由 onMounted 那次定位兜底。
 */
watch(
  () => props.section,
  id => {
    if (id) goToSection(id);
  },
);

/** Esc 退出文档页，与新手引导的退出键一致；可见提示是吸顶条里的 Esc 键帽 */
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('back');
};

/** 跳转浏览器内置的快捷键管理页 */
const handleEditShortcuts = (): void => {
  void openShortcutsPage();
};

onMounted(() => {
  // 本组件自身是懒加载 chunk，挂载即可见，无需像 HelpDialog 那样推迟到打开时再读
  void loadShortcuts();
  window.addEventListener('keydown', onKeydown);
  viewRef.value?.addEventListener('scroll', onScroll, { passive: true });
  if (props.section) goToSection(props.section);
  else updateActive();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  viewRef.value?.removeEventListener('scroll', onScroll);
  if (spyFrame) cancelAnimationFrame(spyFrame);
});
</script>

<style scoped>
/* 独立滚动层：`.options-page` 的 `overflow: hidden` 会让吸顶失效，故滚动容器交给本页自己 */
.guide-view {
  /* 一条宽度基准 + 一条条带高度基准：导航的 sticky 偏移与滚动折线都由这两者派生，
     取代此前散在三处的 1080px / 68px 硬编码。
     条带高度取真机实测 55px（内边距 20 + 内容 34 + 下边框 1），不是估算值 */
  --guide-measure: 940px;
  --guide-bar-h: 55px;

  /* 点击导航后章节的落点 = 条高 + 本值；JS 侧滚动折线由 `GUIDE_FOLD_SLACK` 的同值配对，
     两处必须相等，否则「刚点到的这一节」和「高亮的那一节」不是同一节 */
  --guide-fold-slack: 12px;

  position: fixed;
  inset: 0;
  z-index: 100;
  overflow-y: auto;
  scroll-padding-top: calc(var(--guide-bar-h) + var(--guide-fold-slack));
  background: var(--aph-surface-2);
}

.guide-bar {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--aph-surface-2);
  border-bottom: 1px solid var(--aph-border-light);
}

/* 吸顶条与正文共用同一根基准线：同宽、同居中、同 24px 左内边距。
   此前条带内容全宽铺开而正文居中，返回按钮贴视口左缘、导航却在居中列里，
   1430px 窗口下两者左边缘差 175px，中间空出一条纯 gutter */
.guide-bar__inner,
.guide-layout {
  /* 真机读数：缺省 content-box 下 `width:100%` + 左右 24px 内边距 = 总宽恒比视口多 48px，
     800px 窗口实测 `.guide-layout` 宽 848（溢出 48px），而 `--guide-measure` 与正文列宽
     的算式也都是按边框盒写的。改成 border-box，让 940 就是那根 940 */
  box-sizing: border-box;
  width: 100%;
  max-width: var(--guide-measure);
  margin: 0 auto;
}

.guide-bar__inner {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 24px;
}

/* ghost 胶囊形态（返回 / 在线说明 / 修改快捷键三枚共用）：全部取主题令牌，六档换肤一起跟随
   （与 HeaderBar 的 .session-chip 同一取舍）。EP 默认白底细边按钮压在 surface-2 上几乎没有
   对比，而这三枚是这一页唯一的出口与动作。
   描边必须用 `--aph-text-secondary`：真机级联读数里 surface-line 对条带只有 1.10–1.13、
   surface 底色只有 1.07–1.11，等于「有盒子看不见边界」；换到 text-secondary 是 4.63–4.72，
   过 WCAG 1.4.11 对控件边界的 3:1 */
.guide-pill {
  color: var(--aph-text-primary);
  cursor: pointer;
  background: var(--aph-surface);
  border: 1px solid var(--aph-text-secondary);
  transition:
    background-color 0.2s,
    border-color 0.2s;
}

/* 悬浮只动底色与描边、不动文字：主色文字压在主色浅底上约 2.5:1，比静止态更差；
   改由图标吃主色（图标旁有文字标签，不承担唯一信息），文字始终保持主文本色。
   描边悬浮走主文本色而非 primary-border——后者对条带 1.12–1.19，悬浮反而把边界洗掉 */
.guide-pill:hover {
  background: var(--aph-primary-bg);
  border-color: var(--aph-text-primary);
}

.guide-pill:focus-visible {
  outline: 2px solid var(--aph-primary);
  outline-offset: 2px;
}

/* 条带左右两枚胶囊尺寸同一套，把两个出口对齐成一条线 */
.guide-bar__back,
.guide-bar__online {
  display: inline-flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  border-radius: 8px;
}

.guide-bar__back:hover .guide-bar__back-icon {
  color: var(--aph-primary);
}

.guide-bar__back-icon {
  font-size: 14px;
  transition: color 0.2s;
}

/* Esc 键帽：纯呈现，语义由按钮的 aria-keyshortcuts 承载，因此对读屏隐藏。
   文字用主文本色而非 muted——10px 的字对 surface-2 只有 2.5:1，撑不住 AA */
.guide-bar__kbd {
  padding: 1px 5px;
  font-family: inherit;
  font-size: 10px;
  line-height: 16px;
  color: var(--aph-text-primary);
  background: var(--aph-bg-hover);
  border: 1px solid var(--aph-surface-line);
  border-radius: 4px;
}

.guide-bar__title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--aph-text-primary);
}

.guide-bar__version {
  margin-left: 8px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--aph-text-secondary);
  text-decoration: none;
  transition: color 0.2s;
}

.guide-bar__version:hover {
  color: var(--aph-text-primary);
  text-decoration: underline;
}

/* 在线说明原先是 13px 主色文字压 surface-2，六档主题下 2.37–3.04，低于 AA 4.5:1；
   与返回按钮共用 .guide-pill 形态，尺寸已由上面那条联合选择器给，这里只补链接的下划线 */
.guide-bar__online {
  text-decoration: none;
}

.guide-bar__online:hover .guide-bar__online-icon {
  color: var(--aph-primary);
}

.guide-bar__online-icon {
  font-size: 15px;
  transition: color 0.2s;
}

.guide-layout {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  padding: 20px 24px 56px;
}

.guide-nav {
  position: sticky;
  top: calc(var(--guide-bar-h) + 16px);
  flex: 0 0 168px;
}

.guide-nav__list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.guide-nav__sublist {
  padding: 0;
  margin: 0;
  list-style: none;
}

.guide-nav__link {
  display: block;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--aph-text-secondary);
  text-decoration: none;
  border-left: 2px solid transparent;
  border-radius: 0 4px 4px 0;
  transition:
    color 0.2s,
    background-color 0.2s;
}

/* FAQ 的四个子组：正文里它们是同一套组名，靠缩进 + 更小的字号表达层级，不另拟文案 */
.guide-nav__link--child {
  padding: 3px 10px 3px 22px;
  font-size: 12px;
}

.guide-nav__link:hover {
  color: var(--aph-text-primary);
  background: var(--aph-bg-hover);
}

/* 点亮态不再用主色文字（13px 主色对 bg-hover 只有约 2.5:1），
   改由主色左边规 + 主色浅底 + 加粗的中性主文本表达，换肤色仍然看得见 */
.guide-nav__link.is-active {
  font-weight: 600;
  color: var(--aph-text-primary);
  background: var(--aph-primary-bg);
  border-left-color: var(--aph-primary);
}

/* 正文列 = 940 − 48(左右内边距) − 168(导航) − 28(间距) = 696px，14px 字号下约 49 个中文字一行
   （改造前是 854px / 13px ≈ 65 字）。再窄会切坏快捷键行与列表缩进，故止步于此 */
.guide-body {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--aph-text-primary);
}

.guide-section + .guide-section {
  padding-top: 20px;
  margin-top: 28px;
  border-top: 1px solid var(--aph-border-light);
}

.guide-section__title {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--aph-text-primary);
}

.guide-subtitle {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 18px 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--aph-text-primary);
}

.guide-lead {
  margin: 0 0 10px;
}

.guide-points,
.guide-list {
  padding-left: 20px;
  margin: 0;
}

.guide-points li,
.guide-list li {
  margin-bottom: 6px;
}

.guide-warn {
  padding: 10px 14px;
  margin: 12px 0 0;
  background: var(--aph-surface);
  border-left: 3px solid var(--aph-primary);
  border-radius: 6px;
}

/* 正文条目在宽屏下行宽更长，FAQ 组的行距略收紧以与控制项一致的字号读起来不松 */
.guide-list.faq li {
  margin-bottom: 8px;
}

.guide-shortcut-list {
  padding-left: 0;
  margin: 0;
  list-style: none;
}

.guide-shortcut-row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  max-width: 420px;
  padding: 4px 0;
}

.guide-shortcut-name {
  min-width: 0;
  color: var(--aph-text-primary);
}

/* 「未分配」是 12px 正文级文字，muted 对 surface-2 只有约 2.5:1；
   侧边栏 HelpDialog 的同名提示仍是 muted，属两处需一起裁决的存量项，本轮只把文档中页提上来 */
.guide-shortcut-warn {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--aph-text-secondary);
}

.guide-note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--aph-text-secondary);
}

/* 「修改快捷键」原先是 `link type="primary"`：抵消掉 Options 全局的实心主色背景后，
   仍是 12px 主色文字压 surface-2，六档主题 2.37–3.04，低于 AA 4.5:1（口径见
   docs/reports/GUIDE_ONBOARDING_VAULT_SORT_DESIGN.md §10.3）。改成与返回按钮同一套
   ghost 形态（.guide-pill）——文字走中性主文本色，因此不需要动换肤体系的主色。
   它嵌在正文行内，尺寸比条带那两枚小一圈，只覆盖 padding / 字号 / 圆角 */
.guide-note__btn {
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 6px;
}

.guide-footer {
  display: flex;
  gap: 16px;
  align-items: center;
  padding-top: 18px;
  margin-top: 32px;
  border-top: 1px solid var(--aph-border-light);
}

/* 文末出口链接不再用主色文字（12px 主色对 surface-2 六档 2.37–3.04，低于 AA），
   下划线承担「这是链接」的语义，因此不只靠颜色表达 */
.guide-footer__online {
  color: var(--aph-text-secondary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.guide-footer__online:hover {
  color: var(--aph-text-primary);
}

/* 章节导航在窄窗口退化为顶部横排，避免正文被压成窄条 */
@media (width <= 860px) {
  .guide-layout {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .guide-nav {
    position: static;
    flex: 0 0 auto;
  }

  .guide-nav__list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .guide-nav__link {
    border-left: 0;
    border-radius: 4px;
  }

  /* 子项的 22px 左缩进是给竖排用的：横排后只会变成一片空洞。层级改由更小的
     字号与自身的换行表达，FAQ 子话题在父项下方并排成一行 */
  .guide-nav__sublist {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .guide-nav__link--child {
    padding: 3px 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .guide-pill,
  .guide-bar__back-icon,
  .guide-bar__online-icon,
  .guide-bar__version,
  .guide-nav__link {
    transition: none;
  }
}
</style>

<style>
/* RichText 动态创建的 code 元素不带本组件的 scoped 标识，胶囊样式只能由宿主按后代选择器给；
   选择器前缀收在 .guide-view 内不外溢。
   色值从 #d6336c 提到 #c2255c（同色系更深一档）：12px 文字对胶囊底 #f3f4f6 原为 4.19，
   低于 AA 正文 4.5:1，改后 5.14。侧边栏 HelpDialog 的同名胶囊仍是 #d6336c，
   属两处需一起裁决的存量项，本轮只改文档中页 */
.guide-view code {
  padding: 1px 6px;
  font-size: 12px;
  color: #c2255c;
  background: #f3f4f6;
  border-radius: 3px;
}
</style>
