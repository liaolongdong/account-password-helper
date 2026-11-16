/** @vitest-environment jsdom */

/**
 * 最近搜索历史 composable 测试（composables/useSearchHistory.ts）
 *
 * 锁住三类契约：
 * 1. 隐私——只写 chrome.storage.session，绝不触碰 storage.local；锁定清除经
 *    onChanged（newValue === undefined）传导到 UI；日志与断言都不携带真实凭据。
 * 2. 列表语义——trim、去重、新→旧、≤8 条、短词不记；迟到的初始读取不得整包
 *    覆盖本地已发生的记录（只能合并）。
 * 3. 面板开合——点击空框才展开（自动聚焦不弹）、键入即收起、清空已有关键词
 *    重新展开、选中回填并收起；监听器随卸载摘除。
 *
 * chrome 桩每个用例新建实例（同引用返回会让「存储真的变了」这类断言只测到引用相等）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type Ref } from 'vue';
import { useSearchHistory } from '@/composables/useSearchHistory';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

const KEY = SESSION_MEMORY_KEYS.RECENT_SEARCHES;

type ChangeListener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void;

let changeListeners: ChangeListener[] = [];
let sessionData: Record<string, unknown> = {};

/** 新建 chrome 桩：session 区 + onChanged 登记表；local 区刻意不存在，误写即抛 */
function installChrome(initial: Record<string, unknown> = {}): void {
  sessionData = { ...initial };
  changeListeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionData[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(sessionData, items);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionData[key];
        }),
      },
      onChanged: {
        addListener: vi.fn((listener: ChangeListener) => changeListeners.push(listener)),
        removeListener: vi.fn((listener: ChangeListener) => {
          changeListeners = changeListeners.filter(item => item !== listener);
        }),
      },
    },
  };
}

const emitChange = (changes: Record<string, { newValue?: unknown }>, area = 'session'): void => {
  for (const listener of [...changeListeners]) listener(changes, area);
};

interface Mounted {
  keyword: Ref<string>;
  applied: string[];
  api: ReturnType<typeof useSearchHistory>;
  unmount: () => void;
}

