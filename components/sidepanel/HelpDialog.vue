<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('help.title')"
    width="90%"
    :append-to-body="true"
    class="help-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- 标题行：版本号与标题并排（「关于」模式），点击跳转 GitHub Releases 查看最新版本与下载；
         title prop 保留仅供对话框 aria-label 语义，视觉呈现由 #header 插槽接管 -->
    <template #header>
      <div class="help-header">
        <span
          class="help-header__title"
          role="heading"
          aria-level="2"
          >{{ t('help.title') }}</span
        >
        <a
          class="help-header__version"
          :href="GITHUB_RELEASES_PAGE_URL"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('help.versionLinkTitle')"
        >
          {{ t('help.versionLabel', { version }) }}
        </a>
      </div>
    </template>
    <div class="help-content">
      <!-- ====== 完整使用说明入口 ====== -->
      <section class="help-section help-link-section">
        <div class="help-link-banner">
          <el-icon class="help-link-icon"><Document /></el-icon>
          <span>{{ t('help.viewFull') }}</span>
          <a
            :href="PRODUCT_DOCS_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="help-link"
          >
            {{ t('help.userGuide') }}
          </a>
        </div>
      </section>

      <!-- ====== 快捷键 ====== -->
      <!-- 置于操作指引之前以保证可发现性；数据在弹窗打开时才加载，不侵入侧边栏首屏 -->
      <section class="help-section">
        <h4>{{ t('help.shortcutTitle') }}</h4>
        <ul class="help-shortcut-list">
          <li
            v-for="entry in entries"
            :key="entry.id"
          >
            <div class="help-shortcut-row">
              <span class="help-shortcut-name">{{ t(SHORTCUT_LABEL_KEYS[entry.id]) }}</span>
              <ShortcutKeyCap
                :text="entry.shortcut"
                :muted="!entry.assigned"
                :label="keycapLabel(entry)"
              />
            </div>
            <p
              v-if="!entry.assigned"
              class="help-shortcut-warn"
            >
              {{ t('help.shortcutUnassigned') }}
            </p>
          </li>
        </ul>
        <!-- Firefox 无 chrome://extensions/shortcuts 页面，改键入口降级为纯文案指引 -->
        <p class="help-shortcut-edit">
          <template v-if="isFirefox">{{ t('help.shortcutFirefoxHint') }}</template>
          <template v-else>
            {{ t('help.shortcutEditHint') }}
            <el-button
              link
              type="primary"
              class="help-shortcut-edit-btn"
              @click="handleEditShortcuts"
            >
              {{ t('help.shortcutEditAction') }}
            </el-button>
          </template>
        </p>
      </section>

      <!-- ====== 操作指引 ====== -->
      <section class="help-section">
        <h4>{{ t('help.guideTitle') }}</h4>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="security" />
          {{ t('help.groupSecurity') }}
        </h5>
        <ol>
          <!--
            帮助文案是语言包内置字符串，其中的 code/b 标记经 RichText 白名单渲染，
            其余任何尖括号写法按字面文本显示。本文件不再使用 v-html，因此也没有
            eslint 豁免（清单收缩登记见 `tests/architecture/lintBypassInventory.test.ts`）。
          -->
          <li
            v-for="(item, idx) in helpItems('help.gs', 11)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ol>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="basic" />
          {{ t('help.groupBasic') }}
        </h5>
        <ol>
          <li
            v-for="(item, idx) in helpItems('help.gb', 15)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ol>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="data" />
          {{ t('help.groupData') }}
        </h5>
        <ol>
          <li
            v-for="(item, idx) in helpItems('help.gd', 11)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ol>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="config" />
          {{ t('help.groupConfig') }}
        </h5>
        <ol>
          <li
            v-for="(item, idx) in helpItems('help.gc', 6)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ol>
      </section>

      <!-- ====== 常见问题 ====== -->
      <section class="help-section">
        <h4>{{ t('help.faqTitle') }}</h4>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="security" />
          {{ t('help.groupSecurity') }}
        </h5>
        <ul>
          <li
            v-for="(item, idx) in helpItems('help.fs', 9)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ul>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="basic" />
          {{ t('help.groupBasic') }}
        </h5>
        <ul>
          <li
            v-for="(item, idx) in helpItems('help.fb', 9)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ul>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="data" />
          {{ t('help.groupData') }}
        </h5>
        <ul>
          <li
            v-for="(item, idx) in helpItems('help.fd', 7)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ul>

        <h5 class="help-group-title">
          <HelpGroupIcon kind="config" />
          {{ t('help.groupConfig') }}
        </h5>
        <ul>
          <li
            v-for="(item, idx) in helpItems('help.fc', 13)"
            :key="idx"
          >
            <RichText :source="item" />
          </li>
        </ul>
      </section>
    </div>
    <!-- 页脚纯动作化：版本信息已上移至标题行 -->
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ t('common.close') }}</el-button>
      <el-button
        type="primary"
        @click="handleGoToOptions"
      >
        {{ t('help.goManage') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { Document } from '@element-plus/icons-vue';
import ShortcutKeyCap from '@/components/ShortcutKeyCap.vue';
import HelpGroupIcon from '@/components/HelpGroupIcon.vue';
import RichText from '@/components/RichText.vue';
import { useShortcuts, type ShortcutEntry } from '@/composables/useShortcuts';
import { SHORTCUT_LABEL_KEYS } from '@/utils/shortcutCommands';
import { isFirefox } from '@/utils/env';
import { useI18n } from '@/utils/i18n';
import { GITHUB_RELEASES_PAGE_URL, PRODUCT_DOCS_URL } from '@/utils/urls';
// help 命名空间语言包随本组件懒加载 chunk 按需注册，不占用侧边栏首屏体积
import '@/utils/i18n/bundles/help';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  goToOptions: [];
}>();

const { t } = useI18n();

/** 当前插件版本号，直接读取 manifest，零依赖 */
const version = chrome.runtime.getManifest().version;

/** 快捷键绑定状态（useShortcuts 随本组件懒加载 chunk 落地，不进入侧边栏首屏包） */
const { entries, loadShortcuts, openShortcutsPage } = useShortcuts();

/** 键帽的无障碍名：命令名 + 按键；未生效语义由列表内可见警示文本承载 */
const keycapLabel = (entry: ShortcutEntry): string => `${t(SHORTCUT_LABEL_KEYS[entry.id])} ${entry.shortcut}`;

/**
 * 仅在弹窗真正打开时才读取 chrome.commands.getAll()
 *
 * 本组件在侧边栏中是无条件渲染的 defineAsyncComponent，setup 会随侧边栏挂载执行，
 * 若把加载放在 onMounted 或 setup 顶层会把浏览器 API 调用推入首屏关键路径，
 * 违反侧边栏秒开约束。
 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) void loadShortcuts();
  },
);

/** 跳转浏览器内置的快捷键管理页 */
const handleEditShortcuts = (): void => {
  void openShortcutsPage();
};

/**
 * 按前缀批量取帮助条目文案（key 形如 `${prefix}.1` ~ `${prefix}.${count}`）
 *
 * 在模板渲染期调用，t() 内部读取 currentLocale 使其随语言切换自动更新。
 * @param prefix 语言包 key 前缀
 * @param count 条目数量
 * @returns 条目文案数组（含内置 code/b HTML 标记）
 */
const helpItems = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => t(`${prefix}.${i + 1}`));

