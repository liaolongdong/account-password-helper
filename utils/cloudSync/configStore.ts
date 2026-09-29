/**
 * 云同步配置存取（非敏感）
 *
 * 与凭证严格分离：本模块只存开关、模式、目标表标识与分片阈值，
 * 任何 token/secret 都不得写入这里（凭证见 credentialStore.ts）。
 */
import type {
  CloudProvider,
  CloudSyncConfig,
  CloudSyncMode,
  CloudSyncProviderConfig,
  ProviderTargetMap,
} from './types';
import { logger } from '@/utils/logger';
import { STORAGE_KEYS } from '@/utils/storageKeys';

/** 密文分片初始阈值（字符）：预留平台单元格上限余量，失败时动态减半 */
export const DEFAULT_CHUNK_SIZE = 48000;

/** 分片阈值动态降级下限，低于此值仍失败即终止 */
export const MIN_CHUNK_SIZE = 6000;

/** 密文快照默认保留版本数 */
export const DEFAULT_KEEP_VERSIONS = 3;

/** 保留版本数可选范围 */
export const KEEP_VERSIONS_OPTIONS = [1, 3, 5, 10] as const;

/** 非敏感基础字段（两个平台共用，target 由调用方按平台补齐） */
const BASE_PROVIDER_CONFIG = {
  configured: false,
  mode: 'encrypted' as const,
  chunkSize: DEFAULT_CHUNK_SIZE,
  lastSyncAt: null,
};

/**
 * 单平台默认配置
 *
 * 穷尽式 switch + never 兜底：新增 provider 时 TS 编译期强制补分支，
 * 防止静默落入其他平台（WebDAV 规格 §2.2）。
 */
function defaultProviderConfig<P extends CloudProvider>(provider: P): CloudSyncProviderConfig<P> {
  switch (provider) {
    case 'feishu':
      return {
        ...BASE_PROVIDER_CONFIG,
        // baseUrl 为 null 表示官方 SaaS；私有化部署地址在「测试连接」时归一化后写入
        target: { appToken: null, tableId: null, fileUrl: null, baseUrl: null, allowInsecure: false },
      } as CloudSyncProviderConfig<P>;
    case 'tencent':
      return {
        ...BASE_PROVIDER_CONFIG,
        target: { fileId: null, sheetId: null, fileUrl: null, baseUrl: null, allowInsecure: false },
      } as CloudSyncProviderConfig<P>;
    case 'webdav':
      return {
        ...BASE_PROVIDER_CONFIG,
        target: { dirUrl: null, backupDirUrl: null, allowInsecure: false },
      } as CloudSyncProviderConfig<P>;
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}

/** 默认配置：功能默认关闭，模式默认密文（安全形态） */
export function getDefaultCloudSyncConfig(): CloudSyncConfig {
  return {
    enabled: false,
    keepVersions: DEFAULT_KEEP_VERSIONS,
    providers: {
      feishu: defaultProviderConfig('feishu'),
      tencent: defaultProviderConfig('tencent'),
      webdav: defaultProviderConfig('webdav'),
    },
  };
}

/**
 * 归一化存储中的配置（防御不可信/旧版本数据）
 *
 * 逐字段校验类型与取值范围，非法值回退默认；providers 缺失时补齐，
 * 保证调用方拿到的永远是结构完整的配置对象。
 */
function normalizeConfig(raw: unknown): CloudSyncConfig {
  const defaults = getDefaultCloudSyncConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  const source = raw as Partial<CloudSyncConfig> & Record<string, unknown>;

  const keepVersions =
    typeof source.keepVersions === 'number' &&
    (KEEP_VERSIONS_OPTIONS as readonly number[]).includes(source.keepVersions)
      ? source.keepVersions
      : defaults.keepVersions;

  const providers = (source.providers ?? {}) as Partial<Record<CloudProvider, unknown>>;
  const normalized: CloudSyncConfig = { ...defaults, enabled: source.enabled === true, keepVersions };

  normalized.providers.feishu = normalizeProvider('feishu', providers.feishu, defaults.providers.feishu);
  normalized.providers.tencent = normalizeProvider('tencent', providers.tencent, defaults.providers.tencent);
  normalized.providers.webdav = normalizeProvider('webdav', providers.webdav, defaults.providers.webdav);
  return normalized;
}

/**
 * 归一化单平台配置（单态入参，避免泛型索引的交叉类型问题）
 *
 * 逐字段校验类型与取值范围，非法值回退默认；target 缺失时回退该平台默认目标。
 */
function normalizeProvider<P extends CloudProvider>(
  provider: P,
  stored: unknown,
  fallback: CloudSyncProviderConfig<P>,
): CloudSyncProviderConfig<P> {
  if (!stored || typeof stored !== 'object') return fallback;
  const value = stored as Partial<CloudSyncProviderConfig<P>> & Record<string, unknown>;
  // webdav 仅支持密文备份（WebDAV 规格 §3.2）：存储被篡改为 plaintext 时归一化纠正
  const mode: CloudSyncMode =
    provider === 'webdav' ? 'encrypted' : value.mode === 'plaintext' ? 'plaintext' : 'encrypted';
  const chunkSize =
    typeof value.chunkSize === 'number' && value.chunkSize >= MIN_CHUNK_SIZE && value.chunkSize <= DEFAULT_CHUNK_SIZE
      ? value.chunkSize
      : DEFAULT_CHUNK_SIZE;
  const target = (value.target ?? fallback.target) as ProviderTargetMap[P];
  return {
    configured: value.configured === true,
    mode,
    // 表格平台 target 补齐自定义服务地址与明文确认字段，其余平台原样透传
    target: (provider === 'feishu'
      ? withFeishuBaseUrl(target)
      : provider === 'tencent'
        ? withTencentBaseUrl(target)
        : target) as ProviderTargetMap[P],
    chunkSize,
    lastSyncAt: typeof value.lastSyncAt === 'number' ? value.lastSyncAt : null,
  };
}

/**
 * 补齐飞书 target 的 `baseUrl` 字段（私有化部署新增）
 *
 * 旧版本配置没有该字段：补 `null` 表示官方 SaaS，让调用方永远拿到结构完整的 target；
 * 其余字段按既有口径原样透传（不校验、不改写）。
 */
function withFeishuBaseUrl(target: unknown): ProviderTargetMap['feishu'] {
  const feishu = target as ProviderTargetMap['feishu'];
  return {
    ...feishu,
    baseUrl: typeof feishu?.baseUrl === 'string' ? feishu.baseUrl : null,
    allowInsecure: feishu?.allowInsecure === true,
  };
}

/** 补齐腾讯 target 的自定义地址字段（旧配置与损坏字段统一回退官方地址） */
function withTencentBaseUrl(target: unknown): ProviderTargetMap['tencent'] {
  const tencent = target as ProviderTargetMap['tencent'];
  return {
    ...tencent,
    baseUrl: typeof tencent?.baseUrl === 'string' ? tencent.baseUrl : null,
    allowInsecure: tencent?.allowInsecure === true,
  };
}

/** 读取云同步配置（失败降级为默认值：配置属可重建数据，异常不应阻断 UI） */
export async function getCloudSyncConfig(): Promise<CloudSyncConfig> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLOUD_SYNC_CONFIG);
    return normalizeConfig(result[STORAGE_KEYS.CLOUD_SYNC_CONFIG]);
  } catch (error) {
    logger.error('读取云同步配置失败:', error);
    return getDefaultCloudSyncConfig();
  }
}

