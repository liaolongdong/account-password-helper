/**
 * 通知面上的两条后台不变量回归测试（闹钟提醒 / 通知点击）
 *
 * 回归背景：
 * 1. `performReminderCheck` 里整批提醒共用一个 try：第 1 条 `notifications.create` 抛错
 *    （系统通知配额耗尽、通知服务不可用等）时，异常直接跳出 for 循环被外层 catch 吞掉，
 *    同批后续到期提醒在该周期（12 小时）内全部静默丢失，且失败条目与成功条目无法区分；
 * 2. 通知点击路径直接调用 `chrome.runtime.openOptionsPage()`，绕开仓库里唯一的选项页
 *    单实例入口 `optionsPageManager.openOptionsPage()`（右键菜单、消息路由、快捷键都走它）：
 *    不参与并发去重、不复用已存在的选项页标签、也不聚焦其所在窗口，
 *    用户点通知时可能新开一个标签页，也可能焦点仍停在原窗口。
 *
 * 装置说明：沿用 `sessionClearWatch.test.ts` 的做法——`setupBackgroundServices()` 注册监听时
 * 逐个 spy `addListener` 取回回调，既避免真实事件派发串扰，又能精确控制触发时机；
 * fake-browser 的 notifications / runtime.openOptionsPage 均为「存在但会抛 not implemented」
 * 的占位实现，因此一律替换为可控桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordReminder } from '@/utils/storage/reminderManager';
import { logger } from '@/utils/logger';
import { UNLOCK_NOTIFICATION_ID } from '@/entrypoints/background/quickFillHandler';

vi.mock('@/utils/i18n-lite', () => ({
  tl: vi.fn((key: string) => key),
}));

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPorts: vi.fn(() => []),
}));

vi.mock('@/entrypoints/background/optionsPageManager', () => ({
  openOptionsPage: vi.fn(async () => 11),
}));

vi.mock('@/utils/storage/reminderManager', () => ({
  getDueReminders: vi.fn(async () => []),
  markNotified: vi.fn(async () => {}),
}));

import { setupBackgroundServices } from '@/entrypoints/background/backgroundServices';
import { openOptionsPage } from '@/entrypoints/background/optionsPageManager';
import { getDueReminders, markNotified } from '@/utils/storage/reminderManager';

/** 与 backgroundServices 中 `PASSWORD_REMINDER_ALARM_NAME` 一致的闹钟名 */
const REMINDER_ALARM_NAME = 'password-reminder-check';

/** 实现只读取 `alarm.name`，故测试侧用收窄后的入参类型触发 */
type AlarmListener = (alarm: Pick<chrome.alarms.Alarm, 'name'>) => void;
type NotificationClickListener = (notificationId: string) => void;

let alarmListener: AlarmListener | undefined;
let clickListener: NotificationClickListener | undefined;
let createSpy: ReturnType<typeof vi.spyOn>;
let clearSpy: ReturnType<typeof vi.spyOn>;
let runtimeOpenSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** 冲洗闹钟回调内部的异步链（动态 import + 逐条 await，不含任何定时器） */
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

/** spy 的 calls 元素类型来自 fake-browser 签名，这里只关心首个实参 */
const firstArg = (call: unknown[]): unknown => call[0];

const reminder = (entryId: string, username: string): PasswordReminder => ({
  entryId,
  username,
  remindAt: Date.now() - 1000,
  createdAt: Date.now() - 86400000,
});

