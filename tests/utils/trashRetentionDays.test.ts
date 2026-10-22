import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  TRASH_RETENTION_DAYS,
  TRASH_RETENTION_MS,
  getTrashRemainingDays,
  isTrashEntryExpired,
} from '@/utils/storage/trashRetention';

/**
 * 回收站「剩余天数」读数的边界回归
 *
 * 这个读数原先写在 `TrashDialog.vue` 里（自带一份 `RETENTION_DAYS = 30` 与逐行
 * `Date.now()`），收进数据层时最容易改错的是**除数**：按保留期整体（30 天）除会让
 * 整月都停在 30、到期当天跳到 0；按天除才与原实现逐格递减的读法一致。
 * 这里同时钉住两端钳位与「同一屏同一取样时刻」的可复现性。
 */

/** 一天的毫秒数 */
const DAY = 24 * 60 * 60 * 1000;

/** 固定基准时刻，避免测试依赖真实时钟 */
const NOW = 1_800_000_000_000;

describe('getTrashRemainingDays', () => {
  it('刚删除时显示满保留期', () => {
    expect(getTrashRemainingDays(NOW, NOW)).toBe(TRASH_RETENTION_DAYS);
  });

  it('按完整 24 小时逐格递减，不足一天不扣', () => {
    expect(getTrashRemainingDays(NOW - (DAY - 1), NOW)).toBe(TRASH_RETENTION_DAYS);
    expect(getTrashRemainingDays(NOW - DAY, NOW)).toBe(TRASH_RETENTION_DAYS - 1);
    expect(getTrashRemainingDays(NOW - 15 * DAY, NOW)).toBe(TRASH_RETENTION_DAYS - 15);
    expect(getTrashRemainingDays(NOW - 29 * DAY, NOW)).toBe(1);
  });

  it('到期与超期都钳到 0，不出现负数', () => {
    expect(getTrashRemainingDays(NOW - TRASH_RETENTION_DAYS * DAY, NOW)).toBe(0);
    expect(getTrashRemainingDays(NOW - (TRASH_RETENTION_DAYS + 90) * DAY, NOW)).toBe(0);
  });

  it('deletedAt 落在未来（时钟回拨）时不给出超过保留期的读数', () => {
    expect(getTrashRemainingDays(NOW + DAY, NOW)).toBe(TRASH_RETENTION_DAYS);
  });

  it('默认基准时刻为当前时间，与传入 Date.now() 等价', () => {
    const deletedAt = Date.now() - 3 * DAY;
    expect(getTrashRemainingDays(deletedAt)).toBe(getTrashRemainingDays(deletedAt, Date.now()));
  });

  /**
   * 回归：`deletedAt` 非有限数时减法把 NaN 一路带进读数，表格显示「剩余 NaN 天」，
   * 且到期判定同时把它当成永不过期。读数与判定现在同档归 0 / 判到期。
   */
  it('deletedAt 非有限数时读 0，不出现 NaN', () => {
    expect(getTrashRemainingDays(Number.NaN, NOW)).toBe(0);
    expect(getTrashRemainingDays(Number.POSITIVE_INFINITY, NOW)).toBe(0);
    expect(getTrashRemainingDays(undefined as unknown as number, NOW)).toBe(0);
  });
});

describe('isTrashEntryExpired', () => {
  it('同一阈值同一比较符：第 30 天整不到期，超出 1 毫秒到期', () => {
    expect(isTrashEntryExpired(NOW - TRASH_RETENTION_MS, NOW)).toBe(false);
    expect(isTrashEntryExpired(NOW - TRASH_RETENTION_MS - 1, NOW)).toBe(true);
  });

  it('deletedAt 非有限数判为已到期（PII 不得因畸形时间戳永久驻留）', () => {
    expect(isTrashEntryExpired(Number.NaN, NOW)).toBe(true);
    expect(isTrashEntryExpired(undefined as unknown as number, NOW)).toBe(true);
  });

  it('时钟回拨（deletedAt 落在未来）不判到期', () => {
    expect(isTrashEntryExpired(NOW + DAY, NOW)).toBe(false);
  });
});

/**
 * 阈值单一事实源守卫
 *
 * `trashManager.ts` 的到期清理用的是**本地字面量**阈值而非 import `trashRetention`——
 * 这是刻意的：trashManager 位于 popup 首屏闭包（passwordCrud 静态引用），任何指向
 * trashRetention 的模块边都会把该 chunk 提升进 eager 清单（sidepanelClosure 守卫）。
 * 代价是两处数值必须靠断言钉死：改保留期只动 trashRetention 而漏动 trashManager，
 * 密码回收站会静默按旧阈值清理。这里用源码静态扫描把两者锁死为同一数值。
 */
describe('trashManager 本地阈值与 trashRetention 单一事实源锁定', () => {
  it('trashManager.ts 的 TRASH_RETENTION_MS 字面量必须等于 trashRetention 的导出值', () => {
    const src = readFileSync(resolve(process.cwd(), 'utils/storage/trashManager.ts'), 'utf-8');
    const match = src.match(/const TRASH_RETENTION_MS\s*=\s*([\d\s*]+);/);
    expect(match, 'trashManager.ts 应保留本地 TRASH_RETENTION_MS 字面量').not.toBeNull();
    const literal = (match as RegExpMatchArray)[1].split('*').reduce((acc, part) => acc * Number(part.trim()), 1);
    expect(literal).toBe(TRASH_RETENTION_MS);
  });

  it('trashManager.ts 不得 import trashRetention（popup 首屏闭包守卫）', () => {
    const src = readFileSync(resolve(process.cwd(), 'utils/storage/trashManager.ts'), 'utf-8');
    expect(src).not.toMatch(/from '\.\/trashRetention'/);
  });

  it('保留期读数上限与阈值换算一致（30 天 × 86400000ms）', () => {
    expect(TRASH_RETENTION_MS).toBe(TRASH_RETENTION_DAYS * DAY);
  });

  /**
   * 到期判定的「畸形时间戳按已到期」这一半也必须同步。
   * `isTrashEntryExpired` 是单一事实源，`trashManager.cleanExpiredTrash` 因闭包约束保持着
   * 内联副本；副本漏掉 `Number.isFinite` 时，密码回收站会把 deletedAt 畸形的条目永久留住，
   * 而身份回收站同一时刻已把它清掉——两个回收站在同一份脏数据上行为分叉。
   */
  it('trashManager.ts 的到期判定必须保留非有限数护栏', () => {
    const src = readFileSync(resolve(process.cwd(), 'utils/storage/trashManager.ts'), 'utf-8');
    expect(src).toMatch(/!Number\.isFinite\(entry\.deletedAt\)/);
  });
});
