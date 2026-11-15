/** @vitest-environment jsdom */
/**
 * 保存结果通知条的停留与交互（NativeNotification）
 *
 * 缺陷背景：通知条固定 3000ms 自删、无 hover 暂停。自动保存最长的文案恰恰走这条路
 * （越限拒收点名多个字段、容量上限、跨窗口冲突、带 URL 的去向说明），max-width 300px
 * 下长句折行后 3 秒读不完。本文件钉住改造后的契约：
 * 1. 停留时长按类型分档（success 3s / info 4s / warning、error 6s）；
 * 2. 悬停暂停计时、离开重新计时（复用 FillAckChip 的成熟模式）；
 * 3. 被新通知替换时清掉旧定时器，旧表不得把新通知提前收走；
 * 4. 点击立即关闭并清表。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showNativeNotification } from '@/entrypoints/content/NativeNotification';

const NOTICE_SELECTOR = '.native-form-detector-notification';

const noticeEl = (): HTMLElement | null => document.querySelector(NOTICE_SELECTOR) as HTMLElement | null;

/** 通知文案（图标 span 在前、文案 span 在后，取最后一个 span） */
const noticeText = (): string => {
  const spans = noticeEl()?.querySelectorAll('span');
  return spans?.[spans.length - 1]?.textContent ?? '';
};

const fire = (type: string): void => {
  noticeEl()?.dispatchEvent(new Event(type, { bubbles: true }));
};

describe('NativeNotification 停留与交互', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    // 点击关闭以清掉模块级定时器与引用，避免悬空表跨用例
    fire('click');
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('success 档 3000ms 自删', () => {
    showNativeNotification('已保存', 'success');
    expect(noticeEl()).not.toBeNull();
    vi.advanceTimersByTime(2999);
    expect(noticeEl()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noticeEl()).toBeNull();
  });

  it('info 档 4000ms 自删', () => {
    showNativeNotification('提示', 'info');
    vi.advanceTimersByTime(3999);
    expect(noticeEl()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noticeEl()).toBeNull();
  });

  it.each(['warning', 'error'] as const)('%s 档停留 6000ms，长文案读得完', type => {
    showNativeNotification('以下字段超出长度上限（实际/上限）：账号（60/50）；备注（260/200）。请精简后重试', type);
    vi.advanceTimersByTime(3000);
    expect(noticeEl()).not.toBeNull();
    vi.advanceTimersByTime(2999);
    expect(noticeEl()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noticeEl()).toBeNull();
  });

  it('悬停暂停计时，离开后重新计时', () => {
    showNativeNotification('长文案', 'warning');
    vi.advanceTimersByTime(2000);
    fire('mouseenter');
    // 悬停期间远超原停留时长也不消失
    vi.advanceTimersByTime(20000);
    expect(noticeEl()).not.toBeNull();
    fire('mouseleave');
    vi.advanceTimersByTime(5999);
    expect(noticeEl()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(noticeEl()).toBeNull();
  });

  it('被新通知替换时清掉旧定时器，旧表不得提前收走新通知', () => {
    showNativeNotification('旧', 'success'); // 3s 表
    vi.advanceTimersByTime(1000);
    showNativeNotification('新', 'warning'); // 6s 表
    expect(noticeText()).toBe('新');
    // t=3000 是旧表原到期点：若未清表，新通知会被旧表回调收走
    vi.advanceTimersByTime(2000);
    expect(noticeEl()).not.toBeNull();
    expect(noticeText()).toBe('新');
    // 新表自替换起算 6000ms（t=7000）到期
    vi.advanceTimersByTime(4000);
    expect(noticeEl()).toBeNull();
  });

  it('点击立即关闭并清表', () => {
    showNativeNotification('长文案', 'error');
    fire('click');
    expect(noticeEl()).toBeNull();
    vi.advanceTimersByTime(20000);
    expect(noticeEl()).toBeNull();
  });

  it('同一时刻至多一条通知', () => {
    showNativeNotification('a', 'success');
    showNativeNotification('b', 'warning');
    expect(document.querySelectorAll(NOTICE_SELECTOR)).toHaveLength(1);
    expect(noticeText()).toBe('b');
  });

  it('文案原样渲染在文案 span', () => {
    showNativeNotification('账号密码已保存', 'success');
    expect(noticeText()).toBe('账号密码已保存');
  });
});

/**
 * 通知条是 light DOM（类名公开、非 Shadow DOM），宿主页面可以持有被替换/收起的旧节点
 * 并向它派发合成事件。旧节点的监听器若仍无条件读写模块单槽，就能停掉/重排/收走「当前」
 * 通知——把原本要消灭的 orphan 定时器换成 orphan 监听器。回调必须带存活守卫（同 FillAckChip）。
 */
describe('脱离文档的旧通知不得干扰当前通知', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    fire('click');
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('旧节点的合成 click 不得收走当前通知', () => {
    showNativeNotification('旧', 'success');
    const old = noticeEl()!;
    showNativeNotification('新', 'warning');
    expect(noticeText()).toBe('新');
    old.dispatchEvent(new Event('click', { bubbles: true }));
    expect(noticeEl(), '旧节点 click 收走了当前通知').not.toBeNull();
    expect(noticeText()).toBe('新');
  });

  it('旧节点的合成 mouseenter 不得停掉当前通知的自删表', () => {
    showNativeNotification('旧', 'success');
    const old = noticeEl()!;
    showNativeNotification('新', 'warning'); // 6s 表
    old.dispatchEvent(new Event('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(6000);
    expect(noticeEl(), '旧节点 mouseenter 清掉当前表，通知常驻遮挡').toBeNull();
  });

  it('旧节点的合成 mouseleave 不得按旧档重排当前通知的表', () => {
    showNativeNotification('旧', 'success'); // 3s 档
    const old = noticeEl()!;
    showNativeNotification('新', 'warning'); // 6s 档
    old.dispatchEvent(new Event('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(3000); // 旧档到期点：当前 6s 通知不应被收走
    expect(noticeEl(), '旧节点 mouseleave 按旧档收走了当前通知').not.toBeNull();
    expect(noticeText()).toBe('新');
    vi.advanceTimersByTime(3000);
    expect(noticeEl()).toBeNull();
  });
});
