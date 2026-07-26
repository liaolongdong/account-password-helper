/**
 * Storage 键名常量
 *
 * 从 encryption.ts 分离为独立模块，避免仅需存储键名的模块
 * 因导入 STORAGE_KEYS 而不必要地拉入整个 Web Crypto 实现。
 */
export const STORAGE_KEYS = {
  PASSWORDS: 'account_passwords',
  MASTER_PASSWORD: 'master_password_config',
  SETTINGS: 'app_settings',
  MASTER_PASSWORD_VALIDITY: 'master_password_validity',
  SORT_CONFIG: 'password_sort_config',
  FLOATING_BUTTON_CONFIG: 'floating_button_config',
  EMAIL_BACKUP_CONFIG: 'email_backup_config',
  LAST_AUTO_BACKUP_TIME: 'last_auto_backup_time',
  AUTO_SAVE_CONFIG: 'auto_save_config',
  IDLE_LOCK_CONFIG: 'idle_lock_config',
  CLIPBOARD_CONFIG: 'clipboard_config',
  FAVORITE_LIMIT: 'favorite_limit',
  SIDEPANEL_SORT_CONFIG: 'sidepanel_sort_config',
  UPDATE_INFO: 'extension_update_info',
  /** 回收站条目（软删除，30 天 TTL 自动清理） */
  TRASH: 'account_passwords_trash',
  /** 密码修改历史记录（每条最多 5 条快照） */
  PASSWORD_HISTORY: 'password_change_history',
  /** 密码到期提醒配置（每条目独立提醒时间） */
  PASSWORD_REMINDERS: 'password_reminders',
  /** 用户语言偏好（'zh-CN' | 'en'） */
  LOCALE: 'app_locale',
  /** 侧边栏打开性能埋点环形日志（最近 20 次，用于生产环境量化白屏/卡顿） */
  SIDEPANEL_PERF_LOG: 'sidepanel_perf_log',
};

/**
 * storage.session 键名常量（仅内存，不落盘，浏览器/扩展重启即清）
 *
 * 用于缓存会话期派生的数据加密密钥，使 storage.local 始终只存密文（严重-1 修复），
 * 明文密码仅存在于易失内存。默认访问级别 TRUSTED_CONTEXTS 已排除内容脚本。
 */
export const SESSION_MEMORY_KEYS = {
  /** 会话期派生的 AES-256-GCM 数据密钥（hex） */
  DATA_KEY: 'session_data_key',
};
