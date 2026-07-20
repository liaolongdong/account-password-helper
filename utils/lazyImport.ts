/**
 * 延迟加载模块工具
 * 提供通用的单例动态 import 缓存包装器，避免重复加载模块
 */

/**
 * 创建延迟加载模块的缓存包装器
 *
 * 将动态 import 包装为单例模式：首次调用时执行 loader 并缓存其 Promise，
 * 后续调用（含并发首调）复用同一 Promise，避免重复加载；加载失败时重置缓存以支持重试。
 *
 * @typeParam T - 模块类型（通常为 `typeof import('...')` 的返回值）
 * @param loader - 返回模块 Promise 的加载函数（通常为 `() => import('...')`）
 * @returns 一个异步函数，调用时返回缓存的模块实例
 *
 * @example
 * ```typescript
 * const getEncryption = lazyImport(() => import('@/utils/encryption'));
 * // 首次调用触发 dynamic import，后续调用返回缓存
 * const enc = await getEncryption();
 * ```
 */
export function lazyImport<T>(loader: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      // 缓存加载 Promise 而非结果值：并发首次调用共享同一次加载；
      // 失败时重置以保留“失败可重试”语义
      promise = loader().catch(error => {
        promise = null;
        throw error;
      });
    }
    return promise;
  };
}
