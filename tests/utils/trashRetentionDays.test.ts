import { describe, expect, it } from 'vitest';
import { TRASH_RETENTION_DAYS, getTrashRemainingDays } from '@/utils/storage/trashManager';

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
});
