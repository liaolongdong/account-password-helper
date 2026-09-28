/**
 * 待确认凭据编解码器
 *
 * 自动保存弹窗需要在传统表单提交跳转后于新页面复现，因此「待确认凭据」必须短暂寄存在
 * 宿主页面可达的 sessionStorage 中。本模块负责其加解密，且**刻意不触碰任何存储**：
 * 密钥由调用方（内容脚本向 background 申请）显式传入，使「解密密钥从不进入页面可达
 * 存储」这一安全属性由函数签名本身保证，而非依赖调用纪律。
 *
 * 方案为 XOR 流加密 + 自校验信封：
 * - 内容脚本运行在页面的安全上下文判定下，`http://` 站点拿不到 `crypto.subtle`，
 *   因此不能用 AES-GCM；XOR 配一次性随机密钥是本场景下唯一两端都可用的选择。
 * - 信封内的自校验值（`crypto-light` 的 DJB2，非密码学哈希）用于识别「密钥不符」：
 *   错误密钥解出的是乱码，摘要对不上即返回 null，调用方无需自己辨别半成品明文。
 *   它防的是误用与脏数据，不防蓄意伪造（本场景也没有伪造动机）。
 *
 * 定位是「抵御页面脚本一步读走明文凭据」，不是抗主动密码学攻击；凭据自身 30 秒即失效。
 *
 * @module utils/pendingCredentialCodec
 */

import { hashStringLight } from '@/utils/crypto-light';

/** 自校验信封：明文 + 明文摘要，用于识别密钥不符导致的乱码 */
interface PendingEnvelope {
  /** 明文 */
  p: string;
  /** `hashStringLight(p)`，解密侧一致性校验 */
  s: number;
}

/**
 * 与密钥按字节循环异或（加解密同一操作）
 * @throws 密钥为空时抛错，而非按 `i % 0 = NaN` 静默产出全零密文
 */
function xorWithKey(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0) throw new Error('pending credential cipher key must not be empty');
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

/** 逐字符累积，避免 `String.fromCharCode(...bytes)` 在大数组上爆栈 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 加密待确认凭据
 * @param plaintext 明文字符串
 * @param key 由 background 签发的随机密钥（hex）
 * @returns base64 密文，可安全写入宿主页面可达的存储
 */
export function encryptPendingCredential(plaintext: string, key: string): string {
  const envelope: PendingEnvelope = { p: plaintext, s: hashStringLight(plaintext) };
  const data = new TextEncoder().encode(JSON.stringify(envelope));
  return bytesToBase64(xorWithKey(data, new TextEncoder().encode(key)));
}

/**
 * 解密待确认凭据
 *
 * 任何一步不合预期（非法 base64、非 UTF-8、非信封结构、摘要不符）都视为「拿不到」，
 * 统一返回 null 交由调用方清除脏数据。
 *
 * @param ciphertext base64 密文
 * @param key 与加密时同一把密钥
 * @returns 明文；无法可信还原时为 null
 */
export function decryptPendingCredential(ciphertext: string, key: string): string | null {
  try {
    const bytes = xorWithKey(base64ToBytes(ciphertext), new TextEncoder().encode(key));
    // fatal: true —— 错误密钥解出的乱码在此即抛，不留下游解析半成品明文的机会
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const envelope = JSON.parse(raw) as Partial<PendingEnvelope> | null;
    if (!envelope || typeof envelope.p !== 'string' || typeof envelope.s !== 'number') return null;
    if (envelope.s !== hashStringLight(envelope.p)) return null;
    return envelope.p;
  } catch {
    return null;
  }
}
