/** @vitest-environment jsdom */

/**
 * 站点筛选的列表链路回归测试（usePasswordManagement 的 filterSites / availableSites）
 *
 * 站点筛选与既有的标签筛选共用同一条过滤链，因此这里钉的是「接进去之后不破坏原有语义」：
 *
 * 1. **叠加关系不变**：站点与关键词、收藏、标签是 AND，多个站点之间是 OR。
 *    写成 AND 会让「选了 github.com 又选 gitlab.com」变成空表。
 * 2. **没填网址的条目按它自己的桶判定**：空 `url` 归一后是空串，落到候选集末位的
 *    「无网址」一桶。勾了别的站点就不出现（与同一条链上的标签筛选同口径），
 *    单独勾这一桶时列表只剩这批——「找出没填网址的条目去补全」在管理页里只有这一个落点。
 * 3. **隐形空过滤**：某站点的条目被删光后该站点从候选集消失，若筛选条件不跟着剔除，
 *    下拉里看不见、列表却一直是空的。
 * 4. **页码复位**：筛选口径变了继续停在第 7 页只会读到空白，`filterSites` 必须进
 *    `listFilterSignature`。
 * 5. **选中清空的延迟时机**：多选下拉展开期间每次勾选都会触发筛选变化，
 *    立即清空选中会让批量按钮在交互中途消失、引起布局跳动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';
import { GENERIC_SITE_KEY } from '@/utils/siteUtils';
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

  it('选中站点后只留该站点条目，空 url 的条目跟着被筛掉', () => {
    mgmt.passwords.value = [
      makeEntry('gh1', 'https://github.com/login'),
      makeEntry('gh2', 'github.com'),
      makeEntry('gl', 'gitlab.com'),
      makeEntry('any', ''),
    ];
    mgmt.filterSites.value = ['github.com'];

    expect(matchedIds()).toEqual(['gh1', 'gh2']);
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

  it('候选集按条目数倒序汇总站点，未填网址的条目汇成末位的通用桶', () => {
    mgmt.passwords.value = [
      makeEntry('a', 'github.com'),
      makeEntry('b', 'https://github.com/settings'),
      makeEntry('c', 'gitlab.com'),
      makeEntry('d', ''),
    ];

    // 通用条目（空 url）自成一桶、恒排末位：它不是一个站点，跟着计数在列表里跳位
    // 会让用户每次打开下拉都要重新找它
    expect(mgmt.availableSites.value).toEqual([
      { site: 'github.com', count: 2 },
      { site: 'gitlab.com', count: 1 },
      { site: GENERIC_SITE_KEY, count: 1 },
    ]);
  });

  it('只勾「无网址」这一桶时，列表只剩这批条目', () => {
    mgmt.passwords.value = [
      makeEntry('a', 'github.com'),
      makeEntry('b', 'gitlab.com'),
      makeEntry('c', ''),
      makeEntry('d', ''),
    ];
    mgmt.filterSites.value = [GENERIC_SITE_KEY];

    // 真实站点的键永远不等于哨兵，所以这一勾就是「把待补网址的条目挑出来」的落点
    expect(matchedIds()).toEqual(['c', 'd']);
  });

  it('站点条目被删光后自动剔除该筛选条件，不留隐形空过滤', async () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com'), makeEntry('b', 'gitlab.com')];
    mgmt.filterSites.value = ['github.com', 'gitlab.com'];
    await nextTick();

    // 删除 github.com 的条目：候选集里 github.com 消失，筛选条件必须跟着收口
    mgmt.passwords.value = [makeEntry('b', 'gitlab.com')];
    await nextTick();

    expect(mgmt.availableSites.value).toEqual([{ site: 'gitlab.com', count: 1 }]);
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

  it('下拉展开期间勾选站点不清空选中，收起后补执行', async () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com'), makeEntry('b', 'gitlab.com')];
    mgmt.handleSelectionChange(mgmt.passwords.value);
    expect(mgmt.selectedIds.value).toHaveLength(2);

    mgmt.handleFilterDropdownVisibleChange(true);
    mgmt.filterSites.value = ['github.com'];
    await nextTick();
    expect(mgmt.selectedIds.value).toHaveLength(2);

    mgmt.handleFilterDropdownVisibleChange(false);
    expect(mgmt.selectedIds.value).toHaveLength(0);
  });

  it('下拉收起状态下改站点筛选，立即清空选中（与标签筛选同策略）', async () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com'), makeEntry('b', 'gitlab.com')];
    mgmt.handleSelectionChange(mgmt.passwords.value);

    mgmt.filterSites.value = ['github.com'];
    await nextTick();

    expect(mgmt.selectedIds.value).toHaveLength(0);
  });

  it('合并后的处理器仍管住标签勾选：展开期间延迟清空、收起后补执行', async () => {
    mgmt.passwords.value = [makeEntry('a', 'github.com', 'work'), makeEntry('b', 'gitlab.com', 'home')];
    mgmt.handleSelectionChange(mgmt.passwords.value);

    // 原来标签下拉由 handleTagFilterVisibleChange 独占标记，改名并共用后这条语义必须原样保留：
    // 标签勾选发生在展开期间时不清空，收起那一次才补执行。
    // 「两个下拉共用一份标记」这件事是结构性的，由 tests/architecture/siteFilterWiring.test.ts 钉。
    mgmt.handleFilterDropdownVisibleChange(true);
    mgmt.filterTags.value = ['work'];
    await nextTick();
    expect(mgmt.selectedIds.value).toHaveLength(2);

    mgmt.handleFilterDropdownVisibleChange(false);
    expect(mgmt.selectedIds.value).toHaveLength(0);
  });
});
