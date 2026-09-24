import { ref, computed, watch, nextTick, onScopeDispose, type Ref } from 'vue';
import type { FormRules, FormInstance } from 'element-plus';
import type { PasswordEntry, PasswordEntryWithUI, PasswordFormModel } from '@/utils/types';
import { StorageUtils } from '@/utils/storage';
import { ExcelUtils } from '@/utils/excel';
import { EmailBackupUtils } from '@/utils/emailBackup';
import { exportEncryptedBackup } from '@/utils/backupExport';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import { parseTags, stringifyTags, collectAllTags, normalizeTagInput } from '@/utils/tagUtils';
import { promptAndVerifyMasterPassword } from '@/utils/masterPasswordVerify';
import { formatDateCompact, formatTimestampCompact } from '@/utils/dateFormat';
import { DEFAULT_SORT, sortPasswordEntries, comparePasswordEntries, type SortState } from '@/utils/passwordSort';
import { isValidTotpInput } from '@/utils/totp';
import { matchesKeyword } from '@/utils/searchMatch';
import { filterByKeyword } from '@/utils/keywordMatch';
import { warmPinyinMatcher } from '@/utils/searchMatch/core';
import { useLocalOperationGuard } from '@/composables/useLocalOperationGuard';
import { useVaultListPagination } from '@/composables/useVaultListPagination';
import { createPasswordFormRules, type InitialFieldLengths } from '@/utils/formValidators';
import { isVaultCapacityError, MAX_PASSWORD_ENTRIES } from '@/utils/storage/vaultCapacity';

/** 最多可选择的标签数量 */
export const MAX_TAG_COUNT = 3;
/** 单个标签最大字符长度 */
export const MAX_TAG_LENGTH = 30;

/**
 * 删除动画时长：行淡出后再落盘（沿用原实现的 1s 节奏，不改变观感）
 *
 * 导出供回归测试复用：测试里写死同一个数字，实现调整节奏后只会「多推进」而不会失败，
 * 动画与落盘的时序契约就静默失守了。
 */
export const DELETE_ANIMATION_MS = 1000;

/**
 * 保存 / 收藏 / 创建副本后目标行的高亮时长
 *
 * 与 `DELETE_ANIMATION_MS` 同样的理由导出：定位与高亮的时序契约要靠测试钉住，
 * 测试里写死数字会让「实现把 6 秒改成 600 毫秒」静默通过。
 */