beforeEach(() => {
  vi.useFakeTimers();
  alarmListener = undefined;
  clickListener = undefined;

  vi.spyOn(chrome.idle.onStateChanged, 'addListener').mockImplementation(() => {});
  // storage 监听整体接管：本文件不验证它，注册真实回调会让无关写入触发缓存失效逻辑
  vi.spyOn(chrome.storage.onChanged, 'addListener').mockImplementation(() => {});
  vi.spyOn(chrome.alarms.onAlarm, 'addListener').mockImplementation(listener => {
    alarmListener = listener as AlarmListener;
  });
  vi.spyOn(chrome.notifications.onClicked, 'addListener').mockImplementation(listener => {
    clickListener = listener as NotificationClickListener;
  });

  createSpy = vi.spyOn(chrome.notifications, 'create').mockResolvedValue('id' as never);
  clearSpy = vi.spyOn(chrome.notifications, 'clear').mockResolvedValue(true as never);
  runtimeOpenSpy = vi.spyOn(chrome.runtime, 'openOptionsPage').mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

  vi.mocked(getDueReminders).mockReset().mockResolvedValue([]);
  vi.mocked(markNotified).mockReset().mockResolvedValue(undefined);
  vi.mocked(openOptionsPage).mockReset().mockResolvedValue(11);

  setupBackgroundServices();
  expect(alarmListener).toBeDefined();
  expect(clickListener).toBeDefined();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('密码到期提醒闹钟', () => {
  it('单条通知失败只跳过该条，同批后续到期提醒照常送达', async () => {
    vi.mocked(getDueReminders).mockResolvedValue([
      reminder('e1', 'alice@example.com'),
      reminder('e2', 'bob@example.com'),
      reminder('e3', 'carol@example.com'),
    ]);
    createSpy.mockImplementation(async (id: unknown) => {
      if (id === 'password-reminder-e2') throw new Error('notification quota reached');
    });

    alarmListener?.({ name: REMINDER_ALARM_NAME });
    await flush();

    // 修复前：e2 抛错直接结束整批，e3 永不下发
    expect(createSpy.mock.calls.map(firstArg)).toEqual([
      'password-reminder-e1',
      'password-reminder-e2',
      'password-reminder-e3',
    ]);
    // 失败条目不落「已通知」标记，下一周期仍会重试
    expect(vi.mocked(markNotified).mock.calls.map(firstArg)).toEqual(['e1', 'e3']);
  });

  it('已通知标记写入失败同样不阻断后续条目', async () => {
    vi.mocked(getDueReminders).mockResolvedValue([
      reminder('e1', 'alice@example.com'),
      reminder('e2', 'bob@example.com'),
    ]);
    vi.mocked(markNotified).mockRejectedValueOnce(new Error('storage write failed'));

    alarmListener?.({ name: REMINDER_ALARM_NAME });
    await flush();

    expect(createSpy.mock.calls.map(firstArg)).toEqual(['password-reminder-e1', 'password-reminder-e2']);
  });

  it('逐条失败日志只带 entryId，不重复暴露账号名', async () => {
    vi.mocked(getDueReminders).mockResolvedValue([reminder('e1', 'alice@example.com')]);
    createSpy.mockRejectedValue(new Error('notification service unavailable'));

    alarmListener?.({ name: REMINDER_ALARM_NAME });
    await flush();

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map(firstArg).join('\n');
    expect(logged).toContain('e1');
    expect(logged).not.toContain('alice@example.com');
  });

  it('无到期提醒时不产生任何通知（稳态无副作用）', async () => {
    alarmListener?.({ name: REMINDER_ALARM_NAME });
    await flush();

    expect(createSpy).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });
});

describe('通知点击直达选项页', () => {
  it('「需解锁」通知经选项页单实例入口，并收起该条通知', () => {
    clickListener?.(UNLOCK_NOTIFICATION_ID);

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledWith(UNLOCK_NOTIFICATION_ID);
    // 旧路径不再使用：绕开单实例入口即失去并发去重、复用与窗口聚焦
    expect(runtimeOpenSpy).not.toHaveBeenCalled();
  });

  it('密码提醒通知同样走单实例入口，并按通知 ID 收起', () => {
    clickListener?.('password-reminder-e1');

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledWith('password-reminder-e1');
    expect(runtimeOpenSpy).not.toHaveBeenCalled();
  });

  it('无关通知 ID 不打开选项页', () => {
    clickListener?.('some-other-extension-notification');

    expect(openOptionsPage).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
