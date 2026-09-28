/** @vitest-environment jsdom */

/**
 * 删除 / 批量删除的落盘反馈回归测试（usePasswordManagement）
 *
 * 回归背景：两处删除都把真实写入埋在 `setTimeout` 回调里，外层 `try/catch` 与
 * `ElMessageBox` 的取消判定都够不到那条 Promise——于是出现四类可观察缺陷：
 * 1. 存储写入失败时行已被动画摘掉，用户看不到任何提示，刷新后条目又「复活」；
 * 2. 行未渲染（被当前筛选/搜索/分页条件排除）时，确认后既不落盘也不提示，
 *    表现为「点了没反应」；
 * 3. 批量删除失败仍清空 `selectedIds`，用户失去可重试的选择集；
 * 4. 批量删除到点时才读 `selectedIds`，淡出动画期间改选择集会误删新勾选项。
 *
 * 现在断言的正是这些可观察结果：失败必须有可读提示、被动画摘掉的行必须插回原位、
 * 确认必须有落盘动作、取消必须什么都不做、非取消的弹窗异常仍要提示。`loadPasswords` 走
 * `isSessionValid=false` 早退分支保持无副作用。
 *
 * 为什么打桩 `globalThis` 而不是 `vi.spyOn(ElMessage, ...)`：`wxt.config.ts` 的
 * `AutoImport({ imports: [{ 'element-plus': ['ElMessage', 'ElMessageBox'] }] })` 只在真实
 * 构建期把 import 注入源码，`WxtVitest()` 并不套用这份配置，于是测试环境里 composable 中的
 * 这两个标识符按裸全局解析。直接 spy `element-plus` 的导出会命中另一个对象而静默失效——
 * 正是这种失效让实现里的「确认异常一概 return」把整条链路吞成空操作，四个用例集体 0 调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { usePasswordManagement, DELETE_ANIMATION_MS } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';

/** 打桩到 globalThis 的 Element Plus 命令式 API（测试环境的裸全局解析口径） */
interface EpStubs {
  ElMessage: Record<'success' | 'error' | 'warning' | 'info', Mock>;
  ElMessageBox: { confirm: Mock };
}