/** 以最小宿主组件挂载，触发 onMounted 的初始读取与监听注册 */
function mountHistory(initialKeyword = ''): Mounted {
  const keyword = ref(initialKeyword);
  const applied: string[] = [];
  let api!: ReturnType<typeof useSearchHistory>;
  const app = createApp({
    setup() {
      api = useSearchHistory(keyword, value => {
        applied.push(value);
        keyword.value = value;
      });
      return () => h('div');
    },
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  return {
    keyword,
    applied,
    api,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const flush = async (): Promise<void> => {
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 0));
};

let mounted: Mounted | null = null;

beforeEach(() => installChrome());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

describe('记录语义与持久化边界', () => {
  it('trim 后去重、新→旧排列，并只写 storage.session', async () => {
    mounted = mountHistory();
    await flush();
    const { api, keyword } = mounted;

    keyword.value = '  github  ';
    api.recordCurrentSearch();
    keyword.value = 'gitlab';
    api.recordCurrentSearch();
    keyword.value = 'github';
    api.recordCurrentSearch();

    expect(api.recentSearches.value).toEqual(['github', 'gitlab']);
    expect(sessionData[KEY]).toEqual(['github', 'gitlab']);
    const session = (globalThis as unknown as { chrome: { storage: { session: { set: ReturnType<typeof vi.fn> } } } })
      .chrome.storage.session;
    expect(session.set).toHaveBeenCalledWith({ [KEY]: ['github', 'gitlab'] });
  });

  it('超过 8 条按新→旧淘汰最旧', async () => {
    mounted = mountHistory();
    await flush();
    const { api, keyword } = mounted;
    for (let i = 1; i <= 10; i++) {
      keyword.value = `site-${i}`;
      api.recordCurrentSearch();
    }
    expect(api.recentSearches.value).toHaveLength(8);
    expect(api.recentSearches.value[0]).toBe('site-10');
    expect(api.recentSearches.value).not.toContain('site-1');
    expect(api.recentSearches.value).not.toContain('site-2');
  });

  it('单字符与纯空白不记（击键中间态不污染候选）', async () => {
    mounted = mountHistory();
    await flush();
    const { api, keyword } = mounted;
    keyword.value = 'g';
    api.recordCurrentSearch();
    keyword.value = '   ';
    api.recordCurrentSearch();
    expect(api.recentSearches.value).toEqual([]);
    expect(sessionData[KEY]).toBeUndefined();
  });

  it('清除历史：列表清空、面板收起、session 键删除', async () => {
    installChrome({ [KEY]: ['github'] });
    mounted = mountHistory();
    await flush();
    const { api } = mounted;
    api.openHistoryPanel();
    expect(api.historyPanelOpen.value).toBe(true);

    api.clearSearchHistory();
    expect(api.recentSearches.value).toEqual([]);
    expect(api.historyPanelOpen.value).toBe(false);
    expect(sessionData[KEY]).toBeUndefined();
  });
});

describe('初始读取的收窄与竞态', () => {
  it('不可信存储值被收窄：非数组、非字符串、重复、超量都过滤', async () => {
    installChrome({ [KEY]: ['ok', 42, 'ok', '  ', 'a', ...Array.from({ length: 12 }, (_, i) => `s${i}`)] });
    mounted = mountHistory();
    await flush();
    const list = mounted.api.recentSearches.value;
    expect(list[0]).toBe('ok');
    expect(list).toHaveLength(8);
    expect(list).not.toContain('a');
    expect(list.every(item => typeof item === 'string')).toBe(true);
  });

  it('存储值不是数组时安全降级为空列表', async () => {
    installChrome({ [KEY]: { evil: true } });
    mounted = mountHistory();
    await flush();
    expect(mounted.api.recentSearches.value).toEqual([]);
  });

  it('迟到的初始读取不整包覆盖本地记录，只合并', async () => {
    let resolveGet!: (value: Record<string, unknown>) => void;
    installChrome();
    (globalThis as unknown as { chrome: { storage: { session: { get: unknown } } } }).chrome.storage.session.get =
      vi.fn(() => new Promise(resolve => (resolveGet = resolve)));
    mounted = mountHistory();
    const { api, keyword } = mounted;

    keyword.value = 'local-first';
    api.recordCurrentSearch();
    resolveGet({ [KEY]: ['stored'] });
    await flush();

    expect(api.recentSearches.value).toEqual(['local-first', 'stored']);
  });
});

describe('面板开合规则', () => {
  it('空框 + 有历史才展开；键入非空即收起', async () => {
    installChrome({ [KEY]: ['github'] });
    mounted = mountHistory();
    await flush();
    const { api, keyword } = mounted;

    api.openHistoryPanel();
    expect(api.historyPanelOpen.value).toBe(true);

    keyword.value = 'git';
    await nextTick();
    expect(api.historyPanelOpen.value).toBe(false);
  });

  it('无历史时点击空框不展开；挂载自动聚焦不触发展开', async () => {
    mounted = mountHistory();
    await flush();
    expect(mounted.api.historyPanelOpen.value).toBe(false);
    mounted.api.openHistoryPanel();
    expect(mounted.api.historyPanelOpen.value).toBe(false);
  });

  it('把已有关键词清空视为换搜，重新展开候选', async () => {
    installChrome({ [KEY]: ['github'] });
    mounted = mountHistory('github');
    await flush();
    const { api, keyword } = mounted;
    expect(api.historyPanelOpen.value).toBe(false);

    keyword.value = '';
    await nextTick();
    expect(api.historyPanelOpen.value).toBe(true);
  });

  it('选中历史词：回填关键词、提到最前、收起面板', async () => {
    installChrome({ [KEY]: ['github', 'gitlab'] });
    mounted = mountHistory();
    await flush();
    const { api, applied } = mounted;
    api.openHistoryPanel();

    api.selectHistory('gitlab');
    expect(applied).toEqual(['gitlab']);
    expect(mounted.keyword.value).toBe('gitlab');
    expect(api.recentSearches.value).toEqual(['gitlab', 'github']);
    expect(api.historyPanelOpen.value).toBe(false);
  });
});

describe('跨入口同步与锁定清除', () => {
  it('另一上下文写入本键时跟随更新', async () => {
    mounted = mountHistory();
    await flush();
    emitChange({ [KEY]: { newValue: ['from-options'] } });
    expect(mounted.api.recentSearches.value).toEqual(['from-options']);
  });

  it('clearSession 删除本键（newValue undefined）→ 列表清空、面板收起', async () => {
    installChrome({ [KEY]: ['github'] });
    mounted = mountHistory();
    await flush();
    mounted.api.openHistoryPanel();
    expect(mounted.api.historyPanelOpen.value).toBe(true);

    emitChange({ [KEY]: { newValue: undefined } });
    expect(mounted.api.recentSearches.value).toEqual([]);
    expect(mounted.api.historyPanelOpen.value).toBe(false);
  });

  it('其它存储区或其它键的变更不影响本列表', async () => {
    installChrome({ [KEY]: ['github'] });
    mounted = mountHistory();
    await flush();
    emitChange({ [KEY]: { newValue: ['local-area'] } }, 'local');
    emitChange({ other_key: { newValue: ['x'] } });
    expect(mounted.api.recentSearches.value).toEqual(['github']);
  });

  it('卸载摘除监听器，不残留', async () => {
    mounted = mountHistory();
    await flush();
    expect(changeListeners).toHaveLength(1);
    mounted.unmount();
    mounted = null;
    expect(changeListeners).toHaveLength(0);
  });

  it('初始读取未回就卸载：迟到的读取不得再注册监听', async () => {
    // 锁定切视图可能落在初始 storage.get 的窗口里；卸载后若仍 addListener，
    // 监听器会挂在已死组件的引用上永不摘除（泄漏）
    let resolveGet!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>(resolve => {
      resolveGet = resolve;
    });
    const session = (globalThis as unknown as { chrome: { storage: { session: { get: ReturnType<typeof vi.fn> } } } })
      .chrome.storage.session;
    session.get.mockReturnValueOnce(pending);
    mounted = mountHistory();
    mounted.unmount();
    mounted = null;
    resolveGet({ [KEY]: ['github'] });
    await flush();
    expect(changeListeners).toHaveLength(0);
  });
});

describe('无 chrome 环境降级', () => {
  it('storage.session 不可用时不抛错，记录仅留在内存', async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = undefined;
    mounted = mountHistory();
    await flush();
    const { api, keyword } = mounted;
    keyword.value = 'memory-only';
    expect(() => api.recordCurrentSearch()).not.toThrow();
    expect(api.recentSearches.value).toEqual(['memory-only']);
    expect(() => api.clearSearchHistory()).not.toThrow();
  });
});
