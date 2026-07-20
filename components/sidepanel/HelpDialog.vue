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
      <!-- ====== 操作指引 ====== -->
      <section class="help-section">
        <h4>操作指引</h4>

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
          安全与隐私
        </h5>
        <ol>
          <li>首次使用：请先设置主密码（至少 8 位，包含字母、数字和特殊字符）。主密码无法找回，请务必牢记。</li>
          <li>会话有效期：可选 1/2/4/8/12/24 小时或 3/5/7 天（默认 24 小时），过期后需重新验证主密码。</li>
          <li>自动闲置锁定：在「自动锁定设置」中配置闲置时间（5/10/30/60 分钟），超时后自动清除会话并锁定。</li>
          <li>浏览器重启锁定：在「自动锁定设置」中开启后，完全关闭并重新打开浏览器时需重新输入主密码（更安全）。</li>
          <li>
            安全体检：在密码管理页顶部点击「安全体检」按钮，一键扫描弱密码、密码复用、长时间未更新等问题，生成综合安全评分，支持逐条「去处理」。
          </li>
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
          基础使用
        </h5>
        <ol>
          <li>验证主密码后，侧边栏即可搜索已保存的账号、标签、备注与网址，并快速填充。</li>
          <li>点击列表条目一键填充账号与密码；可在悬浮按钮「设置」（齿轮图标）中开启「自动触发登录」。</li>
          <li>
            快捷键：<code>Ctrl/Cmd + Shift + P</code> 打开密码管理页面，<code>Ctrl/Cmd + Shift + L</code>
            显示/隐藏侧边栏。支持在 <code>chrome://extensions/shortcuts</code> 中自定义。
          </li>
          <li>本地开发友好：当域名为 <code>localhost</code> 或 <code>127.0.0.1</code> 时，侧边栏默认展示全部密码。</li>
          <li>
            版本更新检测：插件每 6 小时自动检测最新版本，发现新版本时 Popup 弹窗会提示更新信息，点击即可跳转下载。
          </li>
          <li>
            主题换肤：在偏好设置中可切换 6
            款色彩主题（晴空蓝、青竹绿、桃花粉、樱粉紫、落霞橙、雾墨灰），所有页面和组件即时生效。
          </li>
          <li>
            内联填充：填充模式为「内联」时，登录输入框获焦后右侧显示钥匙图标，点击展开迷你面板（搜索+账号列表），直接在页面内完成填充，无需打开侧边栏。
          </li>
          <li>
            两步验证（TOTP）：在添加/编辑密码时粘贴 <code>otpauth://</code> 链接或 Base32
            密钥，列表和侧边栏实时展示动态码与倒计时，支持一键填充和复制验证码。
          </li>
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
          数据管理
        </h5>
        <ol>
          <li>
            在密码管理页支持 CSV 导入导出（.csv）、JSON 导入导出（.json），多格式 CSV
            自动识别（Chrome、LastPass、Bitwarden、1Password）。
          </li>
          <li>
            多标签分类（每条最多 3 个，单个最长 30 字符），颜色稳定一致；点击星标可收藏常用条目，支持「只看收藏」过滤。
          </li>
          <li>加密备份：在「数据管理」中导出为 .aph 加密文件，导入时解密后可预览数据再确认，安全可靠。</li>
          <li>
            邮箱备份：导出数据并唤起邮件客户端，支持选择「不加密备份」或「加密备份」（.aph
            格式）；支持定时自动备份提醒（每天/3天/每周/两周/每月）。
          </li>
          <li>一键去重：智能检测重复条目（相同用户名 + 相同 URL），确认后清理。已收藏的条目不会被删除。</li>
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
          高级配置
        </h5>
        <ol>
          <li>
            自动保存：在密码管理页点击「自动保存设置」开启，登录时自动弹窗确认；支持域名白名单/黑名单匹配，弹窗中可编辑标签和备注。
          </li>
          <li>
            偏好设置：有三种方式进入——①密码管理页「偏好设置」按钮；②悬浮按钮齿轮图标；③侧边栏右上角齿轮图标。可配置悬浮按钮显示、自动展示侧边栏、自动触发登录、密码可见性切换及透明度。
          </li>
          <li>
            收藏上限：默认 10 条，可在「设置」→「收藏上限设置」中调整（1~50
            条）。超限后新收藏自动淘汰最近最少使用的条目。
          </li>
          <li>
            随机密码生成：添加/编辑密码时，点击密码框旁的魔棒按钮可一键生成随机密码，支持自定义长度（6~50）和字符集，可排除易混淆字符。
          </li>
          <li>
            剪贴板自动清除：复制密码后可配置自动清除延时（10/15/30/60/120 秒），复制用户名时自动取消密码清除定时器。
          </li>
        </ol>
      </section>

      <!-- ====== 常见问题 ====== -->
      <section class="help-section">
        <h4>常见问题</h4>

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
          安全与隐私
        </h5>
        <ul>
          <li>
            <b>我的密码会被上传到云端吗？</b> 不会。所有数据保存在浏览器本地空间，敏感字段经 AES-256-GCM
            加密存储，零网络传输。
          </li>
          <li>
            <b>忘记主密码怎么办？</b>
            主密码无法找回，只能通过「重置」功能清空数据后重新设置。建议定期通过数据导出或加密备份（.aph 文件）备份。
          </li>
          <li>
            <b>会话有效期到了会发生什么？</b>
            会话过期后，所有敏感字段自动加密回密文；重新验证主密码即可恢复访问，数据不会丢失。
          </li>
          <li>
            <b>什么是自动闲置锁定？</b>
            在密码管理页「自动锁定设置」中可配置闲置时间（5/10/30/60
            分钟或不锁定）。系统检测到用户在设定时间内无操作时，自动清除会话并锁定密码管理，需重新验证主密码才能恢复访问，有效防止离开电脑时密码列表被他人查看。
          </li>
          <li>
            <b>什么是浏览器重启锁定？</b>
            在「自动锁定设置」中可开启「浏览器重启锁定」开关。开启后，即使会话仍在有效期内，完全关闭并重新打开浏览器时也需重新输入主密码，适合对安全性要求更高的场景。关闭此选项则在有效期内自动保持登录。
          </li>
          <li>
            <b>什么是安全体检？</b>
            密码管理页顶部「安全体检」按钮可一键扫描全部密码，生成综合安全评分（0~100
            分）和四维检测：弱密码、密码复用、长时间未更新（90/180/365
            天分级预警）、未开启两步验证。每条问题提供「去处理」按钮直接跳转编辑。全程本地计算，零网络传输。
          </li>
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
          基础使用
        </h5>
        <ul>
          <li>
            <b>侧边栏不显示？</b> 确认 Chrome 版本不低于 114，检查页面是否包含登录表单；也可点击插件图标（支持快捷键
            <code>Ctrl+Shift+L</code> / <code>Cmd+Shift+L</code>），或通过悬浮按钮的「快速填充」手动打开。
          </li>
          <li>
            <b>密码填充不生效？</b> 请等待页面完全加载后重试，填充器会依次尝试三种策略（Native Setter / execCommand /
            模拟键盘事件）；仍不生效请刷新页面。
          </li>
          <li>
            <b>如何自定义快捷键？</b> 在地址栏输入 <code>chrome://extensions/shortcuts</code>，找到「Account Password
            Helper」，点击对应命令的快捷键输入框，按下新组合键即可。
          </li>
          <li>
            <b>插件会自动检测更新吗？</b> 会。通过 GitHub Releases API 每 6 小时自动检测，发现新版本时 Popup
            弹窗展示更新提示，点击即可跳转下载。
          </li>
          <li><b>会话有效期修改何时生效？</b> 修改后立即创建新会话，新有效期即时生效。</li>
          <li>
            <b>如何切换主题配色？</b>
            有三种方式进入偏好设置面板：①在密码管理页点击「偏好设置」按钮；②点击页面悬浮按钮上的齿轮图标；③在侧边栏快速填充右上角齿轮图标。在偏好设置面板中可以看到
            6
            款色彩主题选项（晴空蓝、青竹绿、桃花粉、樱粉紫、落霞橙、雾墨灰），点击色块即可切换，所有页面和组件即时生效，无需刷新。
          </li>
          <li>
            <b>什么是内联填充？</b>
            内联填充是侧边栏之外的另一种快捷填充方式。当填充模式为「内联」时，登录输入框获焦后会在右侧内缘显示一个钥匙图标，点击图标展开迷你面板（含搜索栏、账号列表和密码管理入口），选择账号即可填充。支持键盘导航（↑↓
            浏览、Enter 填充、Esc 关闭），使用 Closed Shadow DOM 完全隔离页面样式。
          </li>
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
          数据管理
        </h5>
        <ul>
          <li>
            <b>导入 CSV 报错？</b> 请使用「密码管理」页提供的模板下载，确保必填列完整。插件自动识别
            Chrome、LastPass、Bitwarden、1Password 导出格式。
          </li>
          <li><b>支持从其他密码管理器导入吗？</b> 支持。上传对应管理器导出的 CSV 文件，插件自动识别并映射字段。</li>
          <li>
            <b>支持 JSON 格式导入导出吗？</b>
            支持。在「数据管理」下拉菜单中选择「导出JSON」即可导出（需验证主密码）；导入时选择 JSON 文件即可。
          </li>
          <li>
            <b>如何一键去重？</b> 在「数据管理」中点击「一键去重」，智能检测重复条目（相同用户名 + 相同
            URL），确认后清理。已收藏条目不会被删除。
          </li>
          <li>
            <b>如何备份到邮箱？</b>
            密码管理页点击「备份到邮箱」，配置目标邮箱后可选择备份方式：「不加密备份」导出标准文件，「加密备份」导出
            .aph 加密文件（需通过「加密备份导入」+ 原主密码解密查看）。也可开启定时提醒。
          </li>
          <li>
            <b>如何导出/导入加密备份？</b> 「数据管理」中选择「加密备份导出」生成 .aph 文件；「加密备份导入」上传 .aph
            文件后输入主密码解密，可预览数据再确认。
          </li>
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
          高级配置
        </h5>
        <ul>
          <li>
            <b>如何开启自动保存？</b>
            密码管理页点击「自动保存设置」，开启后登录时自动弹窗确认；弹窗中可编辑标签和备注；支持域名白名单/黑名单匹配，已保存凭证不重复弹窗。
          </li>
          <li>
            <b>自动保存会覆盖已有密码吗？</b>
            同一网站相同账号登录时更新密码，保留原有标签和备注（除非弹窗中手动修改）；不同账号则新增条目。
          </li>
          <li>
            <b>为什么有时登录后没有弹出保存提示？</b>
            可能原因包括：①该域名已被加入屏蔽黑名单（检查自动保存设置中的「已屏蔽的域名」）；②相同凭证刚弹过提示且在 60
            秒冷却期内；③该凭证已成功保存过；④域名不匹配配置的白名单规则。
          </li>
          <li>
            <b>密码框没有显示/隐藏按钮？</b>
            悬浮按钮「设置」中默认<b>关闭</b>「密码可见性切换」，需手动开启。
          </li>
          <li>
            <b>如何配置悬浮按钮的偏好设置？</b>
            有三种方式进入偏好设置面板：①在密码管理页点击「偏好设置」按钮；②点击页面悬浮按钮上的齿轮图标；③在侧边栏快速填充右上角齿轮图标。可配置：主题换肤（6
            款色彩主题）、悬浮按钮显示/隐藏、自动展示侧边栏、自动触发登录、密码可见性切换以及按钮透明度。
          </li>
          <li>
            <b>如何设置收藏上限？</b>
            密码管理页「设置」→「收藏上限设置」中可调整（1~50 条，默认 10
            条）。超限后新收藏自动淘汰最近最少使用的条目，被淘汰条目仅取消收藏标记。
          </li>
          <li>
            <b>复制密码后剪贴板会自动清除吗？</b>
            会。默认 30 秒后自动清除，可选 10/15/30/60/120
            秒。清除前验证内容未被替换，失焦时采用「尽力清除」策略。复制用户名时自动取消清除定时器。
          </li>
          <li>
            <b>如何生成随机密码？</b>
            添加/编辑密码时，点击密码框旁的魔棒按钮打开生成器。可自定义长度（6~50）和字符集，可排除易混淆字符（1/l/I/0/O），基于
            Web Crypto API 保证密码学安全。
          </li>
          <li>
            <b>侧边栏和内联填充有什么区别？</b>
            两者都是密码填充方式，功能互补。侧边栏是浏览器侧边的完整面板，适合搜索浏览全部密码、管理收藏等；内联填充是页面内的迷你面板，登录框获焦后显示钥匙图标，点击即可快速选择账号填充，无需切换到侧边栏。可在偏好设置中选择填充模式：「侧边栏」适合习惯侧边操作的用户，「内联」适合追求快速填充的用户。
          </li>
          <li>
            <b>如何使用两步验证（TOTP）？</b>
            在添加/编辑密码时，粘贴网站提供的 <code>otpauth://</code> 链接或 Base32
            密钥到「两步验证」字段。保存后列表和侧边栏实时展示动态码与环形倒计时，侧边栏提供「填充验证码」和「复制验证码」按钮。基于
            Web Crypto HMAC 本地计算，零网络传输。注意本机时钟须准确（误差 &lt; 30 秒）。
          </li>
          <li>
            <b>插件的性能表现如何？</b>
            插件在性能方面做了大量优化。Service Worker 在会话有效期内通过保活闹钟（每 1
            分钟唤醒）持续运行，确保密码缓存始终在内存中可用，侧边栏打开时可直接从缓存加载数据（约
            20-50ms），避免冷启动延迟。Service Worker 启动后还会延迟 500ms
            预热密码缓存，进一步提升首次打开侧边栏的响应速度。保活仅在会话有效期内启用，会话过期后自动停止，不影响电池续航。
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
