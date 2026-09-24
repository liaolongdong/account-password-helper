/** @vitest-environment jsdom */

/**
 * 管理页检索口径接线回归测试（usePasswordManagement）
 *
 * 钉住一件事：管理页的关键词过滤必须走 `utils/keywordMatch.filterByKeyword` 这条单一真源，
 * 而不是在 composable 里手抄一份字段清单。两种失败形状各自对应真实故障：
 *
 * 1. **字段归一丢失**：条目可能来自历史数据或被手工改过的存储，`tag` / `remark` 等字段
 *    类型上必填、实际上可能是非字符串。手抄清单把原值直接喂给匹配器，`indexOfIgnoreCase`
 *    里的 `text.toLowerCase()` 会当场抛错——表现为「搜索框一打字，整个列表消失」（computed
 *    抛错 → `pagedEntries` 拿不到值）。经 `keywordFieldsOf` 归一则按空串跳过，与侧边栏、
 *    内联下拉同一答案。
 * 2. **清单漂移**：三处各维护一份 `[username, tag, remark, url]` 时，给内核新增一个可搜字段
 *    只会让另外两处静默搜不到它（`docs/ARCHITECTURE.md`「检索口径单一真源」正是这条断言）。
 *    这里用「与内核直调结果逐条相同」把接线钉住，漂移即红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import type { PasswordEntry } from '@/utils/types';
import { usePasswordManagement } from '@/composables/usePasswordManagement';
import { filterByKeyword } from '@/utils/keywordMatch';
import { matchesKeyword } from '@/utils/searchMatch';
import { sortPasswordEntries } from '@/utils/passwordSort';
import { StorageUtils } from '@/utils/storage';

/** 造一条最小可用条目 */
const makeEntry = (index: number, patch: Partial<PasswordEntry> = {}): PasswordEntry => ({
  id: `r${index}`,
  username: `user${index}`,
  password: 'p',
  url: '',
  tag: '',
  remark: '',
  totp: '',
  createTime: 1_000_000 + index,
  updateTime: 1_000_000 + index,
  order: index,
  ...patch,
});

describe('usePasswordManagement 的检索口径接线', () => {
  let scope: EffectScope;
  let mgmt: ReturnType<typeof usePasswordManagement>;

  beforeEach(() => {
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
      ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') },
    });
    // `loadPasswords` 等路径会读存储，统一给空数组避免 chrome 桩缺失
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

  it('字段值不是字符串的历史条目不再让过滤抛错，且按空串跳过', async () => {
    // 类型上 `tag` 必填 string，这里是刻意构造的脏数据（历史/手工改过的存储）
    mgmt.passwords.value = [
      makeEntry(1, { tag: 123 as unknown as string }),
      makeEntry(2, { remark: { text: 'x' } as unknown as string, username: 'ok' }),
      makeEntry(3, { username: 'alice', url: undefined as unknown as string }),
    ];
    mgmt.debouncedSearchKeyword.value = 'alice';
    await nextTick();

    // 修复前：`matchesKeyword([username, 123, ...])` 一路走到 `text.toLowerCase()` 抛 TypeError
    expect(() => mgmt.filteredPasswords.value).not.toThrow();
    expect(mgmt.filteredPasswords.value.map(entry => entry.id)).toEqual(['r3']);
  });

  it('非字符串字段本身不会被当成命中文本（归一为不搜，而非搜其字符串形式）', async () => {
    mgmt.passwords.value = [makeEntry(1, { tag: 123 as unknown as string })];
    mgmt.debouncedSearchKeyword.value = '123';
    await nextTick();

    expect(mgmt.filteredPasswords.value).toEqual([]);
  });

  it('过滤结果与内核直调逐条相同（字段清单与保序口径不得各留一份）', async () => {
    const list = [
      makeEntry(1, { username: 'github', tag: '工作', remark: '旧账号', url: 'github.com' }),
      makeEntry(2, { username: 'bob', tag: '个人,github', remark: '', url: '' }),
      makeEntry(3, { username: 'carol', tag: '', remark: '备注里含 github', url: '' }),
      makeEntry(4, { username: 'dave', tag: '', remark: '', url: 'example.com' }),
    ];
    mgmt.passwords.value = list;
    mgmt.debouncedSearchKeyword.value = 'github';
    await nextTick();

    const expected = sortPasswordEntries(filterByKeyword(list, 'github', matchesKeyword), mgmt.currentSort.value);
    expect(mgmt.filteredPasswords.value.map(entry => entry.id)).toEqual(expected.map(entry => entry.id));
    // 四个字段各自都要能命中：漏掉任一字段说明清单又开始各写一份
    for (const keyword of ['github', '个人', '备注里', 'example']) {
      mgmt.debouncedSearchKeyword.value = keyword;
      await nextTick();
      expect(mgmt.filteredPasswords.value.length, `字段清单缺检索面：${keyword}`).toBeGreaterThan(0);
    }
  });

  it('空关键词不过滤（与内核对空白关键词的语义一致）', async () => {
    mgmt.passwords.value = [makeEntry(1), makeEntry(2)];
    mgmt.debouncedSearchKeyword.value = '   ';
    await nextTick();

    expect(mgmt.filteredPasswords.value).toHaveLength(2);
  });
});
