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
            <!-- 只读跳转：把用户名当搜索词带去身份库，本抽屉不解身份密文、也不显示任何 PII 值 -->
            <el-tooltip
              :content="t('options.detail.searchIdentity')"
              placement="top"
            >
              <el-button
                :icon="Search"
                :aria-label="t('options.detail.searchIdentity')"
                link
                @click="searchIdentity"
              />
            </el-tooltip>
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
            class="detail-value detail-remark"
          >
            <span class="detail-remark__text">
              <SearchHighlight
                :text="entry.remark"
                :keyword="keyword || ''"
              />
            </span>
            <el-button
              :icon="CopyDocument"
              :aria-label="t('common.copy')"
              link
              @click="copyText(entry.remark)"
            />
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
        <!-- 分享卡片：跨用户名/密码/网址三字段的整条动作，故置于底部而非某个字段行内 -->
        <el-button
          :icon="Share"
          @click="copyShareCard"
        >
          {{ t('common.shareCard') }}
        </el-button>
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
import { CopyDocument, Edit, View, Hide, StarFilled, Link, Share, Search } from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import { formatDateTime } from '@/utils/dateFormat';
import { getTagFullStyle, parseTags } from '@/utils/tagUtils';
import { toNavigableUrl } from '@/utils/domain';
import { buildShareCard, hasShareCardPassword } from '@/utils/shareCard';
import { copySecretToClipboard, copyTextToClipboard } from '@/utils/clipboard';
import { usePasswordHistory } from '@/composables/usePasswordHistory';
import { useClipboardFeedback } from '@/composables/useClipboardFeedback';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';
import TotpCode from '@/components/TotpCode.vue';
import SiteFavicon from '@/components/SiteFavicon.vue';
import SearchHighlight from '@/components/SearchHighlight.vue';

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
  /**
   * 当前搜索关键词（用于备注命中高亮，空串时不高亮）
   *
   * 列表里搜到一条再点进详情，高亮若消失就是可感的断裂；表格与侧边栏都已用
   * `SearchHighlight`，抽屉此前是唯一没有的一处。
   */
  keyword?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [boolean];
  /** 请求进入编辑态（由父级关闭抽屉并复用既有编辑弹窗流程） */
  edit: [entry: PasswordEntry];
  /**
   * 请求以当前用户名检索身份信息库
   *
   * 只把用户名当**搜索词**上交：身份库的复验门槛与开窗都由父级持有，
   * 本组件既不解身份密文，也不会在抽屉里显示任何 PII 值。
   */
  searchIdentity: [username: string];
}>();

const { t, currentLocale } = useI18n();
const { historyList, loadHistory, resetHistory, decryptHistoryPassword } = usePasswordHistory();

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
 *
 * 与编辑弹窗的历史密码复制、身份库字段复制共用 `useClipboardFeedback`，
 * 避免同一回执在三处各自漂移（文案 key、info/warning 级别）。
 */
const { notifyClipboardCleared } = useClipboardFeedback();

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
 * 复制「分享卡片」到剪贴板
 *
 * 把用户名 / 密码 / 网址编排为多行纯文本一次复制，便于直接粘贴给他人。
 * 卡片含明文密码，因此必须走 `copySecretToClipboard`（与复制密码同受
 * 「剪贴板设置」限时自动清除约束）；文本构造与侧边栏共用 `utils/shareCard`，
 * 两个入口只在复制出口上不同。
 */
