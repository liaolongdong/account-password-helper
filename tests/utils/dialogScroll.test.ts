// @vitest-environment jsdom
/**
 * 弹窗内容区滚动工具测试
 *
 * 这条工具函数存在的意义是「时序只有一份实现」，所以断言的重点不是"滚没滚"，而是：
 * 注册定时器之前必须先等一次 DOM 更新（否则表格还没长出来，`scrollHeight` 是旧值）、
 * 落点取的是**滚动那一刻**的 `scrollHeight`、以及减弱动效时确实换成 `auto`。
 * 三处调用点（导入解析成功、备份文件选中、备份解密成功）共用它，测这一处即测全部。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { scrollDialogBodyToBottom } from '@/utils/dialogScroll';

/** 造一个带内容区类名的容器，并把 `scrollHeight` 钉成可断言的固定值（jsdom 无布局，默认恒为 0） */
function mountContainer(scrollHeight: number): { container: HTMLElement; scrollTo: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = '<div class="dlg"><div class="dialog-body-scroll"></div></div>';
  const container = document.querySelector<HTMLElement>('.dlg .dialog-body-scroll')!;
  const scrollTo = vi.fn();
  Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true });
  container.scrollTo = scrollTo;
  return { container, scrollTo };
}

/**
 * 让 `prefers-reduced-motion` 按指定答案回应
 *
 * 直接赋值而非 `vi.spyOn`：本仓这套 jsdom 环境里 `window.matchMedia` 压根不存在，
 * spyOn 会以 "can only spy on a function" 失败；`prefersReducedMotion` 走的是
 * `typeof window.matchMedia === 'function'` 判定，赋值恰好也覆盖了真实运行时的形态。
 */
function stubReducedMotion(matches: boolean): void {
  window.matchMedia = ((query: string) => ({ matches, media: query })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('scrollDialogBodyToBottom', () => {
  it('先等一次 DOM 更新，再等渲染落定时长，然后把落点设为当时的 scrollHeight', async () => {
    stubReducedMotion(false);
    const { container, scrollTo } = mountContainer(1234);

    // 数据刚写进响应式 state：DOM 还没更新，此时取到的 scrollHeight 必是旧值
    let domFlushed = false;
    void nextTick().then(() => {
      domFlushed = true;
    });

    const pending = scrollDialogBodyToBottom('.dlg .dialog-body-scroll');
    await pending;

    expect(domFlushed, '未等 DOM 更新就注册滚动，落点会按旧高度算').toBe(true);
    expect(scrollTo, '落定时器时就该滚动，说明 150ms 的渲染余量没生效').not.toHaveBeenCalled();

    vi.advanceTimersByTime(149);
    expect(scrollTo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: container.scrollHeight, behavior: 'smooth' });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('开启「减弱动态效果」后同一处调用改为瞬时定位', async () => {
    stubReducedMotion(true);
    const { scrollTo } = mountContainer(800);

    await scrollDialogBodyToBottom('.dlg .dialog-body-scroll');
    vi.advanceTimersByTime(150);

    expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'auto' });
  });

  it('选择器没命中（弹窗已关 / 类名改了）时静默返回，不抛错', async () => {
    stubReducedMotion(false);
    mountContainer(100);

    await expect(scrollDialogBodyToBottom('.dlg .not-there')).resolves.toBeUndefined();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  it('可覆盖落定时长（重型表格需要更久的渲染余量时）', async () => {
    stubReducedMotion(false);
    const { scrollTo } = mountContainer(600);

    await scrollDialogBodyToBottom('.dlg .dialog-body-scroll', 400);
    vi.advanceTimersByTime(399);
    expect(scrollTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
