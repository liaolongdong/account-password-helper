<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('help.title')"
    width="90%"
    :append-to-body="true"
    class="help-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="help-content">
      <!-- ====== 完整使用说明入口 ====== -->
      <section class="help-section help-link-section">
        <div class="help-link-banner">
          <el-icon class="help-link-icon"><Document /></el-icon>
          <span>{{ t('help.viewFull') }}</span>
          <a
            href="https://liaolongdong.github.io/account-password-helper/"
            target="_blank"
            rel="noopener noreferrer"
            class="help-link"
          >
            {{ t('help.userGuide') }}
          </a>
        </div>
      </section>

      <!-- ====== 操作指引 ====== -->
      <section class="help-section">
        <h4>{{ t('help.guideTitle') }}</h4>

        <h5 class="help-group-title">
          <span class="help-group-icon security">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
          {{ t('help.groupSecurity') }}
        </h5>
        <ol>
          <!-- 帮助文案为语言包内置静态内容，v-html 仅渲染内置 code/b 标记 -->
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.gs', 10)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ol>

        <h5 class="help-group-title">
          <span class="help-group-icon basic">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          {{ t('help.groupBasic') }}
        </h5>
        <ol>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.gb', 8)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ol>

        <h5 class="help-group-title">
          <span class="help-group-icon data">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <ellipse
                cx="12"
                cy="5"
                rx="9"
                ry="3"
              />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </span>
          {{ t('help.groupData') }}
        </h5>
        <ol>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.gd', 7)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ol>

        <h5 class="help-group-title">
          <span class="help-group-icon config">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle
                cx="12"
                cy="12"
                r="3"
              />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
          </span>
          {{ t('help.groupConfig') }}
        </h5>
        <ol>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.gc', 5)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ol>
      </section>

      <!-- ====== 常见问题 ====== -->
      <section class="help-section">
        <h4>{{ t('help.faqTitle') }}</h4>

        <h5 class="help-group-title">
          <span class="help-group-icon security">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
          {{ t('help.groupSecurity') }}
        </h5>
        <ul>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.fs', 9)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ul>

        <h5 class="help-group-title">
          <span class="help-group-icon basic">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          {{ t('help.groupBasic') }}
        </h5>
        <ul>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.fb', 9)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ul>

        <h5 class="help-group-title">
          <span class="help-group-icon data">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <ellipse
                cx="12"
                cy="5"
                rx="9"
                ry="3"
              />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </span>
          {{ t('help.groupData') }}
        </h5>
        <ul>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.fd', 6)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ul>

        <h5 class="help-group-title">
          <span class="help-group-icon config">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle
                cx="12"
                cy="12"
                r="3"
              />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              />
            </svg>
          </span>
          {{ t('help.groupConfig') }}
        </h5>
        <ul>
          <!-- eslint-disable vue/no-v-html -->
          <li
            v-for="(item, idx) in helpItems('help.fc', 12)"
            :key="idx"
            v-html="item"
          ></li>
          <!-- eslint-enable vue/no-v-html -->
        </ul>
      </section>
    </div>
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
import { Document } from '@element-plus/icons-vue';
import { useI18n } from '@/utils/i18n';
// help 命名空间语言包随本组件懒加载 chunk 按需注册，不占用侧边栏首屏体积
import '@/utils/i18n/bundles/help';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  goToOptions: [];
}>();

const { t } = useI18n();

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
  color: #1f2937;
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

.help-group-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
}
.help-group-icon.security {
  color: #059669;
  background: rgb(16 185 129 / 10%);
}
.help-group-icon.basic {
  color: #4e88ff;
  background: rgb(78 136 255 / 10%);
}
.help-group-icon.data {
  color: #7c3aed;
  background: rgb(139 92 246 / 10%);
}
.help-group-icon.config {
  color: #d97706;
  background: rgb(245 158 11 / 10%);
}

.help-section code {
  padding: 1px 6px;
  font-size: 12px;
  color: #d6336c;
  background: #f3f4f6;
  border-radius: 3px;
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
</style>

<style>
.el-dialog.help-dialog {
  margin-top: 40px;
  margin-bottom: 40px;
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
