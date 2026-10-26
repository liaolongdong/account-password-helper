/** @vitest-environment jsdom */

/**
 * 标签候选计数的列表链路回归测试（usePasswordManagement 的 availableTagOptions）
 *
 * 管理页筛选栏的标签下拉从「裸标签数组」升级为「带条目数的候选集」，这里钉四件事：
 *
 * 1. **计数口径 = 全库条目数**：一旦改成「当前筛选结果数」，选中一个标签后其余候选会当场
 *    归零，下拉读起来就是空集（与站点候选 `availableSites` 同口径）。
 * 2. **两个视图同源不同序**：`availableTagOptions` 按条目数倒序给筛选栏；
 *    `availableTags` 保持首次出现顺序给新增表单与批量标签弹窗——不能因为加了计数就改掉那两处的顺序。
 * 3. **失效剔除照样成立**：某标签的最后一条被改掉后，候选集与筛选条件同时收口，
 *    不留「下拉里看不见、列表却是空集」的隐形过滤。
 * 4. **一条目的多标签各计一次**：同一条目可以同时坐进多个标签的计数桶。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { StorageUtils } from '@/utils/storage';
import type { PasswordEntry } from '@/utils/types';

/** 造一条条目：`tag` 可覆盖，其余字段取固定值 */
const makeEntry = (id: string, tag = ''): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: 'cipher-text',
  url: `${id}.e2e-tag.test`,
  tag,
  remark: '',
  createTime: 1_000_000,
  updateTime: 2_000_000,
  order: 0,
});

describe('usePasswordManagement.tagOptions', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    });
    vi.spyOn(StorageUtils, 'getAllPasswordsDetailed').mockResolvedValue({ entries: [], undecryptableCount: 0 });

    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
  });

  afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).ElMessage;
    delete (globalThis as Record<string, unknown>).ElMessageBox;
  });

  it('候选集带条目数并按其倒序，同数量按标签码点正序', () => {
    mgmt.passwords.value = [
      makeEntry('a', 'work,home'),
      makeEntry('b', 'work'),
      makeEntry('c', 'work'),
      makeEntry('d', 'home'),
      makeEntry('e', 'Bank'),
      makeEntry('f', ''),
    ];

    // work 3 条最前、home 2 条、Bank 1 条；条目 f 没有标签，不进候选集。
    // 同数量标签之间的码点并列序由 `tests/utils/tagUtils.test.ts` 钉，这里只有一条 count=1。
    expect(mgmt.availableTagOptions.value).toEqual([
      { tag: 'work', count: 3 },
      { tag: 'home', count: 2 },
      { tag: 'Bank', count: 1 },
    ]);
  });

  it('计数视图倒序，弹窗视图仍是首次出现顺序', () => {
    mgmt.passwords.value = [
      makeEntry('a', '少,中'),
      makeEntry('b', '多'),
      makeEntry('c', '多,中'),
      makeEntry('d', '多'),
    ];

    expect(mgmt.availableTags.value).toEqual(['少', '中', '多']);
    expect(mgmt.availableTagOptions.value.map(option => option.tag)).toEqual(['多', '中', '少']);
  });

  it('候选键集与计数视图同源：标签失效后筛选条件同步收口', async () => {
    mgmt.passwords.value = [makeEntry('a', 'work'), makeEntry('b', 'home')];
    mgmt.filterTags.value = ['work', 'home'];
    await nextTick();

    // work 的最后一条改挂别的标签：两个视图都只剩 home，筛选条件里的 work 必须被剔除
    mgmt.passwords.value = [makeEntry('a', 'vacation'), makeEntry('b', 'home')];
    await nextTick();

    expect(mgmt.availableTagOptions.value).toEqual([
      { tag: 'home', count: 1 },
      { tag: 'vacation', count: 1 },
    ]);
    expect(mgmt.filterTags.value).toEqual(['home']);
    expect(mgmt.filteredPasswords.value.map(entry => entry.id)).toEqual(['b']);
  });

  it('无标签条目不进候选集，空库得到空候选', () => {
    expect(mgmt.availableTagOptions.value).toEqual([]);

    mgmt.passwords.value = [makeEntry('a'), makeEntry('b', ' , ， ')];

    expect(mgmt.availableTagOptions.value).toEqual([]);
    expect(mgmt.availableTags.value).toEqual([]);
  });
});