export const ROW_HIGHLIGHT_MS = 6000;

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
  /** 当前排序状态（由 el-table @sort-change 驱动更新） */
  const currentSort = ref<SortState>({ ...DEFAULT_SORT });
  const showImportDialog = ref(false);
  const showPasswordDialog = ref(false);
  const showEmailBackupDialog = ref(false);
  const searchKeyword = ref('');
  /**
   * 搜索关键词防抖副本：驱动 filteredPasswords 过滤，也驱动表格的命中高亮。
   *
   * 高亮与过滤同源，既保证「看到的行」与「行内高亮」始终一致，
   * 也避免每次击键都为上千个文本单元格重算分段（大列表下即整表重排）。
   */
  const debouncedSearchKeyword = ref('');
  /** 是否仅显示收藏条目 */
  const favoriteOnly = ref(false);
  /** 标签筛选：选中标签集合（命中任一即保留，与搜索/收藏过滤为叠加关系） */
  const filterTags = ref<string[]>([]);
  const selectedIds = ref<string[]>([]);
  const isEditingPassword = ref(false);
  const editingPasswordId = ref<string>('');
  const passwordFormLoading = ref(false);
  const tableLoading = ref(false);
  /** 本地操作守卫：防止 storage watcher 在本地操作期间触发全量 loadPasswords */
  const { isLocalOperation, runLocalOperation, consumeLocalOperation } = useLocalOperationGuard();
  const passwordForm = ref<PasswordFormModel>({
    username: '',
    password: '',
    url: '',
    tag: '',
    remark: '',
    totp: '',
  });

  /**
   * 编辑态条目的原始字段长度，用于放宽校验上限
   *
   * 导入闸门刻意比表单容量宽（超容量字段既不拒收也不截断，保证任何自导出文件都能回灌），
   * 库里因此可能存在「比容量更长」的历史/外部条目。四个输入框都带 `maxlength=容量`，
   * 用户无法把它改得更长，但按原容量硬拒会让这些条目改任何字段都存不下。
   * 在弹窗装载条目那一刻取快照（而非按 id 回查列表），编辑期间不随列表重载而漂移；
   * 新建态与 SidePanel 快速添加恒为空对象，容量口径分毫不动。
   */
  const editingFieldLengths = ref<InitialFieldLengths>({});

  const passwordFormRules = computed<FormRules>(() => ({
    ...createPasswordFormRules(t, editingFieldLengths.value),
    totp: [{ validator: totpValidator, trigger: 'blur' }],
  }));

  // 计算属性（过滤 + 排序，替代 el-table 客户端排序）
  const filteredPasswords = computed(() => {
    let result: PasswordEntry[] = passwords.value;

    if (debouncedSearchKeyword.value) {
      // 字段清单、字段归一与保序口径由 `utils/keywordMatch.filterByKeyword` 单点持有，
      // 与侧边栏、内联下拉同一条路径；此处只注入「怎么判定命中」的拼音版匹配器。
      result = filterByKeyword(result, debouncedSearchKeyword.value, matchesKeyword);
    }

    if (favoriteOnly.value) {
      result = result.filter(p => p.favorite);
    }

    if (filterTags.value.length > 0) {
      result = result.filter(p => parseTags(p.tag).some(tag => filterTags.value.includes(tag)));
    }

    // 始终按当前排序状态排序（替代 el-table 客户端排序）
    return sortPasswordEntries([...result], currentSort.value);
  });

  /**
   * 分页复位信号：只由「查看口径」变化构成
   *
   * 筛选与排序口径一变，用户眼前的集合就是一批新东西，继续停在第 7 页只会读到空白；
   * 而删除、就地编辑、收藏这类**内容**变化刻意不进这里——它们应保持用户当前所在页，
   * 页码越界由 `useVaultListPagination` 内部的 `pageCount` 钳位兜住。
   * 拼成单串是为了让 `watch` 按值比较：`filterTags` 每次勾选都是新数组，
   * 直接当依赖会让同一份口径反复复位页码。
   */
  const listFilterSignature = computed(() =>
    [
      debouncedSearchKeyword.value,
      favoriteOnly.value ? 1 : 0,
      filterTags.value.join(','),
      currentSort.value.prop,
      currentSort.value.order ?? '',
    ].join('\u0000'),
  );

  /**
   * 密码列表分页（详见 `useVaultListPagination`）
   *
   * `el-table` 每轮只拿到 `pagedEntries` 这一页：整表挂载成本随行数近似平方增长
   * （2000 行实测 180 秒、首屏 33.6 秒，见 docs/PERF_LARGE_VAULT_EVALUATION.md 9.10），
   * 把渲染行数从「命中数」压成「页大小」是这条曲线上唯一有效的旋钮。
   */
  const { currentPage, pageSize, pageCount, totalCount, pagedEntries, revealIndex } = useVaultListPagination(
    filteredPasswords,
    listFilterSignature,
  );

  /** 选中集的成员判定视图：分页后选择集可到 2000 条，批量操作不再能逐项 `includes` */
  const selectedIdSet = computed(() => new Set(selectedIds.value));

  /**
   * 已选中但不在当前页的条数
   *
   * 分页后「选中 30 条」和「眼前只看到 8 条勾」会同时成立，批量按钮上的计数因此失去了
   * 可核对性；这个数用来在分页条上显式说明差额，避免用户以为漏选。
   */
  const offPageSelectedCount = computed(() => {
    const onPage = new Set(pagedEntries.value.map(entry => entry.id));
    return selectedIds.value.reduce((count, id) => count + (onPage.has(id) ? 0 : 1), 0);
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
   * 标签筛选变化同样视为过滤条件变化，需清空选中（与收藏过滤策略一致）。
   * 但多选下拉展开期间每次勾选项都会触发变化：若此时立即清空选中，
   * 批量按钮会在交互中途消失引起布局跳动。因此展开期间仅记录待清空标记，
   * 待下拉收起时（见 handleTagFilterVisibleChange）统一清空。
   */
  let tagFilterDropdownVisible = false;
  let pendingSelectionClear = false;
  watch(filterTags, () => {
    if (tagFilterDropdownVisible) {
      pendingSelectionClear = true;
    } else {
      selectedIds.value = [];
    }
  });

  /**
   * 标签筛选下拉展开/收起回调
   * 收起时若交互期间发生过筛选变化，则补执行选中清空，
   * 此时下拉面板已关闭，按钮显隐引起的布局变化不再被用户感知。
   * @param visible 下拉面板是否展开
   */
  const handleTagFilterVisibleChange = (visible: boolean) => {
    tagFilterDropdownVisible = visible;
    if (!visible && pendingSelectionClear) {
      pendingSelectionClear = false;
      selectedIds.value = [];
    }
  };

  /**
   * 下拉候选标签列表
   * 从所有密码条目中聚合去重，供表单中的标签下拉选项使用。
   */
  const availableTags = computed<string[]>(() => collectAllTags(passwords.value));

  // 批量移除标签等操作后候选集可能不再包含已选筛选标签：
  // 及时剔除失效项，避免筛选下拉隐藏后残留过滤条件造成「隐形空过滤」
  watch(availableTags, tags => {
    if (filterTags.value.some(selected => !tags.includes(selected))) {
      filterTags.value = filterTags.value.filter(selected => tags.includes(selected));
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
      const { accepted, rejectedTooLong } = normalizeTagInput(value, MAX_TAG_LENGTH);
      if (rejectedTooLong.length > 0) {
        ElMessage.warning(t('form.tagLengthLimit', { max: MAX_TAG_LENGTH }));
      }
      let finalTags = accepted;
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
      revealRow(id);
    } catch (error) {
      logger.error('切换收藏失败:', error);
      ElMessage.error(t('message.operationFailed'));
    }
  };

  /**
   * 整表加载的代际序号与在飞计数
   *
   * `loadPasswords` 内部有三次 await，每一次都是「手里这份快照可能已经过期」的窗口：
   * 认证回调、可见性变化与 storage 事件都能并发启动新的加载，晚完成的旧加载若照常提交，
   * 就会把新数据盖回旧数据。序号保证只有最新一次加载有权落地，计数让「仅元数据就地修补」
   * 在加载在飞时主动让位——修补改的是即将被整表替换的旧条目，且它返回 true 还会让
   * storage watcher 省掉本该发生的那次重载，结果是列表静默停在过期状态。
   */
  let loadGeneration = 0;
  let loadsInFlight = 0;

  // 加载密码列表
  const loadPasswords = async () => {
    const generation = ++loadGeneration;
    loadsInFlight++;
    try {
      tableLoading.value = true;

      const sessionValid = await StorageUtils.isSessionValid();
      if (generation !== loadGeneration) return;
      if (!sessionValid) {
        passwords.value = [];
        return;
      }

      const entries = await StorageUtils.getAllPasswords();
      if (generation !== loadGeneration) return;
      passwords.value = entries;

      // 初始化每条记录的密码显隐状态
      passwords.value.forEach(p => {
        (p as PasswordEntryWithUI).showPassword = false;
      });
      // 排序由 filteredPasswords computed 处理，此处不再排序

      // 初始化有效期设置表单
      const validityHours = await StorageUtils.getMasterPasswordValidityHours();
      if (generation !== loadGeneration) return;
      validityForm.value.validityHours = validityHours;
    } catch (error: unknown) {
      logger.error('加载密码列表失败:', error);
      const message = error instanceof Error ? error.message : t('message.unknownError');
      ElMessage.error(t('message.loadListFailedDetail', { message }));
    } finally {
      loadsInFlight--;
      // 只有最新一次加载负责收尾：被取代的那次提前返回时不得熄灭仍在加载的遮罩
      if (generation === loadGeneration) tableLoading.value = false;
    }
  };

  /**
   * 仅元数据外部写入的就地修补（storage watcher 零解密快路径）
   *
   * 其他窗口的填充、网页自动保存只会改动 `METADATA_FIELDS` 白名单里的非敏感字段，
   * 但 `onChanged` 送来的仍是整包 `account_passwords`：走 `loadPasswords()` 等于
   * 一次 5N 字段解密（N=2000 实测 410.6 ms）+ 整表替换与重渲染。这里复用侧边栏
   * 同一判据与白名单（`StorageUtils.isMetadataOnlyChange` / `METADATA_FIELDS`，
   * 单一事实源在 `utils/storage/passwordCrud.ts`），命中时只改条目字段、不换数组引用。
   *
   * 保守降级：一次整表加载在飞、列表为空（锁定态/未加载）、判据未命中、或存储里有
   * 本地列表不存在的 id 一律返回 false，由调用方回退整表重载——误判的代价只是
   * 「少了一次快路径」，反向的代价是显示过期数据，不可接受。
   *
   * @param change `account_passwords` 的 onChanged 变更对象
   * @returns true 表示列表已与 storage 一致，调用方无需再重载
   */
  const patchMetadataOnlyFromStorage = async (change: chrome.storage.StorageChange): Promise<boolean> => {
    const newEntries = change.newValue;
    // 加载在飞时不走快路径：那次加载手里的快照早于本次事件，随后整表覆盖会抹掉这里
    // 就地改出的字段，而返回 true 又让 watcher 跳过重载，列表便静默停在过期状态。
    // 让位后由新一次加载收口——它读取的已是事件落地后的存储，代价只是多一次重载。
    if (loadsInFlight > 0) return false;
    if (!Array.isArray(newEntries) || passwords.value.length === 0) return false;
    if (!StorageUtils.isMetadataOnlyChange(change.oldValue, newEntries)) return false;

    const targets = new Map(passwords.value.map(entry => [entry.id, entry as unknown as Record<string, unknown>]));
    let missed = 0;
    for (const raw of newEntries) {
      const entry = raw as Record<string, unknown> | null;
      const target = entry && typeof entry.id === 'string' ? targets.get(entry.id) : undefined;
      if (!entry || !target) {
        // 判据只比对 old/new 两次整包，看不出「本地列表少了这条」：此时就地修补会漏掉
        // 该条目却报告已与存储一致，缺口要等下一次非元数据写入才暴露，故回退重载。
        // 已修补的其他字段随调用方的整表重载一并换掉，不产生与存储偏离的中间态。
        missed++;
        continue;
      }
      // 与侧边栏同口径：按键存在性同步——白名单字段在新值里缺失（如取消收藏后
      // at-rest 删掉的 `favoriteUsedAt` 键）时也要从列表条目上删除，否则 UI 与存储持续偏离
      for (const field of StorageUtils.METADATA_FIELDS) {
        if (field in entry) {
          target[field] = entry[field];
        } else {
          delete target[field];
        }
      }
    }
    if (missed > 0) {
      logger.debug(`Options: 仅元数据变更命中，但本地列表缺少 ${missed} 条存储中的条目，回退整表重载`);
      return false;
    }
    logger.debug('Options: 外部写入命中仅元数据变更，已就地修补列表');
    return true;
  };

  // 处理排序变化（同步更新 currentSort 并持久化）
  const handleSortChange = async ({ prop, order }: { prop: string; order: string }) => {
    currentSort.value = { prop, order: (order || null) as SortState['order'] };
    try {
      await StorageUtils.saveSortConfig({ prop, order });
    } catch (error) {
      logger.error('保存排序配置失败:', error);
    }
  };

  /**
   * 从存储恢复排序状态到 currentSort
   * 需在 onMounted 中、loadPasswords 之后调用，确保首次渲染使用正确的排序
   */
  const restoreSortConfig = async () => {
    try {
      const sortConfig = await StorageUtils.getSortConfig();
      if (sortConfig) {
        currentSort.value = { prop: sortConfig.prop, order: (sortConfig.order || null) as SortState['order'] };
      }
    } catch (error) {
      logger.debug('恢复排序配置失败:', error);
    }
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
    editingFieldLengths.value = {};
    passwordForm.value = { ...EMPTY_PASSWORD_FORM, url: prefillUrl };
    showPasswordDialog.value = true;
  };

  // 编辑密码
  const editPassword = (password: PasswordEntry) => {
    isEditingPassword.value = true;
    editingPasswordId.value = password.id;
    editingFieldLengths.value = {
      username: password.username.length,
      password: password.password.length,
      url: password.url.length,
      remark: password.remark.length,
    };
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
    editingFieldLengths.value = {};
    passwordForm.value = { ...EMPTY_PASSWORD_FORM };
  };

  /** 定位链路的代际：新一次定位会让上一次挂起中的逐帧查找作废（见 `revealRow`） */
  let revealGeneration = 0;

  /** 各行尚未到点的高亮定时器，按条目 ID 保存，重复定位时重置而不是叠加 */
  const rowHighlights = new Map<string, ReturnType<typeof setTimeout>>();

  onScopeDispose(() => {
    revealGeneration++;
    for (const timer of rowHighlights.values()) clearTimeout(timer);
    rowHighlights.clear();
  });

  /**
   * 定位到某个条目：必要时先翻到它所在的页，再滚动并高亮
   *
   * 原来三条链路（保存、创建副本、切换收藏）各自复制了一份
   * 「setTimeout 100ms → querySelector(`.${id}`) → 加 `new-item`」，分页之后这条链路
   * 必须**先换页**才有行可找，三份副本只会让时序各自漂移，因此收敛成这一个入口。
   *
   * 等待渲染改为逐帧重试而不是固定 100ms：换页会让 `el-table` 整批替换一页的行，
   * 固定延时在慢机器上会赶在行出现之前，表现为「保存后没有定位到」；找到即停，
   * 快路径与原实现同样只等一次渲染。条目被当前筛选排除时保持原行为——什么都不做。
   *
   * 两次定位之间只用代际（`revealGeneration`）断开旧的逐帧链：被作废的那次既不会
   * 再把用户换页，也不会给旧行补高亮。高亮定时器按条目 ID 存进 `rowHighlights`，
   * 因此同一行连续定位是「重置 6 秒倒计时」，而不同行仍各自保持高亮——与分页前
   * 多行可同时高亮的表现一致。
   *
   * @param id 目标条目 ID
   */
  const revealRow = (id: string) => {
    const index = filteredPasswords.value.findIndex(entry => entry.id === id);
    if (index === -1) return;
    revealIndex(index);

    const generation = ++revealGeneration;
    /** 逐帧寻找目标行；上限约 0.5 秒，超过即认定这轮渲染没赶上，静默收尾 */
    const MAX_FRAMES = 30;
    let frame = 0;
    const locate = () => {
      if (generation !== revealGeneration) return;
      const row = findPasswordRow(id);
      if (!row) {
        if (++frame < MAX_FRAMES) requestAnimationFrame(locate);
        return;
      }
      row.classList.add('new-item');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearTimeout(rowHighlights.get(id));
      rowHighlights.set(
        id,
        setTimeout(() => {
          rowHighlights.delete(id);
          row.classList.remove('new-item');
        }, ROW_HIGHLIGHT_MS),
      );
    };
    void nextTick(locate);
  };

  // 处理密码表单保存
  const handlePasswordFormSave = async (formRef?: FormInstance) => {
    if (formRef) {
      // 校验失败由 el-form 的字段内联提示承载，不能按「保存失败」上报：那会把用户的输入错误
      // 说成系统故障，还把 EP 的字段错误对象写进 error 日志（与 SiteRulesDialog 同一口径）
      try {
        await formRef.validate();
      } catch {
        return;
      }
    }

    try {
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
        revealRow(editingPasswordId.value);
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
        revealRow(newEntry!.id);
      }

      showPasswordDialog.value = false;
      resetPasswordForm();
    } catch (error) {
      logger.error('保存密码失败:', error);
      // 上限拒绝单独成文：泛化的「保存失败」会让用户反复重试同一次添加，
      // 而真实原因是条目总数已到位，需要的是先清理再添加。
      ElMessage.error(
        isVaultCapacityError(error)
          ? t('options.capacity.addBlocked', { max: MAX_PASSWORD_ENTRIES })
          : t('message.saveFailed'),
      );
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

      revealRow(newEntry!.id);

      ElMessage.success(t('form.copySuccess'));
    } catch (error: any) {
      logger.error('创建副本失败:', error);
      ElMessage.error(
        isVaultCapacityError(error)
          ? t('options.capacity.copyBlocked', { max: MAX_PASSWORD_ENTRIES })
          : t('form.copyFailedDetail', { message: error.message || t('message.unknownError') }),
      );
    }
  };

  /**
   * 删除落盘收尾：成功刷新列表并提示，失败给出可读错误并刷新回真实数据
   *
   * 原实现把真实写入直接放在 setTimeout 回调里，外层 try/catch 捕获不到任何异常——
   * 失败时行已从表格消失但存储未删，刷新后条目「复活」，用户得不到任何反馈。
   *
   * @returns 是否真正删除成功（失败时由调用方把动画期间摘掉的行插回原位）
   */
  const commitDelete = async (runDelete: () => Promise<void>, failureMessage: string): Promise<boolean> => {
    try {
      await runLocalOperation(runDelete);
      await loadPasswords();
      ElMessage.success(t('form.movedToTrash'));
      return true;
    } catch (error) {
      logger.error('移入回收站失败:', error);
      await loadPasswords();
      ElMessage.error(failureMessage);
      return false;
    }
  };

  /** 按条目 ID 定位表格行（CSS.escape 兜住非常规 id，避免选择器本身抛错） */
  const findPasswordRow = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`.${CSS.escape(id)}`);

  /**
   * 摘掉淡出结束的表格行，并返回「插回原位」的复原函数
   *
   * 动画结束时物理移除节点是既有观感（行随之收拢）；但 `el-table` 设了 `row-key="id"`，
   * 条目仍在库里时，失败分支的 `loadPasswords()` 只会让 Vue 按 key 复用那个已脱离文档的
   * 节点、不会重新插入——行永久看不见，直到用户翻页或重排序。因此必须记住原位自己插回。
   * 插回时顺带摘掉 `del-item`：重新入文档会让 CSS 动画从 0% 重播，否则失败行会再淡出一次。
   */
  const detachRow = (row: HTMLElement): (() => void) => {
    const parent = row.parentNode;
    const next = row.nextElementSibling;
    row.remove();
    return () => {
      row.classList.remove('del-item');
      if (!parent) return;
      parent.insertBefore(row, parent.contains(next) ? next : null);
    };
  };

  // 删除密码
  const deletePassword = async (id: string) => {
    try {
      await ElMessageBox.confirm(t('form.deleteConfirm'), t('form.deleteConfirmTitle'), {
        confirmButtonText: t('form.moveToTrash'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      });
    } catch (error) {
      // 取消（EP 以字符串 'cancel' reject）保持静默，其余异常照旧提示：
      // 一概 return 会把「点了没反应」带回来，非 cancel 的 reject 属于真实故障
      if (error !== 'cancel') {
        logger.error('删除确认弹窗异常:', error);
        ElMessage.error(t('message.deleteFailed'));
      }
      return;
    }

    const delItem = findPasswordRow(id);
    // 行未渲染（被当前筛选/搜索条件排除等）时同样要执行删除：原实现只在命中 DOM 行的
    // 分支里落盘，用户确认后既无提示也无删除，表现为「点了没反应」
    if (!delItem) {
      await commitDelete(() => StorageUtils.deletePassword(id), t('message.deleteFailed'));
      return;
    }

    delItem.classList.add('del-item');
    setTimeout(() => {
      const restoreRow = detachRow(delItem);
      void commitDelete(() => StorageUtils.deletePassword(id), t('message.deleteFailed')).then(deleted => {
        if (!deleted) restoreRow();
      });
    }, DELETE_ANIMATION_MS);
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
    } catch (error) {
      if (error !== 'cancel') {
        logger.error('批量删除确认弹窗异常:', error);
        ElMessage.error(t('form.batchDeleteFailed'));
      }
      return;
    }

    // 确认瞬间一次性快照选择集：淡出动画（DELETE_ANIMATION_MS）期间用户仍可勾选/取消，
    // 到点时才读 selectedIds 会让「动画里的行」与「真正被删的 id」分叉，误删新选中项
    const idsToDelete = [...selectedIds.value];
    const patchDelItems: HTMLElement[] = [];
    idsToDelete.forEach((id: string) => {
      const delItem = findPasswordRow(id);
      if (delItem) {
        delItem.classList.add('del-item');
        patchDelItems.push(delItem);
      }
    });
    setTimeout(() => {
      const restoreRows = patchDelItems.map(delItem => detachRow(delItem));
      void commitDelete(() => StorageUtils.deletePasswords(idsToDelete), t('form.batchDeleteFailed')).then(deleted => {
        if (deleted) {
          // 只摘掉本次真正删除的 id，保留动画期间新勾选的项
          const deletedSet = new Set(idsToDelete);
          selectedIds.value = selectedIds.value.filter(id => !deletedSet.has(id));
          return;
        }
        // 逆序插回：相邻的被删行互为参照节点，后摘的先回去，先摘的才找得到插入位置
        for (let index = restoreRows.length - 1; index >= 0; index--) restoreRows[index]();
      });
    }, DELETE_ANIMATION_MS);
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
    const entries = passwords.value.filter(p => selectedIdSet.value.has(p.id));
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

    const targets = passwords.value.filter(p => selectedIdSet.value.has(p.id));
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
    debouncedSearchKeyword,
    selectedIds,
    isEditingPassword,
    editingPasswordId,
    passwordForm,
    passwordFormRules,
    passwordFormLoading,
    tableLoading,
    favoriteOnly,
    filterTags,
    filteredPasswords,
    /** 当前页切片：`el-table` 的 `data` 只认这个，不再直接吃 `filteredPasswords` */
    pagedEntries,
    currentPage,
    pageSize,
    pageCount,
    totalCount,
    offPageSelectedCount,
    currentSort,
    availableTags,
    tagArray,
    // 方法
    loadPasswords,
    patchMetadataOnlyFromStorage,
    handleSortChange,
    restoreSortConfig,
    togglePasswordVisibility,
    handleRowClassName,
    handleSelectionChange,
    handleTagFilterVisibleChange,
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
    consumeLocalOperation,
  };
}
