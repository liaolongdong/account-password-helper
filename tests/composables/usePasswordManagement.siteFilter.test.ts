/** @vitest-environment jsdom */

/**
 * 分类栏两段候选的列表链路回归测试（usePasswordManagement 的 tagOptions / availableSites 与对应筛选）
 *
 * 站点候选与既有的标签候选、标签筛选与站点筛选共用同一条过滤链，因此这里钉的是
 * 「两段接进同一个左栏之后不破坏原有语义」：
 *
 * 1. **叠加关系不变**：站点与关键词、收藏、标签是 AND，同一段内部多个值之间是 OR。
 *    写成 AND 会让「选了 github.com 又选 gitlab.com」变成空表。
 * 2. **通用条目恒保留**：空 `url` 的条目对任何站点都可用，被筛掉等于让用户以为库里没有。
 * 3. **隐形空过滤**：某站点（某标签）的条目被删光后它从候选集消失，若筛选条件不跟着剔除，
 *    左栏里看不见、列表却一直是空的。
 * 4. **页码复位**：筛选口径变了继续停在第 7 页只会读到空白，`filterSites` 必须进
 *    `listFilterSignature`。
 * 5. **两段候选同形同序**：都产出 `{ value, count }` 且按「计数倒序 → 值正序」，
 *    否则同一屏里两段给出两套排序答案。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';
import type { PasswordEntry } from '@/utils/types';

/** 造一条条目：`url` 与 `tag` 可覆盖，其余字段取固定值 */
const makeEntry = (id: string, url: string, tag = ''): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: 'cipher-text',
  url,
  tag,
  remark: '',
  createTime: 1_000_000,
  updateTime: 2_000_000,
  order: 0,
});

