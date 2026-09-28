/**
 * 云同步内容哈希
 *
 * 哈希范围（设计规格 §6.1）：**仅 7 个同步字段**
 * （username/password/url/tag/remark/totp/groupPath）
 * 按固定顺序参与计算，**明确不含 ID、updateTime、云端修改时间**——扩展自身推送会刷新
 * 云端 record 修改时间，若混入会导致哈希恒 ≠ 快照，把「刚推完的行」误判为「云端侧变更」。
 *
 * 编码采用长度前缀（`${len}:${value}`）而非分隔符拼接，杜绝
 * 「"a|b" + "c"」与「"a" + "b|c"」产生同一哈希的歧义。
 */
import { bytesToHex } from '@/utils/crypto-light';
import { SYNCED_TEXT_FIELDS } from './schema';

/** 参与哈希的字段投影 */
export type HashableEntry = Record<(typeof SYNCED_TEXT_FIELDS)[number], string>;

/**
 * 计算条目内容哈希（SHA-256，hex）
 *
 * @param entry 含 7 个同步字段的对象；undefined/null 字段按空串处理
 */
export async function computeEntryHash(entry: Partial<HashableEntry>): Promise<string> {
  const parts = SYNCED_TEXT_FIELDS.map(field => {
    const value = entry[field] ?? '';
    return `${value.length}:${value}`;
  });
  return sha256Hex(parts.join('|'));
}

/**
 * 计算任意字符串的 SHA-256（hex）
 *
 * 供密文快照的 `snapshotHash`（完整 Blob）与 `partHash`（单个分片 Base64 串）复用。
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}
