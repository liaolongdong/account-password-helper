/**
 * 主密码验证弹窗控制器回归测试
 *
 * 背景：`promptAndVerifyMasterPassword` 是 Options 侧 11 处敏感操作（导出、清空、改密、
 * 身份库导出/删除/重置、历史设置、会话时长等）拿主密码的唯一入口，它把用户输入装进一个
 * **命令式 Promise**，由 `MasterPasswordVerifyDialog` 组件在另一条调用链上 resolve/reject。
 * 这条链上最容易出事
 * 的不是渲染，而是「resolve 槽位只有一个」这个约定：
 * - 前一格弹窗还没关就再开一次时，旧调用方的 Promise 必须被 null 结算，否则 `await` 它的
 *   那个 handler 永久挂起（按钮停在 loading、后续操作再也发不出）；
 * - 结算槽位必须一次性：组件重复点确认/关闭不能把同一个密码再发给别的等待者；
 * - 无等待者时的 resolve/reject 必须无害，且无论如何都要把 `visible` 落回 false。
 *
 * 这里只测状态机与 Promise 结算，不渲染组件：`visible/title/description` 是组件唯一输入，
 * `_resolveVerifyDialog`/`_rejectVerifyDialog` 是它唯一输出，两侧契约齐了即覆盖整条链。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isReactive, nextTick } from 'vue';
import {
  _getVerifyDialogState,
  _rejectVerifyDialog,
  _resolveVerifyDialog,
  openMasterPasswordVerifyDialog,
} from '@/utils/masterPasswordVerifyController';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';

/** 结算探针：把 Promise 的落点变成可断言的调用记录（未结算时 calls 为空） */
const track = <T>(promise: Promise<T>) => {
  const calls: T[] = [];
  promise.then(value => void calls.push(value));
  return calls;
};

afterEach(() => {
  // 单例状态跨用例可见：每条用例结束时按组件的关闭路径复位，避免串味
  _rejectVerifyDialog();
  _getVerifyDialogState().title = '';
  _getVerifyDialogState().description = '';
});

describe('open → 弹窗状态', () => {
  it('打开时写入标题与描述并置 visible', async () => {
    const state = _getVerifyDialogState();

    void openMasterPasswordVerifyDialog('导出密码', '请输入主密码以导出：');
    await nextTick();

    expect(state.visible).toBe(true);
    expect(state.title).toBe('导出密码');
    expect(state.description).toBe('请输入主密码以导出：');
  });

  it('返回给组件读取的是同一个响应式单例（组件靠 watch 它来开关弹窗）', () => {
    expect(_getVerifyDialogState()).toBe(_getVerifyDialogState());
    expect(isReactive(_getVerifyDialogState())).toBe(true);
  });
});

describe('结算：验证通过与用户取消', () => {
  it('验证通过时把主密码明文交回调用方并关闭弹窗', async () => {
    const promise = openMasterPasswordVerifyDialog('修改主密码', '请输入当前主密码：');
    await nextTick();

    _resolveVerifyDialog('master-secret');

    await expect(promise).resolves.toBe('master-secret');
    expect(_getVerifyDialogState().visible).toBe(false);
  });

  it('用户取消时结算为 null 并关闭弹窗（调用方据此中止操作，而非拿到空串）', async () => {
    const promise = openMasterPasswordVerifyDialog('清空数据', '请输入主密码以清空：');
    await nextTick();

    _rejectVerifyDialog();

    await expect(promise).resolves.toBeNull();
    expect(_getVerifyDialogState().visible).toBe(false);
  });

  it('关闭后重复结算不会改写已定的结果', async () => {
    const promise = openMasterPasswordVerifyDialog('导出', 'desc');
    await nextTick();

    _resolveVerifyDialog('first');
    _resolveVerifyDialog('second');
    _rejectVerifyDialog();

    await expect(promise).resolves.toBe('first');
  });
});

describe('单槽位：并发打开时旧等待者必须先被结算', () => {
  it('第二次 open 把第一次的 Promise 以 null 结算，避免其永久挂起', async () => {
    const first = openMasterPasswordVerifyDialog('导出', 'desc-1');
    const firstCalls = track(first);
    await nextTick();

    const second = openMasterPasswordVerifyDialog('清空', 'desc-2');
    await nextTick();

    // 缺陷形态：旧 resolve 被新 resolve 覆盖 → firstCalls 永远为空 → 旧 handler 卡在 loading
    expect(firstCalls, '前一个等待者必须被取消，否则 await 它的调用方永不返回').toEqual([null]);

    _resolveVerifyDialog('pw');
    await expect(second).resolves.toBe('pw');
  });

  it('标题与描述跟随最后一次 open（弹窗展示的是当前发起者的文案）', async () => {
    void openMasterPasswordVerifyDialog('导出', 'desc-1');
    void openMasterPasswordVerifyDialog('身份库', 'desc-2');
    await nextTick();

    expect(_getVerifyDialogState().title).toBe('身份库');
    expect(_getVerifyDialogState().description).toBe('desc-2');
    expect(_getVerifyDialogState().visible).toBe(true);
  });

  it('无人等待时 resolve/reject 不抛错，且仍把 visible 落回 false', async () => {
    openMasterPasswordVerifyDialog('导出', 'desc');
    await nextTick();
    _rejectVerifyDialog();
    await nextTick();

    // 此刻槽位为空：组件的关闭动画回调、或重复触发都会走到这条路径
    _getVerifyDialogState().visible = true;
    expect(() => _resolveVerifyDialog('late')).not.toThrow();
    expect(_getVerifyDialogState().visible).toBe(false);
    expect(() => _rejectVerifyDialog()).not.toThrow();
  });

  it('取消后新开的一格不会被上一格的回调结算', async () => {
    const first = openMasterPasswordVerifyDialog('导出', 'desc-1');
    await nextTick();
    _rejectVerifyDialog();
    await expect(first).resolves.toBeNull();

    const second = openMasterPasswordVerifyDialog('清空', 'desc-2');
    const secondCalls = track(second);
    await nextTick();

    expect(secondCalls).toEqual([]);
  });
});

describe('promptAndVerifyMasterPassword 门面', () => {
  /**
   * 门面本身只有一行转发，但它是全部业务调用方唯一认识的入口，
   * 故按「端到端驱动真实控制器」断言：文案落进弹窗状态、结果原样回传。
   */
  it('原样透传标题与描述，并把控制器结算的结果回传给调用方', async () => {
    const promise = promptAndVerifyMasterPassword('历史设置', '请输入主密码：');
    await nextTick();

    expect(_getVerifyDialogState().title).toBe('历史设置');
    expect(_getVerifyDialogState().description).toBe('请输入主密码：');
    expect(_getVerifyDialogState().visible).toBe(true);

    _resolveVerifyDialog('pw-123');
    await expect(promise).resolves.toBe('pw-123');
  });

  it('用户取消时返回 null，调用方以「非真假值」判定中止', async () => {
    const promise = promptAndVerifyMasterPassword('会话时长', 'desc');
    await nextTick();

    _rejectVerifyDialog();

    await expect(promise).resolves.toBeNull();
  });
});
