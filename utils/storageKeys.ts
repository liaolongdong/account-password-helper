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
  /** 平台检测结果持久化（是否 Windows），供 SW 冷启动早期 getPlatformInfo 异常时兜底 */
  PLATFORM_IS_WINDOWS: 'platform_is_windows',
  /** 内联填充首次引导气泡已展示标记（终生仅展示一次） */
  INLINE_FILL_HINT_SHOWN: 'inline_fill_hint_shown',
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
  /** 侧边栏打开请求记录（{ at: epoch 毫秒, trigger: 触发源 }），用于量化「用户点击 → 渲染进程 timeOrigin」耗时与打开路径归因 */
  SIDEPANEL_OPEN_REQUESTED_AT: 'sidepanel_open_requested_at',
  /** 侧边栏资源预热上次执行时间戳（epoch 毫秒），跨 SW 生命周期保持节流窗口有效 */
  SIDEPANEL_WARM_AT: 'sidepanel_warm_at',
  /**
   * 密码缓存加密快照（{ passwords, sortConfig, timestamp } JSON 经 AES-GCM 加密，Base64 编码）
   *
   * SW 侧 warmPasswordCache / getOrWarmCache 成功后写入，侧边栏冷启动时直读解密，
   * 跳过 SW 唤醒 + storage.local 磁盘 IO + 逐条 AES-GCM 解密，将数据加载从 200-3000ms 压缩至 <50ms。
   * 仅内存（浏览器关闭即清）、TRUSTED_CONTEXTS 访问（内容脚本不可读）。
   */
  PASSWORD_CACHE_SNAPSHOT: 'password_cache_snapshot',
  /**
   * 元数据防抖 flush 打标时间戳（epoch 毫秒）
   *
   * flushMetadataUpdates 写入 account_passwords 前设置，供 SW 的 storage 变更监听
   * 识别「仅元数据变更」：命中时原地修补内存缓存与快照（零全量解密、快照无缺失），
   * 避免使用痕迹落盘击穿侧边栏快照直读快路径。短 TTL 消费后即移除。
   */
  METADATA_FLUSH_AT: 'metadata_flush_at',
  /**
   * 会话锁定状态快速镜像（纯内存，不落盘，浏览器重启自动清除）
   *
   * 格式：{ locked: boolean; expiresAt?: number }
   * - createSession() 写入 { locked: false, expiresAt }
   * - clearSession() / markSessionInvalid() 写入 { locked: true }
   *
   * 侧边栏 isSessionQuicklyKnownInvalid() 优先读取本键（storage.session IPC 为纯内存操作，
   * 不受磁盘 IO /杀毒扫描影响），消除 Windows 内网慢磁盘场景下 storage.local 读取
   * 延迟（200-500ms）导致 _quickKnownInvalid 迟迟不就绪、骨架屏延伸至 2.5-5s 的白屏问题。
   * 浏览器重启后 storage.session 清空，自动降级到 storage.local 兜底（语义不变）。
   */
  SESSION_LOCK_STATE: 'session_lock_state',
};
