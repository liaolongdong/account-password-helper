/**
 * 身份信息库的复验策略判定
 *
 * 单独成模块的原因：这是一个**安全决策**，但它只有纯函数形态才可测——调用点在
 * `entrypoints/options/App.vue` 的开窗门槛里，那里没有 DOM 环境可跑。把「要不要问」
 * 与「存哪儿」分开，本文件负责语义，`utils/storage/configManager.ts` 负责落盘。
 *
 * 三档共同的既有事实：身份库解密始终走全局会话数据密钥，本策略**不改变**密码学边界，
 * 只决定「打开前要不要再让用户证明一次知道主密码」。因此 `followValidity` 并不会
 * 让明文多活一秒——它去掉的是一次人为确认，威胁模型见 `shouldVerifyIdentityVault`。
 */
import type { IdentityVaultVerifyPolicy } from '@/utils/types';

/** 复验策略的合法取值（顺序即设置界面下拉的展示顺序，从最严格到最宽松） */
export const IDENTITY_VERIFY_POLICIES: readonly IdentityVaultVerifyPolicy[] = [
  'always',
  'perSession',
  'followValidity',
];

/** 默认策略：本会话内复验一次 */
export const DEFAULT_IDENTITY_VERIFY_POLICY: IdentityVaultVerifyPolicy = 'perSession';

/**
 * 把任意来源的策略值归一化为合法值
 *
 * 回落方向刻意选**最严格**的 `always` 而不是默认值：本键是安全开关，storage 被外部改写、
 * 或旧版本写入过非法值时，非法值不得等价于「少问一次」。因此这里不能写成 `value ?? default`。
 *
 * @param value 来自 storage 的原始值，按不可信输入处理
 * @returns 合法策略；无法识别时一律 `always`
 */
export function normalizeIdentityVerifyPolicy(value: unknown): IdentityVaultVerifyPolicy {
  return IDENTITY_VERIFY_POLICIES.includes(value as IdentityVaultVerifyPolicy)
    ? (value as IdentityVaultVerifyPolicy)
    : 'always';
}

/**
 * 判定本次打开身份库前是否还需要复验主密码
 *
 * 威胁模型（`always` 一档的既有理由）：防「会话已解锁但用户离开座位」时旁人一次性看到
 * 全部身份信息。`perSession` 保留这条——解锁后的第一次打开仍然要问；它省掉的是同一坐席内
 * 反复打开时的重复输入。`followValidity` 则明确放弃这条防护，只依赖全局有效期。
 *
 * `alreadyVerifiedInSession` 的「会话」粒度是**管理页文档生命周期**：它是模块内存变量，
 * 刷新或重开管理页即复位（比浏览器会话更严）。刻意不落 `chrome.storage.session`，
 * 因为那一层要跨 `clearSession()` 正确失效就得把复位点铺进会话边界模块，扩大改动面。
 *
 * @param policy 归一化后的策略
 * @param alreadyVerifiedInSession 本文档生命周期内是否已成功复验过
 * @returns 是否需要弹出主密码复验
 */
export function shouldVerifyIdentityVault(
  policy: IdentityVaultVerifyPolicy,
  alreadyVerifiedInSession: boolean,
): boolean {
  switch (policy) {
    case 'followValidity':
      return false;
    case 'perSession':
      return !alreadyVerifiedInSession;
    case 'always':
      return true;
  }
}
