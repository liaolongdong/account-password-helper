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
};
