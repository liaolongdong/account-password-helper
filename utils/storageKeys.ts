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
  /** 管理页每页条数（仅存 50/100/200 之一的视图偏好，不含任何条目数据） */
  VAULT_PAGE_SIZE: 'vault_page_size',
  FLOATING_BUTTON_CONFIG: 'floating_button_config',
  EMAIL_BACKUP_CONFIG: 'email_backup_config',
  LAST_AUTO_BACKUP_TIME: 'last_auto_backup_time',
  /** 最近一次「通过完整性自检」的加密 .aph 导出时间戳（epoch 毫秒），用于「距上次成功备份 N 天」提醒 */
  LAST_VERIFIED_BACKUP_AT: 'last_verified_backup_at',
  /**
   * 最近一次「与备份相关」的密码变更时间戳（epoch 毫秒）
   *
   * 由 Service Worker 的 `storage.onChanged` 写入，判据见 `utils/backup/changeDetection`
   * 的 `isBackupRelevantPasswordChange`——使用痕迹（`lastUsedAt` / `favoriteUsedAt`）刻意不算，
   * 否则每次自动填充都会把用户推向一次多余的备份提醒。只存时间戳，不含任何条目数据。
   */
  LAST_PASSWORD_CHANGE_AT: 'last_password_change_at',
  /**
   * 最近一次「与备份相关」的身份库变更时间戳（epoch 毫秒）
   *
   * 与上一键同一形态，判据为 `isBackupRelevantIdentityChange`。之所以要单独存而不能
   * 由身份记录的 `max(updateTime)` 推出来：`deleteIdentities` 只删记录，删掉最新那条后
   * 最大值会变小，删除就判不出来了。只存时间戳，不含任何 PII。
   */
  LAST_IDENTITY_CHANGE_AT: 'last_identity_change_at',
  /**
   * 最近一次**完整**导出加密 .aphid 身份备份的时间戳（epoch 毫秒）
   *
   * 只在导出范围覆盖全部条目时写入——部分勾选导出并不构成「身份库已备份」，
   * 此时提醒必须留着。刻意不由明文 .json 导出触发：那条通道是隐私边界例外，
   * 提醒文案要求的就是加密备份。只存时间戳，不含任何 PII。
   */
  LAST_IDENTITY_BACKUP_AT: 'last_identity_backup_at',
  AUTO_SAVE_CONFIG: 'auto_save_config',
  IDLE_LOCK_CONFIG: 'idle_lock_config',
  CLIPBOARD_CONFIG: 'clipboard_config',
  FAVORITE_LIMIT: 'favorite_limit',
  SIDEPANEL_SORT_CONFIG: 'sidepanel_sort_config',
  UPDATE_INFO: 'extension_update_info',
  /** 回收站条目（软删除，30 天 TTL 自动清理） */
  TRASH: 'account_passwords_trash',
  /** 密码修改历史记录（每条最多 N 条快照） */
  PASSWORD_HISTORY: 'password_change_history',
  /** 密码历史记录配置（启用/禁用 + 最大保留条数） */
  PASSWORD_HISTORY_CONFIG: 'password_history_config',
  /** 身份信息库条目（个人信息收藏夹，整块加密存储） */
  IDENTITY: 'personal_identity_infos',
  /**
   * 身份信息库回收站（软删除，30 天 TTL 自动清理）
   *
   * 落盘形状 = `IdentityRecord` 四键 + `deletedAt`，密文原样搬移（与密码库 TRASH 同一口径）。
   * 注意不能复用密码库的 `TRASH` 键：两侧条目形状不同，且 at-rest 安全网按
   * `encrypted` 标志扫描密码形状，混入身份形状会被误判为明文残留。
   */
  IDENTITY_TRASH: 'personal_identity_infos_trash',
  /** 身份信息库列表排序档位（仅存枚举值，不含任何 PII，故明文单键） */
  IDENTITY_SORT_MODE: 'identity_sort_mode',
  /**
   * 身份信息库访问配置（仅存复验策略枚举，不含任何 PII，故明文单键）
   *
   * 与 `IDENTITY_SORT_MODE` 同一形态：值只有三个字符串常量，读写都只在 Options 链路。
   * 非法值不得被当作「免复验」，归一化口径见 `utils/identityVaultAccess.ts`。
   */
  IDENTITY_VAULT_ACCESS_CONFIG: 'identity_vault_access_config',
  /**
   * 身份信息库 `manual` 档的手排顺序（明文 `string[]`，只存条目 id，上限同 `MAX_IDENTITIES`）
   *
   * 与排序档位同一形态：id 是 `generateId()` 产出的随机串，不携带任何 PII，
   * 因此无需进密文；读写只出现在 Options 的身份库弹窗链路上，不得被侧边栏首屏闭包引用。
   */
  IDENTITY_MANUAL_ORDER: 'identity_manual_order',
  /** 密码到期提醒配置（每条目独立提醒时间） */
  PASSWORD_REMINDERS: 'password_reminders',
  /** 健康评分趋势快照（只存分数与四类计数，不含任何条目内容或明文） */
  HEALTH_HISTORY: 'password_health_history',
  /** 用户语言偏好（'zh-CN' | 'en'） */
  LOCALE: 'app_locale',
  /** 站点级填充规则（域名 → 自定义选择器/穿透开关） */
  SITE_RULES: 'site_rules',
  /** 跨子域匹配档位（仅存枚举值，不含任何域名/账号信息） */
  DOMAIN_MATCH_CONFIG: 'domain_match_config',
  /** 侧边栏打开性能埋点环形日志（最近 20 次，用于生产环境量化白屏/卡顿） */
  SIDEPANEL_PERF_LOG: 'sidepanel_perf_log',
  /** 平台检测结果持久化（是否 Windows），供 SW 冷启动早期 getPlatformInfo 异常时兜底 */
  PLATFORM_IS_WINDOWS: 'platform_is_windows',
  /** 内联填充首次引导气泡已展示标记（终生仅展示一次） */
  INLINE_FILL_HINT_SHOWN: 'inline_fill_hint_shown',
  /**
   * 个人信息提示的「开关在哪」首次说明已展示标记（终生仅展示一次）
   *
   * 只存一个布尔，不含站点、字段名或库内内容，因此不构成隐私面。
   */
  IDENTITY_HINT_TIP_SHOWN: 'identity_hint_tip_shown',
  /**
   * 新手引导（聚光引导）状态
   *
   * 仅存 `{ seen, outcome, finishedAt }` 三个标记位，不含任何账号、密码、
   * 站点或步骤内容，因此本键不构成隐私面。自动弹出终生仅一次。
   */
  ONBOARDING_TOUR: 'onboarding_tour_state',
  /** 安全起步清单暂不提醒时间（只存时间戳，不含账号数据） */
  ACTIVATION_CHECKLIST: 'activation_checklist',
  /** 已读过「本次更新」的扩展版本（只存版本号字符串，不含账号数据） */
  WHATS_NEW_SEEN_VERSION: 'whats_new_seen_version',
  /** 一次性评价引导状态（只存首次成功填充、永久关闭与延后截止时间戳，不含账号数据） */
  REVIEW_PROMPT_STATE: 'review_prompt_state',
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
  /**
   * 浏览器启动重锁屏障状态（{ status: 'pending' | 'complete' | 'failed' }）。
   *
   * onStartup 在读取配置/清理会话前先写 pending；GET_INITIAL_DATA 与 Side Panel
   * 本地回退路径在 pending 期间等待，失败时保持锁定，避免重启后立即打开面板时
   * 旧持久会话在异步 clearSession 完成前短暂恢复。
   */
  BROWSER_STARTUP_RELOCK_STATE: 'browser_startup_relock_state',
  /**
   * 当前浏览器会话已通过显式认证/安全初始化恢复启动重锁屏障。
   *
   * 与 BROWSER_STARTUP_RELOCK_STATE 分键存储，避免 onInstalled、配置变更或
   * createSession 的异步 complete 写入覆盖仍在执行的 pending 启动重锁。
   * failed 状态仅在本标记明确引用同一次失败后才允许恢复。
   */
  BROWSER_STARTUP_RELOCK_RECOVERY: 'browser_startup_relock_recovery',
  /**
   * 待保存凭据密钥仓（`"<tabId>:<origin>"` → `{ k: hex 密钥, t: 签发时间戳 }` 聚合对象）
   *
   * 供 content script 加解密落在宿主页面 sessionStorage 的「待确认保存」凭据。密钥
   * 只存在这里：storage.session 仅内存、默认 TRUSTED_CONTEXTS，宿主页面与本扩展的
   * 内容脚本都读不到，因此页面侧只剩不可解的密文。按 tab + origin 隔离，等价于
   * sessionStorage 自身的作用域边界，同站导航后新文档可解回、跨站与跨标签页不可。
   */
  PENDING_CIPHER_KEYS: 'pending_cipher_keys',
  /**
   * 本地开发页的环境绑定（`"<host>:<port>"` → `{ env, at }` 聚合对象）
   *
   * 用户在侧边栏芯片上声明「这个 localhost:3000 页面其实是 fat.example.com 环境的前端」，
   * 后台据此把该环境的条目并入本站判定。只存主机名，不含任何凭证。
   *
   * 选 storage.session 而不是 storage.local 是刻意的安全取舍：绑定等于「让另一个主机的
   * 凭证可被填进眼前这一页」，这类授权不该活过浏览器重启。落盘的话，一次为临时联调点的
   * 「prod」会在下次开机后仍然把线上账号摆在本地页首位。
   */
  ENV_BINDINGS: 'env_bindings',
  /**
   * 本会话内已确认过「把线上环境账号带到本地页」的环境主机（字符串数组）
   *
   * 与 ENV_BINDINGS 同生命周期：确认只对这一次开机有效，下次再选 prod 仍需确认。
   */
  ENV_PROD_ACKS: 'env_prod_acks',
};
