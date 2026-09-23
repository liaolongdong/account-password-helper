import { ref, computed, watch, nextTick, onScopeDispose, type Ref } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import type { PasswordEntry, PasswordEntryWithUI, PasswordFormModel } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { DEFAULT_OPTIONS_PAGE_SIZE, OPTIONS_PAGE_SIZE_OPTIONS } from '@/utils/storage/configManager';
import { ExcelUtils } from '@/utils/excel';
import { EmailBackupUtils } from '@/utils/emailBackup';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { parseTags, stringifyTags, collectAllTags } from '@/utils/tagUtils';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { formatDateCompact, formatTimestampCompact } from '@/utils/dateFormat';
import { DEFAULT_SORT, comparePasswordEntries, sortByChain, type SortCriterion } from '@/utils/passwordSort';
import { isValidTotpInput } from '@/utils/totp';
import { matchesKeyword, warmPinyinMatcher } from '@/utils/searchMatch';
import { normalizeToHostname } from '@/utils/domain';
import { useLocalOperationGuard } from '@/composables/useLocalOperationGuard';
import { createPasswordFormRules } from '@/utils/formValidators';

/** 最多可选择的标签数量 */
export const MAX_TAG_COUNT = 3;
/** 单个标签最大字符长度 */
export const MAX_TAG_LENGTH = 30;
/** 每页条数可选档位（供 UI 渲染下拉；与 configManager 白名单同源，防漂移） */
export const PAGE_SIZE_OPTIONS = OPTIONS_PAGE_SIZE_OPTIONS;

/** 密码表单空值初始状态（避免多处重复字面量） */
const EMPTY_PASSWORD_FORM = { username: '', password: '', url: '', tag: '', remark: '', totp: '' } as const;

/**
 * TOTP 密钥自定义校验器
 * 允许为空；非空时必须为合法的 otpauth:// 链接或 Base32 密钥
 * @param _rule 校验规则（未使用）
 * @param value 用户输入的密钥值
 * @param callback 校验回调函数
 */
const totpValidator = (_rule: any, value: string, callback: any) => {
  const trimmed = (value || '').trim();
  if (!trimmed || isValidTotpInput(trimmed)) {
    callback();
    return;
  }
  callback(new Error(t('form.invalidTotp')));
};

/**
 * 密码管理 Composable
 * 管理密码列表的 CRUD、搜索、排序、导入导出等逻辑
 */
