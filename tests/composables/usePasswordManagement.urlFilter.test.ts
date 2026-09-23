/**
 * Options 网址筛选测试（usePasswordManagement）
 *
 * 契约：
 * 1. availableUrls 从条目 URL 聚合去重的 hostname（规范化协议/路径/大小写，空 URL 不产生候选）；
 * 2. filterUrls 命中任一域名即保留（OR），与标签/收藏/关键词过滤叠加（AND）；
 * 3. 条目删除导致候选失效时，自动剔除已选筛选项，避免隐形空过滤；
 * 4. 网址筛选变化回到第一页；
 * 5. 下拉展开期间勾选不立即清空选中，收起后补执行（与标签筛选策略一致）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

/** 等待搜索关键词 200ms 防抖落定 */
const flushDebounce = () => new Promise(resolve => setTimeout(resolve, 250));

describe('usePasswordManagement 网址筛选', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(async () => {
    scope = effectScope();
    mgmt = scope.run(() => usePasswordManagement({ validityForm: ref({ validityHours: 1 }) }))!;
    await flushAsync();
  });

  afterEach(() => {
    scope.stop();
  });

  it('availableUrls 聚合去重并规范化 hostname', () => {
    mgmt.passwords.value = [
      makePasswordEntry({ id: 'a', url: 'https://Example.com/login' }),
      makePasswordEntry({ id: 'b', url: 'example.com' }),
      makePasswordEntry({ id: 'c', url: 'https://github.com' }),
      makePasswordEntry({ id: 'd', url: '' }),
    ];

    expect(mgmt.availableUrls.value).toEqual(['example.com', 'github.com']);
  });

  it('filterUrls 命中任一域名保留，与其他过滤叠加', async () => {
    // updateTime 递减，保证默认排序（updateTime 降序）下结果为 a、b、c 顺序
    mgmt.passwords.value = [
      makePasswordEntry({ id: 'a', url: 'https://example.com', tag: '工作', updateTime: 3 }),
      makePasswordEntry({ id: 'b', url: 'https://github.com', tag: '个人', updateTime: 2 }),
      makePasswordEntry({ id: 'c', url: 'https://other.org', tag: '工作', updateTime: 1 }),
    ];
    await nextTick();

    // OR：两个域名任一命中
    mgmt.filterUrls.value = ['example.com', 'github.com'];
    await nextTick();
    expect(mgmt.filteredPasswords.value.map(p => p.id)).toEqual(['a', 'b']);

    // AND：与标签筛选叠加
    mgmt.filterTags.value = ['个人'];
    await nextTick();
    expect(mgmt.filteredPasswords.value.map(p => p.id)).toEqual(['b']);
  });

  it('候选失效时自动剔除已选筛选项', async () => {
    mgmt.passwords.value = [
      makePasswordEntry({ id: 'a', url: 'https://example.com' }),
      makePasswordEntry({ id: 'b', url: 'https://github.com' }),
    ];
    await nextTick();
    mgmt.filterUrls.value = ['example.com', 'github.com'];
    await nextTick();

    // 删除 example.com 条目后候选不再包含它，已选筛选项应被剔除而非残留隐形过滤
    mgmt.passwords.value = [makePasswordEntry({ id: 'b', url: 'https://github.com' })];
    await nextTick();

    expect(mgmt.filterUrls.value).toEqual(['github.com']);
    expect(mgmt.filteredPasswords.value.map(p => p.id)).toEqual(['b']);
  });

  it('网址筛选变化时回到第一页', async () => {
    mgmt.passwords.value = Array.from({ length: 120 }, (_, i) =>
      makePasswordEntry({ id: `id-${i}`, url: i < 60 ? 'https://example.com' : 'https://github.com', order: i }),
    );
    mgmt.currentPage.value = 2;
    await nextTick();
    expect(mgmt.currentPage.value).toBe(2);

    mgmt.filterUrls.value = ['github.com'];
    await nextTick();
    expect(mgmt.currentPage.value).toBe(1);
  });

  it('筛选下拉候选随搜索关键词动态收窄', async () => {
    mgmt.passwords.value = [
      makePasswordEntry({ id: 'a', username: 'alice', url: 'https://example.com', tag: '工作', updateTime: 3 }),
      makePasswordEntry({ id: 'b', username: 'bob', url: 'https://github.com', tag: '个人', updateTime: 2 }),
    ];
    await nextTick();

    // 无搜索：候选为全量
    expect(mgmt.filterTagOptions.value).toEqual(['工作', '个人']);
    expect(mgmt.filterUrlOptions.value).toEqual(['example.com', 'github.com']);

    // 搜索命中 alice（工作 / example.com）：候选收窄到该子集
    mgmt.searchKeyword.value = 'alice';
    await flushDebounce(); // 等待 200ms 防抖落定
    await nextTick();
    expect(mgmt.filterTagOptions.value).toEqual(['工作']);
    expect(mgmt.filterUrlOptions.value).toEqual(['example.com']);
  });

  it('已选筛选项并入候选，搜索收窄时不丢失 chip', async () => {
    mgmt.passwords.value = [
      makePasswordEntry({ id: 'a', username: 'alice', url: 'https://example.com', tag: '工作', updateTime: 3 }),
      makePasswordEntry({ id: 'b', username: 'bob', url: 'https://github.com', tag: '个人', updateTime: 2 }),
    ];
    await nextTick();
    mgmt.filterTags.value = ['个人'];
    mgmt.filterUrls.value = ['github.com'];
    await nextTick();

    // 搜索 alice 时结果集不含「个人」标签，但已选项仍应保留在候选中以便取消勾选
    mgmt.searchKeyword.value = 'alice';
    await flushDebounce();
    await nextTick();
    expect(mgmt.filterTagOptions.value).toContain('个人');
    expect(mgmt.filterUrlOptions.value).toContain('github.com');
    // 且筛选选择未被搜索清除（搜索只是临时视图收窄）
    expect(mgmt.filterTags.value).toEqual(['个人']);
    expect(mgmt.filterUrls.value).toEqual(['github.com']);
  });

  it('下拉展开期间勾选不清空选中，收起后补执行', async () => {
    mgmt.passwords.value = [
      makePasswordEntry({ id: 'a', url: 'https://example.com' }),
      makePasswordEntry({ id: 'b', url: 'https://github.com' }),
    ];
    await nextTick();
    mgmt.selectedIds.value = ['a'];

    // 展开下拉：交互中途筛选变化不立即清空选中（避免批量按钮闪没）
    mgmt.handleUrlFilterVisibleChange(true);
    mgmt.filterUrls.value = ['example.com'];
    await nextTick();
    expect(mgmt.selectedIds.value).toEqual(['a']);

    // 收起下拉：补执行清空
    mgmt.handleUrlFilterVisibleChange(false);
    await nextTick();
    expect(mgmt.selectedIds.value).toEqual([]);
  });
});
