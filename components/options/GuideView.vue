<template>
  <div class="guide-view">
    <header class="guide-bar">
      <el-button
        class="guide-bar__back"
        :icon="ArrowLeft"
        @click="emit('back')"
      >
        {{ t('options.guide.back') }}
      </el-button>
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
        class="guide-bar__online"
        :href="PRODUCT_DOCS_URL"
        target="_blank"
        rel="noopener noreferrer"
      >
        <el-icon class="guide-bar__online-icon"><Document /></el-icon>
        <span>{{ t('options.guide.online') }}</span>
      </a>
    </header>

    <div class="guide-layout">
      <nav
        class="guide-nav"
        :aria-label="t('options.guide.toc')"
      >
        <ul class="guide-nav__list">
          <li
            v-for="navItem in SECTIONS"
            :key="navItem.id"
          >
            <!-- 锚点交给浏览器原生跳转：写入 `#guide/<id>` 会触发 hashchange，
                 由父级回传 section 后统一滚动，前进 / 后退因此天然可用 -->
            <a
              class="guide-nav__link"
              :class="{ 'is-active': currentSection === navItem.id }"
              :href="`#guide/${navItem.id}`"
              >{{ t(navItem.labelKey) }}</a
            >
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
              <el-button
                link
                type="primary"
                class="guide-note__btn"
                @click="handleEditShortcuts"
              >
                {{ t('options.shortcuts.editAction') }}
              </el-button>
            </template>
          </p>
        </section>

        <!-- ====== 常见问题 ====== -->
        <section
          id="guide-sec-faq"
          class="guide-section"
        >
          <h2 class="guide-section__title">{{ t('help.faqTitle') }}</h2>

          <h3 class="guide-subtitle">
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

          <h3 class="guide-subtitle">
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

          <h3 class="guide-subtitle">
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

          <h3 class="guide-subtitle">
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

        <footer class="guide-footer">
          <a
            class="guide-footer__online"
            :href="PRODUCT_DOCS_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('options.guide.online') }}
          </a>
          <el-button @click="emit('back')">{{ t('options.guide.back') }}</el-button>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { ArrowLeft, Document } from '@element-plus/icons-vue';
import RichText from '@/components/RichText.vue';
import HelpGroupIcon from '@/components/HelpGroupIcon.vue';
import ShortcutKeyCap from '@/components/ShortcutKeyCap.vue';
import { useShortcuts, type ShortcutEntry } from '@/composables/useShortcuts';
import { SHORTCUT_LABEL_KEYS } from '@/utils/shortcutCommands';
import { scrollBehavior } from '@/utils/a11y';
import { isFirefox } from '@/utils/env';
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

/** 章节清单：id 出现在 URL 锚点里，只增不改；顺序即正文滚动顺序，导航跟随同一顺序 */
const SECTIONS = [
  { id: 'product', labelKey: 'options.guide.sectionProduct' },
  { id: 'gs', labelKey: 'help.groupSecurity' },
  { id: 'gb', labelKey: 'help.groupBasic' },
  { id: 'gd', labelKey: 'help.groupData' },
  { id: 'gc', labelKey: 'help.groupConfig' },
  { id: 'shortcut', labelKey: 'help.shortcutTitle' },
  { id: 'faq', labelKey: 'help.faqTitle' },
] as const;

/** 产品说明要点（`<b>标题</b> 正文`，与 FAQ 同一套写法） */
const PRODUCT_POINT_KEYS = [
  'options.guide.pointLocal',
  'options.guide.pointFill',
  'options.guide.pointAudit',
  'options.guide.pointBackup',
] as const;

/** 导航高亮所在章节：未锚定时落在第一章，与刚进入时的视口一致 */
const currentSection = computed(() => props.section ?? SECTIONS[0].id);

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

/** 把章节滚到视口顶部（`scroll-margin-top` 负责让开吸顶栏） */
const scrollToSection = (id: string): void => {
  document.getElementById(`guide-sec-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
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
    if (id) void nextTick(() => scrollToSection(id));
  },
);

/** Esc 退出文档页，与新手引导的退出键一致 */
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
  const initial = props.section;
  if (initial) void nextTick(() => scrollToSection(initial));
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
/* 独立滚动层：`.options-page` 的 `overflow: hidden` 会让吸顶失效，故滚动容器交给本页自己 */
.guide-view {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow-y: auto;
  background: var(--aph-surface-2);
}

.guide-bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 24px;
  background: var(--aph-surface-2);
  border-bottom: 1px solid var(--aph-border-light);
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
  color: var(--aph-text-muted);
  text-decoration: none;
  transition: color 0.2s;
}

.guide-bar__version:hover {
  color: var(--aph-primary);
  text-decoration: underline;
}

.guide-bar__online {
  display: inline-flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  color: var(--aph-primary);
  text-decoration: none;
}

.guide-bar__online:hover {
  text-decoration: underline;
}

.guide-bar__online-icon {
  font-size: 15px;
}

.guide-layout {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  max-width: 1080px;
  padding: 20px 24px 56px;
  margin: 0 auto;
}

.guide-nav {
  position: sticky;
  top: 68px;
  flex: 0 0 150px;
}

.guide-nav__list {
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

.guide-nav__link:hover {
  color: var(--aph-primary);
  background: var(--aph-bg-hover);
}

.guide-nav__link.is-active {
  font-weight: 600;
  color: var(--aph-primary);
  background: var(--aph-bg-hover);
  border-left-color: var(--aph-primary);
}

.guide-body {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.75;
  color: #374151;
}

.guide-section {
  scroll-margin-top: 68px;
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
  font-size: 15px;
  font-weight: 600;
  color: var(--aph-text-primary);
}

.guide-subtitle {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 18px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
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

.guide-shortcut-warn {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--aph-text-muted);
}

.guide-note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--aph-text-secondary);
}

/* link 型「修改快捷键」按钮：抵消 options 全局 .el-button--primary 的实心背景/边框，
   否则主色文字压在同色背景上不可见（对标 SiteRulesDialog / PasswordHealthDialog）。
   用 `:deep()` 而非直接给 `.guide-note__btn` 补声明：编译后是 (0,3,0)，压得住全局那条
   (0,2,0)，不依赖本组件异步 CSS 与 options.css 的先后顺序 */
:deep(.el-button--primary.is-link),
:deep(.el-button--primary.is-link:hover) {
  background-color: transparent;
  border-color: transparent;
}

/* el-button link 默认带高度与内边距，此处归零以随行文本基线排版 */
.guide-note__btn {
  height: auto;
  padding: 0;
  font-size: 12px;
  vertical-align: baseline;
}

.guide-footer {
  display: flex;
  gap: 16px;
  align-items: center;
  padding-top: 18px;
  margin-top: 32px;
  border-top: 1px solid var(--aph-border-light);
}

.guide-footer__online {
  color: var(--aph-primary);
  text-decoration: none;
}

.guide-footer__online:hover {
  text-decoration: underline;
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
}

@media (prefers-reduced-motion: reduce) {
  .guide-bar__version,
  .guide-nav__link {
    transition: none;
  }
}
</style>

<style>
/* RichText 动态创建的 code 元素不带本组件的 scoped 标识，胶囊样式只能由宿主按后代选择器给；
   与侧边栏帮助弹窗同一套配色，选择器前缀收在 .guide-view 内不外溢 */
.guide-view code {
  padding: 1px 6px;
  font-size: 12px;
  color: #d6336c;
  background: #f3f4f6;
  border-radius: 3px;
}
</style>
