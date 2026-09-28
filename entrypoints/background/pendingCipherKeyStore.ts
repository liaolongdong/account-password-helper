/**
 * 待保存凭据密钥仓
 *
 * 「自动保存确认弹窗」的凭据在页面跳转后仍需复现，历史上把密文和解密密钥一起放在
 * 宿主页面可达的 sessionStorage 里 —— 页面任意脚本一次读取即可完成还原。本模块把密钥
 * 收进 chrome.storage.session（仅内存、默认 TRUSTED_CONTEXTS，宿主页面与内容脚本均不可读），
 * 页面侧只留不可解的密文，容器位置与键名保持不变。写入因多了一次跨进程往返而改为异步，
 * 由内容脚本侧的代数守卫维持「清除必定落在写入之后」的次序。
 *
 * 作用域取自消息发送方上下文（`sender.tab.id` + `sender.url` 的 origin，均由 Chrome 填充，
 * 不接受调用方自报），与 sessionStorage 自身的 per-origin 隔离边界一致：同一标签页同一
 * 站点在页面导航后拿到同一把密钥（可解回），跨站点、跨标签页各自独立。
 *
 * @module entrypoints/background/pendingCipherKeyStore
 */

import { logger } from '@/utils/logger';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { bytesToHex } from '@/utils/crypto-light';

/**
 * 单条密钥的最长存活时间（毫秒）
 *
 * 待确认凭据自身 30 秒即作废，密钥只需活到「同站导航后的新文档解回」那一刻；
 * 取 4 倍余量覆盖慢导航，不再拉长敏感派生物在内存中的存活时间。
 * 超出即视为标签页关闭留下的残骸，由下次签发顺带清除。
 */
export const PENDING_CIPHER_KEY_TTL_MS = 2 * 60 * 1000;

/** 聚合仓中的单条记录：密钥 + 签发时间戳 */
interface PendingCipherKeyEntry {
  /** XOR 密钥（32 字节随机值的 hex 表示） */
  k: string;
  /** 签发时间戳（epoch 毫秒） */
  t: number;
}

/** 聚合仓：`"<tabId>:<origin>"` → 记录 */
type PendingCipherKeyMap = Record<string, PendingCipherKeyEntry>;

/**
 * 读改写串行化队列
 *
 * 聚合仓是「整对象覆盖」写入，短时间内的多次签发若并发读改写，后写会覆盖前写，
 * 导致前一个 origin 的密钥静默丢失（表现为跳转后弹窗偶发不复现）。排队执行消除该窗口。
 */
let _queue: Promise<unknown> = Promise.resolve();

/**
 * 从发送方上下文推导密钥作用域
 * @returns `"<tabId>:<origin>"`；上下文不足以唯一归属时返回 null
 */
function resolveScope(sender: chrome.runtime.MessageSender): string | null {
  const tabId = sender?.tab?.id;
  const documentUrl = sender?.url ?? sender?.tab?.url;
  if (typeof tabId !== 'number' || typeof documentUrl !== 'string' || !documentUrl) return null;
  try {
    const { origin } = new URL(documentUrl);
    // opaque origin（about:blank / about:srcdoc / 沙箱帧）的 sessionStorage 归属继承父上下文，
    // 折叠成 "<tab>:null" 会让密钥作用域比容器作用域更粗（同标签页多个此类帧共用一把），
    // 无法与容器一一对应，故不签发。
    if (!origin || origin === 'null') return null;
    return `${tabId}:${origin}`;
  } catch {
    return null;
  }
}

/**
 * 签发（或复用）当前 tab + origin 的凭据密钥
 *
 * @param sender 消息发送方上下文；必须同时具备 tab.id 与可解析的文档 URL
 * @returns 64 位 hex 密钥；无法可信归属请求方（缺 tab 上下文或 opaque origin）或 storage.session
 *   读写异常时返回 null（fail-closed，不签发）
 */
export async function issuePendingCipherKey(sender: chrome.runtime.MessageSender): Promise<string | null> {
  const scope = resolveScope(sender);
  if (!scope) return null;

  const task = _queue.then(async () => {
    const stored = await chrome.storage.session.get(SESSION_MEMORY_KEYS.PENDING_CIPHER_KEYS);
    const aggregate = stored[SESSION_MEMORY_KEYS.PENDING_CIPHER_KEYS] as PendingCipherKeyMap | undefined;
    const now = Date.now();

    // 顺带清扫：过期与结构损坏的记录在重建对象时丢弃，无需额外定时器与标签页监听
    const alive: PendingCipherKeyMap = {};
    for (const [scopeKey, entry] of Object.entries(aggregate ?? {})) {
      if (!entry || typeof entry.k !== 'string' || typeof entry.t !== 'number') continue;
      if (now - entry.t > PENDING_CIPHER_KEY_TTL_MS) continue;
      alive[scopeKey] = entry;
    }

    const existing = alive[scope];
    if (existing) return existing.k;

    const key = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    alive[scope] = { k: key, t: now };
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.PENDING_CIPHER_KEYS]: alive });
    return key;
  });

  // 队列只关心「上一步别和我的写冲突」，失败由调用方各自处理
  _queue = task.catch(() => undefined);

  try {
    return await task;
  } catch (error) {
    logger.error('签发待保存凭据密钥失败:', error);
    return null;
  }
}
