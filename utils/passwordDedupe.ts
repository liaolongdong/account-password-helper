/**
 * 「一键去重」的分组纯函数
 *
 * 单独成文件而不是留在 `usePasswordManagement` 里，理由与 `utils/passwordHealth.ts` 同源：
 * 这是一个会**删除条目**的判定，必须能被单测直接钉住；留在 composable 里就只能靠挂载
 * 组件 + 打桩 ElMessageBox 才能验证「到底哪条被删」。
 *
 * 指纹口径（三者全等才算同一条）：
 * - `username`：按原样比较（去重不做大小写归一，避免把 `Alice` / `alice` 这类真实双账号合并）；
 * - `url`：按原样比较；
 * - `pathScope`：必须先归一化再比较——`desktop` / `/desktop` / `https://a.com/desktop`
 *   在匹配层是同一个作用域，不归一就会出现「显示重复、删完还剩一条同样作用的条目」。
 *
 * 为什么 pathScope 必须在指纹里：路径作用域的目标场景正是「同一域名、同一个人、不同路由
 * 各存一套账号」（`/#/desktop` 与 `/#/admin`），这类条目的 username + url 往往**刻意相同**。
 * 指纹缺 pathScope 时，一次「一键去重」就会把另一条真实账号判为重复删掉（可经回收站恢复，
 * 但用户并不知道那是另一个账号）。
 */
import type { PasswordEntry } from './types';
import { normalizePathScope } from './domain';
import { comparePasswordEntries, DEFAULT_SORT } from './passwordSort';

/** 去重扫描结果 */
export interface DuplicateScanResult {
  /** 每个重复组里除保留项之外、应当删除的条目 ID */
  idsToRemove: string[];
  /** 命中的重复组数（用于确认文案的「共 N 组」） */
  groupCount: number;
}

/**
 * 扫描重复条目并按「每组留一条」给出待删 ID
 *
 * 组内保留顺序完全复用公共比较器（`comparePasswordEntries` + `DEFAULT_SORT`）：
 * 收藏优先，其次 `updateTime` 降序，与列表排序口径一致，用户看到的第一条就是留下的那条。
 *
 * @param entries - 全量条目（通常为已解密的明文列表）
 * @returns 待删 ID 列表与重复组数；无重复时两者均为 0 / 空数组
 */
export function findDuplicatePasswordIds(entries: readonly PasswordEntry[]): DuplicateScanResult {
  const groups = new Map<string, PasswordEntry[]>();
  for (const entry of entries) {
    const key = [entry.username, entry.url, normalizePathScope(entry.pathScope)].join('|');
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const idsToRemove: string[] = [];
  let groupCount = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    groupCount += 1;
    group.sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SORT));
    for (let i = 1; i < group.length; i++) idsToRemove.push(group[i].id);
  }

  return { idsToRemove, groupCount };
}
