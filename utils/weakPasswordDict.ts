/**
 * 离线弱口令字典校验模块
 *
 * 打包 top-1000 常见泄露密码（来源：公开 SecLists），零联网，
 * 懒加载 + Set O(1) 查找。首次调用时动态 import JSON 构建 Set，
 * 后续调用直接命中内存缓存，对初始包体积无影响。
 *
 * @module utils/weakPasswordDict
 */

import { logger } from '@/utils/logger';

/** 懒加载的弱密码 Set（大小写不敏感：存储时统一转小写） */
let _dictSet: Set<string> | null = null;

/** 加载中的 Promise（防止并发 import 重复加载） */
let _loadingPromise: Promise<Set<string>> | null = null;

/**
 * 加载弱密码字典（懒加载，仅首次触发 import）
 *
 * @returns 包含 top-1000 常见密码的 Set（全小写）
 */
async function loadDict(): Promise<Set<string>> {
  if (_dictSet) return _dictSet;

  if (!_loadingPromise) {
    _loadingPromise = import('@/utils/data/top1000.json')
      .then(module => {
        const list = (module.default ?? module) as string[];
        _dictSet = new Set(list.map(p => p.toLowerCase()));
        return _dictSet;
      })
      .catch(error => {
        // 加载失败时返回空 Set，不阻塞业务逻辑（fail-open），但记录日志便于排查
        logger.warn('WeakPasswordDict: 字典加载失败，弱口令校验降级为空字典:', error);
        _dictSet = new Set();
        return _dictSet;
      })
      .finally(() => {
        _loadingPromise = null;
      });
  }

  return _loadingPromise;
}

/**
 * 判断密码是否在常见泄露密码列表中（大小写不敏感）
 *
 * 首次调用时懒加载字典文件（约 8-10KB），后续 O(1) 查找。
 * 空密码直接返回 false（无需查字典）。
 *
 * @param pwd 待检查的密码明文
 * @returns 是否为常见泄露密码
 */
export async function isCommonPassword(pwd: string): Promise<boolean> {
  if (!pwd) return false;
  const dict = await loadDict();
  return dict.has(pwd.toLowerCase());
}

/**
 * 批量检查密码列表中哪些命中字典（用于安全体检批量场景）
 *
 * @param passwords 密码明文数组
 * @returns 命中字典的密码索引集合
 */
export async function filterCommonPasswords(passwords: string[]): Promise<Set<number>> {
  const dict = await loadDict();
  const hits = new Set<number>();
  for (let i = 0; i < passwords.length; i++) {
    const pwd = passwords[i];
    if (pwd && dict.has(pwd.toLowerCase())) {
      hits.add(i);
    }
  }
  return hits;
}