describe('usePasswordManagement.siteFilter', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    });
    vi.spyOn(StorageUtils, 'getAllPasswords').mockResolvedValue([]);

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  /** 命中列表的 id 读数（排序后取集合口径，与列表自身的排序状态无关） */
  const matchedIds = () => mgmt.filteredPasswords.value.map(entry => entry.id).sort();

  it('未选中站点时不参与筛选，列表保持全量', () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com'), makeEntry('b', 'gitlab.com')];
    expect(mgmt.filterSites.value).toEqual([]);
    expect(matchedIds()).toEqual(['a', 'b']);
  });

  it('选中站点后只留该站点条目，并保留空 url 的通用条目', () => {
    mgmt.passwords.value = [
      makeEntry('gh1', 'https://github.com/login'),
      makeEntry('gh2', 'github.com'),
      makeEntry('gl', 'gitlab.com'),
      makeEntry('any', ''),
    ];
    mgmt.filterSites.value = ['github.com'];

    expect(matchedIds()).toEqual(['any', 'gh1', 'gh2']);
  });

  it('多个站点之间是或关系', () => {
    mgmt.passwords.value = [makeEntry('gh', 'github.com'), makeEntry('gl', 'gitlab.com'), makeEntry('x', 'other.com')];
    mgmt.filterSites.value = ['github.com', 'gitlab.com'];

    expect(matchedIds()).toEqual(['gh', 'gl']);
  });

  it('与关键词、收藏、标签是叠加关系', () => {
    mgmt.passwords.value = [
      Object.assign(makeEntry('a', 'github.com', 'work'), { favorite: true }),
      Object.assign(makeEntry('b', 'github.com', 'home'), { favorite: true }),
      Object.assign(makeEntry('c', 'gitlab.com', 'work'), { favorite: true }),
    ];
    mgmt.filterSites.value = ['github.com'];
    mgmt.filterTags.value = ['work'];
    mgmt.favoriteOnly.value = true;

    expect(matchedIds()).toEqual(['a']);
  });

  it('候选集按条目数倒序汇总站点', () => {
    mgmt.passwords.value = [
      makeEntry('a', 'github.com'),
      makeEntry('b', 'https://github.com/settings'),
      makeEntry('c', 'gitlab.com'),
      makeEntry('d', ''),
    ];

    // 通用条目（空 url）不进候选集
    expect(mgmt.availableSites.value).toEqual([
      { value: 'github.com', count: 2 },
      { value: 'gitlab.com', count: 1 },
    ]);
  });

  it('站点条目被删光后自动剔除该筛选条件，不留隐形空过滤', async () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com'), makeEntry('b', 'gitlab.com')];
    mgmt.filterSites.value = ['github.com', 'gitlab.com'];
    await nextTick();

    // 删除 github.com 的条目：候选集里 github.com 消失，筛选条件必须跟着收口
    mgmt.passwords.value = [makeEntry('b', 'gitlab.com')];
    await nextTick();

    expect(mgmt.availableSites.value).toEqual([{ value: 'gitlab.com', count: 1 }]);
    expect(mgmt.filterSites.value).toEqual(['gitlab.com']);
    expect(matchedIds()).toEqual(['b']);
  });

  it('站点筛选变化会把页码复位到第 1 页', async () => {
    // 150 条分属两个站点，每页 100 → 翻到第 2 页后换筛选口径必须回到第 1 页
    mgmt.passwords.value = Array.from({ length: 150 }, (_, index) =>
      makeEntry(`e${index}`, index < 120 ? 'github.com' : 'gitlab.com'),
    );
    await nextTick();
    mgmt.currentPage.value = 2;
    expect(mgmt.pageCount.value).toBe(2);

    mgmt.filterSites.value = ['gitlab.com'];
    await nextTick();

    expect(mgmt.currentPage.value).toBe(1);
    expect(mgmt.totalCount.value).toBe(30);
  });

  it('两段候选同形同序：都产出 `{ value, count }`，计数倒序、同数量按值正序', () => {
    mgmt.passwords.value = [
      makeEntry('a', 'github.com', 'work'),
      makeEntry('b', 'https://github.com/settings', 'home'),
      makeEntry('c', 'gitlab.com', 'work'),
      makeEntry('d', '', ''),
    ];

    // 站点段与标签段必须给出同一套顺序答案，否则同一屏里两段读起来像两个规则
    expect(mgmt.tagOptions.value).toEqual([
      { value: 'work', count: 2 },
      { value: 'home', count: 1 },
    ]);
    expect(mgmt.availableSites.value).toEqual([
      { value: 'github.com', count: 2 },
      { value: 'gitlab.com', count: 1 },
    ]);
  });

  it('左栏没有「面板展开中」这个中间态，改任一筛选立即清空选中', async () => {
    // 多选下拉时代要延迟清空，是因为面板开着时批量按钮消失会引起布局跳动；
    // 左栏每次点击都是一个落定状态，因此与收藏过滤同策略、立即清空。
    mgmt.passwords.value = [makeEntry('a', 'github.com', 'work'), makeEntry('b', 'gitlab.com', 'home')];

    mgmt.handleSelectionChange(mgmt.passwords.value);
    mgmt.filterSites.value = ['github.com'];
    await nextTick();
    expect(mgmt.selectedIds.value).toHaveLength(0);

    mgmt.handleSelectionChange(mgmt.passwords.value);
    mgmt.filterTags.value = ['work'];
    await nextTick();
    expect(mgmt.selectedIds.value).toHaveLength(0);
  });

  it('标签被删光后自动剔除该筛选条件，与站点段同策略', async () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com', 'work'), makeEntry('b', 'gitlab.com', 'home')];
    mgmt.filterTags.value = ['work', 'home'];
    await nextTick();

    mgmt.passwords.value = [makeEntry('b', 'gitlab.com', 'home')];
    await nextTick();

    expect(mgmt.tagOptions.value).toEqual([{ value: 'home', count: 1 }]);
    expect(mgmt.filterTags.value).toEqual(['home']);
    expect(matchedIds()).toEqual(['b']);
  });
});
