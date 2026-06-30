<script setup lang="ts">
import { User, CopyDocument, Key, Star, StarFilled, Promotion, EditPen } from '@element-plus/icons-vue';
import type { PasswordEntry } from '@/utils/types';
import { getTagColor, parseTags } from '@/utils/tagUtils';

interface Props {
  /** 密码条目数据 */
  password: PasswordEntry;
  /** 是否处于激活（选中）状态 */
  isActive: boolean;
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
}

defineProps<Props>();
defineEmits<Emits>();
</script>

<template>
  <div
    class="password-item"
    :class="{ active: isActive }"
    title="点击快速填充账号和密码"
    @click="$emit('fill', password)"
  >
    <div class="password-info">
      <div class="username">
        <el-icon><User /></el-icon>
        {{ password.username }}
        <span
          class="copy-icon-wrapper"
          title="复制账号"
          @click.stop.prevent="$emit('copyUsername', password.username)"
          @mousedown.stop
        >
          <el-icon class="copy-icon">
            <CopyDocument />
          </el-icon>
        </span>
        <span
          class="copy-icon-wrapper copy-password"
          title="复制密码"
          @click.stop.prevent="$emit('copyPassword', password.password)"
          @mousedown.stop
        >
          <el-icon class="copy-icon">
            <Key />
          </el-icon>
        </span>
      </div>
      <div class="details">
        <el-tag
          v-for="t in parseTags(password.tag)"
          :key="t"
          :title="t"
          :color="getTagColor(t).background"
          :style="{ color: getTagColor(t).text, borderColor: getTagColor(t).border }"
          size="small"
          class="tag-item"
        >
          {{ t }}
        </el-tag>
        <el-text
          v-if="password.url"
          type="info"
          size="small"
        >
          {{ password.url }}
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
          {{ password.remark }}
        </el-text>
      </div>
    </div>
    <div class="password-actions">
      <el-icon
        class="action-icon favorite-icon"
        :class="{ 'is-favorite': password.favorite }"
        :title="password.favorite ? '取消收藏' : '收藏'"
        @click.stop="$emit('toggleFavorite', password)"
      >
        <StarFilled v-if="password.favorite" />
        <Star v-else />
      </el-icon>
      <el-icon
        class="action-icon auto-login-icon"
        title="填充并登录"
        @click.stop="$emit('fillAndLogin', password)"
      >
        <Promotion />
      </el-icon>
      <el-icon
        class="action-icon edit-icon"
        title="编辑"
        @click.stop="$emit('edit', password)"
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
  border-bottom: 1px solid #f3f4f5;
  transition:
    background-color 0.2s,
    transform 0.2s ease;
}

/* 斑马条纹：奇偶行交替背景，提升长列表可扫读性 */
.password-item:nth-child(odd) {
  background: #fff;
}

.password-item:nth-child(even) {
  background: #f8f9fb;
}

.password-item:hover {
  background: #eef1f5;
  transform: translateX(2px);
}

.password-item.active {
  padding-left: 13px;
  background: #ecf5ff;
  border-left: 3px solid #409eff;
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
  color: #1f2937;
}

.username > .el-icon {
  margin-right: 6px;
  font-size: 16px;
  color: #6b7280;
}

.copy-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  margin-left: 4px;
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
  background-color: rgb(64 158 255 / 10%);
  transform: scale(1.12);
}

.copy-icon-wrapper .copy-icon {
  font-size: 14px;
  color: #9ca3af;
  pointer-events: none;
}

.copy-icon-wrapper:hover .copy-icon {
  color: #409eff;
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
  max-width: 120px;
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
  color: #6b7280;
  white-space: nowrap;
}

.password-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  color: #b0b7c3;
}

.action-icon {
  font-size: 16px;
}

.favorite-icon {
  margin-right: 8px;
  color: #b0b7c3;
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
  color: #b0b7c3;
  cursor: pointer;
  transition: color 0.2s;
}

.auto-login-icon:hover {
  color: #67c23a;
}

.edit-icon {
  color: #b0b7c3;
  cursor: pointer;
  opacity: 0;
  transition:
    color 0.2s,
    opacity 0.2s;
}

.password-item:hover .edit-icon {
  opacity: 1;
}

.edit-icon:hover {
  color: #409eff;
}
</style>