/** 全量写入云同步配置 */
export async function saveCloudSyncConfig(config: CloudSyncConfig): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.CLOUD_SYNC_CONFIG]: normalizeConfig(config) });
  } catch (error) {
    logger.error('保存云同步配置失败:', error);
    throw error;
  }
}

/**
 * 增量更新单平台配置
 *
 * @param provider 平台标识
 * @param patch 需要覆盖的字段（target 为整体替换，避免半更新产生不一致目标）
 */
export async function patchProviderConfig(
  provider: CloudProvider,
  patch: Partial<CloudSyncProviderConfig<CloudProvider>>,
): Promise<CloudSyncConfig> {
  const config = await getCloudSyncConfig();
  // 穷尽式 switch：联合索引赋值会触发交叉类型错误，且新增 provider 时编译期强制补分支
  switch (provider) {
    case 'feishu':
      config.providers.feishu = {
        ...config.providers.feishu,
        ...patch,
      } as CloudSyncProviderConfig<'feishu'>;
      break;
    case 'tencent':
      config.providers.tencent = {
        ...config.providers.tencent,
        ...patch,
      } as CloudSyncProviderConfig<'tencent'>;
      break;
    case 'webdav':
      config.providers.webdav = {
        ...config.providers.webdav,
        ...patch,
      } as CloudSyncProviderConfig<'webdav'>;
      break;
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
  await saveCloudSyncConfig(config);
  return config;
}

/** 更新全局字段（开关、保留版本数） */
export async function patchGlobalConfig(
  patch: Pick<Partial<CloudSyncConfig>, 'enabled' | 'keepVersions'>,
): Promise<void> {
  const config = await getCloudSyncConfig();
  if (patch.enabled !== undefined) config.enabled = patch.enabled;
  if (patch.keepVersions !== undefined) config.keepVersions = patch.keepVersions;
  await saveCloudSyncConfig(config);
}

/**
 * 计算目标文档键（快照隔离与任务锁的 targetKey 组成部分）
 *
 * 目标未配置完整时返回 null，调用方据此判定「尚未就绪」。
 */
export function getDocKey<P extends CloudProvider>(provider: P, target: ProviderTargetMap[P]): string | null {
  switch (provider) {
    case 'feishu': {
      const t = target as ProviderTargetMap['feishu'];
      // 只取 app_token + table_id，不含 baseUrl：换服务器必然换文档链接，且改动键名会让
      // 既有用户的本地快照与任务锁全部失联（快照可重建但会退化为全量比对，无必要）
      return t.appToken && t.tableId ? `${t.appToken}:${t.tableId}` : null;
    }
    case 'tencent': {
      const t = target as ProviderTargetMap['tencent'];
      return t.fileId && t.sheetId ? `${t.fileId}:${t.sheetId}` : null;
    }
    case 'webdav': {
      // 备份目录 URL 即目标标识（WebDAV 规格 §3.3）；未探测成功前为空 → 未就绪
      const t = target as ProviderTargetMap['webdav'];
      return t.backupDirUrl ?? null;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unsupported provider: ${String(_exhaustive)}`);
    }
  }
}
