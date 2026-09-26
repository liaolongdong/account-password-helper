/** @vitest-environment jsdom */

/**
 * 批量编辑标签的落盘载荷与遍历成本回归测试（usePasswordManagement.batchEditTags）
 *
 * 这条路径在 2000 条上限下出现过两类可观察问题，各自钉一组断言：
 *
 * 1. **排序被打乱**：标签是元数据，批量改标签不该把条目挤进「最近更新」。
 *    `StorageUtils.batchUpdatePasswordMetadata` 的合并式是
 *    `{ ...current, ...fields, updateTime: fields.updateTime ?? Date.now() }`——
 *    载荷里没带 `updateTime` 就等于当场把它改成「现在」，整批选中条目瞬间置顶。
 *    这里断言载荷带的就是各条目**原有**的那个数字。
 * 2. **一次操作卡住整页**：改造前函数里有两处按选中项逐条回查全库的
 *    `passwords.value.find(...)`（建载荷一次、落盘后就地更新再一次）。
 *    全库 2000 条、整批选中时那是 2 × 2000 × 2000 次经由 reactive 代理的属性读取，
 *    同窗口实测 2856.57 ms → 换按 id 建一次索引后 5.95 ms（约 480:1）。
 *    本文件用「每次调用给条目对象的 `id` 读取计数」把这件事变成确定性断言，
 *    不依赖计时（跨批次绝对毫秒在本机不可信，只认同一窗口内的相对量级）。
 * 3. **落盘后写错对象**：`await` 期间 storage watcher 可能整组替换 `passwords`，
 *    就地更新必须落在「此刻列表里的」条目对象上，否则界面停在旧值、
 *    而改过的那个对象已不在渲染树里。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { usePasswordManagement, MAX_TAG_COUNT } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';
import type { PasswordEntry } from '@/utils/types';

/** 打桩到 globalThis 的 Element Plus 命令式 API（测试环境按裸全局解析，口径见 delete 测试的说明） */
interface EpStubs {
  ElMessage: Record<'success' | 'error' | 'warning' | 'info', ReturnType<typeof vi.fn>>;
  ElMessageBox: { confirm: ReturnType<typeof vi.fn> };
}

/** 批量元数据写入的函数签名（显式取，避免 `ReturnType<typeof vi.spyOn>` 把载荷抹成 `any`） */
type BatchMetadataWrite = (updates: Array<{ id: string; updates: Partial<PasswordEntry> }>) => Promise<void>;

/** 造一条条目：`updateTime` 刻意与 `createTime` 不同，便于证明写入用的是原值 */
const makeEntry = (id: string, tag = '', patch: Partial<PasswordEntry> = {}): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: 'cipher-text',
  url: 'https://example.com',
  tag,
  remark: '',
  createTime: 1_000_000,
  updateTime: 2_000_000,
  order: 0,
  ...patch,
});

/**
 * 给条目对象的 `id` 读取计数
 *
 * 每轮全表扫描的判据都是 `p.id === id`，因而「`id` 被读了多少次」正是扫描遍数的直接度量：
 * 一遍全库 = n 次，k 个选中项逐条回查全库 = k × n 次。计数装在条目对象这一层
 * （而不是数组层），因为 Vue 3.5 的数组迭代插桩会 `toRaw` 后再取值，数组代理的
 * `get`  traps 数不到逐索引访问；对象代理一定在读取链路上。
 */
