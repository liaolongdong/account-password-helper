import { describe, expect, it } from 'vitest';
import { decideBackupChipState, decideVaultBackupVerdict, isVerdictOwedNow } from '@/utils/backup/changeDetection';

/**
 * 头部备份徽标的档位判据单元测试
 *
 * 判据是纯函数，徽标与轻提醒都只消费它的结果，所以这里就是这条链路唯一的事实来源。
 * 重点锁四件容易被改坏的事：
 * 1. **空库不提醒**（两库皆空 → 隐藏；单库为空不参与档位，但要在明细里说「无条目」）；
 * 2. **徽标取两库里更严重的一档**，一库「从未备份」一库「今日已备份」时显示绿色就是撒谎；
 * 3. 兜底下限用严格大于，且 `pending` 只在变更时间戳**晚于**上次备份时才成立——
 *    否则「备份完之后又改了」与「改完之后备份了」两种顺序会分不清。
 * 4. 「另一库也欠着」的点名口径（`isVerdictOwedNow`）与横幅自己的出声口径同档。
 */

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const FLOOR = 7 * DAY;

/** 造一库输入 */
const vault = (hasData: boolean, lastBackupAt: number | null, lastChangeAt: number | null) => ({
  hasData,
  lastBackupAt,
  lastChangeAt,
});

describe('decideVaultBackupVerdict 单库档位', () => {
  it('无条目即退出判定', () => {
    expect(decideVaultBackupVerdict(vault(false, null, null), FLOOR, NOW)).toBe('hidden');
  });

  it('有条目但从未备份 → never（不看时间戳新旧）', () => {
    expect(decideVaultBackupVerdict(vault(true, null, NOW - 30 * DAY), FLOOR, NOW)).toBe('never');
  });

  it('变更晚于上次备份 → pending', () => {
    expect(decideVaultBackupVerdict(vault(true, NOW - 2 * DAY, NOW - DAY), FLOOR, NOW)).toBe('pending');
  });

  it('变更早于上次备份 → 不算待备份（顺序不能反）', () => {
    expect(decideVaultBackupVerdict(vault(true, NOW - DAY, NOW - 2 * DAY), FLOOR, NOW)).toBe('ok');
  });

  it('无变更但超过兜底下限 → stale；正好等于下限仍算 ok', () => {
    expect(decideVaultBackupVerdict(vault(true, NOW - 8 * DAY, null), FLOOR, NOW)).toBe('stale');
    expect(decideVaultBackupVerdict(vault(true, NOW - FLOOR, null), FLOOR, NOW)).toBe('ok');
  });

  it('变更时间戳缺失（存量数据没赶上监听器）时退回纯时间驱动', () => {
    expect(decideVaultBackupVerdict(vault(true, NOW - DAY, null), FLOOR, NOW)).toBe('ok');
    expect(decideVaultBackupVerdict(vault(true, NOW - 40 * DAY, null), FLOOR, NOW)).toBe('stale');
  });
});

describe('decideBackupChipState 徽标档位', () => {
  it('两库皆空 → 隐藏，且明细里两库都记为无条目', () => {
    const state = decideBackupChipState({
      passwords: vault(false, null, null),
      identity: vault(false, null, null),
      floorMs: FLOOR,
      now: NOW,
    });

    expect(state.visible).toBe(false);
    expect(state.perVault).toEqual({
      passwords: { verdict: 'hidden', ageDays: null },
      identity: { verdict: 'hidden', ageDays: null },
    });
  });

  it('密码库从未备份 → critical，天数无意义为 null', () => {
    const state = decideBackupChipState({
      passwords: vault(true, null, NOW - DAY),
      identity: vault(false, null, null),
      floorMs: FLOOR,
      now: NOW,
    });

    expect(state.level).toBe('critical');
    expect(state.worstVault).toBe('passwords');
    expect(state.ageDays).toBeNull();
  });

  it('一库从未备份、一库今日已备份 → 取更严重的 critical，不被绿色掩盖', () => {
    const state = decideBackupChipState({
      passwords: vault(true, NOW, null),
      identity: vault(true, null, NOW - DAY),
      floorMs: FLOOR,
      now: NOW,
    });

    expect(state.level).toBe('critical');
    expect(state.worstVault).toBe('identity');
    expect(state.perVault.passwords).toEqual({ verdict: 'ok', ageDays: 0 });
  });

  it('最差库是个人信息库时，worstVault 指过去，供文案补库名标签', () => {
    const state = decideBackupChipState({
      passwords: vault(true, NOW - DAY, NOW - 2 * DAY),
      identity: vault(true, NOW - 3 * DAY, NOW - DAY),
      floorMs: FLOOR,
      now: NOW,
    });

    expect(state.level).toBe('urgent');
    expect(state.worstVault).toBe('identity');
    expect(state.ageDays).toBe(3);
  });

  it('两库都只超期未变更 → warning，天数取最差库', () => {
    const state = decideBackupChipState({
      passwords: vault(true, NOW - 10 * DAY, null),
      identity: vault(true, NOW - 20 * DAY, null),
      floorMs: FLOOR,
      now: NOW,
    });

    expect(state.level).toBe('warning');
    expect(state.ageDays).toBe(20);
    expect(state.perVault.passwords.ageDays).toBe(10);
  });

  it('两库都在期限内且无变更 → ok；同档时取更久没备份的那一库，不粉饰天数', () => {
    const state = decideBackupChipState({
      passwords: vault(true, NOW - DAY, NOW - 2 * DAY),
      identity: vault(true, NOW - 2 * DAY, null),
      floorMs: FLOOR,
      now: NOW,
    });

    expect(state.level).toBe('ok');
    expect(state.worstVault).toBe('identity');
    expect(state.ageDays).toBe(2);
  });
});

describe('isVerdictOwedNow 哪一库值得此刻出声', () => {
  it('从未备份与备份后又改过才算欠着', () => {
    expect(isVerdictOwedNow('never')).toBe(true);
    expect(isVerdictOwedNow('pending')).toBe(true);
  });

  it('太久没备但期间没改过不出声——没有新数据要丢', () => {
    expect(isVerdictOwedNow('stale')).toBe(false);
  });

  it('已备份与空库都不该被点名', () => {
    expect(isVerdictOwedNow('ok')).toBe(false);
    expect(isVerdictOwedNow('hidden')).toBe(false);
  });
});
