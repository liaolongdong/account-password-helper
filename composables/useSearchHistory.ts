import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';

/** 历史上限：只保留最近 8 条，超出按新→旧淘汰 */
const MAX_RECENT_SEARCHES = 8;
/** 短于 2 字符的关键词不记：单字母多为击键中间态，记进去只会污染候选 */
const MIN_QUERY_LENGTH = 2;

const KEY = SESSION_MEMORY_KEYS.RECENT_SEARCHES;

/** 去重键：trim + NFKC + 小写，大小写 / 全半角变体共用一个名额；展示文本仍保留原形态 */
const historyKey = (query: string): string => query.trim().normalize('NFKC').toLowerCase();

/** 把不可信的存储值收窄为去重、截断后的关键词列表 */
function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const query = item.trim();
    if (query.length < MIN_QUERY_LENGTH) continue;
    const key = historyKey(query);
    if (seen.has(key)) continue;
    seen.add(key);
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
 * 展示面只在管理页筛选栏；侧边栏只记录、不展示（快速填充场景里内联历史块会把
 * 匹配列表挤出首屏），两个入口共用同一份会话历史。去重按归一化键（trim + NFKC +
 * 小写），大小写 / 全半角变体不各占一个名额，展示保留键入原形态。
 *
 * 面板开合规则刻意避开自动聚焦：挂载即 focus 不弹面板，
 * 只有用户**点击空输入框**或**把已有关键词清空**时才展开；键入非空即收起。
 * 记录时机是 blur 与回车（搜索已被实际使用），不是每次击键——防抖中间态不进历史。
 *
 * @param keyword 搜索框当前值（只读消费，写入走 applyKeyword）
 * @param applyKeyword 选中历史词后的回填动作（管理页发 update:searchKeyword）
 */
export function useSearchHistory(keyword: Ref<string>, applyKeyword: (value: string) => void) {
  const recentSearches = ref<string[]>([]);
  const historyPanelOpen = ref(false);

  /** 本地已发生记录/清除时，迟到的初始读取不得整包覆盖，只能合并 */
  let touched = false;
  /** 卸载可能落在初始读取的 await 窗口里（锁定切视图），此后不得再注册监听 */
  let disposed = false;

  const sessionArea = () => globalThis.chrome?.storage?.session;

  const recordQuery = (query: string): void => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    touched = true;
    const key = historyKey(trimmed);
    const next = [trimmed, ...recentSearches.value.filter(item => historyKey(item) !== key)].slice(
      0,
      MAX_RECENT_SEARCHES,
    );
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
      if (disposed) return;
      const loaded = sanitize(stored[KEY]);
      recentSearches.value = touched ? sanitize([...recentSearches.value, ...loaded]) : loaded;
    } catch (error) {
      logger.error('读取最近搜索失败:', error);
    }
    if (disposed) return;
    chrome.storage.onChanged.addListener(handleStorageChanged);
  });

  onUnmounted(() => {
    disposed = true;
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
