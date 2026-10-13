/**
 * 身份信息库（Identity Vault）响应式状态与生命周期
 *
 * 单一实例由 `entrypoints/options/App.vue` 创建并注入给列表弹窗（props），
 * 保证会话失效时 App.vue 侧的 `teardown()` 与弹窗共享同一份状态：
 * - 状态：rows（解密后条目）/ loading / revealedIds（掩码显隐）/ selectedIds（导出勾选）/ collapsedIds（卡片折叠）/ keyword / categoryFilter / sortMode（列表排序档位）/ manualOrder（`manual` 档的手排 id 顺序）；
 * - 派生：filteredRows（类别过滤 + 搜索 + 按 sortMode 排序）；
 * - 生命周期：load() / teardown() / resetViewState() / restoreSortMode()；
 * - 视图态：卡级显隐 toggleReveal / 批量 toggleRevealAll（仅作用可见含机密卡）/ 单卡折叠 toggleCollapse 与批量折叠 toggleCollapseAll（均仅作用可见卡）/ 档位切换 setSortMode（落盘为偏好）/ 手排换位 moveIdentity（仅 `manual` 档，落盘顺序数组）/ 勾选选择态 / 过滤清除 clearFilters；
 * - 领域：displayTitle（列表标题回退链）/ copyField（逐字段复制）/ copyCard（整卡复制，恒走限时自动清除通道）。
 *
 * 搜索刻意**不加防抖**：既有 200ms 防抖是为上百条密码设计，身份库 ≤30 条，
 * 即时过滤更简单（有意偏离，见方案 §4.1）。
 *
 * 排序档位只改**列表展示**顺序：`rows` 恒按 updateTime 倒序，导出与勾选摘要读的是 `rows`，
 * 因此换档位不会改写备份文件的条目次序（视图偏好不该惊动数据层）。
 * `manual` 档同样只重排 `filteredRows`，唯一写进数据侧的东西是一张独立的 id 顺序数组
 * （`IDENTITY_MANUAL_ORDER`），条目 payload 与 `.aphid` 结构一概不动，回滚等于删掉那个键。
 */
import { computed, ref, shallowRef } from 'vue';
import type {
  IdentityCategory,
  IdentityEntry,
  IdentityMoveSide,
  IdentityPayload,
  IdentitySortMode,
} from '@/utils/identity/types';
import { DEFAULT_IDENTITY_SORT_MODE } from '@/utils/identity/constants';
import {
  deleteIdentities,
  getAllIdentity,
  getIdentityManualOrder,
  getIdentitySortMode,
  saveIdentity,
  saveIdentityManualOrder,
  saveIdentitySortMode,
  updateIdentity,
} from '@/utils/storage/identityCrud';
import { IDENTITY_FIELD_DEFS, hasSecretFields } from '@/utils/identity/fields';
import {
  MANUAL_ORDER_UNRANKED,
  applyManualMove,
  normalizeManualOrder,
  sortIdentityEntries,
} from '@/utils/identity/sort';
import { matchesKeyword } from '@/utils/searchMatch';
import { copySecretToClipboard, copyTextToClipboard } from '@/utils/clipboard';
import { logger } from '@/utils/logger';
import { useClipboardFeedback } from '@/composables/useClipboardFeedback';
import { useI18n } from '@/utils/i18n';

const { t, currentLocale } = useI18n();

/** 类别过滤器取值（'all' 表示不过滤） */
export type IdentityCategoryFilter = 'all' | IdentityCategory;

/** 收集参与搜索匹配的全部字段文本（机密字段参与匹配但不高亮）；内置字段集以 IDENTITY_FIELD_DEFS 为单一事实来源 */
function collectSearchableFields(payload: IdentityPayload): string[] {
  const fields: string[] = [];
  for (const def of IDENTITY_FIELD_DEFS) {
    const value = payload[def.key];
    if (typeof value === 'string') {
      fields.push(value);
    }
  }
  for (const field of payload.customFields ?? []) {
    fields.push(field.label, field.value);
  }
  return fields;
}

