<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import {
  User,
  CopyDocument,
  Key,
  Star,
  StarFilled,
  Promotion,
  EditPen,
  Timer,
  DocumentCopy,
} from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import { buildTagPresentationRecords } from '@/utils/tagUtils';
import { activateOnKeydown } from '@/utils/a11y';
import SiteFavicon from '@/components/SiteFavicon.vue';
import SearchHighlight from '@/components/SearchHighlight.vue';
import { useI18n } from '@/utils/i18n';

/**
 * TOTP 验证码组件——异步加载（仅存在 totp 条目时渲染）
 *
 * 静态导入会将 utils/totp 及其 Element Plus 重依赖拖入列表 chunk，
 * 改为异步后该依赖链退出首屏关键路径；首帧后由 App.vue 空闲预取温热，
 * 含 totp 条目的列表渲染无可感知延迟。
 */
const TotpCode = defineAsyncComponent(() => import('@/components/TotpCode.vue'));

interface Props {
  /** 密码条目数据 */
  password: PasswordEntry;
  /** 是否处于激活（选中）状态 */
  isActive: boolean;
  /** 全局「自动触发登录」是否开启（开启时点条目即等于填充并登录，隐藏每条冗余的「填充并登录」按钮） */
  autoLoginEnabled: boolean;
  /** 当前搜索关键词（用于命中高亮，空串时不高亮） */
  searchKeyword?: string;
}

interface Emits {
  /** 点击条目进行快速填充 */
  fill: [password: PasswordEntry];
  /** 填充并自动登录 */
  fillAndLogin: [password: PasswordEntry];
  /** 跳转到编辑页面 */
  edit: [password: PasswordEntry];
  /** 切换收藏状态 */
  toggleFavorite: [password: PasswordEntry];
  /** 复制用户名 */
  copyUsername: [username: string];
  /** 复制密码 */
  copyPassword: [password: string];
  /** 填充 TOTP 两步验证码 */
  fillTotp: [password: PasswordEntry];
  /** 复制 TOTP 两步验证码 */
  copyTotp: [password: PasswordEntry];
}

const props = defineProps<Props>();
defineEmits<Emits>();

const { t } = useI18n();

/** 标签字符串未变化时复用解析结果与样式对象，避免列表行更新时重复创建。 */
const tagPresentationRecords = computed(() => buildTagPresentationRecords(props.password.tag));
</script>