const copyShareCard = async (): Promise<void> => {
  if (!props.entry) return;
  const withPassword = hasShareCardPassword(props.entry);
  const card = buildShareCard(
    props.entry,
    { username: t('common.username'), password: t('common.password'), url: t('common.url') },
    currentLocale.value,
  );
  // 卡片含明文密码，失败时只记布尔结果，不输出内容
  const ok = await copySecretToClipboard(card, notifyClipboardCleared);
  if (ok) {
    // 条目未填密码时卡片不含可用凭据，成功提示改为告警，避免误以为凭据已完整交付
    if (withPassword) {
      ElMessage.success(t('fill.shareCardCopied'));
    } else {
      ElMessage.warning(t('fill.shareCardNoPassword'));
    }
  } else {
    ElMessage.error(t('fill.shareCardCopyFailed'));
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

/**
 * 请求以当前用户名检索身份信息库：用户名是唯一的跨库线索，值本身不外泄
 * @param username 当前条目的用户名，空值时不发起
 */
const searchIdentity = (): void => {
  const username = props.entry?.username.trim();
  if (username) emit('searchIdentity', username);
};

/** 抽屉关闭动画结束后复位敏感态（密码可见性、历史列表） */
const handleClosed = (): void => {
  passwordVisible.value = false;
  // 用 resetHistory 而非直接清数组：还要作废仍在飞的那次读取，
  // 否则晚到的结果会把这条目的历史填回已关闭的抽屉，下次打开先闪一下旧数据
  resetHistory();
};

/**
 * 抽屉打开时按配置加载密码历史
 * 与编辑弹窗一致：仅在密码历史功能启用时加载，避免无谓解密与存储读取。
 *
 * 同样自持开关序号：await 配置期间抽屉被关闭或换看另一条目，这一次就地作废，
 * 不给已失效的目标发起读取。
 */
let historyOpenSeq = 0;

watch(
  () => props.modelValue,
  async visible => {
    const seq = ++historyOpenSeq;
    if (!visible || !props.entry) return;
    const targetId = props.entry.id;
    passwordVisible.value = false;
    try {
      const { getPasswordHistoryConfig } = await import('@/utils/storage/configManager');
      const config = await getPasswordHistoryConfig();
      if (seq !== historyOpenSeq) return;
      if (config.enabled) {
        await loadHistory(targetId);
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
  color: var(--aph-primary-strong);
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

/*
 * 图标之间的净间距归一到 8px（实测原先是 16px）。
 * 成因：Element Plus 的 `.el-button + .el-button { margin-left: 12px }` 与本行的 `gap: 4px`
 * 是叠加的，两处都没意识到对方存在。这里显式接管那 12px，让「图标↔图标」= 8px，
 * 而「文本↔图标」保持 4px 的紧贴关系（它们说的是同一个值）。
 * 量的是按钮盒子之间的净间距；按可见图标量，间距同步从 22px 收到 14px
 * （盒子两侧各留 1px 边框 + 2px padding 的空位）。
 */
.detail-value .el-button + .el-button {
  margin-left: 4px;
}

/*
 * 命中区补到 WCAG 2.5.8 的 24px 下限：`link` 按钮的盒子只有 20×20（14px 图标 + 2×2px padding
 * + 2×1px 边框）。视觉尺寸与 DOM 都不动，只用 `::after` 向外扩。
 * 口径：`inset` 以 padding box 为基准，被 EP 按钮那 1px 边框吃掉一格，所以 −4px 实际只外扩 3px。
 * 真鼠标实测：盒子右缘外 +2px 仍能翻显隐，+3px 起落空 —— 相邻两颗的热区之间因此还留约 2px
 * 中性带，既没有重叠误点，也没把整行铺成一颗接一颗的分段控件。
 * 与表格操作列 `.operation-buttons` 同一套做法（那边是 28px 盒 + 10px 间距 + 外扩 5px）。
 */
.detail-value .el-button {
  position: relative;

  /*
   * 值文本改为可折行后，它的 flex 基准尺寸（max-content，整段一行）远超容器，
   * 负剩余空间会按「收缩系数 × 基准尺寸」分摊到同行每个弹性项 —— 不加这一句，
   * 20px 的图标按钮会被长备注 / 长网址挤到 10px 左右（热区与图标同时变形）。
   */
  flex-shrink: 0;
}

.detail-value .el-button::after {
  position: absolute;
  inset: -4px;
  content: '';
}

/*
 * 值文本折行而非省略号截断：本抽屉是列表截断后的唯一完整读通道（见组件头注释），
 * 超长用户名 / 网址 / 明文密码应当折行展示全文。同时解除 nowrap 对表格布局的
 * min-content 挤压——`el-descriptions border` 渲染为 table，一个 nowrap 的长值会把
 * 值列撑到整串宽度，把标签 th 挤到一字宽、中文标签逐字竖排。
 */
.detail-value__text {
  min-width: 0;
  overflow-wrap: anywhere;
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
  color: var(--aph-primary-strong);
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s;
}

.detail-url:hover {
  color: color-mix(in srgb, var(--aph-primary-strong) 78%, #000);
  text-decoration: underline;
}

.detail-url__text {
  overflow-wrap: anywhere;
}

.detail-muted {
  font-size: 12px;
  font-style: italic;
  color: var(--aph-text-muted);
}

.detail-tag + .detail-tag {
  margin-left: 4px;
}

/*
 * 备注行：容器直接复用 `.detail-value`（同一套 flex + 4px 间距 + 图标热区外扩），
 * 这里只把居中对齐改成顶部对齐 —— 备注折成多行时，复制按钮贴第一行而不是悬在中间。
 * 用 `.detail-value.detail-remark` 复合选择器而非单类，是为了压过 `.detail-value`
 * 的 `align-items: center`（同为单类时谁生效取决于样式顺序，换行序即翻车）。
 */
.detail-value.detail-remark {
  align-items: flex-start;
}

.detail-remark__text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

/*
 * 标签格不得逐字竖排：border 形态下 el-descriptions 是 table，标签 th 的宽度由
 * min-content 决定，中文可在任意字间断行，一旦值列挤压就会退成一字一行。
 * 标签本身最长四字（两步验证 / Username），nowrap 后其 min-content 即整词宽度，
 * 表格布局必先满足它，竖排随之消失。
 */
.detail-descriptions :deep(.el-descriptions__label) {
  white-space: nowrap;
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
  color: var(--aph-text-muted);
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