/**
 * 身份信息库 composable（App.vue 单一实例化后注入弹窗）
 *
 * 复制反馈复用既有 key：成功 `options.detail.copied`、失败 `message.copyFailed`、
 * 自动清除 `fill.clipboardCleared` / `fill.clipboardClearFailed`（对标 PasswordDetailDrawer）。
 */
export function useIdentityVault() {
  /** 解密后的条目列表（updateTime 倒序，浅响应：条目整体替换） */
  const rows = shallowRef<IdentityEntry[]>([]);
  const loading = ref(false);
  /** 已显明文的条目 id 集合（显隐状态，不落盘） */
  const revealedIds = ref<Set<string>>(new Set());
  /** 已勾选待导出的条目 id 集合（视图态，不落盘；resetViewState 清空） */
  const selectedIds = ref<Set<string>>(new Set());
  /** 已折叠（仅显示标题行）的条目 id 集合（视图态，不落盘；resetViewState 清空） */
  const collapsedIds = ref<Set<string>>(new Set());
  const keyword = ref('');
  const categoryFilter = ref<IdentityCategoryFilter>('all');
  /** 列表排序档位（视图偏好，明文单键落盘；初始取默认档，restoreSortMode 用落盘值对齐） */
  const sortMode = ref<IdentitySortMode>(DEFAULT_IDENTITY_SORT_MODE);
  /**
   * `manual` 档的手排顺序（id 数组，明文单键落盘）
   *
   * 与档位同属「切走再切回仍然保留」的视图偏好，故不进 `resetViewState` / `teardown`：
   * 里面只有随机 id、不含 PII，保留可避免弹窗重开时把用户排好的顺序读成中间态。
   */
  const manualOrder = ref<string[]>([]);
  /** 手动换档次数（`restoreSortMode` 的代际判据，见该函数注释） */
  let manualSortTicks = 0;

  /** id → 手排序位（一次建表供整轮比较器复用；`rows` ≤30 条，重排成本可忽略） */
  const manualRank = computed(() => new Map(manualOrder.value.map((id, index) => [id, index])));

  /**
   * 手排序位查询（注入 `sort.ts` 的比较上下文，使排序模块零存储依赖）
   *
   * 不在数组里的 id（新建、刚导入，或本次 load 前还没读到落盘值）返回
   * {@link MANUAL_ORDER_UNRANKED}，由比较器连 `tieBreak` 一起落到列表尾部——
   * 「排过序的条目」永远不会因为新条目不在数组里而被挤出去或看不见。
   */
  function orderIndexOf(id: string): number {
    return manualRank.value.get(id) ?? MANUAL_ORDER_UNRANKED;
  }

  /** 类别过滤 + 搜索过滤后的条目，按当前档位排序（≤30 条，每次重排成本可忽略） */
  const filteredRows = computed(() => {
    const category = categoryFilter.value;
    const kw = keyword.value.trim();
    let list = rows.value;
    if (category !== 'all') {
      list = list.filter(entry => entry.payload.category === category);
    }
    if (kw) {
      list = list.filter(entry => matchesKeyword(collectSearchableFields(entry.payload), kw));
    }
    return sortIdentityEntries(
      list,
      { titleOf: displayTitle, locale: currentLocale.value, orderIndexOf },
      sortMode.value,
    );
  });

  /**
   * 加载并解密全部身份条目（updateTime 倒序）
   *
   * 解密失败的单条由 getAllIdentity 跳过并告警；整体读取失败仅记录日志，
   * 交由调用方决定是否提示（弹窗打开时调用，失败不阻断弹窗骨架）。
   *
   * 这里的倒序是**数据层基准序**：导出与勾选摘要读 `rows`，故备份内容不受视图档位影响。
   *
   * 手排序号与条目同批**并行**读取：两者互不依赖，串行等于给「打开弹窗」多加一次
   * storage IPC；读到的顺序在下次 `moveIdentity` 落盘时才与条目集合对齐（剪掉已删除的 id、
   * 尾部追加新出现的 id），读路径本身不写库。
   */
  async function load(): Promise<void> {
    loading.value = true;
    try {
      const [{ entries }, order] = await Promise.all([getAllIdentity(), getIdentityManualOrder()]);
      entries.sort((a, b) => b.updateTime - a.updateTime);
      rows.value = entries;
      manualOrder.value = order;
    } catch (error) {
      logger.error('加载身份信息失败:', error);
      rows.value = [];
      manualOrder.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** 新增身份条目（写失败上抛，由调用方提示） */
  async function create(payload: IdentityPayload): Promise<void> {
    await saveIdentity(payload);
    await load();
  }

  /** 更新身份条目（携带并发令牌，写失败上抛，由调用方提示） */
  async function update(id: string, patch: Partial<IdentityPayload>, expectedUpdateTime: number): Promise<void> {
    await updateIdentity(id, patch, expectedUpdateTime);
    await load();
  }

  /** 删除身份条目（失败上抛，由调用方提示） */
  async function remove(id: string): Promise<void> {
    await deleteIdentities([id]);
    await load();
  }

  /** 切换某条目的明文显隐 */
  function toggleReveal(id: string): void {
    const next = new Set(revealedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    revealedIds.value = next;
  }

  /** 某条目当前是否显明文 */
  function isRevealed(id: string): boolean {
    return revealedIds.value.has(id);
  }

  /** 当前可见且含机密字段的条目（批量展开/收起的唯一作用范围；无机密字段的卡无法经卡级眼睛展开） */
  const revealableRows = computed(() => filteredRows.value.filter(r => hasSecretFields(r.payload)));

  /** 可见的含机密条目是否已全部展开明文（驱动「展开 / 收起全部机密」按钮文案与态） */
  const allVisibleRevealed = computed(
    () => revealableRows.value.length > 0 && revealableRows.value.every(r => revealedIds.value.has(r.id)),
  );

  /**
   * 一键展开 / 收起当前可见的含机密条目
   *
   * 只增删「可见且含机密」的 id，不动被过滤掉的既有展开项（与 `selectAllVisible` 口径一致），
   * 也不把无机密字段的卡塞进 `revealedIds`，使其恒等于「当前明文中」。
   */
  function toggleRevealAll(): void {
    const next = new Set(revealedIds.value);
    const reveal = !allVisibleRevealed.value;
    for (const r of revealableRows.value) {
      if (reveal) {
        next.add(r.id);
      } else {
        next.delete(r.id);
      }
    }
    revealedIds.value = next;
  }

  /** 某条目当前是否折叠（仅显示标题行） */
  function isCollapsed(id: string): boolean {
    return collapsedIds.value.has(id);
  }

  /**
   * 切换单张卡片的折叠态
   *
   * 与 `toggleReveal` 同款口径：整组换新 Set，让浅响应可靠触发依赖更新。
   */
  function toggleCollapse(id: string): void {
    const next = new Set(collapsedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    collapsedIds.value = next;
  }

  /** 当前可见条目是否已全部折叠（驱动「折叠 / 展开全部」按钮文案与态） */
  const allVisibleCollapsed = computed(
    () => filteredRows.value.length > 0 && filteredRows.value.every(r => collapsedIds.value.has(r.id)),
  );

  /**
   * 一键折叠 / 展开当前可见的全部卡片（折叠后仅保留标题行，用于概览与减少滚动）
   *
   * 与 `toggleRevealAll` 同口径：只增删「可见」的 id，不动被过滤掉的既有折叠态。
   */
  function toggleCollapseAll(): void {
    const next = new Set(collapsedIds.value);
    const collapse = !allVisibleCollapsed.value;
    for (const r of filteredRows.value) {
      if (collapse) {
        next.add(r.id);
      } else {
        next.delete(r.id);
      }
    }
    collapsedIds.value = next;
  }

  /**
   * 切换列表排序档位并落盘
   *
   * 先改内存再写盘：视图必须立即响应，而落盘失败只意味着「下次打开回到旧档位」，
   * 不值得为一次偏好写入向用户报错（与分页档位同一取舍），故此处只告警不上抛。
   */
  function setSortMode(mode: IdentitySortMode): void {
    if (mode === sortMode.value) return;
    manualSortTicks += 1;
    sortMode.value = mode;
    void saveIdentitySortMode(mode).catch(error => logger.warn('身份信息排序档位落盘失败，本次会话内仍生效:', error));
  }

  /**
   * 从落盘值恢复排序档位（弹窗每次打开时与 load() 并行调用）
   *
   * 两条读取互不依赖，故并行发起、不新增串行等待；存储层已把非法值与读失败
   * 回落成默认档，这里不需要再判异常。
   *
   * `manualSortTicks` 是本组件自己的代际保护：读回是异步的，用户可能在结果落地前
   * 就动手换了档，那种情况下过期读数必须作废，否则「一打开就选好档位」会被一次慢读覆盖。
   */
  async function restoreSortMode(): Promise<void> {
    const ticks = manualSortTicks;
    const mode = await getIdentitySortMode();
    if (ticks === manualSortTicks) {
      sortMode.value = mode;
    }
  }

  /**
   * 手排档唯一的写序入口：把 `draggedId` 移到 `targetId` 的前 / 后
   *
   * 拖拽与键盘（Alt+↑ / Alt+↓）两条路径都收敛到这一只函数，落盘形状与换位算法因此
   * 只有一份。与 `setSortMode` 同一取舍：先改内存让视图立即响应，落盘失败只告警不上抛
   * （视图偏好不值得为一次坏写入向用户报错，下次打开回到旧顺序）。
   *
   * 落盘前先把顺序数组与当前条目集合对齐（`normalizeManualOrder`）：被删除的 id 就此剪掉，
   * 新建与导入带来的新 id 追加尾部，数组因此恒等于「库里现存的那些 id」。
   * 有过滤条件时只在可见子集内换位、按可见项的全局原槽位回写（`applyManualMove`），
   * 隐藏项的位置一动不动。
   *
   * @param draggedId 被移动条目的 id
   * @param targetId 落点参照条目的 id
   * @param side 插到参照卡之前还是之后
   * @returns 移动后在**可见列表**里的 1 基位次（供 aria-live 播报）；无实际位移时返回 null 且不写盘
   */
  function moveIdentity(draggedId: string, targetId: string, side: IdentityMoveSide): number | null {
    const globalIds = normalizeManualOrder(
      manualOrder.value,
      rows.value.map(entry => entry.id),
    );
    const moved = applyManualMove({
      globalIds,
      visibleIds: filteredRows.value.map(entry => entry.id),
      draggedId,
      targetId,
      side,
    });
    if (!moved) return null;

    manualOrder.value = moved.ids;
    void saveIdentityManualOrder(moved.ids).catch(error =>
      logger.warn('身份信息手动排序落盘失败，本次会话内仍生效:', error),
    );
    return moved.index + 1;
  }

  /** 切换某条目的勾选态 */
  function toggleSelect(id: string): void {
    const next = new Set(selectedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds.value = next;
  }

  /** 某条目当前是否被勾选 */
  function isSelected(id: string): boolean {
    return selectedIds.value.has(id);
  }

  /** 已勾选且仍在库中的条数（load 后自动剔除已删除的失效 id） */
  const selectedCount = computed(() => rows.value.filter(r => selectedIds.value.has(r.id)).length);

  /** 当前可见（过滤后）条目是否已全部勾选（驱动工具栏「全选」复选框） */
  const allVisibleSelected = computed(
    () => filteredRows.value.length > 0 && filteredRows.value.every(r => selectedIds.value.has(r.id)),
  );

  /** 工具栏「全选」是否处于半选态（可见项部分勾选） */
  const selectionIndeterminate = computed(
    () => !allVisibleSelected.value && filteredRows.value.some(r => selectedIds.value.has(r.id)),
  );

  /** 勾选/取消勾选当前可见的全部条目（不影响被过滤掉的已选项） */
  function selectAllVisible(select: boolean): void {
    const next = new Set(selectedIds.value);
    for (const r of filteredRows.value) {
      if (select) {
        next.add(r.id);
      } else {
        next.delete(r.id);
      }
    }
    selectedIds.value = next;
  }

  /** 清空勾选（导出成功后复位，让「未勾选=全部」回到默认口径） */
  function clearSelection(): void {
    selectedIds.value = new Set();
  }

  /** 仅清除过滤条件（搜索 + 类别），保留显隐与勾选态（空态「清除筛选」使用） */
  function clearFilters(): void {
    keyword.value = '';
    categoryFilter.value = 'all';
  }

  /** 复位弹窗视图状态（搜索/过滤/显隐/勾选），不含 rows（@closed 时调用） */
  function resetViewState(): void {
    revealedIds.value = new Set();
    selectedIds.value = new Set();
    collapsedIds.value = new Set();
    keyword.value = '';
    categoryFilter.value = 'all';
  }

  /** 会话失效或列表弹窗关闭时清空全部内存明文（rows + 视图状态），防止 PII 残留 */
  function teardown(): void {
    rows.value = [];
    resetViewState();
  }

  /** 列表标题回退链：name ?? cardHolder ?? email ?? phone ?? 类别名 */
  function displayTitle(entry: IdentityEntry): string {
    const p = entry.payload;
    return p.name || p.cardHolder || p.email || p.phone || t(`identity.category.${p.category}`);
  }

  /** 自动清除完成回调（与密码详情抽屉、编辑弹窗历史复制共用 useClipboardFeedback） */
  const { notifyClipboardCleared } = useClipboardFeedback();

  /**
   * 复制到剪贴板的共享通道
   *
   * 机密走 `copySecretToClipboard`（限时自动清除），非机密走 `copyTextToClipboard`
   * （取消待清除定时器）。空值静默跳过；成功提示文案由 `successKey` 决定。
   */
  async function copyViaClipboard(value: string, secret: boolean, successKey: string): Promise<void> {
    if (!value) return;
    const ok = secret ? await copySecretToClipboard(value, notifyClipboardCleared) : await copyTextToClipboard(value);
    if (ok) {
      ElMessage.success(t(successKey));
    } else {
      ElMessage.error(t('message.copyFailed'));
    }
  }

  /** 复制单字段到剪贴板（机密字段走限时自动清除通道） */
  async function copyField(value: string, secret: boolean): Promise<void> {
    await copyViaClipboard(value, secret, 'options.detail.copied');
  }

  /**
   * 复制整条身份信息（已拼好的多行文本）
   *
   * 整卡载荷恒含姓名 / 手机号 / 住址等 PII，故一律走 `copySecretToClipboard`（限时自动清除），
   * 不再按「是否含机密字段」分支：既消除「传错布尔就把 PII 常留剪贴板」的隐患，也避免纯地址卡
   * 经普通复制通道取消上一条机密待清除定时器、间接延长明文存活时间。
   */
  async function copyCard(text: string): Promise<void> {
    await copyViaClipboard(text, true, 'identity.copyCard.success');
  }

  return {
    rows,
    loading,
    revealedIds,
    selectedIds,
    collapsedIds,
    keyword,
    categoryFilter,
    sortMode,
    manualOrder,
    filteredRows,
    selectedCount,
    allVisibleSelected,
    selectionIndeterminate,
    allVisibleRevealed,
    allVisibleCollapsed,
    load,
    create,
    update,
    remove,
    toggleReveal,
    toggleRevealAll,
    isRevealed,
    isCollapsed,
    toggleCollapse,
    toggleCollapseAll,
    setSortMode,
    restoreSortMode,
    moveIdentity,
    toggleSelect,
    isSelected,
    selectAllVisible,
    clearSelection,
    clearFilters,
    resetViewState,
    teardown,
    displayTitle,
    copyField,
    copyCard,
  };
}

/** 身份库实例类型（App.vue 注入弹窗的 props 契约） */
export type IdentityVault = ReturnType<typeof useIdentityVault>;
