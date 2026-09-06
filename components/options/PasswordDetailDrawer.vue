<template>
  <el-drawer
    :model-value="modelValue"
    :title="t('options.detail.title')"
    direction="rtl"
    size="440px"
    @update:model-value="$emit('update:modelValue', $event)"
    @closed="handleClosed"
  >
    <div
      v-if="entry"
      class="detail-body"
    >
      <!-- 头部：站点图标 + 用户名 + 收藏标识 -->
      <div class="detail-header">
        <SiteFavicon
          v-if="entry.url"
          :url="entry.url"
          :size="32"
          class="detail-header__favicon"
        >
          <el-icon class="detail-header__fallback"><Link /></el-icon>
        </SiteFavicon>
        <div class="detail-header__main">
          <div class="detail-header__title">
            <span class="detail-header__username">{{ entry.username }}</span>
            <el-tooltip
              v-if="entry.favorite"
              :content="t('common.favorite')"
              placement="top"
            >
              <el-icon
                class="detail-header__star"
                :aria-label="t('common.favorite')"
              >
                <StarFilled />
              </el-icon>
            </el-tooltip>
          </div>
          <span
            v-if="entry.url"
            class="detail-header__site"
          >
            {{ entry.url }}
          </span>
        </div>
      </div>

      <!-- 结构化字段（只读） -->
      <el-descriptions
        :column="1"
        border
        class="detail-descriptions"
      >
        <el-descriptions-item :label="t('common.username')">
          <div class="detail-value">
            <span class="detail-value__text">{{ entry.username }}</span>
            <el-button
              :icon="CopyDocument"
              :aria-label="t('common.copy')"
              link
              @click="copyText(entry.username)"
            />
          </div>
        </el-descriptions-item>

        <el-descriptions-item :label="t('common.password')">
          <div class="detail-value">
            <span class="detail-value__text detail-value__text--mono">
              {{ passwordVisible ? entry.password : '*'.repeat(8) }}
            </span>
            <!-- 动作语义：密文显示睁眼（点击显示），明文显示划线眼（点击隐藏） -->
            <el-button
              :icon="passwordVisible ? Hide : View"
              :aria-label="passwordVisible ? t('common.hidePassword') : t('common.showPassword')"
              link
              @click="passwordVisible = !passwordVisible"
            />
            <el-button
              :icon="CopyDocument"
              :aria-label="t('common.copy')"
              link
              @click="copySecret(entry.password)"
            />
          </div>
        </el-descriptions-item>

        <el-descriptions-item :label="t('common.url')">
          <div
            v-if="entry.url"
            class="detail-value"
          >
            <a
              v-if="navigableUrl"
              :href="navigableUrl"
              class="detail-url"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SiteFavicon
                :url="entry.url"
                :size="14"
              >
                <el-icon><Link /></el-icon>
              </SiteFavicon>
              <span class="detail-url__text">{{ entry.url }}</span>
            </a>
            <span
              v-else
              class="detail-value__text"
            >
              {{ entry.url }}
            </span>
            <el-button
              :icon="CopyDocument"
              :aria-label="t('common.copy')"
              link
              @click="copyText(entry.url)"
            />
          </div>
          <span
            v-else
            class="detail-muted"
          >
            {{ t('options.detail.matchesAllSites') }}
          </span>
        </el-descriptions-item>

        <el-descriptions-item :label="t('common.totp')">
          <TotpCode
            v-if="entry.totp"
            :secret="entry.totp"
            copyable
          />
          <span
            v-else
            class="detail-muted"
          >
            {{ t('options.detail.noTotp') }}
          </span>
        </el-descriptions-item>

        <el-descriptions-item :label="t('common.tag')">
          <template v-if="tagList.length">
            <el-tag
              v-for="tagName in tagList"
              :key="tagName"
              :style="getTagFullStyle(tagName)"
              size="small"
              class="detail-tag"
            >
              {{ tagName }}
            </el-tag>
          </template>
          <span
            v-else
            class="detail-muted"
          >
            —
          </span>
        </el-descriptions-item>

        <el-descriptions-item :label="t('common.remark')">
          <div
            v-if="entry.remark"
            class="detail-remark"
          >
            {{ entry.remark }}
          </div>
          <span
            v-else
            class="detail-muted"
          >
            {{ t('options.detail.noRemark') }}
          </span>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 密码修改历史（只读，仅提供复制；恢复属编辑动作，引导至编辑弹窗） -->
      <template v-if="historyList.length > 0">
        <el-divider content-position="left">{{ t('options.form.historyTitle') }}</el-divider>
        <div class="detail-history">
          <div
            v-for="(item, index) in historyList"
            :key="index"
            class="detail-history__item"
          >
            <span class="detail-history__time">{{ formatDateTime(item.changedAt) }}</span>
            <span class="detail-history__password">••••••••</span>
            <el-button
              type="primary"
              size="small"
              :loading="item.loading"
              @click="copyHistory(item, index)"
            >
              {{ t('common.copy') }}
            </el-button>
          </div>
        </div>
      </template>

      <!-- 时间信息 -->
      <el-divider content-position="left">{{ t('options.detail.timeInfo') }}</el-divider>
      <div class="detail-time">
        <div class="detail-time__row">
          <span class="detail-time__label">{{ t('sidepanel.createTime') }}</span>
          <span class="detail-time__value">{{ formatDateTime(entry.createTime) }}</span>
        </div>
        <div class="detail-time__row">
          <span class="detail-time__label">{{ t('options.table.updateTime') }}</span>
          <span class="detail-time__value">{{ formatDateTime(entry.updateTime) }}</span>
        </div>
        <div
          v-if="entry.lastUsedAt"
          class="detail-time__row"
        >
          <span class="detail-time__label">{{ t('options.detail.lastUsed') }}</span>
          <span class="detail-time__value">{{ formatDateTime(entry.lastUsedAt) }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="detail-footer">
        <el-button @click="$emit('update:modelValue', false)">{{ t('common.close') }}</el-button>
        <el-button
          type="primary"
          :icon="Edit"
          @click="handleEdit"
        >
          {{ t('common.edit') }}
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { CopyDocument, Edit, View, Hide, StarFilled, Link } from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import { formatDateTime } from '@/utils/dateFormat';
import { getTagFullStyle, parseTags } from '@/utils/tagUtils';
import { toNavigableUrl } from '@/utils/domain';
import { copySecretToClipboard, copyTextToClipboard } from '@/utils/clipboard';
import { usePasswordHistory } from '@/composables/usePasswordHistory';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import TotpCode from '@/components/TotpCode.vue';
import SiteFavicon from '@/components/SiteFavicon.vue';

/**
 * 密码条目只读详情抽屉
 *
 * 以只读方式完整展示单条账号密码信息（用户名/密码/网址/两步验证/标签/备注/
 * 密码历史/时间戳），核心价值是呈现列表中被截断的备注全文与历史，用户无需进入
 * 编辑态即可查阅；密码默认掩码，需显式点击才揭示，关闭抽屉时复位。
 * 纯展示组件：不写入存储、不改动加密与会话，编辑动作向上抛出由父级复用既有流程。
 */
const props = defineProps<{
  /** 抽屉显隐状态 */
  modelValue: boolean;
  /** 当前查看的条目（已解密，为空时不渲染内容） */
  entry: PasswordEntry | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  /** 请求进入编辑态（由父级关闭抽屉并复用既有编辑弹窗流程） */
  edit: [entry: PasswordEntry];
}>();

const { t } = useI18n();
const { historyList, loadHistory, decryptHistoryPassword } = usePasswordHistory();

/** 密码明文可见性（本地态，关闭抽屉即复位，不持久化） */
const passwordVisible = ref(false);

/** 标签数组视图 */
const tagList = computed(() => (props.entry ? parseTags(props.entry.tag) : []));

/**
 * 归一化后的可跳转 URL
 *
 * 复用 utils/domain 的加固助手：为无协议主机补默认协议、本地开发域名走 http，
 * 并显式拒绝 javascript:/data: 等非导航协议（返回 null），避免存储字段作为
 * 不可信输入直接拼进 href 造成协议注入。
 */
const navigableUrl = computed(() => (props.entry?.url ? toNavigableUrl(props.entry.url) : null));

/**
 * 自动清除完成回调：复用 fill 命名空间既有文案提示「已清除」或「清除失败」
 * @param ok 是否成功清除
 */
const notifyClipboardCleared = (ok: boolean): void => {
  if (ok) {
    ElMessage.info(t('fill.clipboardCleared'));
  } else {
    ElMessage.warning(t('fill.clipboardClearFailed'));
  }
};

/**
 * 复制普通文本（用户名 / 网址）到剪贴板并反馈
 * @param text 待复制文本，空值时静默跳过
 */
const copyText = async (text: string): Promise<void> => {
  if (!text) return;
  const ok = await copyTextToClipboard(text);
  if (ok) {
    ElMessage.success(t('options.detail.copied'));
  } else {
    ElMessage.error(t('message.copyFailed'));
  }
};

/**
 * 复制密码到剪贴板并反馈
 * 按剪贴板配置限时自动清除，兑现「复制密码后自动清除」的安全承诺，与侧边栏一致。
 * @param text 明文密码，空值时静默跳过
 */
const copySecret = async (text: string): Promise<void> => {
  if (!text) return;
  const ok = await copySecretToClipboard(text, notifyClipboardCleared);
  if (ok) {
    ElMessage.success(t('options.detail.copied'));
  } else {
    ElMessage.error(t('message.copyFailed'));
  }
};

/**
 * 解密并复制某条历史密码（同样走自动清除）
 * @param item 历史项（含加密态密码与加载态）
 * @param index 历史项索引（用于切换 loading）
 */
const copyHistory = async (item: { password: string; loading: boolean }, index: number): Promise<void> => {
  historyList.value[index].loading = true;
  try {
    const plain = await decryptHistoryPassword(item.password);
    if (!plain) {
      ElMessage.error(t('message.decryptFailed'));
      return;
    }
    const ok = await copySecretToClipboard(plain, notifyClipboardCleared);
    if (ok) {
      ElMessage.success(t('options.form.historyCopied'));
    } else {
      ElMessage.error(t('message.copyFailed'));
    }
  } finally {
    historyList.value[index].loading = false;
  }
};

/** 请求进入编辑态：向上抛出当前条目，由父级关闭抽屉并打开编辑弹窗 */
const handleEdit = (): void => {
  if (props.entry) emit('edit', props.entry);
};

/** 抽屉关闭动画结束后复位敏感态（密码可见性、历史列表） */
const handleClosed = (): void => {
  passwordVisible.value = false;
  historyList.value = [];
};

/**
 * 抽屉打开时按配置加载密码历史
 * 与编辑弹窗一致：仅在密码历史功能启用时加载，避免无谓解密与存储读取。
 */
watch(
  () => props.modelValue,
  async visible => {
    if (!visible || !props.entry) return;
    passwordVisible.value = false;
    try {
      const { getPasswordHistoryConfig } = await import('@/utils/storage/configManager');
      const config = await getPasswordHistoryConfig();
      if (config.enabled) {
        await loadHistory(props.entry.id);
      }
    } catch (error) {
      logger.error('详情抽屉：加载密码历史失败:', error);
    }
  },
);
</script>

<style scoped>
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 头部：站点图标 + 用户名 + 收藏标识 */
.detail-header {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-bottom: 16px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--aph-surface-line);
}

