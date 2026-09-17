/**
 * 身份信息重复检测（纯函数，零 i18n / 零存储 / 零 Vue）
 *
 * 目标是抓「同一条信息被重复录入」，而非「同一身份证出现在多张卡上」。故：
 * - 银行卡号相同 → 直接命中（卡号对每张卡唯一，重复基本是重录）；
 * - 证件号码相同 → **仅当**该条还配有相同姓名（或相同卡号）才命中；纯证件号相同
 *   不算重复——同一身份证号的社保卡 / 银行卡本就应各存一条，误报会让人养成跳过确认的坏习惯。
 * 值均 `trim` + 大写归一（覆盖身份证末位 `X`/`x`）。调用方（`App.vue`）保存前据此弹
 * 二次确认，用户可「仍要保存」，故为**非阻断**提示。
 *
 * @module utils/identity/dedup
 */
import type { IdentityEntry, IdentityPayload } from './types';

/** 命中时可报告的字段键 */
export type IdentityDedupField = 'idNumber' | 'cardNo';

/** 判定所需读取的负载字段（证件号需姓名 / 卡号佐证，故一并读取姓名） */
export type IdentityDedupInput = Pick<IdentityPayload, 'name' | IdentityDedupField>;

/** 命中的疑似重复描述 */
export interface IdentityDuplicateMatch {
  /** 命中的既有条目 id（供调用方定位并展示其标题） */
  id: string;
  /** 命中的字段键 */
  field: IdentityDedupField;
}

/** 归一：去首尾空白 + 大写，空值归一为空串 */
function normalize(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * 在既有条目中查找与 `payload` 疑似重复的条目（按数组顺序命中首个）
 *
 * 逐条比较（排除 `excludeId` 自身）：卡号非空且相同即命中 `cardNo`；否则证件号非空
 * 且相同、并有相同姓名或相同卡号佐证时命中 `idNumber`。无命中返回 null。
 *
 * @param entries 当前库中已解密的条目（调用方保证为最新内存快照）
 * @param payload 待保存负载，只读取 `name` / `idNumber` / `cardNo`
 * @param excludeId 编辑态下需排除的自身条目 id
 * @returns 命中的条目 id 与字段，或 null
 */
export function findDuplicateIdentity(
  entries: readonly IdentityEntry[],
  payload: IdentityDedupInput,
  excludeId?: string,
): IdentityDuplicateMatch | null {
  const idNumber = normalize(payload.idNumber);
  const cardNo = normalize(payload.cardNo);
  const name = normalize(payload.name);
  for (const entry of entries) {
    if (entry.id === excludeId) continue;
    const otherId = normalize(entry.payload.idNumber);
    const otherCard = normalize(entry.payload.cardNo);
    const otherName = normalize(entry.payload.name);
    const sameCard = !!cardNo && otherCard === cardNo;
    const sameIdWithProof = !!idNumber && otherId === idNumber && ((!!name && otherName === name) || sameCard);
    if (sameIdWithProof) return { id: entry.id, field: 'idNumber' };
    if (sameCard) return { id: entry.id, field: 'cardNo' };
  }
  return null;
}