const countIdReads = (entries: PasswordEntry[]): { proxy: PasswordEntry; reads: () => number }[] =>
  entries.map(entry => {
    let counter = 0;
    const proxy = new Proxy(entry, {
      get: (target, prop, receiver) => {
        if (prop === 'id') counter += 1;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as PasswordEntry;
    return { proxy, reads: () => counter };
  });

describe('usePasswordManagement.batchEditTags', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;
  let ep: EpStubs;
  let writeSpy: Mock<BatchMetadataWrite>;

  beforeEach(() => {
    vi.useRealTimers();
    ep = {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    };
    Object.assign(globalThis, ep);

    // 列表读取与批量写入都打桩：本文件只关心「喂给存储的载荷」与「就地更新的落点」
    vi.spyOn(StorageUtils, 'getAllPasswords').mockResolvedValue([]);
    writeSpy = vi.spyOn(StorageUtils, 'batchUpdatePasswordMetadata').mockResolvedValue(undefined);

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  it('追加模式：合并去重后一次批量写入，且沿用条目原有的 updateTime', async () => {
    const entries = [makeEntry('a', 'work', { updateTime: 111 }), makeEntry('b', '', { updateTime: 222 })];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);

    await mgmt.batchEditTags(['work', 'home'], 'append');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    // 标签是元数据编辑：载荷里必须带着各自的原始 updateTime，否则整批条目会被挤到「最近更新」最前
    expect(writeSpy.mock.calls[0][0]).toEqual([
      { id: 'a', updates: { tag: 'work,home', updateTime: 111 } },
      { id: 'b', updates: { tag: 'work,home', updateTime: 222 } },
    ]);
    expect(ep.ElMessage.success).toHaveBeenCalledWith('form.batchTagDone');
  });

  it('移除模式：只摘掉指定标签，其余标签与顺序保持', async () => {
    const entries = [makeEntry('a', 'work,home,personal'), makeEntry('b', 'home')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);

    await mgmt.batchEditTags(['home'], 'remove');

    expect(writeSpy.mock.calls[0][0]).toEqual([
      { id: 'a', updates: { tag: 'work,personal', updateTime: 2_000_000 } },
      { id: 'b', updates: { tag: '', updateTime: 2_000_000 } },
    ]);
  });

  it('超出标签上限的条目跳过不写，其余照常落盘并提示跳过数量', async () => {
    const entries = [makeEntry('a', 'x1,x2,x3'), makeEntry('b', 'x1'), makeEntry('c', 'x1,x2')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);

    await mgmt.batchEditTags(['new'], 'append');

    // 追加后超过 MAX_TAG_COUNT 的那一条不进载荷，另外两条要进
    expect(writeSpy.mock.calls[0][0].map(item => item.id)).toEqual(['b', 'c']);
    expect(ep.ElMessage.success).toHaveBeenCalledWith('form.batchTagDone');
    expect(ep.ElMessage.warning).toHaveBeenCalledWith('form.batchTagSkipped');
  });

  it('标签上限只有一条定义来源：跳过的判据就是 MAX_TAG_COUNT', async () => {
    // 3 个已有标签 + 1 个新标签 = 4 > MAX_TAG_COUNT → 全被跳过，一条都不写
    expect(MAX_TAG_COUNT).toBe(3);
    const entries = [makeEntry('a', 'x1,x2,x3')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);

    await mgmt.batchEditTags(['x4'], 'append');

    expect(writeSpy).not.toHaveBeenCalled();
    expect(ep.ElMessage.info).toHaveBeenCalledWith('form.batchTagAllSkipped');
  });

  it('无需变更时不写存储：既报「无需变更」也不报「全部跳过」', async () => {
    const entries = [makeEntry('a', 'work,home'), makeEntry('b', 'home')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);

    await mgmt.batchEditTags(['home'], 'append');

    expect(writeSpy).not.toHaveBeenCalled();
    expect(ep.ElMessage.info).toHaveBeenCalledTimes(1);
    expect(ep.ElMessage.info).toHaveBeenCalledWith('form.batchTagNoChange');
    expect(ep.ElMessage.warning).not.toHaveBeenCalled();
  });

  it('空标签或空选择直接返回，不碰存储也不提示', async () => {
    const entries = [makeEntry('a', 'work')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);

    await mgmt.batchEditTags(['  '], 'append');
    mgmt.handleSelectionChange([]);
    await mgmt.batchEditTags(['x'], 'append');

    expect(writeSpy).not.toHaveBeenCalled();
    expect(ep.ElMessage.info).not.toHaveBeenCalled();
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
  });

  it('遍历成本不随「选中数 × 全库数」增长：整批选中时只扫两遍列表', async () => {
    const n = 20;
    const entries = Array.from({ length: n }, (_, i) => makeEntry(`r${i}`));
    const instrumented = countIdReads(entries);
    mgmt.passwords.value = instrumented.map(item => item.proxy);
    mgmt.handleSelectionChange(entries);

    // 计数从「选择已建立」之后开始，只度量 batchEditTags 自身（选择用的是原始对象，不经过代理）
    const before = instrumented.reduce((sum, item) => sum + item.reads(), 0);

    await mgmt.batchEditTags(['x'], 'append');

    const scans = instrumented.reduce((sum, item) => sum + item.reads(), 0) - before;
    // 恰好三遍：`filter` 挑出选中项、建载荷时读一次 id、落盘后按 id 建一次索引，各 n 次。
    // 旧写法在这里是 n + n×n + n + n×n = 860——断言精确值同时证明「计数有效」，
    // 不会因为代理层没被穿过而空跑（那才是本用例唯一真正的失效方式）。
    expect(scans).toBe(n * 3);
  });

  it('写入期间列表被整组替换时，就地更新落在新列表的条目对象上', async () => {
    const originals = [makeEntry('a', 'work'), makeEntry('b', 'work')];
    // storage watcher 在 await 期间换掉整个数组：新对象携带的是落盘前的旧标签
    const replacementA = makeEntry('a', 'work');
    const replacementB = makeEntry('b', 'work');
    mgmt.passwords.value = originals;
    mgmt.handleSelectionChange(originals);
    writeSpy.mockImplementation(async () => {
      mgmt.passwords.value = [replacementA, replacementB];
    });

    await mgmt.batchEditTags(['work', 'home'], 'append');

    // 界面读到的是此刻列表里的对象，因此必须它们被改到，而不是已被换出的那两个
    expect(replacementA.tag).toBe('work,home');
    expect(replacementB.tag).toBe('work,home');
    expect(originals[0].tag).toBe('work');
    expect(ep.ElMessage.success).toHaveBeenCalledWith('form.batchTagDone');
  });

  it('写入后条目已不在列表里（被其他上下文删除）时静默跳过，不抛错', async () => {
    const entries = [makeEntry('a', 'work'), makeEntry('b', 'work')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);
    writeSpy.mockImplementation(async () => {
      mgmt.passwords.value = [entries[1]];
    });

    await expect(mgmt.batchEditTags(['work', 'home'], 'append')).resolves.toBeUndefined();

    expect(entries[1].tag).toBe('work,home');
    expect(ep.ElMessage.error).not.toHaveBeenCalled();
  });

  it('落盘失败：解除本地操作守卫、按失败提示，且不改列表里的标签', async () => {
    const entries = [makeEntry('a', 'work')];
    mgmt.passwords.value = entries;
    mgmt.handleSelectionChange(entries);
    writeSpy.mockRejectedValue(new Error('storage 写入失败'));

    await mgmt.batchEditTags(['work', 'home'], 'append');

    expect(entries[0].tag).toBe('work');
    expect(ep.ElMessage.success).not.toHaveBeenCalled();
    expect(ep.ElMessage.error).toHaveBeenCalledWith('message.operationFailed');
    expect(mgmt.isLocalOperation.value).toBe(false);
  });
});
