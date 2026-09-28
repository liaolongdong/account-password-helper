/**
 * 商店素材的文案表（截图与演示动图共用一份）。
 *
 * 这些文字会**烧进图片**，因此与商店四个字段同口径受关键字堆砌政策约束：
 * 零竞品品牌名、零绝对化表述（不得写「零联网 / 100% offline / 数据不出浏览器」，
 * 扩展每 6 小时有一次不携带用户数据的匿名版本检查）。改完必须重跑
 * `capture.mjs`（截图）或 `record.mjs`（动图）。
 */

/** 各语言的输出文件名后缀与标题带文案。 */
export const COPY = {
  zh: {
    suffix: '',
    login: {
      title: '一键登录：填充 → 勾选「记住我」→ 自动点击登录',
      sub: '侧边栏「填充并登录」，或在偏好设置中开启「自动触发登录」',
    },
    totp: {
      title: 'TOTP 两步验证：验证码和密码住在一起，不用摸手机',
      sub: '扫码或上传图片即可添加密钥，动态码在本机按 RFC 6238 生成',
    },
    handoff: {
      title: '两步验证接力：跳到验证码页，活码胶囊自动跟上',
      sub: '页内面板选账号 → 验证码页自动锚定活码胶囊 → 点「填入页面验证码输入框」',
    },
    audit: {
      title: '离线安全体检：0-100 分给密码健康打分，全程本机计算',
      sub: '复用 / 弱密码 / 常见泄露 / 长期未更新四维加权，不联网',
    },
    env: {
      title: '多环境账号管理：同一站点，开发 / 测试 / 生产分得清清楚楚',
      sub: '条目按精确域名匹配，各环境凭据互不混淆',
    },
    favorites: {
      title: '收藏常用账号：星标置顶，再一键只看收藏',
      sub: '侧边栏与密码列表各有一个星标开关，标签按名称稳定配色',
    },
    detail: {
      title: '条目详情：备注、两步验证活码、修改历史一屏看全',
      sub: '密码默认掩码，点眼睛才显示；复制后按设置自动清除剪贴板',
    },
    inline: {
      title: '页内填充面板：在输入框旁边直接挑账号',
      sub: '快捷键 Cmd/Ctrl+Shift+K 展开，带网站图标、标签与收藏标识',
    },
    prefs: {
      title: '6 款主题 + 中英文双语界面，即时切换无需刷新',
      sub: '扩展页与注入页面的浮层同步生效，快捷键均可在浏览器页自定义',
    },
    encryption: {
      title: '本地加密：密码只存在你的浏览器里，加密后落盘',
      sub: 'PBKDF2 600,000 次迭代 + AES-256-GCM，密码数据不上传服务器',
    },
    floating: {
      title: '页面悬浮按钮：登录页随手唤起填充面板',
      sub: '可拖到任意位置并自动吸附屏幕边缘，透明度 10%~100% 可调',
    },
    autosave: {
      title: '自动保存登录凭证：提交时弹窗确认，自动去重',
      sub: '同一账号改了密码会转为「更新」，库里已是同一份凭据则不再打扰',
    },
    backup: {
      title: '导入导出与加密备份：数据随时能带走',
      sub: 'CSV / JSON 双向导入导出，另有 .aph 加密备份与邮箱备份提醒',
    },
    generator: {
      title: '密码生成器双模式：随机字符或助记词组',
      sub: '6~50 位可调、可排除易混淆字符；助记词组取 3~8 个单词并可追加数字',
    },
    trash: {
      title: '回收站与修改历史：误删可恢复，改错能回滚',
      sub: '删除的条目保留 30 天，每条密码默认留存 3 份加密历史快照',
    },
  },
  en: {
    suffix: '-en',
    login: {
      title: 'One-click login: fill, tick consent, click Sign in',
      sub: 'Use Fill and sign in in the side panel, or enable auto-submit in preferences',
    },
    totp: {
      title: 'TOTP two-factor: codes live right next to the passwords',
      sub: 'Add a key by scanning a QR code or uploading an image; codes are generated on your device per RFC 6238',
    },
    handoff: {
      title: 'Two-factor handoff: the live code follows you to the code page',
      sub: 'Pick the account in the in-page panel, then click "Fill the page code input" on the capsule',
    },
    audit: {
      title: 'Offline security audit: a 0-100 score for password health',
      sub: 'Weighted across reuse, weakness, common leaks and staleness; all computed on your device',
    },
    env: {
      title: 'Multi-environment accounts: dev, test and prod kept apart',
      sub: 'Entries match the exact host name, so credentials never mix between environments',
    },
    favorites: {
      title: 'Star the accounts you use, then filter to favorites',
      sub: 'One star toggle in the side panel and one in the list; each tag keeps its own color',
    },
    detail: {
      title: 'Entry details: notes, live codes and change history in one panel',
      sub: 'Passwords stay masked until you click the eye; copies clear from the clipboard on a timer',
    },
    inline: {
      title: 'In-page fill panel: pick an account right beside the field',
      sub: 'Open it with Cmd/Ctrl+Shift+K, with site icons, tags and favorite marks',
    },
    prefs: {
      title: '6 color themes plus an English/Chinese UI, switched instantly',
      sub: 'Applies to extension pages and injected overlays; every shortcut is customizable',
    },
    encryption: {
      title: 'Encrypted locally: passwords stay in your browser, encrypted at rest',
      sub: 'PBKDF2 with 600,000 iterations plus AES-256-GCM; password data is never uploaded',
    },
    floating: {
      title: 'Floating fill button: reach the panel without leaving the login page',
      sub: 'Drag it anywhere and it snaps to the screen edge; opacity adjustable from 10% to 100%',
    },
    autosave: {
      title: 'Save passwords as you sign in: confirm once, de-duplicated',
      sub: 'A changed password switches the prompt to update mode; an identical pair is not asked again',
    },
    backup: {
      title: 'Import, export and encrypted backups: your data stays portable',
      sub: 'CSV and JSON both ways, plus encrypted .aph backups and email backup reminders',
    },
    generator: {
      title: 'Generator with two modes: random characters or a passphrase',
      sub: '6 to 50 characters with ambiguous ones excluded; passphrases draw 3 to 8 words plus optional digits',
    },
    trash: {
      title: 'Trash and history: recover a deletion, roll back a change',
      sub: 'Deleted entries stay recoverable for 30 days; each password keeps 3 encrypted snapshots',
    },
  },
};

/** 管理页与侧边栏上的入口文案（按界面语言不同），供截图 / 录制脚本点击定位用。 */
export const UI = {
  zh: {
    audit: '安全体检',
    prefs: '偏好设置',
    detail: '查看详情',
    data: '数据管理',
    trash: '回收站',
    add: '添加密码',
    fillAndLogin: '填充并登录',
  },
  en: {
    audit: 'Health Check',
    prefs: 'Preferences',
    detail: 'View details',
    data: 'Data Management',
    trash: 'Trash',
    add: 'Add Password',
    fillAndLogin: 'Fill and sign in',
  },
};
