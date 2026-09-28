/**
 * 账号密码条目总量上限
 *
 * 存在理由（不是防护性设计，是实测结论）：管理页的整表渲染成本随行数**超线性**增长
 * （终版产物同一口径实测：600 行整表挂载中位 16.5 秒、1200 行 52.5 秒、2000 行 180.2 秒，
 * 拟合指数 1.67～2.0，数据见 docs/PERF_LARGE_VAULT_EVALUATION.md 9.10）。条目数一旦失去上界，
 * 「打开管理页」这件事本身就会不可用，而数据仍在存储里、用户无从降级。
 * 因此在**写入侧**收口总量：只让三条会让条数变长的路径受限
 * （savePassword / batchSavePasswords / restoreFromTrash），
 * 更新与删除永不因此被拦。
 *
 * 上限刻意保持为内部常量而非偏好设置：偏好的语义是「用户可取的任意值」，
 * 而这里的数字是渲染成本的物理边界，暴露成设置只会让用户调到不可用的档位。
 */

/** 账号密码条目总量上限（含回收站之外的主列表，不含回收站条目） */
export const MAX_PASSWORD_ENTRIES = 2000;

/** 超限错误的稳定判别码，供各入口映射为用户文案 */
export const VAULT_CAPACITY_ERROR_CODE = 'vault-capacity-exceeded';

/**
 * 条目总量超限错误
 *
 * 只携带计数与额度，绝不携带条目内容：该错误会被 background 记入日志，
 * 也可能被上层透传到 UI。
 */
export class VaultCapacityError extends Error {
  /** 判别码（跨 chunk 时用 isVaultCapacityError 判等，不依赖 instanceof） */
  readonly code = VAULT_CAPACITY_ERROR_CODE;

  /** 当前已有条数 */
  readonly current: number;

  /** 本次试图新增的条数 */
  readonly incoming: number;

  /** 允许的上限条数 */
  readonly max: number;

  constructor(current: number, incoming: number, max: number = MAX_PASSWORD_ENTRIES) {
    super(`账号密码条目数超出上限：当前 ${current} 条，本次新增 ${incoming} 条，上限 ${max} 条`);
    this.name = 'VaultCapacityError';
    this.current = current;
    this.incoming = incoming;
    this.max = max;
  }
}

/**
 * 判断一个未知错误是否为条目总量超限
 *
 * 用判别码而非 `instanceof`：错误可能跨入口/跨 chunk 边界抛出，
 * 类标识不一定同一，而 `code` 是稳定的。
 */
export function isVaultCapacityError(error: unknown): error is VaultCapacityError {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === VAULT_CAPACITY_ERROR_CODE &&
    typeof (error as { current?: unknown }).current === 'number'
  );
}

/**
 * 纯函数校验：写入后总条数是否仍在上限内
 *
 * 放在读取到当前条数之后、任何加密与写入之前——超限时应当连派生密钥与加密的开销都不付。
 *
 * @param current - 当前已有条数
 * @param incoming - 本次新增条数
 * @param max - 上限，默认取模块常量
 * @throws VaultCapacityError 超出上限时抛出
 */
export function assertWithinCapacity(current: number, incoming: number, max: number = MAX_PASSWORD_ENTRIES): void {
  if (incoming <= 0) return;
  if (current + incoming > max) {
    throw new VaultCapacityError(current, incoming, max);
  }
}

/**
 * 剩余可写入条数
 *
 * @param current - 当前已有条数
 * @returns 还允许新增多少条；已满时为 0（不为负，避免调用方把负数当额度用）
 */
export function remainingCapacity(current: number, max: number = MAX_PASSWORD_ENTRIES): number {
  return Math.max(0, max - current);
}
