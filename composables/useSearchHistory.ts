import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/** 历史上限：只保留最近 8 条，超出按新→旧淘汰 */
const MAX_RECENT_SEARCHES = 8;
/** 短于 2 字符的关键词不记：单字母多为击键中间态，记进去只会污染候选 */
const MIN_QUERY_LENGTH = 2;

const KEY = SESSION_MEMORY_KEYS.RECENT_SEARCHES;

/** 把不可信的存储值收窄为去重、截断后的关键词列表 */
function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const query = item.trim();
    if (query.length < MIN_QUERY_LENGTH || seen.has(query)) continue;
    seen.add(query);
    result.push(query);
    if (result.length >= MAX_RECENT_SEARCHES) break;
  }
  return result;
}

/**
 * 最近搜索历史（会话级）
 *
 * 隐私口径：搜索词可能含账号名，属用户键入的明文，因此**只存 chrome.storage.session**
 * （浏览器关闭即清、TRUSTED_CONTEXTS 内容脚本不可读），锁定时由 clearSession 一并删除，
 * 绝不写 storage.local。日志不携带关键词本身。
 *
 * 面板开合规则刻意避开侧边栏的自动聚焦：挂载即 focus 不弹面板（不干扰秒开首屏），
 * 只有用户**点击空输入框**或**把已有关键词清空**时才展开；键入非空即收起。
 * 记录时机是 blur 与回车（搜索已被实际使用），不是每次击键——防抖中间态不进历史。
 *
 * @param keyword 搜索框当前值（只读消费，写入走 applyKeyword）
 * @param applyKeyword 选中历史词后的回填动作（sidepanel 写 model，options 发 emit）
 */
export function useSearchHistory(keyword: Ref<string>, applyKeyword: (value: string) => void) {
  const recentSearches = ref<string[]>([]);
  const historyPanelOpen = ref(false);

  /** 本地已发生记录/清除时，迟到的初始读取不得整包覆盖，只能合并 */
  let touched = false;

  const sessionArea = () => globalThis.chrome?.storage?.session;

  const recordQuery = (query: string): void => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    touched = true;
    const next = [trimmed, ...recentSearches.value.filter(item => item !== trimmed)].slice(0, MAX_RECENT_SEARCHES);
    recentSearches.value = next;
    void sessionArea()
      ?.set({ [KEY]: next })
      .catch(error => logger.error('写入最近搜索失败:', error));
  };

  /** 记录当前搜索框里的关键词（blur / 回车时调用） */
  const recordCurrentSearch = (): void => recordQuery(keyword.value);

  const clearSearchHistory = (): void => {
    touched = true;
    recentSearches.value = [];
    historyPanelOpen.value = false;
    void sessionArea()
      ?.remove(KEY)
      .catch(error => logger.error('清除最近搜索失败:', error));
  };

  const openHistoryPanel = (): void => {
    if (!keyword.value.trim() && recentSearches.value.length > 0) historyPanelOpen.value = true;
  };

  const closeHistoryPanel = (): void => {
    historyPanelOpen.value = false;
  };

  const selectHistory = (query: string): void => {
    applyKeyword(query);
    recordQuery(query);
    closeHistoryPanel();
  };

  // 键入即收起；把已有关键词清空（clearable / 退格）视为「想换一条搜」，展开候选
  watch(keyword, (value, oldValue) => {
    if (value.trim()) {
      closeHistoryPanel();
      return;
    }
    if (oldValue && oldValue.trim()) openHistoryPanel();
  });

  /** 跨入口同步 + 锁定清除：另一上下文写入或 clearSession 删除本键时跟随 */
  const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'session' || !(KEY in changes)) return;
    recentSearches.value = sanitize(changes[KEY].newValue);
    if (recentSearches.value.length === 0) closeHistoryPanel();
  };

  onMounted(async () => {
    const area = sessionArea();
    if (!area) return;
    try {
      const stored = await area.get(KEY);
      const loaded = sanitize(stored[KEY]);
      recentSearches.value = touched ? sanitize([...recentSearches.value, ...loaded]) : loaded;
    } catch (error) {
      logger.error('读取最近搜索失败:', error);
    }
    chrome.storage.onChanged.addListener(handleStorageChanged);
  });

  onUnmounted(() => {
    if (globalThis.chrome?.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(handleStorageChanged);
    }
  });

  return {
    recentSearches,
    historyPanelOpen,
    recordCurrentSearch,
    clearSearchHistory,
    openHistoryPanel,
    closeHistoryPanel,
    selectHistory,
  };
}
