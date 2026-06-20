<template>
  <el-dialog
    :model-value="modelValue"
    title="操作指引与常见问题"
    width="90%"
    :append-to-body="true"
    class="help-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="help-content">
      <section class="help-section">
        <h4>操作指引</h4>
        <ol>
          <li>首次使用：请先设置主密码（至少 8 位，包含字母、数字和特殊字符）。</li>
          <li>验证主密码后，侧边栏即可搜索已保存的账号、标签、备注与网址，并快速填充。</li>
          <li>
            点击列表条目一键填充账号与密码；可在悬浮按钮「设置」（齿轮图标）中开启「自动触发登录」。自动保存弹窗中可编辑标签和备注。
          </li>
          <li>
            在密码管理页支持 Excel 导入导出（.xlsx/.xls）、JSON 导入导出（.json），以及多标签（每条最多 3 个，单个最长
            30 字符）、颜色稳定的标签体系。点击星标可收藏常用条目，支持「只看收藏」过滤。
          </li>
          <li>加密备份：在「数据管理」中导出为 .aph 加密文件，导入时解密后可预览数据再确认，安全可靠。</li>
          <li>自动闲置锁定：在「自动锁定设置」中配置闲置时间（5/10/30/60 分钟），超时后自动清除会话并锁定。</li>
          <li>
            快捷键：<code>Ctrl/Cmd + Shift + P</code> 打开密码管理页面，<code>Ctrl/Cmd + Shift + L</code>
            显示/隐藏侧边栏。快捷键支持在 <code>chrome://extensions/shortcuts</code> 中自定义。
          </li>
          <li>本地开发友好：当域名为 <code>localhost</code> 或 <code>127.0.0.1</code> 时，侧边栏默认展示全部密码。</li>
          <li>
            版本更新检测：插件每 6 小时自动检测最新版本，发现新版本时 Popup 弹窗会提示更新信息，点击即可跳转下载。
          </li>
        </ol>
      </section>
      <section class="help-section">
        <h4>常见问题</h4>
        <ul>
          <li><b>提示「未检测到登录表单」？</b> 请刷新页面，或确认当前页面包含账号/密码输入框。</li>
          <li><b>填充失败或无响应？</b> 可能页面脚本未就绪，刷新页面后重试。</li>
          <li><b>侧边栏列表为空？</b> 主密码会话可能已过期，请前往密码管理页重新验证主密码。</li>
          <li><b>导入 Excel 报错？</b> 请使用「密码管理」页提供的模板下载，确保必填列完整。</li>
          <li><b>悬浮按钮未显示？</b> 在本弹窗的「设置」（齿轮图标）中启用「显示悬浮按钮」。</li>
          <li><b>数据安全？</b> 全部数据采用 PBKDF2 + AES-256-CBC 本地加密存储，零网络传输。</li>
          <li>
            <b>如何开启自动保存？</b>
            密码管理页点击「自动保存设置」，开启后登录时自动弹窗确认是否保存；弹窗中可编辑标签和备注；支持域名白名单/黑名单匹配，已保存的凭证不会重复弹窗。
          </li>
          <li>
            <b>自动保存会覆盖已有密码吗？</b>
            同一网站（同域名）相同账号登录时更新密码，但保留原有标签和备注（除非在弹窗中手动修改）；不同账号则新增条目。
          </li>
          <li>
            <b>密码框没有显示/隐藏按钮？</b>
            悬浮按钮「设置」中默认<b>关闭</b>「密码可见性切换」，需手动开启；开启后对所有密码输入框统一注入切换按钮，输入有值时按钮自动可见。
          </li>
          <li>
            <b>如何备份到邮箱？</b> 密码管理页点击「备份到邮箱」，配置目标邮箱后可一键导出 Excel
            并唤起邮件客户端，也可开启定时提醒。
          </li>
          <li>
            <b>如何导出/导入加密备份？</b>
            密码管理页「数据管理」中选择「加密备份导出」会生成 .aph 加密文件；「加密备份导入」上传 .aph
            文件后输入主密码解密，可预览数据再确认导入。
          </li>
          <li>
            <b>什么是自动闲置锁定？</b>
            在「自动锁定设置」中配置闲置时间，超时后自动清除会话并锁定。效果与手动锁定一致，需重新验证主密码才能恢复访问，有效防止离开时密码列表被他人查看。
          </li>
          <li>
            <b>如何一键去重？</b>
            密码管理页「数据管理」中点击「一键去重」，插件会智能检测重复条目（相同用户名 + 相同
            URL），确认后清理。已收藏的条目不会被删除。
          </li>
          <li>
            <b>支持从其他密码管理器导入吗？</b>
            支持。在 Excel 导入弹窗中选择 CSV 格式，插件会自动识别 Chrome、LastPass、Bitwarden、1Password
            的导出格式并映射字段。
          </li>
          <li>
            <b>支持 JSON 格式导入导出吗？</b>
            支持。密码管理页「数据管理」中选择「导出JSON」即可导出所有密码为 JSON 文件（需验证主密码）；导入时选择 JSON
            文件即可，字段结构与插件内部存储一致。
          </li>
          <li>
            <b>如何自定义快捷键？</b>
            在地址栏输入 <code>chrome://extensions/shortcuts</code>，找到「Account Password
            Helper」，点击对应命令的快捷键输入框，按下新组合键即可。修改后 Popup 弹窗会自动同步显示。
          </li>
          <li>
            <b>插件会自动检测更新吗？</b>
            会。插件通过 GitHub Releases API 每 6 小时自动检测最新版本，发现新版本时 Popup
            弹窗会展示更新提示（含版本号和更新说明），点击即可跳转下载页面。也可在 Popup 中手动触发检测。
          </li>
        </ul>
      </section>
      <section class="help-section help-link-section">
        <div class="help-link-banner">
          <el-icon class="help-link-icon"><Document /></el-icon>
          <span>查看完整</span>
          <a
            href="https://liaolongdong.github.io/account-password-helper/"
            target="_blank"
            rel="noopener noreferrer"
            class="help-link"
          >
            使用说明
          </a>
        </div>
      </section>
    </div>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button
        type="primary"
        @click="handleGoToOptions"
      >
        前往密码管理
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Document } from '@element-plus/icons-vue';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  goToOptions: [];
}>();

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

.help-section code {
  padding: 1px 6px;
  font-size: 12px;
  color: #d6336c;
  background: #f3f4f6;
  border-radius: 3px;
}

.help-link-section {
  margin-bottom: 16px;
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
