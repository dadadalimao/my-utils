/**
 * API响应数据结构
 * @interface ApiResponse
 * @template T - 响应数据类型
 */
export interface ApiResponse<T> {
  code?: number | null;
  data?: T | null;
  msg?: null | string;
  total?: number | null;
}

/**
 * 通用缓存管理器 - 用于管理任意数据的获取和缓存
 * @class CacheManager
 * @template T - 缓存数据类型
 * @example
 * // 创建一个缓存管理器实例
 * const userCache = CacheManager.getInstance<UserInfo>('user');
 *
 * // 使用缓存管理器包装API请求
 * const getUserInfo = (userId: string) =>
 *   userCache.getOrFetch(userId, () => apiGetUserInfo(userId));
 */
export default class CacheManager<T> {
  private static instances: Map<string, CacheManager<any>> = new Map();

  private cache: Map<string, T> = new Map();

  private pendingRequests: Map<string, Promise<T>> = new Map();

  protected constructor(private namespace: string) { }

  /**
     * 获取缓存管理器实例
     * @param namespace - 缓存命名空间
     */
  static getInstance<T>(namespace: string): CacheManager<T> {
    if (!this.instances.has(namespace)) {
      this.instances.set(namespace, new CacheManager<T>(namespace));
    }
    return this.instances.get(namespace) as CacheManager<T>;
  }

  /**
     * 获取或加载数据
     * @param key - 缓存键
     * @param fetchFn - 获取数据的函数
     */
  async getOrFetch(
    key: string,
    fetchFn: () => Promise<ApiResponse<T>>,
  ): Promise<T> {
    const cacheKey = `${this.namespace}:${key}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    // 使用try-catch-finally处理请求失败的情况
    const promise = fetchFn()
      .then((res) => {
        if (!res.data) throw new Error('API response missing data field');
        this.cache.set(cacheKey, res.data);
        return res.data;
      })
      .catch((error) => {
        // 请求失败时重新抛出错误，让调用者知道
        throw error;
      })
      .finally(() => {
        // 无论成功还是失败，都清理pendingRequests
        this.pendingRequests.delete(cacheKey);
      });

    this.pendingRequests.set(cacheKey, promise);
    return promise;
  }

  /**
     * 清除缓存
     * @param key - 指定要清除的缓存键，不传则清除该命名空间下所有缓存
     */
  clearCache(key?: string): void {
    if (key) {
      const cacheKey = `${this.namespace}:${key}`;
      this.cache.delete(cacheKey);
    } else {
      this.cache.clear();
    }
  }
}
