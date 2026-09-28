import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';

/**
 * backgroundServices 统一常驻保活单元测试
 *
 * 覆盖统一常驻保活的决策语义：
 * - 任意平台/会话状态（会话有效、keys 过期残留、无任何会话键）均启用保活闹钟；
 * - 保活不再依赖 storage.session 宽限期/引导期标记（机制已移除）；
 * - 幂等：重复同步不重建既有闹钟（period 保持不变）；
 * - 心跳间隔守住 MV3 的 30s 空闲阈值（闹钟周期由 `periodInMinutes` 断言覆盖）。
 *
 * 重依赖经 mock 从接缝注入：
 * - @/utils/storage（动态导入的 StorageUtils，本测试不触及但隔离真实存储模块）；
 * - sidePanelManager.getSidePanelPorts（隔离 port 通知路径）。
 *
 * 定时器隔离：setupSwKeepaliveAlarm 的 20s 心跳是模块级 setInterval，
 * beforeEach 启用假定时器使心跳不产生真实句柄，afterEach 恢复真实定时器并清闹钟。
 */

vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    clearSession: vi.fn(async () => {}),
  },
}));

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPorts: vi.fn(() => []),
}));

import { syncSwKeepaliveAlarm } from '@/entrypoints/background/backgroundServices';

/** SW 保活闹钟名称（与 backgroundServices 内 SW_KEEPALIVE_ALARM_NAME 一致，测试断言用字面量） */
const SW_KEEPALIVE_ALARM = 'sw-keepalive';

beforeEach(async () => {
  vi.useFakeTimers();
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.alarms.clear(SW_KEEPALIVE_ALARM);
});

afterEach(async () => {
  vi.useRealTimers();
  await chrome.alarms.clear(SW_KEEPALIVE_ALARM);
});

describe('syncSwKeepaliveAlarm（统一常驻保活）', () => {
  it('无任何会话键时仍启用保活（Mac 会话失效态常驻语义）', async () => {
    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('会话有效（keys + 未来 expiry）时启用保活', async () => {
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-key-test',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() + 60 * 60 * 1000,
    });

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
  });

  it('keys 存在但已过期时仍保持保活（不再依赖宽限期标记）', async () => {
    await chrome.storage.local.set({
      [SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY]: 'wrapped-key-test',
      [SESSION_STORAGE_KEYS.PASSWORD_EXPIRY]: Date.now() - 60 * 1000,
    });

    await syncSwKeepaliveAlarm();

    expect(await chrome.alarms.get(SW_KEEPALIVE_ALARM)).toBeDefined();
    // 宽限期标记机制已移除：不再向 storage.session 写入宽限截止键
    const sessionData = await chrome.storage.session.get('sw_grace_keepalive_until');
    expect(sessionData['sw_grace_keepalive_until']).toBeUndefined();
  });

  it('重复同步幂等：既有闹钟不被重建（alarms.create 仅调用一次）', async () => {
    const createSpy = vi.spyOn(chrome.alarms, 'create');

    await syncSwKeepaliveAlarm();
    expect(createSpy).toHaveBeenCalledTimes(1);

    await syncSwKeepaliveAlarm();

    // 幂等的关键价值：同名重建会重置 scheduledTime，把复活等待推迟整周期，
    // 故用 create 调用次数直接验证「免相位重置」保证
    expect(createSpy).toHaveBeenCalledTimes(1);
    const second = await chrome.alarms.get(SW_KEEPALIVE_ALARM);
    expect(second).toBeDefined();
    expect(second!.periodInMinutes).toBe(0.5);
  });

  it('心跳间隔守住 MV3 的 30s 空闲阈值', () => {
    // 值是模块私有常量，为测试导出会扩大内部 API 面，故沿用仓库既有的静态守卫手法。
    // 心跳一旦 ≥30s，「存活期不死亡」这一层整体失效，侧边栏退回 SW 冷启动白屏；
    // 闹钟周期已由上一条的 `periodInMinutes` 运行时断言覆盖，此处不重复钉。
    const source = readFileSync(path.resolve(__dirname, '../../entrypoints/background/backgroundServices.ts'), 'utf-8');
    const heartbeat = Number(/const SW_HEARTBEAT_INTERVAL_MS\s*=\s*([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ''));

    expect(Number.isFinite(heartbeat), '未从源码提取到 SW_HEARTBEAT_INTERVAL_MS，请检查正则').toBe(true);
    expect(heartbeat).toBeGreaterThan(0);
    expect(heartbeat).toBeLessThan(30_000);
  });
});