.detail-header__favicon,
.detail-header__fallback {
  flex-shrink: 0;
}

.detail-header__fallback {
  font-size: 20px;
  color: var(--el-color-primary);
}

.detail-header__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.detail-header__title {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.detail-header__username {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.detail-header__star {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--el-color-warning);
}

.detail-header__site {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

/* 字段值行：文本 + 行内操作按钮 */
.detail-value {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.detail-value__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-value__text--mono {
  font-family: SFMono-Regular, consolas, 'Liberation Mono', menlo, monospace;
  letter-spacing: 1px;
}

.detail-url {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  color: var(--el-color-primary);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s;
}

.detail-url:hover {
  color: var(--el-color-primary-light-3);
  text-decoration: underline;
}

.detail-url__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-muted {
  font-size: 12px;
  font-style: italic;
  color: #c0c4cc;
}

.detail-tag + .detail-tag {
  margin-left: 4px;
}

/* 备注全文：保留换行，长文本自动折行（核心价值，列表中被截断） */
.detail-remark {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

/* 密码历史（只读） */
.detail-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-history__item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.detail-history__time {
  flex-shrink: 0;
  font-size: 12px;
  color: #909399;
}

.detail-history__password {
  flex: 1;
  font-size: 13px;
  color: #606266;
  letter-spacing: 2px;
}

/* 时间信息 */
.detail-time {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-time__row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.detail-time__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.detail-time__value {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

/* 底部操作栏 */
.detail-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