const handleGoToOptions = () => {
  emit('update:modelValue', false);
  emit('goToOptions');
};
</script>

<style scoped>
.help-content {
  max-height: 800px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  color: #374151;
}

.help-section + .help-section {
  margin-top: 16px;
}

.help-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--aph-text-primary);
}

.help-section ol,
.help-section ul {
  padding-left: 20px;
  margin: 0;
}

.help-section li {
  margin-bottom: 6px;
}

.help-group-title {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 16px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  letter-spacing: 0.01em;
}
.help-group-title:first-child {
  margin-top: 4px;
}

.help-link-banner {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  font-size: 13px;
  color: #1e40af;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
}

.help-link-icon {
  font-size: 16px;
}

.help-link {
  font-weight: 500;
  color: #2563eb;
  text-decoration: none;
  transition: color 0.2s;
}

.help-link:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

/* 快捷键分组：命令名与键帽两端对齐，未生效项追加灰色警示文案 */
.help-shortcut-list {
  padding-left: 0;
  list-style: none;
}

.help-shortcut-row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.help-shortcut-name {
  min-width: 0;
  color: var(--aph-text-primary);
}

.help-shortcut-warn {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--aph-text-muted);
}

.help-shortcut-edit {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--aph-text-secondary);
}

/* el-button link 默认带高度与内边距，此处归零以随行文本基线排版 */
.help-shortcut-edit-btn {
  height: auto;
  padding: 0;
  font-size: 12px;
  vertical-align: baseline;
}

/* 标题行：版本号弱化链接随标题并排展示，点击跳转最新版本下载页 */
.help-header {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.help-header__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--aph-text-primary);
}

.help-header__version {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #9aa3af;
  text-decoration: none;
  transition: color 0.2s;
}

.help-header__version:hover {
  color: var(--aph-primary);
  text-decoration: underline;
}

.help-header__version:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 50%);
  outline-offset: 1px;
  border-radius: 3px;
}
</style>

<style>
.el-dialog.help-dialog {
  margin-top: 40px;
  margin-bottom: 40px;
}

/* RichText 动态创建的 code 元素不带本组件的 scoped 标识，胶囊样式只能由宿主按后代选择器给；
   选择器前缀收在 .help-dialog 内，不外溢到其他入口的同名标签 */
.el-dialog.help-dialog .help-section code {
  padding: 1px 6px;
  font-size: 12px;
  color: #d6336c;
  background: #f3f4f6;
  border-radius: 3px;
}

/* 弹性布局约束：让 body 作为唯一可滚动容器，header/footer 自然在滚动区之外保持固定 */
.el-dialog.help-dialog .el-dialog__body {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
  overflow: hidden;
}

.el-dialog.help-dialog .help-content {
  flex: 1 1 auto;
  max-height: 800px;
  overflow-y: auto;

  /* scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent; */
}

.el-dialog.help-dialog .help-content::-webkit-scrollbar {
  width: 3px;
}

.el-dialog.help-dialog .help-content::-webkit-scrollbar-thumb {
  background-color: #cbd5e1;
  border-radius: 3px;
}

.el-dialog.help-dialog .help-content::-webkit-scrollbar-thumb:hover {
  background-color: #94a3b8;
}
</style>