<template>
  <div
    class="password-item"
    :class="{ active: isActive }"
    role="button"
    tabindex="0"
    :title="t('sidepanel.item.fillTitle')"
    :aria-label="t('sidepanel.item.fillTitle')"
    @click="$emit('fill', password)"
    @keydown="activateOnKeydown($event, () => $emit('fill', password))"
  >
    <div class="password-info">
      <div class="username">
        <!-- 网站图标（Chrome 本地缓存，零网络），无图标/加载失败时降级为原有用户图标 -->
        <SiteFavicon
          :url="password.url"
          :size="16"
        >
          <el-icon><User /></el-icon>
        </SiteFavicon>
        <SearchHighlight
          :text="password.username"
          :keyword="searchKeyword ?? ''"
        />
        <span
          class="copy-icon-wrapper"
          role="button"
          tabindex="0"
          :title="t('sidepanel.item.copyUsername')"
          :aria-label="t('sidepanel.item.copyUsername')"
          @click.stop.prevent="$emit('copyUsername', password.username)"
          @keydown.stop="activateOnKeydown($event, () => $emit('copyUsername', password.username))"
          @mousedown.stop
        >
          <el-icon class="copy-icon">
            <CopyDocument />
          </el-icon>
        </span>
        <span
          class="copy-icon-wrapper copy-password"
          role="button"
          tabindex="0"
          :title="t('sidepanel.item.copyPassword')"
          :aria-label="t('sidepanel.item.copyPassword')"
          @click.stop.prevent="$emit('copyPassword', password.password)"
          @keydown.stop="activateOnKeydown($event, () => $emit('copyPassword', password.password))"
          @mousedown.stop
        >
          <el-icon class="copy-icon">
            <Key />
          </el-icon>
        </span>
      </div>
      <div class="details">
        <el-tag
          v-for="tagRecord in tagPresentationRecords"
          :key="tagRecord.name"
          :title="tagRecord.name"
          :style="tagRecord.style"
          size="small"
          class="tag-item"
        >
          <SearchHighlight
            :text="tagRecord.name"
            :keyword="searchKeyword ?? ''"
          />
        </el-tag>
        <el-text
          v-if="password.url"
          type="info"
          size="small"
        >
          <SearchHighlight
            :text="password.url"
            :keyword="searchKeyword ?? ''"
          />
        </el-text>
      </div>
      <div
        v-if="password.remark"
        class="remark"
      >
        <el-text
          type="info"
          size="small"
        >
          <SearchHighlight
            :text="password.remark"
            :keyword="searchKeyword ?? ''"
          />
        </el-text>
      </div>
      <div
        v-if="password.totp"
        class="totp-row"
        @click.stop
        @mousedown.stop
      >
        <TotpCode :secret="password.totp" />
      </div>
    </div>
    <div class="password-actions">
      <el-icon
        v-if="password.totp"
        class="action-icon totp-fill-icon"
        role="button"
        tabindex="0"
        :title="t('sidepanel.item.fillTotp')"
        :aria-label="t('sidepanel.item.fillTotp')"
        @click.stop="$emit('fillTotp', password)"
        @keydown.stop="activateOnKeydown($event, () => $emit('fillTotp', password))"
      >
        <Timer />
      </el-icon>
      <el-icon
        v-if="password.totp"
        class="action-icon totp-copy-icon"
        role="button"
        tabindex="0"
        :title="t('sidepanel.item.copyTotp')"
        :aria-label="t('sidepanel.item.copyTotp')"
        @click.stop="$emit('copyTotp', password)"
        @keydown.stop="activateOnKeydown($event, () => $emit('copyTotp', password))"
      >
        <DocumentCopy />
      </el-icon>
      <el-icon
        class="action-icon favorite-icon"
        :class="{ 'is-favorite': password.favorite }"
        role="button"
        tabindex="0"
        :title="password.favorite ? t('common.unfavorite') : t('common.favorite')"
        :aria-label="password.favorite ? t('common.unfavorite') : t('common.favorite')"
        @click.stop="$emit('toggleFavorite', password)"
        @keydown.stop="activateOnKeydown($event, () => $emit('toggleFavorite', password))"
      >
        <StarFilled v-if="password.favorite" />
        <Star v-else />
      </el-icon>
      <el-icon
        v-if="!autoLoginEnabled"
        class="action-icon auto-login-icon"
        role="button"
        tabindex="0"
        :title="t('sidepanel.item.fillAndLogin')"
        :aria-label="t('sidepanel.item.fillAndLogin')"
        @click.stop="$emit('fillAndLogin', password)"
        @keydown.stop="activateOnKeydown($event, () => $emit('fillAndLogin', password))"
      >
        <Promotion />
      </el-icon>
      <el-icon
        class="action-icon edit-icon"
        role="button"
        tabindex="0"
        :title="t('common.edit')"
        :aria-label="t('common.edit')"
        @click.stop="$emit('edit', password)"
        @keydown.stop="activateOnKeydown($event, () => $emit('edit', password))"
      >
        <EditPen />
      </el-icon>
    </div>
  </div>
</template>

<style scoped>
.password-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--aph-border-light);
  transition:
    background-color 0.2s,
    transform 0.2s ease;
}

/* 斑马条纹：奇偶行交替背景，提升长列表可扫读性 */
.password-item:nth-child(odd) {
  background: #fff;
}

.password-item:nth-child(even) {
  background: var(--aph-bg-zebra);
}

.password-item:hover {
  background: var(--aph-bg-hover);
  transform: translateX(2px);
}

.password-item.active {
  padding-left: 13px;
  background: var(--aph-primary-bg);
  border-left: 3px solid var(--aph-primary);
}

.password-info {
  flex: 1;
  min-width: 0;
}