describe('usePasswordManagement 删除落盘反馈', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;
  let ep: EpStubs;

  let deleteSpy: ReturnType<typeof vi.spyOn>;
  let batchDeleteSpy: ReturnType<typeof vi.spyOn>;
  let isSessionValidSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';

    ep = {
      ElMessage: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
      },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    };
    Object.assign(globalThis, ep);

    // 列表重载走早退分支，避免真实 storage 读与「加载失败」提示干扰断言
    isSessionValidSpy = vi.spyOn(StorageUtils, 'isSessionValid').mockResolvedValue(false as never);
    deleteSpy = vi.spyOn(StorageUtils, 'deletePassword').mockResolvedValue(undefined as never);
    batchDeleteSpy = vi.spyOn(StorageUtils, 'deletePasswords').mockResolvedValue(undefined as never);

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
  });

  afterEach(() => {
    scope.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  /** 推进淡出动画定时器（时长与实现同源），并把回调里 commitDelete 的 await 链跑完 */
  const settleAnimation = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(DELETE_ANIMATION_MS);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  };

  it('行未渲染时同样落盘并提示成功（此前是「点了没反应」）', async () => {
    await mgmt.deletePassword('not-rendered');

    expect(ep.ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('not-rendered');
    // 未注册语言包的测试环境下 t() 原样返回 key，断言 key 即锁定用到的文案条目
    expect(ep.ElMessage.success).toHaveBeenCalledWith('form.movedToTrash');
    expect(ep.ElMessage.error).not.toHaveBeenCalled();
  });

  it('命中行时先播淡出动画，动画结束才落盘', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="row-1"></div>';
    const row = document.querySelector<HTMLElement>('.row-1')!;

    await mgmt.deletePassword('row-1');
    expect(row.classList.contains('del-item')).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalled();

    await settleAnimation();

    expect(row.isConnected).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith('row-1');
    expect(ep.ElMessage.success).toHaveBeenCalledTimes(1);
  });

  it('存储写入失败时给出可读错误，并靠重载还原列表且不误报成功', async () => {
    deleteSpy.mockRejectedValue(new Error('disk full'));
    const reloadsBefore = isSessionValidSpy.mock.calls.length;

    await mgmt.deletePassword('not-rendered');

    expect(ep.ElMessage.error).toHaveBeenCalledWith('message.deleteFailed');
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
    // 失败路径同样要重载列表：动画摘掉的行必须回到表格，与存储保持一致
    expect(isSessionValidSpy.mock.calls.length).toBeGreaterThan(reloadsBefore);
  });

  it('存储写入失败时把动画摘掉的行插回原位', async () => {
    // 只靠 `loadPasswords()` 还原是不够的：表格设了 `row-key="id"`，条目仍在库里时 Vue 会按
    // key 复用那个已脱离文档的节点而非重新插入，行会一直看不见直到翻页/重排序。
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="row-1"></div><div class="tail"></div>';
    const row = document.querySelector<HTMLElement>('.row-1')!;
    deleteSpy.mockRejectedValue(new Error('disk full'));

    await mgmt.deletePassword('row-1');
    await settleAnimation();

    expect(row.isConnected).toBe(true);
    expect(document.body.firstElementChild).toBe(row);
    // 重新入文档会从 0% 重播 CSS 动画，失败行不能再淡出一次
    expect(row.classList.contains('del-item')).toBe(false);
  });

  it('取消确认时不做任何写入也不提示', async () => {
    ep.ElMessageBox.confirm.mockRejectedValue('cancel');

    await mgmt.deletePassword('not-rendered');

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
    expect(ep.ElMessage.error).not.toHaveBeenCalled();
  });

  it('确认弹窗抛出非取消异常时仍提示，不静默变成「点了没反应」', async () => {
    ep.ElMessageBox.confirm.mockRejectedValue(new Error('dialog broken'));

    await mgmt.deletePassword('not-rendered');

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(ep.ElMessage.error).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
  });

  it('批量删除成功后清空选择，失败时保留选择集供重试', async () => {
    vi.useFakeTimers();
    mgmt.selectedIds.value = ['a', 'b'];

    await mgmt.batchDelete();
    expect(batchDeleteSpy).not.toHaveBeenCalled();
    await settleAnimation();

    expect(batchDeleteSpy).toHaveBeenCalledWith(['a', 'b']);
    expect(mgmt.selectedIds.value).toEqual([]);
    expect(ep.ElMessage.success).toHaveBeenCalledTimes(1);

    mgmt.selectedIds.value = ['c', 'd'];
    batchDeleteSpy.mockRejectedValue(new Error('disk full'));
    await mgmt.batchDelete();
    await settleAnimation();

    expect(mgmt.selectedIds.value).toEqual(['c', 'd']);
    expect(ep.ElMessage.error).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.success).toHaveBeenCalledTimes(1);
  });

  it('批量删除失败时整批按原顺序插回（相邻行互为参照节点）', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="a"></div><div class="b"></div><div class="tail"></div>';
    const rowA = document.querySelector<HTMLElement>('.a')!;
    const rowB = document.querySelector<HTMLElement>('.b')!;
    const tail = document.querySelector<HTMLElement>('.tail')!;
    batchDeleteSpy.mockRejectedValue(new Error('disk full'));
    mgmt.selectedIds.value = ['a', 'b'];

    await mgmt.batchDelete();
    await settleAnimation();

    // 摘除顺序是 a→b，复原必须逆序，否则 a 的参照节点 b 还飘在文档外、插不回原位
    expect(Array.from(document.body.children)).toEqual([rowA, rowB, tail]);
  });

  it('淡出动画期间改选择集，不会误删新勾选项', async () => {
    vi.useFakeTimers();
    mgmt.selectedIds.value = ['a', 'b'];
    const running = mgmt.batchDelete();
    // 让确认弹窗的微任务落地：此刻实现应已完成选择集快照并排好定时器
    await vi.advanceTimersByTimeAsync(0);
    // 动画期间用户又勾选了 c
    mgmt.selectedIds.value = ['a', 'b', 'c'];

    await settleAnimation();
    await running;

    // 被删的是确认瞬间的快照，而非到点时的选择集
    expect(batchDeleteSpy).toHaveBeenCalledWith(['a', 'b']);
    // 选择集只摘掉真正删除的 id，保留新勾选的 c
    expect(mgmt.selectedIds.value).toEqual(['c']);
  });
});
