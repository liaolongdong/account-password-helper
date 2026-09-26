/**
 * 关键词防抖副本单测（composables/useKeywordDebounce）
 *
 * 这个 composable 是三处列表（管理页密码表、回收站弹窗、侧边栏）的「输入即时回显、
 * 过滤延后落地」的唯一实现，抽离前是两处逐字相同的 watcher。它锁住的契约有两类：
 *
 * 1. 成本侧——一轮连续击键只让下游过滤链跑一次。下游是「整表重排 + 命中行逐格高亮」，
 *    每键一跑在 2000 条库形状下足以越过一帧，用户读到的是卡顿而不是中间态。
 * 2. 正确性侧——`flush()` 必须先把未落地的关键词同步进来再执行「以当前列表为准」的动作
 *    （侧边栏的下键导航与回车填充）。少了这一步会出现快机器上偶发、慢机器上必现的
 *    「字打完了，回车填的还是上一个列表」错位，且这类错位不会报错。
 *
 * 计时器一律用 `vi.useFakeTimers()`；下游写入次数用 `flush: 'sync'` 的 watcher 计数，
 * 避开 pre-flush 调度队列与假计时器对微任务的接管。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, watch } from 'vue';
import { KEYWORD_DEBOUNCE_MS } from '@/utils/keywordMatch';
import { useKeywordDebounce } from '@/composables/useKeywordDebounce';

/** 在独立作用域里挂载，返回源、防抖副本、落地序列与作用域句柄 */
const mount = (initial = '', delayMs?: number) => {
  const source = ref(initial);
  const landed: string[] = [];
  const scope = effectScope();
  const handle = scope.run(() => {
    const debounced = useKeywordDebounce(source, delayMs);
    watch(debounced.debounced, value => landed.push(value), { flush: 'sync' });
    return debounced;
  })!;
  return { source, debounced: handle.debounced, flush: handle.flush, landed, scope };
};

describe('useKeywordDebounce 的落地时机', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('副本初值与源相同，非空初值不会被抹成空串', () => {
    const { debounced, landed, scope } = mount('GitHub');
    expect(debounced.value).toBe('GitHub');
    expect(landed).toEqual([]);
    scope.stop();
  });

  it('连续击键只落地最后一次：三次赋值下游只跑一遍', async () => {
    const { source, debounced, landed, scope } = mount();

    source.value = 'g';
    await nextTick();
    source.value = 'gi';
    await vi.advanceTimersByTimeAsync(80);
    source.value = 'git';
    await nextTick();

    expect(debounced.value).toBe('');
    expect(landed).toEqual([]);

    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS);
    expect(debounced.value).toBe('git');
    expect(landed).toEqual(['git']);
    scope.stop();
  });

  it('差 1 毫秒不落地，到点才落地（时长可注入，缺省取共享常量）', async () => {
    const { source, debounced, scope } = mount();
    source.value = 'git';
    await nextTick();

    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS - 1);
    expect(debounced.value).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(debounced.value).toBe('git');
    scope.stop();
  });

  it('自定义时长覆盖共享常量', async () => {
    const { source, debounced, scope } = mount('', 30);
    source.value = 'git';
    await nextTick();

    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS);
    expect(debounced.value).toBe('git');
    scope.stop();
  });
});

describe('useKeywordDebounce 的 flush', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('立即落地未生效的关键词，并取消待触发的计时器', async () => {
    const { source, debounced, flush, landed, scope } = mount();

    source.value = 'git';
    await nextTick();
    flush();

    expect(debounced.value).toBe('git');
    expect(landed).toEqual(['git']);

    // 计时器必须已取消：否则到点后再写一次，下游会被同一次按键触发两遍
    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS * 2);
    expect(landed).toEqual(['git']);
    scope.stop();
  });

  it('无待落地更新时是零成本赋值，不触发下游', async () => {
    const { source, flush, landed, scope } = mount();

    source.value = 'git';
    await nextTick();
    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS);
    expect(landed).toEqual(['git']);

    // 模拟「用户没有再打字，只是接着按 ↓ / 回车」：flush 不得让列表重排第二次
    flush();
    flush();
    expect(landed).toEqual(['git']);
    scope.stop();
  });

  it('flush 之后继续打字仍按防抖节奏落地', async () => {
    const { source, debounced, flush, scope } = mount();

    source.value = 'g';
    await nextTick();
    flush();
    expect(debounced.value).toBe('g');

    source.value = 'git';
    await nextTick();
    expect(debounced.value).toBe('g');
    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS);
    expect(debounced.value).toBe('git');
    scope.stop();
  });
});

describe('useKeywordDebounce 的作用域清理', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('作用域销毁后未触发的计时器不再写入', async () => {
    const { source, debounced, landed, scope } = mount();

    source.value = 'git';
    await nextTick();
    scope.stop();

    await vi.advanceTimersByTimeAsync(KEYWORD_DEBOUNCE_MS * 2);
    expect(landed).toEqual([]);
    // 已停用的副本保持销毁前状态，不出现「关闭后凭空多一次落地」
    expect(debounced.value).toBe('');
  });
});