.username {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-bottom: 4px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  color: var(--aph-text-primary);
}

.username > .el-icon {
  margin-right: 6px;
  font-size: 16px;
  color: var(--aph-text-secondary);
}

/* 网站图标与原用户图标占位一致，布局零偏移 */
.username :deep(.site-favicon) {
  margin-right: 6px;
}

.copy-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  margin-left: 2px;
  cursor: pointer;
  border-radius: 4px;
  transition:
    background-color 0.2s,
    color 0.2s,
    transform 0.15s ease;
}

.copy-icon-wrapper.copy-password {
  margin-left: 0;
}

.copy-icon-wrapper:hover {
  background-color: rgb(var(--aph-primary-rgb) / 10%);
  transform: scale(1.12);
}

.copy-icon-wrapper .copy-icon {
  font-size: 14px;
  color: var(--aph-icon-muted);
  pointer-events: none;
}

.copy-icon-wrapper:hover .copy-icon {
  color: var(--aph-primary);
}

.details {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  margin-bottom: 4px;
  overflow: hidden;
}

.details .el-tag {
  font-size: 11px;
}

/* 标签样式 */
.tag-item {
  /* 单行展示，超长省略，配合外层 el-tooltip 显示完整内容 */
  box-sizing: border-box;
  min-width: 0;

  /* 上限 120px，同时不超过容器宽度：窄容器时随之收缩，避免标签溢出导致右侧圆角被裁切，与列表表格截断行为保持一致 */
  max-width: min(120px, 100%);
  padding: 0 6px;
  margin: 0;

  /* 覆盖 Element Plus .el-tag 默认 overflow: hidden，防止裁切右侧边框 */
  overflow: visible !important;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  cursor: default;
  border-radius: 4px;
}

/* el-tag 内层文本节点负责截断，确保边框不被裁切 */
.tag-item :deep(.el-tag__content) {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 多标签并列时的横向间距 */
.tag-item + .tag-item {
  margin-left: 2px;
}

/* URL 文本截断，防止长 URL 挤占右侧按钮 */
.details > .el-text {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remark {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--aph-text-secondary);
  white-space: nowrap;
}

.totp-row {
  margin-top: 4px;
}

.password-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  color: var(--aph-icon-action);
}

.action-icon {
  position: relative;
  font-size: 16px;
}

/* 触控热区扩展：视觉尺寸不变，点击区域扩至约 28px，降低误触/点空概率 */
.action-icon::after {
  position: absolute;
  inset: -6px;
  content: '';
}

/* 键盘可达性：行与图标按钮获得焦点时展示可见焦点环 */
.password-item:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 60%);
  outline-offset: -2px;
}

.copy-icon-wrapper:focus-visible,
.action-icon:focus-visible {
  outline: 2px solid rgb(var(--aph-primary-rgb) / 60%);
  outline-offset: 1px;
  border-radius: 4px;
}

.favorite-icon {
  margin-right: 8px;
  color: var(--aph-icon-action);
  cursor: pointer;
  transition: color 0.2s;
}

.favorite-icon:hover {
  color: #e6a23c;
}

.favorite-icon.is-favorite {
  color: #e6a23c;
}

.auto-login-icon {
  margin-right: 8px;
  color: var(--aph-icon-action);
  cursor: pointer;
  transition: color 0.2s;
}

.auto-login-icon:hover {
  color: #67c23a;
}

.totp-fill-icon,
.totp-copy-icon {
  margin-right: 8px;
  color: var(--aph-icon-action);
  cursor: pointer;
  transition: color 0.2s;
}

.totp-fill-icon:hover,
.totp-copy-icon:hover {
  color: var(--aph-primary);
}

.edit-icon {
  color: var(--aph-icon-action);
  cursor: pointer;
  transition: color 0.2s;
}

.edit-icon:hover {
  color: var(--aph-primary);
}

/* 标签内高亮：沿用标签自身配色，仅加粗强调，避免主题色与标签底色冲突 */
.tag-item :deep(.search-hit) {
  font-weight: 700;
  color: inherit;
}
</style>
