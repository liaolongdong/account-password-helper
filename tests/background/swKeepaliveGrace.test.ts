import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';

/**
 * backgroundServices 会话失效宽限期保活单元测试
 *
 * 覆盖 Mac（非 Windows）会话失效后宽限期保活的决策语义：
 * - 会话有效 → 保活；keys 存在已过期 → 打宽限标记 + 保活（等 tick 锁定）；
 * - keys 已清除：宽限期内 → 保活；宽限期外/无标记 → 停活；
 * - Windows：任何会话状态均保活（宽限逻辑不介入，平台分支零改动）；
 * - handleUserActivityGraceRefresh：无标记 no-op、有标记滑动续期并恢复保活、60 秒节流。
 *
 * 重依赖经 mock 从接缝注入：
 * - @/utils/platform（detectWindowsPlatform，逐用例切换 Windows/非 Windows）；
 * - @/utils/storage（动态导入的 StorageUtils.clearSession，本测试不触及但隔离真实存储模块）；
 * - sidePanelManager.getSidePanelPort（隔离 port 通知路径）。
 *
 * 节流态隔离：handleUserActivityGraceRefresh 的 60s 节流时间戳是模块级 Date.now()，
 * describe 内逐用例使用单调递增的假纪元（见 graceCaseSeq），保证上一用例写入的
 * 节流时间戳/宽限截止总处于当前用例的过去，用例间不串扰且无需依赖手写日期递增。
 */

vi.mock('@/utils/platform', () => ({
  detectWindowsPlatform: vi.fn(async () => false),
}));

vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    clearSession: vi.fn(async () => {}),
  },
}));

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPort: vi.fn(() => null),
}));

import { detectWindowsPlatform } from '@/utils/platform';
import {
  syncSwKeepaliveAlarm,
  markSwGraceKeepaliveWindow,
  handleUserActivityGraceRefresh,
} from '@/entrypoints/background/backgroundServices';

/** SW 保活闹钟名称（与 backgroundServices 内 SW_KEEPALIVE_ALARM_NAME 一致，测试断言用字面量） */
const SW_KEEPALIVE_ALARM = 'sw-keepalive';

/** 写入会话键（keys 存在 + 可定制的过期时间戳） */
async function writeSessionKeys(expiry: number | undefined): Promise<void> {
  const values: Record<string, unknown> = {
    [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-key-test',
  };
  if (expiry !== undefined) {
    values[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY] = expiry;
  }
  await chrome.storage.local.set(values);
}

/** 读取宽限期保活截止时间戳（未设置时返回 null） */
async function readGraceUntil(): Promise<number | null> {
  const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.SW_GRACE_KEEPALIVE_UNTIL);
  return (result[SESSION_MEMORY_KEYS.SW_GRACE_KEEPALIVE_UNTIL] as number | undefined) ?? null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(detectWindowsPlatform).mockResolvedValue(false);
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.alarms.clear(SW_KEEPALIVE_ALARM);
});

afterEach(async () => {
  // 恢复真实定时器（部分用例使用假定时器钉住系统时间）
  vi.useRealTimers();
  // 收敛保活状态（无会话无宽限 → 停活），清除模块级心跳定时器避免跨用例泄漏
  await syncSwKeepaliveAlarm();
});

describe('syncSwKeepaliveAlarm（非 Windows）', () => {
  it('会话有效（keys + 未来 expiry）→ 启用保活闹钟', async () => {
    await writeSessionKeys(Date.now() + 60 * 60 * 1000);

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('keys 存在但已过期 → 打宽限标记 + 保持保活（清除交由保活 tick 完成）', async () => {
    await writeSessionKeys(Date.now() - 60 * 1000);

    await syncSwKeepaliveAlarm();

    const graceUntil = await readGraceUntil();
    expect(graceUntil).not.toBeNull();
    expect(graceUntil!).toBeGreaterThan(Date.now());
    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('keys 已清除且宽限标记在未来 → 宽限期内保活', async () => {
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.SW_GRACE_KEEPALIVE_UNTIL]: Date.now() + 10 * 60 * 1000,
    });

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('keys 已清除且无宽限标记 → 停活（Mac 常态零电量语义不变）', async () => {
    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeUndefined();
  });

  it('keys 已清除且宽限标记已过期 → 停活（宽限期结束自动收敛）', async () => {
    await chrome.storage.session.set({
      [SESSION_MEMORY_KEYS.SW_GRACE_KEEPALIVE_UNTIL]: Date.now() - 1000,
    });

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeUndefined();
  });
});

describe('syncSwKeepaliveAlarm（Windows 非回归）', () => {
  it('会话失效（keys 已清除）时 Windows 仍常驻保活，宽限逻辑不介入', async () => {
    vi.mocked(detectWindowsPlatform).mockResolvedValue(true);

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('会话有效时 Windows 保活（行为与既有常驻策略一致）', async () => {
    vi.mocked(detectWindowsPlatform).mockResolvedValue(true);
    await writeSessionKeys(Date.now() + 60 * 60 * 1000);

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });
});

describe('handleUserActivityGraceRefresh', () => {
  /** 用例序号（每用例 +1，用于生成单调递增的假纪元） */
  let graceCaseSeq = 0;

  // 钉住系统时间在逐用例递增的假纪元：上一用例写入的节流时间戳/宽限截止
  // 总处于当前纪元的过去，模块级节流态不跨用例泄漏
  beforeEach(() => {
    graceCaseSeq += 1;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2030 + graceCaseSeq, 0, 1)));
  });

  it('无宽限标记时 no-op：不创建标记、不新建保活', async () => {
    await handleUserActivityGraceRefresh();

    expect(await readGraceUntil()).toBeNull();
    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeUndefined();
  });

  it('标记存在时滑动续期并恢复保活', async () => {
    await markSwGraceKeepaliveWindow();
    const before = await readGraceUntil();

    // 跨越 60 秒节流窗口后再触发活动信号
    vi.advanceTimersByTime(61 * 1000);
    await handleUserActivityGraceRefresh();

    const after = await readGraceUntil();
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(before!);
    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('60 秒节流：窗口内的重复活动信号不再续期', async () => {
    await markSwGraceKeepaliveWindow();

    await handleUserActivityGraceRefresh();
    const afterFirst = await readGraceUntil();
    // 立即再次触发（处于节流窗口内）→ 标记不变
    await handleUserActivityGraceRefresh();
    const afterSecond = await readGraceUntil();

    expect(afterSecond).toBe(afterFirst);
  });
});