export function usePasswordManagement(options: { validityForm: Ref<{ validityHours: number }> }) {
  const { validityForm } = options;

  // 预热拼音匹配模块（幂等，独立 chunk 不进首屏关键包）：
  // 就绪后过滤 computed 依赖的 pinyinMatcherReady 置 true 自动重算，拼音命中即时补齐
  void warmPinyinMatcher();

  // 状态
  const passwords = ref<PasswordEntry[]>([]);
  /**
   * 当前多列排序链（数组顺序即优先级，先点击者为主排序）
   *
   * 空链表示默认排序（收藏置顶 + updateTime 降序）。初值为空，创建时异步读取
   * 用户偏好覆盖；读取失败保持空（默认）。列点击按 升 → 降 → 移除 循环更新。
   */
  const sortChain = ref<SortCriterion[]>([]);

  /** 读取持久化的排序链（fire-and-forget，失败保持默认空链不阻断列表） */
  void StorageUtils.getOptionsSortChain().then(chain => {
    sortChain.value = chain;
  });
  const showImportDialog = ref(false);
  const showPasswordDialog = ref(false);
  const showEmailBackupDialog = ref(false);
  const searchKeyword = ref('');
  /** 搜索关键词防抖副本：驱动 filteredPasswords 过滤，避免每次击键都重排大列表 */
  const debouncedSearchKeyword = ref('');
  /** 是否仅显示收藏条目 */
  const favoriteOnly = ref(false);
  /** 标签筛选：选中标签集合（命中任一即保留，与搜索/收藏过滤为叠加关系） */
  const filterTags = ref<string[]>([]);
  /** 网址筛选：选中域名集合（命中任一即保留，与标签/收藏/搜索为叠加关系） */
  const filterUrls = ref<string[]>([]);
  const selectedIds = ref<string[]>([]);
  const isEditingPassword = ref(false);
  const editingPasswordId = ref<string>('');
  const passwordFormLoading = ref(false);
  const tableLoading = ref(false);
  /** 本地操作守卫：防止 storage watcher 在本地操作期间触发全量 loadPasswords */
  const { isLocalOperation, runLocalOperation } = useLocalOperationGuard();
  const passwordForm = ref<PasswordFormModel>({
    username: '',
    password: '',
    url: '',
    tag: '',
    remark: '',
    totp: '',
  });

  const passwordFormRules = computed<FormRules>(() => ({
    ...createPasswordFormRules(t),
    totp: [{ validator: totpValidator, trigger: 'blur' }],
  }));

  // 计算属性（过滤 + 排序，替代 el-table 客户端排序）

  /**
   * 命中关键词搜索与收藏过滤的条目（筛选下拉候选的基准集）
   *
   * 不含标签/网址筛选自身：下拉候选应反映「当前搜索语境下可选项」，
   * 若叠加筛选自身会导致选中一个选项后其余候选被互相挤掉。
   */
  const searchFilteredPasswords = computed(() => {
    let result: PasswordEntry[] = passwords.value;

    if (debouncedSearchKeyword.value) {
      const keyword = debouncedSearchKeyword.value;
      // 智能匹配：子串（大小写不敏感）优先，拼音模块预热后自动补齐全拼/首字母命中
      result = result.filter(p => matchesKeyword([p.username, p.tag, p.remark, p.url], keyword));
    }

    if (favoriteOnly.value) {
      result = result.filter(p => p.favorite);
    }

    return result;
  });

  const filteredPasswords = computed(() => {
    let result: PasswordEntry[] = searchFilteredPasswords.value;

    if (filterTags.value.length > 0) {
      result = result.filter(p => parseTags(p.tag).some(tag => filterTags.value.includes(tag)));
    }

    if (filterUrls.value.length > 0) {
      result = result.filter(p => filterUrls.value.includes(normalizeToHostname(p.url || '')));
    }

    // 始终按当前排序链排序（替代 el-table 客户端排序）
    return sortByChain([...result], sortChain.value);
  });

  /**
   * 当前页码（1 起）
   *
   * 大列表（数百条以上）全量渲染 el-table 时每行约 12 个 tooltip 组件实例，
   * 新增/收藏/排序等任意变更都触发整表重建导致卡顿。分页后表格只渲染当前页，
   * 把每次更新的成本从 O(全部条目) 降到 O(pageSize)。
   */
  const currentPage = ref(1);

  /**
   * 每页条数（用户可自定义，持久化到 storage.local）
   *
   * 初值为默认档位，创建时异步读取用户偏好覆盖；读取失败保持默认。
   * 仅接受白名单档位（见 PAGE_SIZE_OPTIONS），由 UI 下拉约束 + 存储层校验双重保证。
   */
  const pageSize = ref<number>(DEFAULT_OPTIONS_PAGE_SIZE);

  /** 读取持久化的每页条数（fire-and-forget，失败保持默认值不阻断列表） */
  void StorageUtils.getOptionsPageSize().then(size => {
    pageSize.value = size;
  });

  /** 当前页条目（表格实际渲染的数据源）；页码越界时按最后一页取值，避免空白页 */
  const pagedPasswords = computed(() => {
    const all = filteredPasswords.value;
    const maxPage = Math.max(1, Math.ceil(all.length / pageSize.value));
    const page = Math.min(currentPage.value, maxPage);
    const start = (page - 1) * pageSize.value;
    return all.slice(start, start + pageSize.value);
  });

  /** 结果集变短或页大小变化导致当前页越界时，收敛到最后一页（计算属性保持纯派生，状态在此修正） */
  watch(
    () => [filteredPasswords.value.length, pageSize.value] as const,
    ([total, size]) => {
      const maxPage = Math.max(1, Math.ceil(total / size));
      if (currentPage.value > maxPage) currentPage.value = maxPage;
    },
  );

  /**
   * 过滤条件或排序变化时回到第一页
   *
   * 与既有「筛选变化清空选中」策略一致：结果集语义已变，停留在原页码
   * 会让用户看不到命中结果的第一条。
   */
  watch([debouncedSearchKeyword, favoriteOnly, filterTags, filterUrls, sortChain], () => {
    currentPage.value = 1;
  });

  /**
   * 切换每页条数
   *
   * 保持视口位置：以当前页首条在全量结果中的索引换算到新页大小下的页码，
   * 避免用户从第 N 页切换档位后被弹回顶部或落到不相干的条目。
   * 异步持久化用户偏好（失败仅记录日志，不阻断 UI 切换）。
   * @param size 新的每页条数（白名单档位）
   */
  const handlePageSizeChange = (size: number) => {
    const firstIndex = (currentPage.value - 1) * pageSize.value;
    pageSize.value = size;
    const maxPage = Math.max(1, Math.ceil(filteredPasswords.value.length / size));
    currentPage.value = Math.min(Math.floor(firstIndex / size) + 1, maxPage);
    void StorageUtils.setOptionsPageSize(size).catch(error => {
      logger.error('保存每页条数失败:', error);
    });
  };

  /**
   * 选中集与当前页联动清理
   *
   * el-table 的 selection 由组件内部维护，翻页后旧行的选中态随 DOM 销毁而消失，
   * 但 selectedIds 仍保留旧页条目，导致「批量删除」误删不可见条目。
   * 这里只剔除已不在当前页的 id，保留同页内用户已勾选的条目。
   */
  watch(pagedPasswords, pageRows => {
    if (selectedIds.value.length === 0) return;
    const visibleIds = new Set(pageRows.map(row => row.id));
    const kept = selectedIds.value.filter(id => visibleIds.has(id));
    if (kept.length !== selectedIds.value.length) {
      selectedIds.value = kept;
    }
  });

  /**
   * 搜索关键词防抖：输入框保持即时响应（v-model 仍绑定 searchKeyword），
   * 仅将驱动过滤的 debouncedSearchKeyword 延迟 200ms 更新，
   * 降低大列表连续击键时 filter + sort 的重排开销。
   */
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  watch(searchKeyword, value => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      debouncedSearchKeyword.value = value;
    }, 200);
  });

  // 作用域销毁时清理未触发的防抖定时器，避免向已停用作用域赋值
  onScopeDispose(() => clearTimeout(searchDebounceTimer));

  /** 收藏过滤变化时清空选中状态（符合交互策略：过滤条件变化清空选中） */
  watch(favoriteOnly, () => {
    selectedIds.value = [];
  });

  /**
   * 标签/网址筛选变化同样视为过滤条件变化，需清空选中（与收藏过滤策略一致）。
   * 但多选下拉展开期间每次勾选项都会触发变化：若此时立即清空选中，
   * 批量按钮会在交互中途消失引起布局跳动。因此展开期间仅记录待清空标记，
   * 待下拉收起时（见 handleTagFilterVisibleChange / handleUrlFilterVisibleChange）统一清空。
   */
  let tagFilterDropdownVisible = false;
  let urlFilterDropdownVisible = false;
  let pendingSelectionClear = false;
  watch([filterTags, filterUrls], () => {
    if (tagFilterDropdownVisible || urlFilterDropdownVisible) {
      pendingSelectionClear = true;
    } else {
      selectedIds.value = [];
    }
  });

  /** 两个筛选下拉均已收起时，补执行交互期间挂起的选中清空 */
  const flushPendingSelectionClear = () => {
    if (!tagFilterDropdownVisible && !urlFilterDropdownVisible && pendingSelectionClear) {
      pendingSelectionClear = false;
      selectedIds.value = [];
    }
  };

  /**
   * 标签筛选下拉展开/收起回调
   * 收起时若交互期间发生过筛选变化，则补执行选中清空，
   * 此时下拉面板已关闭，按钮显隐引起的布局变化不再被用户感知。
   * @param visible 下拉面板是否展开
   */
  const handleTagFilterVisibleChange = (visible: boolean) => {
    tagFilterDropdownVisible = visible;
    flushPendingSelectionClear();
  };

  /** 网址筛选下拉展开/收起回调（语义与标签筛选一致） */
  const handleUrlFilterVisibleChange = (visible: boolean) => {
    urlFilterDropdownVisible = visible;
    flushPendingSelectionClear();
  };

  /**
   * 下拉候选标签列表
   * 从所有密码条目中聚合去重，供表单中的标签下拉选项使用。
   */
  const availableTags = computed<string[]>(() => collectAllTags(passwords.value));

  /**
   * 标签筛选下拉的候选集（搜索语境）
   *
   * 随关键词搜索/收藏过滤动态收窄：搜索结果里没有的标签不再出现在下拉中，
   * 避免用户选中一个必然零结果的选项。已选中的标签并入候选（保持可取消勾选），
   * 即使它不在当前搜索结果里，chip 也不会丢失。
   * 注意与 availableTags 区分：表单/批量编辑的候选始终来自全量条目。
   */
  const filterTagOptions = computed<string[]>(() => {
    const options = collectAllTags(searchFilteredPasswords.value);
    const known = new Set(options);
    return [...options, ...filterTags.value.filter(tag => !known.has(tag))];
  });

  /**
   * 网址筛选下拉的候选集（搜索语境）
   *
   * 与 filterTagOptions 同理：基于当前搜索/收藏过滤的结果集聚合去重 hostname，
   * 并并入已选中项保证可取消。
   */
  const filterUrlOptions = computed<string[]>(() => {
    const hosts = new Set<string>();
    for (const p of searchFilteredPasswords.value) {
      const host = normalizeToHostname(p.url || '');
      if (host) hosts.add(host);
    }
    const options = [...hosts].sort();
    const known = new Set(options);
    return [...options, ...filterUrls.value.filter(url => !known.has(url))];
  });

  // 批量移除标签等操作后候选集可能不再包含已选筛选标签：
  // 及时剔除失效项，避免筛选下拉隐藏后残留过滤条件造成「隐形空过滤」。
  // 注意以全量候选（availableTags）为准而非搜索语境候选：搜索只是临时视图收窄，
  // 不应据此清掉用户的筛选选择。
  watch(availableTags, tags => {
    if (filterTags.value.some(selected => !tags.includes(selected))) {
      filterTags.value = filterTags.value.filter(selected => tags.includes(selected));
    }
  });

  /**
   * 下拉候选网址列表
   * 从所有密码条目聚合去重的 hostname（规范化：忽略协议/路径/大小写），
   * 空 URL 条目不产生候选。按字典序排列保证选项稳定。
   */
  const availableUrls = computed<string[]>(() => {
    const hosts = new Set<string>();
    for (const p of passwords.value) {
      const host = normalizeToHostname(p.url || '');
      if (host) hosts.add(host);
    }
    return [...hosts].sort();
  });

  // 与标签筛选同理：删除条目导致候选网址失效时剔除已选筛选项，避免隐形空过滤
  watch(availableUrls, urls => {
    if (filterUrls.value.some(selected => !urls.includes(selected))) {
      filterUrls.value = filterUrls.value.filter(selected => urls.includes(selected));
    }
  });

  /**
   * 表单标签的数组视图
   * `passwordForm.tag` 仍以逗号拼接字符串作为最终写入源，本 computed 提供
   * 数组形式以便 `el-select multiple` 绑定；写入时自动调用 `stringifyTags`
   * 做去重与空项过滤。
   *
   * setter 中做两重兜底：
   * 1. 过滤超过 MAX_TAG_LENGTH 个字符的标签；
   * 2. 截断超过 MAX_TAG_COUNT 个的标签。
   */
  const tagArray = computed<string[]>({
    get: () => parseTags(passwordForm.value.tag),
    set: (value: string[]) => {
      const trimmed = value.map(v => String(v ?? '').trim()).filter(Boolean);
      const valid: string[] = [];
      let hasTooLong = false;
      for (const t of trimmed) {
        if (t.length > MAX_TAG_LENGTH) {
          hasTooLong = true;
          continue;
        }
        valid.push(t);
      }
      if (hasTooLong) {
        ElMessage.warning(t('form.tagLengthLimit', { max: MAX_TAG_LENGTH }));
      }
      let finalTags = valid;
      if (finalTags.length > MAX_TAG_COUNT) {
        finalTags = finalTags.slice(0, MAX_TAG_COUNT);
        ElMessage.warning(t('form.tagCountLimit', { max: MAX_TAG_COUNT }));
      }
      passwordForm.value.tag = stringifyTags(finalTags);
    },
  });

  /**
   * 接收密码表单弹窗回写的字段补丁
   *
   * `tag` 只允许经 `tagArray` 通道写入，此处显式丢弃补丁携带的 tag 作为兜底：弹窗侧已不再
   * 持有 tag 副本（见 PasswordFormDialog 的 localForm），但本函数签名接受
   * `Partial<PasswordFormModel>`（含 tag），而 `PasswordFormPatch` 的类型约束只由 IDE 的
   * Volar 强制——仓库的 `pnpm typecheck` 是纯 `tsc`，不解析 `.vue`，拦不住弹窗侧误传。
   *
   * 历史缺陷：弹窗把整份本地镜像（含陈旧 tag）回传，父级用内联 `Object.assign` 直接覆盖，
   * 导致「选完标签再输入备注 → 标签被清空」（新增态）与「标签被静默回滚」（编辑态）。
   *
   * 采用解构剔除而非字段白名单：将来表单新增字段时本侧自动透传，不会静默丢字段；
   * 但弹窗侧的 emit 载荷是显式字段列表，新增字段仍需同步修改那里。
   *
   * @param patch 弹窗回传的字段补丁（可能携带陈旧 `tag`）
   */
  const applyPasswordFormPatch = (patch: Partial<PasswordFormModel>) => {
    const { tag: _staleTag, ...ownedFields } = patch;
    Object.assign(passwordForm.value, ownedFields);
  };

  /**
   * 切换收藏状态
   * 当收藏数已达上限时，自动淘汰最近最少使用（LRU）的收藏条目，再添加新收藏
   * 切换后自动滚动到目标行并短暂高亮，提供操作反馈
   */
  const toggleFavorite = async (id: string) => {
    try {
      const entry = passwords.value.find(p => p.id === id);
      if (!entry) return;
      const newFav = !entry.favorite;

      await runLocalOperation(async () => {
        if (newFav) {
          // 收藏前检查是否已达上限，若达则先淘汰 LRU 条目
          const evicted = await StorageUtils.evictLRUFavoriteIfNeeded(passwords.value);
          if (evicted) {
            const limit = await StorageUtils.getFavoriteLimit();
            ElMessage.info(t('sidepanel.favoriteEvicted', { limit, username: evicted.username }));
          }
          // 设置新收藏条目及其使用时间戳
          const now = Date.now();
          await StorageUtils.updatePassword(id, { favorite: true, favoriteUsedAt: now, updateTime: entry.updateTime });
          entry.favorite = true;
          entry.favoriteUsedAt = now;
          ElMessage.success(t('sidepanel.favorited'));
        } else {
          // 取消收藏，清除使用时间戳
          await StorageUtils.updatePassword(id, {
            favorite: false,
            favoriteUsedAt: undefined,
            updateTime: entry.updateTime,
          });
          entry.favorite = false;
          entry.favoriteUsedAt = undefined;
          ElMessage.success(t('sidepanel.unfavorited'));
        }
      });

      // 等待 el-table 完成虚拟 DOM 更新后滚动到目标行并高亮（复用 new-item 样式）
      // scrollToPassword 分页感知：收藏后条目位次可能变化并落到其他页，需先切页再定位
      scrollToPassword(id);
    } catch (error) {
      logger.error('切换收藏失败:', error);
      ElMessage.error(t('message.operationFailed'));
    }
  };

  // 加载密码列表
  const loadPasswords = async () => {
    try {
      tableLoading.value = true;

      const sessionValid = await StorageUtils.isSessionValid();
      if (!sessionValid) {
        passwords.value = [];
        return;
      }

      passwords.value = await StorageUtils.getAllPasswords();

      // 初始化每条记录的密码显隐状态
      passwords.value.forEach(p => {
        (p as PasswordEntryWithUI).showPassword = false;
      });
      // 排序由 filteredPasswords computed 处理，此处不再排序

      // 初始化有效期设置表单
      const validityHours = await StorageUtils.getMasterPasswordValidityHours();
      validityForm.value.validityHours = validityHours;
    } catch (error: unknown) {
      logger.error('加载密码列表失败:', error);
      const message = error instanceof Error ? error.message : t('message.unknownError');
      ElMessage.error(t('message.loadListFailedDetail', { message }));
    } finally {
      tableLoading.value = false;
    }
  };

  /** 持久化排序链（失败仅记录日志，不阻断 UI 更新） */
  const persistSortChain = () => {
    void StorageUtils.saveOptionsSortChain(sortChain.value).catch(error => {
      logger.error('保存排序链失败:', error);
    });
  };

  /**
   * 处理列头点击（多列排序链）
   *
   * 循环语义：不在链中 → 追加为升序；升序 → 转降序；降序 → 从链中移除。
   * 点击已在链中的列只改变该列方向/存在性，不改变其优先级位置；
   * 点击新列则追加到链尾（最低优先级），实现「按点击顺序叠加」。
   * @param prop 被点击的列字段名
   */
  const handleColumnSort = (prop: string) => {
    const index = sortChain.value.findIndex(item => item.prop === prop);
    if (index === -1) {
      sortChain.value = [...sortChain.value, { prop, order: 'ascending' }];
    } else if (sortChain.value[index].order === 'ascending') {
      const next = [...sortChain.value];
      next[index] = { prop, order: 'descending' };
      sortChain.value = next;
    } else {
      sortChain.value = sortChain.value.filter(item => item.prop !== prop);
    }
    persistSortChain();
  };

  /**
   * 从排序链移除指定列（信息栏 chip 的 × 操作）
   * @param prop 目标列字段名
   */
  const removeSortCriterion = (prop: string) => {
    sortChain.value = sortChain.value.filter(item => item.prop !== prop);
    persistSortChain();
  };

  /** 清除全部排序，回到默认（收藏置顶 + 更新时间降序） */
  const clearSortChain = () => {
    sortChain.value = [];
    persistSortChain();
  };

  /**
   * 拖拽调整排序链优先级（信息栏 chip 拖动重排）
   *
   * 将 fromIndex 处的条件移动到 toIndex（数组下标，0 起）。越界或同位时忽略。
   * @param fromIndex 被拖拽项原下标
   * @param toIndex   目标下标
   */
  const moveSortCriterion = (fromIndex: number, toIndex: number) => {
    const chain = sortChain.value;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= chain.length || toIndex >= chain.length) {
      return;
    }
    const next = [...chain];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    sortChain.value = next;
    persistSortChain();
  };

  // 切换密码可见性
  const togglePasswordVisibility = (row: PasswordEntryWithUI) => {
    row.showPassword = !row.showPassword;
  };

  // 处理表格每行的样式名
  const handleRowClassName = (data: { row: PasswordEntry; rowIndex: number }) => {
    return data.row.id;
  };

  // 选择变更处理
  const handleSelectionChange = (selection: PasswordEntry[]) => {
    selectedIds.value = selection.map(item => item.id);
  };

  // 打开密码弹窗（新增）
  // prefillUrl：来自侧边栏「添加本站账号」的预填域名；未携带时由调用方（options 页）
  // 另行尝试带入当前活动标签页 URL，编辑流程不受影响
  const openPasswordDialog = (prefillUrl = '') => {
    isEditingPassword.value = false;
    editingPasswordId.value = '';
    passwordForm.value = { ...EMPTY_PASSWORD_FORM, url: prefillUrl };
    showPasswordDialog.value = true;
  };

  // 编辑密码
  const editPassword = (password: PasswordEntry) => {
    isEditingPassword.value = true;
    editingPasswordId.value = password.id;
    passwordForm.value = {
      username: password.username,
      password: password.password,
      url: password.url,
      tag: password.tag,
      remark: password.remark,
      totp: password.totp ?? '',
    };
    showPasswordDialog.value = true;
  };

  // 重置密码表单
  const resetPasswordForm = () => {
    isEditingPassword.value = false;
    editingPasswordId.value = '';
    passwordForm.value = { ...EMPTY_PASSWORD_FORM };
  };

  // 滚动到密码项
  // 分页后目标条目可能不在当前页：先按其在全量结果中的位置切到对应页，
  // 等 DOM 更新后再定位高亮，避免新增/编辑后看不到反馈
  const scrollToPassword = (id: string) => {
    const index = filteredPasswords.value.findIndex(p => p.id === id);
    if (index >= 0) {
      const targetPage = Math.floor(index / pageSize.value) + 1;
      if (targetPage !== currentPage.value) {
        currentPage.value = targetPage;
      }
    }
    // 页码切换后需等一次 DOM 更新，再查询目标行；原 100ms 延时保留过渡动画窗口
    void nextTick(() => {
      setTimeout(() => {
        const passwordElement = document.querySelector(`.${id}`);
        if (passwordElement) {
          passwordElement.classList.add('new-item');
          setTimeout(() => {
            passwordElement.classList.remove('new-item');
          }, 6000);

          passwordElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }, 100);
    });
  };

  // 处理密码表单保存
  const handlePasswordFormSave = async (formRef?: FormInstance) => {
    try {
      if (formRef) {
        await formRef.validate();
      }
      passwordFormLoading.value = true;

      // 对标签做归一化：拆分 → 去空/去重 → 英文逗号拼接
      const normalizedTag = stringifyTags(parseTags(passwordForm.value.tag));

      if (isEditingPassword.value) {
        const updatedFields = {
          username: passwordForm.value.username.trim(),
          password: passwordForm.value.password,
          url: passwordForm.value.url.trim(),
          tag: normalizedTag,
          remark: passwordForm.value.remark.trim(),
          totp: passwordForm.value.totp.trim(),
          updateTime: Date.now(),
        };
        await runLocalOperation(async () => {
          await StorageUtils.updatePassword(editingPasswordId.value, updatedFields);
        });
        // 就地更新：filteredPasswords computed 会自动重新排序
        const entry = passwords.value.find(p => p.id === editingPasswordId.value);
        if (entry) {
          Object.assign(entry, updatedFields);
        }
        ElMessage.success(t('form.updateSuccess'));
        scrollToPassword(editingPasswordId.value);
      } else {
        const now = Date.now();
        let newEntry: PasswordEntry;
        await runLocalOperation(async () => {
          newEntry = await StorageUtils.savePassword({
            username: passwordForm.value.username.trim(),
            password: passwordForm.value.password,
            url: passwordForm.value.url.trim(),
            tag: normalizedTag,
            remark: passwordForm.value.remark.trim(),
            totp: passwordForm.value.totp.trim(),
            createTime: now,
            updateTime: now,
          });
        });
        // 就地插入：filteredPasswords computed 会自动重新排序
        (newEntry! as PasswordEntryWithUI).showPassword = false;
        passwords.value.push(newEntry!);
        ElMessage.success(t('form.addSuccess'));
        scrollToPassword(newEntry!.id);
      }

      showPasswordDialog.value = false;
      resetPasswordForm();
    } catch (error) {
      logger.error('保存密码失败:', error);
      ElMessage.error(t('message.saveFailed'));
    } finally {
      passwordFormLoading.value = false;
    }
  };

  // 创建副本：由既有条目复制出一条独立的新条目（列表操作列的「创建副本」，不写剪贴板）
  const copyPassword = async (password: PasswordEntry) => {
    try {
      const newPasswordEntry = {
        username: password.username,
        password: password.password,
        url: password.url,
        tag: password.tag,
        remark: password.remark,
        totp: password.totp,
        createTime: password.createTime,
        updateTime: Date.now(),
      };

      const copyItemId = password.id;
      let newEntry: PasswordEntry;
      await runLocalOperation(async () => {
        newEntry = await StorageUtils.savePassword(newPasswordEntry, undefined, copyItemId);
      });
      // 就地插入：filteredPasswords computed 会自动重新排序
      (newEntry! as PasswordEntryWithUI).showPassword = false;
      passwords.value.push(newEntry!);

      // 分页感知定位：副本按排序规则可能落到其他页，需先切页再高亮
      scrollToPassword(newEntry!.id);

      ElMessage.success(t('form.copySuccess'));
    } catch (error: any) {
      logger.error('创建副本失败:', error);
      ElMessage.error(t('form.copyFailedDetail', { message: error.message || t('message.unknownError') }));
    }
  };

  // 删除密码
  const deletePassword = async (id: string) => {
    try {
      await ElMessageBox.confirm(t('form.deleteConfirm'), t('form.deleteConfirmTitle'), {
        confirmButtonText: t('form.moveToTrash'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      });

      const delItem = document.querySelector(`.${id}`) as HTMLElement | undefined;
      if (delItem) {
        delItem.classList.add('del-item');
        setTimeout(async () => {
          delItem.remove();
          await runLocalOperation(async () => {
            await StorageUtils.deletePassword(id);
          });
          await loadPasswords();
          ElMessage.success(t('form.movedToTrash'));
        }, 1000);
      }
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(t('message.deleteFailed'));
      }
    }
  };

  // 批量删除
  const batchDelete = async () => {
    try {
      await ElMessageBox.confirm(
        t('form.batchDeleteConfirm', { count: selectedIds.value.length }),
        t('form.batchDeleteConfirmTitle'),
        {
          confirmButtonText: t('form.moveToTrash'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      );

      const patchDelItems: HTMLElement[] = [];
      selectedIds.value.forEach((id: string) => {
        const delItem = document.querySelector(`.${id}`) as HTMLElement | undefined;
        if (delItem) {
          delItem.classList.add('del-item');
          patchDelItems.push(delItem);
        }
      });
      setTimeout(async () => {
        patchDelItems.forEach(delItem => {
          delItem.remove();
        });

        await runLocalOperation(async () => {
          await StorageUtils.deletePasswords(selectedIds.value);
        });
        await loadPasswords();
        selectedIds.value = [];
        ElMessage.success(t('form.movedToTrash'));
      }, 1000);
    } catch (error) {
      if (error !== 'cancel') {
        ElMessage.error(t('form.batchDeleteFailed'));
      }
    }
  };

  // 密码导入处理
  const handlePasswordsImported = async () => {
    await loadPasswords();
  };

  // 导出密码（公共实现：主密码校验 + 带日期后缀文件名，全量/选中复用）
  const exportEntriesToCSV = async (entries: PasswordEntry[]) => {
    if (entries.length === 0) {
      ElMessage.warning(t('form.noDataToExport'));
      return;
    }

    const masterPassword = await promptAndVerifyMasterPassword(t('session.verifyTitle'), t('form.exportVerifyPrompt'));
    if (!masterPassword) return;

    // 生成带日期后缀的文件名：passwords_YYYYMMDD_HHmmss.csv
    const filename = `passwords_${formatTimestampCompact()}.csv`;
    ExcelUtils.exportToCSV(entries, filename);
    ElMessage.success(t('form.exportSuccess'));
  };

  // 导出密码
  const exportPasswords = async () => {
    try {
      await exportEntriesToCSV(passwords.value);
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('导出失败:', error);
        ElMessage.error(t('form.exportFailed'));
      }
    }
  };

  /**
   * 批量导出选中条目（CSV）
   * 与全量导出同一路径：主密码校验 + 带日期后缀文件名，仅导出范围限选中集
   */
  const batchExportSelected = async () => {
    const entries = passwords.value.filter(p => selectedIds.value.includes(p.id));
    if (entries.length === 0) {
      ElMessage.warning(t('form.noDataToExport'));
      return;
    }
    try {
      await exportEntriesToCSV(entries);
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('批量导出失败:', error);
        ElMessage.error(t('form.exportFailed'));
      }
    }
  };

  /**
   * 批量编辑标签
   *
   * 追加模式：选中标签并入每条选中条目（去重）；移除模式：从每条中剔除选中标签。
   * 追加后超出 MAX_TAG_COUNT 的条目跳过不写，结束后统一提示跳过数量；
   * 保留原 updateTime（标签为元数据编辑，不改变「最近更新」排序）。
   * @param tags 待追加/移除的标签列表
   * @param mode 'append' 追加 / 'remove' 移除
   */
  const batchEditTags = async (tags: string[], mode: 'append' | 'remove') => {
    const normalized = stringifyTags(tags).split(',').filter(Boolean);
    if (normalized.length === 0 || selectedIds.value.length === 0) return;

    const targets = passwords.value.filter(p => selectedIds.value.includes(p.id));
    let skippedCount = 0;
    const updates: Array<{ id: string; tag: string }> = [];

    for (const entry of targets) {
      const existing = parseTags(entry.tag);
      const nextTags =
        mode === 'append'
          ? [...existing, ...normalized.filter(tag => !existing.includes(tag))]
          : existing.filter(tag => !normalized.includes(tag));
      if (nextTags.length > MAX_TAG_COUNT) {
        skippedCount++;
        continue;
      }
      const nextTag = stringifyTags(nextTags);
      if (nextTag === entry.tag) continue;
      updates.push({ id: entry.id, tag: nextTag });
    }

    if (updates.length === 0) {
      ElMessage.info(
        skippedCount > 0 ? t('form.batchTagAllSkipped', { max: MAX_TAG_COUNT }) : t('form.batchTagNoChange'),
      );
      return;
    }

    try {
      await runLocalOperation(async () => {
        // 单次 read-modify-write 批量落盘（避免逐条全量读写，且写入原子）；
        // updateTime 保持原值：仅标签元数据变更，不干扰排序
        await StorageUtils.batchUpdatePasswordMetadata(
          updates.map(({ id, tag }) => {
            const entry = passwords.value.find(p => p.id === id);
            return { id, updates: { tag, updateTime: entry?.updateTime } };
          }),
        );
      });
      // 就地更新：与 filteredPasswords computed 联动，避免全量重载
      for (const { id, tag } of updates) {
        const entry = passwords.value.find(p => p.id === id);
        if (entry) entry.tag = tag;
      }
      ElMessage.success(t('form.batchTagDone', { count: updates.length }));
      if (skippedCount > 0) {
        ElMessage.warning(t('form.batchTagSkipped', { count: skippedCount, max: MAX_TAG_COUNT }));
      }
    } catch (error) {
      logger.error('批量编辑标签失败:', error);
      ElMessage.error(t('message.operationFailed'));
    }
  };

  // 下载模板
  const downloadTemplate = () => {
    try {
      ExcelUtils.downloadTemplate();
      ElMessage.success(t('form.templateSuccess'));
    } catch (_error) {
      ElMessage.error(t('form.templateFailed'));
    }
  };

  // 导出密码为 JSON
  const exportPasswordsJson = async () => {
    try {
      if (passwords.value.length === 0) {
        ElMessage.warning(t('form.noDataToExport'));
        return;
      }

      const masterPassword = await promptAndVerifyMasterPassword(
        t('session.verifyTitle'),
        t('form.exportVerifyPrompt'),
      );
      if (!masterPassword) return;

      const now = new Date();
      const filename = `passwords_${formatTimestampCompact(now)}.json`;
      ExcelUtils.exportToJSON(passwords.value, filename);
      ElMessage.success(t('form.exportSuccess'));
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('JSON 导出失败:', error);
        ElMessage.error(t('form.exportFailed'));
      }
    }
  };

  /**
   * 打开邮箱备份弹窗
   */
  const openEmailBackupDialog = () => {
    showEmailBackupDialog.value = true;
  };

  /**
   * 执行密码备份到邮箱
   * 流程：验证主密码 -> 根据加密选项导出文件 -> 调用邮件工具
   *
   * @param email     目标邮箱地址
   * @param encrypted 是否使用加密备份（.aph 格式）
   */
  const backupToEmail = async (email: string, encrypted: boolean) => {
    try {
      if (passwords.value.length === 0) {
        ElMessage.warning(t('message.noDataToBackup'));
        return;
      }

      const masterPassword = await promptAndVerifyMasterPassword(
        t('session.verifyTitle'),
        encrypted ? t('options.backup.exportPrompt') : t('form.backupVerifyPrompt'),
      );
      if (!masterPassword) return;

      if (encrypted) {
        // 加密备份：导出 .aph 文件并打开邮件客户端
        await exportEncryptedBackup(passwords.value, masterPassword);
        const mailtoUrl = EmailBackupUtils.buildMailtoUrl(
          email,
          t('form.emailSubjectEncrypted', { date: formatDateCompact(new Date()) }),
          [
            t('form.emailBodyTime', { time: new Date().toLocaleString() }),
            t('form.emailBodyCount', { count: passwords.value.length }),
            t('form.emailBodyAttachment'),
            '',
            t('form.emailBodySend'),
            t('form.emailBodyNote'),
          ].join('\n'),
        );
        window.open(mailtoUrl, '_blank');
        ElMessage.success(t('form.encryptedBackupDone'));
      } else {
        // 不加密备份：导出 CSV 文件
        await EmailBackupUtils.backupToEmail(passwords.value, email);
        ElMessage.success(t('form.backupDone'));
      }
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('备份到邮箱失败:', error);
        ElMessage.error(t('options.emailBackup.backupFailed'));
      }
    }
  };

  /**
   * 一键去重
   * 检测 username + url 相同的重复条目，每组优先保留收藏项（多条收藏时保留 updateTime 最新的），
   * 无收藏时保留 updateTime 最新的一项，其余删除。
   */
  const removeDuplicates = async () => {
    const groups = new Map<string, PasswordEntry[]>();
    for (const entry of passwords.value) {
      const key = [entry.username, entry.url].join('|');
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    const idsToRemove: string[] = [];
    let duplicateGroupCount = 0;
    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      duplicateGroupCount++;
      // 收藏优先，其次按 updateTime 降序，保留第一条（复用公共比较器）
      group.sort((a, b) => comparePasswordEntries(a, b, DEFAULT_SORT));
      for (let i = 1; i < group.length; i++) {
        idsToRemove.push(group[i].id);
      }
    }

    if (idsToRemove.length === 0) {
      ElMessage.info(t('form.noDuplicates'));
      return;
    }

    try {
      await ElMessageBox.confirm(
        t('form.dedupeConfirm', { groups: duplicateGroupCount, count: idsToRemove.length }),
        t('options.header.removeDuplicates'),
        {
          confirmButtonText: t('common.confirm'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      );

      await runLocalOperation(async () => {
        await StorageUtils.deletePasswords(idsToRemove);
      });
      await loadPasswords();
      selectedIds.value = [];
      ElMessage.success(t('form.dedupeDone', { count: idsToRemove.length }));
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('一键去重失败:', error);
        ElMessage.error(t('form.dedupeFailed'));
      }
    }
  };

  return {
    // 状态
    passwords,
    showImportDialog,
    showPasswordDialog,
    showEmailBackupDialog,
    searchKeyword,
    selectedIds,
    isEditingPassword,
    editingPasswordId,
    passwordForm,
    passwordFormRules,
    passwordFormLoading,
    tableLoading,
    favoriteOnly,
    filterTags,
    filterUrls,
    filteredPasswords,
    currentPage,
    pageSize,
    pagedPasswords,
    handlePageSizeChange,
    sortChain,
    availableTags,
    availableUrls,
    filterTagOptions,
    filterUrlOptions,
    tagArray,
    // 方法
    loadPasswords,
    handleColumnSort,
    removeSortCriterion,
    clearSortChain,
    moveSortCriterion,
    togglePasswordVisibility,
    handleRowClassName,
    handleSelectionChange,
    handleTagFilterVisibleChange,
    handleUrlFilterVisibleChange,
    openPasswordDialog,
    editPassword,
    resetPasswordForm,
    applyPasswordFormPatch,
    handlePasswordFormSave,
    copyPassword,
    deletePassword,
    batchDelete,
    batchEditTags,
    batchExportSelected,
    handlePasswordsImported,
    exportPasswords,
    exportPasswordsJson,
    downloadTemplate,
    openEmailBackupDialog,
    backupToEmail,
    toggleFavorite,
    removeDuplicates,
    isLocalOperation,
  };
}
