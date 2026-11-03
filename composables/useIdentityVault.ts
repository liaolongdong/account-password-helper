/**
 * 身份信息库（Identity Vault）响应式状态与生命周期
 *
 * 单一实例由 `entrypoints/options/App.vue` 创建并注入给列表弹窗（props），
 * 保证会话失效时 App.vue 侧的 `teardown()` 与弹窗共享同一份状态：
 * - 状态：rows（解密后条目）/ loading / revealedIds（掩码显隐）/ selectedIds（导出勾选）/ collapsedIds（卡片折叠）/ keyword / categoryFilter / sortMode（列表排序档位）/ manualOrder（`manual` 档的手排 id 顺序）；
 * - 派生：filteredRows（类别过滤 + 搜索 + 按 sortMode 排序）/ identityBackupPending（备份提醒条显隐）；
 * - 生命周期：load() / teardown() / resetViewState() / restoreSortMode()；
 * - 视图态：卡级显隐 toggleReveal / 批量 toggleRevealAll（仅作用可见含机密卡）/ 单卡折叠 toggleCollapse 与批量折叠 toggleCollapseAll（均仅作用可见卡）/ 档位切换 setSortMode（落盘为偏好）/ 手排换位 moveIdentity（仅 `manual` 档，落盘顺序数组）/ 勾选选择态 / 过滤清除 clearFilters；
 * - 领域：displayTitle（列表标题回退链）/ copyField（逐字段复制）/ copyCard（整卡复制，恒走限时自动清除通道）/ markBackupPending 与 markBackupDone（备份提醒的会话内信号）。
 *
 * 搜索刻意**不加防抖**：既有 200ms 防抖是为上百条密码设计，身份库 ≤100 条（`MAX_IDENTITIES`），
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
import {
  IDENTITY_FIELD_DEFS,
  hasSecretFields,
  identityDisplayTitle,
  identityFieldNameSet,
  requestedFieldName,
} from '@/utils/identity/fields';
import {
  MANUAL_ORDER_UNRANKED,
  applyManualMove,
  normalizeManualOrder,
  sortIdentityEntries,
} from '@/utils/identity/sort';
import { matchesKeyword } from '@/utils/searchMatch';
import { copySecretToClipboard, copyTextToClipboard } from '@/utils/clipboard';
import { getLastIdentityBackupAt, getLastIdentityChangeAt, markIdentityBackupAt } from '@/utils/storage/configManager';
import { hasPendingIdentityBackup } from '@/utils/backup/changeDetection';
import { logger } from '@/utils/logger';
import { useClipboardFeedback } from '@/composables/useClipboardFeedback';
import { useI18n } from '@/utils/i18n';

const { t, currentLocale } = useI18n();

/** 类别过滤器取值（'all' 表示不过滤） */
export type IdentityCategoryFilter = 'all' | IdentityCategory;

/**
 * 收集参与**严格检索**的全部字段文本——**列表上看得见的字，就是搜得到的字**。
 *
 * 值与字段名同进一个集合，交给同一个 `matchesKeyword`（子串优先，拼音预热后补全拼与首字母）：
 * 自定义字段的名称与内容一直在检索面里（气泡深链落的就是名称），内置字段的名字随后补齐，
 * 于是「搜银行卡号」问的就是「哪些条目有这一格」。**两侧都只在字段有值时**把名字放进集合：
 * 空着的那一格在 `buildIdentityFieldRows` 里根本不渲染，让它进面等于搜出一条屏上看不见的格子。
 * 名字取当前界面语言的译名（与标签列显示的字同源），严格这一层不做跨语言兜底——
 * 页面那行字与译名对不上时（`联系电话号码` vs `手机号`），由 {@link askedNameKeys} 那条
 * 「只在严格检索为空时才打开」的放宽通道接住，词表不分语言。
 * 机密字段的值参与匹配但默认打码（不高亮），口径与改造前一致。
 */
function collectSearchableFields(payload: IdentityPayload): string[] {
  const fields: string[] = [];
  for (const def of IDENTITY_FIELD_DEFS) {
    const value = payload[def.key];
    if (typeof value === 'string' && value) {
      fields.push(value, t(`identity.field.${def.key}`));
    }
  }
  for (const field of payload.customFields ?? []) {
    // 有值才进：空着的那一格在 `buildIdentityFieldRows` 里根本不渲染，
    // 让它进检索面就等于「搜得到一条屏上看不到、也填不出东西的格子」。
    if (field.value) {
      fields.push(field.label, field.value);
    }
  }
  return fields;
}

/**
 * 这行字在要哪几格（内置字段键与 `custom:<id>` 混在同一个集合里，命名与字段行的 key 一致）
 *
 * 内置那一半走静态词表，自定义那一半只能拿用户自己起的名字比——所以要把整库过一遍。
 * 自定义字段**有值才进**，与 {@link collectSearchableFields} 同一条规矩：
 * 空着的那一格既不该被搜到，也不该被高亮成「你搜的就是它」。
 */
function askedNameKeys(kw: string, entries: readonly IdentityEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const def of IDENTITY_FIELD_DEFS) {
    if (requestedFieldName(kw, identityFieldNameSet(def.key, t(`identity.field.${def.key}`)))) {
      keys.add(def.key);
    }
  }
  for (const entry of entries) {
    for (const field of entry.payload.customFields ?? []) {
      if (field.value && requestedFieldName(kw, [field.label])) keys.add(`custom:${field.id}`);
    }
  }
  return keys;
}

/** 这条身份是不是填着了话里认中的某一格 */
function entryHasAskedField(payload: IdentityPayload, keys: ReadonlySet<string>): boolean {
  if (IDENTITY_FIELD_DEFS.some(def => payload[def.key] && keys.has(def.key))) return true;
  return (payload.customFields ?? []).some(field => !!field.value && keys.has(`custom:${field.id}`));
}

/** 「没有放宽」时复用的空集合：每次求值新建 Set 会让依赖它的 computed 每轮都换引用 */
const NO_RELAXED_KEYS: ReadonlySet<string> = new Set<string>();

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
  /** load 代际：teardown / 新一轮 load 递增，迟到的旧结果不得重新写回明文 */
  let loadEpoch = 0;
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

  /**
   * 落盘口径的「身份库有未备份变更」（`load()` 时按两个时间戳重算）
   *
   * 与 `identityBackupPending` 分开存：这一份是**上次读盘时的结论**，
   * 下面那份是叠加了本页面会话内即时信号后供模板消费的结果。
   */
  const persistedBackupPending = ref(false);
  /**
   * 本页面会话内发生过、且尚未导出备份的变更
   *
   * 存在的唯一理由是竞态：`LAST_IDENTITY_CHANGE_AT` 由 Service Worker 的
   * `storage.onChanged` 写入，而 `create` / `update` / `remove` 在 CRUD 之后
   * 立刻 `await load()`，此时那一写常常还没落地——**删除**尤其致命，删掉最新
   * 一条会让「按记录 createTime / updateTime 比对」这条信号反而变假，
   * 提醒条会先消失、等用户重开弹窗才回来。这个内存标志把该窗口补齐；
   * 页面刷新即失效，此后完全由落盘时间戳接管。
   */
  const unbackedMutation = ref(false);

  /** id → 手排序位（一次建表供整轮比较器复用；`rows` 不超条目上限，重排成本可忽略） */
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

  /**
   * 文本阶段的结果：严格命中，或严格为空时「把这句话认成某一格」的放宽命中
   *
   * 拆成一层是必需的而不是排风格：放宽与否是**同一次求值**的产物，`filteredRows`、
   * `searchRelaxed`、`relaxedNameKeys` 三者必须来自同一批判定，否则会出现
   * 「列表是放宽的、说明行说不是」这类自相矛盾的屏。排序仍留在 `filteredRows`，
   * 顺序口径与档位都不受放宽影响。
   */
  const textStage = computed<{ list: IdentityEntry[]; relaxed: boolean; keys: ReadonlySet<string> }>(() => {
    const category = categoryFilter.value;
    const kw = keyword.value.trim();
    let list = rows.value;
    if (category !== 'all') {
      list = list.filter(entry => entry.payload.category === category);
    }
    if (!kw) return { list, relaxed: false, keys: NO_RELAXED_KEYS };

    const strict = list.filter(entry => matchesKeyword(collectSearchableFields(entry.payload), kw));
    if (strict.length > 0) return { list: strict, relaxed: false, keys: NO_RELAXED_KEYS };

    // 严格检索空了才问第二句：这行字是不是在要某一格。这道次序挡的是「短名字盖掉一次真实的值命中」
    // ——`备注` / `姓名` 永远争不过一条真的搜到值的查询。它**不**保证放宽的结果窄：一句话既搜不到值、
    // 又恰好含一个短名字时，这一屏就是宽的，那种宽由视图侧那句 `identity.searchRelaxed` 说明行负责讲清。
    const asked = askedNameKeys(kw, rows.value);
    if (asked.size === 0) return { list: [], relaxed: false, keys: NO_RELAXED_KEYS };
    const relaxedList = list.filter(entry => entryHasAskedField(entry.payload, asked));
    if (relaxedList.length === 0) return { list: [], relaxed: false, keys: NO_RELAXED_KEYS };
    return { list: relaxedList, relaxed: true, keys: asked };
  });

  /** 类别过滤 + 搜索过滤后的条目，按当前档位排序（不超条目上限，每次重排成本可忽略） */
  const filteredRows = computed(() =>
    sortIdentityEntries(
      textStage.value.list,
      { titleOf: displayTitle, locale: currentLocale.value, orderIndexOf },
      sortMode.value,
    ),
  );

  /**
   * 这一屏是不是「按字段名放宽」的结果
   *
   * 只在放宽**确实产出了条目**时为真：放宽后仍然空（库里没人填过那一格）时保持 false，
   * 让空态那句「建一条同名自定义字段」继续说话，而不是配一句「已按字段名放宽」的空列表。
   */
  const searchRelaxed = computed(() => textStage.value.relaxed);

  /** 放宽时这句话认中了哪些格子：内置字段键或 `custom:<id>`，与字段行的 key 同一套命名 */
  const relaxedNameKeys = computed(() => textStage.value.keys);

  /**
   * 备份提醒条是否该出现
   *
   * 空库恒不提醒（没有条目就没有可备份的东西）；有条目时，本会话内的即时信号与
   * 落盘时间戳任一为真即提醒。改造前这条提醒是「有数据就常驻」，与密码侧
   * 「有变更才提醒」的口径不一致，且对已经导出过 `.aphid` 的用户构成持续噪音。
   */
  const identityBackupPending = computed(
    () => rows.value.length > 0 && (unbackedMutation.value || persistedBackupPending.value),
  );

  /**
   * 加载并解密全部身份条目（updateTime 倒序）
   *
   * 解密失败的单条由 getAllIdentity 跳过并告警；整体读取失败仅记录日志，
   * 交由调用方决定是否提示（弹窗打开时调用，失败不阻断弹窗骨架）。
   *
   * 这里的倒序是**数据层基准序**：导出与勾选摘要读 `rows`，故备份内容不受视图档位影响。
   *
   * 手排序号、两个备份时间戳与条目同批**并行**读取：四者互不依赖，串行等于给
   * 「打开弹窗」多加三次 storage IPC；读到的顺序在下次 `moveIdentity` 落盘时才与条目集合
   * 对齐（剪掉已删除的 id、尾部追加新出现的 id），读路径本身不写库。
   * 时间戳读取内部已吞异常并降级为 null，不会把整个 `load()` 拖进 catch。
   */
  async function load(): Promise<void> {
    const epoch = ++loadEpoch;
    loading.value = true;
    try {
      const [{ entries }, order, lastChangeAt, lastBackupAt] = await Promise.all([
        getAllIdentity(),
        getIdentityManualOrder(),
        getLastIdentityChangeAt(),
        getLastIdentityBackupAt(),
      ]);
      // 解密期间弹窗已关闭 / 会话已锁定：teardown 已清空，迟到的明文不得再写回
      if (epoch !== loadEpoch) return;
      entries.sort((a, b) => b.updateTime - a.updateTime);
      rows.value = entries;
      manualOrder.value = order;
      persistedBackupPending.value = hasPendingIdentityBackup({ records: entries, lastChangeAt, lastBackupAt });
    } catch (error) {
      if (epoch !== loadEpoch) return;
      logger.error('加载身份信息失败:', error);
      rows.value = [];
      manualOrder.value = [];
      persistedBackupPending.value = false;
    } finally {
      if (epoch === loadEpoch) loading.value = false;
    }
  }

  /**
   * 标记「本会话内出现了尚未备份的变更」
   *
   * `create` / `update` / `remove` 内部自调；不经过这三者的写路径（弹窗里的
   * 备份导入走 `replaceAllIdentity`）由调用方显式调一次。
   */
  function markBackupPending(): void {
    unbackedMutation.value = true;
  }

  /**
   * 记录一次**完整**加密导出并撤下备份提醒
   *
   * 只在导出作用域等于全库时调用（见 `IdentityVaultDialog` 的 `handleExport`）：
   * 部分导出留下的仍是残缺备份，此时撤下提醒等于告诉用户「已经备好了」。
   * 明文导出也不得调用——明文 JSON 不是可长期保管的备份形态。
   *
   * 落盘失败只记 warn：内存标志已复位，提醒在本次页面会话内不会回来；
   * 重开弹窗按落盘时间戳重算，最坏是多提醒一次，不会漏提醒。
   */
  async function markBackupDone(): Promise<void> {
    unbackedMutation.value = false;
    persistedBackupPending.value = false;
    try {
      await markIdentityBackupAt();
    } catch (error) {
      logger.warn('记录身份库备份时间失败:', error);
    }
  }

  /** 新增身份条目（写失败上抛，由调用方提示） */
  async function create(payload: IdentityPayload): Promise<void> {
    await saveIdentity(payload);
    markBackupPending();
    await load();
  }

  /** 更新身份条目（携带并发令牌，写失败上抛，由调用方提示） */
  async function update(id: string, patch: Partial<IdentityPayload>, expectedUpdateTime: number): Promise<void> {
    await updateIdentity(id, patch, expectedUpdateTime);
    markBackupPending();
    await load();
  }

  /** 删除身份条目（失败上抛，由调用方提示） */
  async function remove(id: string): Promise<void> {
    await deleteIdentities([id]);
    markBackupPending();
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
    // 不回滚内存顺序：卡片已经跟着手势落位，弹回去比留一条明确提示更糟。
    // 但落盘失败必须让用户知道——否则刷新后顺序悄悄复原，看着像拖拽没生效。
    void saveIdentityManualOrder(moved.ids).catch(error => {
      logger.warn('身份信息手动排序落盘失败，本次会话内仍生效:', error);
      ElMessage.warning(t('identity.sort.saveFailed'));
    });
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
    // 清空后再递增代际：同步执行，迟到的 load 续体会在回填前看到新代际
    loadEpoch += 1;
    loading.value = false;
  }

  /** 列表标题回退链：name ?? cardHolder ?? email ?? phone ?? 类别名（与回收站弹窗共用 identityDisplayTitle） */
  function displayTitle(entry: IdentityEntry): string {
    return identityDisplayTitle(entry.payload, t);
  }

  /** 自动清除完成回调（与密码详情抽屉、编辑弹窗历史复制共用 useClipboardFeedback） */
  const { notifyClipboardCleared } = useClipboardFeedback();

  /**
   * 复制到剪贴板的共享通道
   *
   * 机密走 `copySecretToClipboard`（限时自动清除），非机密走 `copyTextToClipboard`
   * （取消待清除定时器）。空值静默跳过；成功提示文案由 `successKey` 决定。
   *
   * @returns 是否确实写进了剪贴板（调用方据此决定要不要跟进动作，视图层不猜）
   */
  async function copyViaClipboard(value: string, secret: boolean, successKey: string): Promise<boolean> {
    if (!value) return false;
    const ok = secret ? await copySecretToClipboard(value, notifyClipboardCleared) : await copyTextToClipboard(value);
    if (ok) {
      ElMessage.success(t(successKey));
    } else {
      ElMessage.error(t('message.copyFailed'));
    }
    return ok;
  }

  /** 复制单字段到剪贴板（机密字段走限时自动清除通道） */
  async function copyField(value: string, secret: boolean): Promise<boolean> {
    return copyViaClipboard(value, secret, 'options.detail.copied');
  }

  /**
   * 复制整条身份信息（已拼好的多行文本）
   *
   * 整卡载荷恒含姓名 / 手机号 / 住址等 PII，故一律走 `copySecretToClipboard`（限时自动清除），
   * 不再按「是否含机密字段」分支：既消除「传错布尔就把 PII 常留剪贴板」的隐患，也避免纯地址卡
   * 经普通复制通道取消上一条机密待清除定时器、间接延长明文存活时间。
   */
  async function copyCard(text: string): Promise<boolean> {
    return copyViaClipboard(text, true, 'identity.copyCard.success');
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
    searchRelaxed,
    relaxedNameKeys,
    identityBackupPending,
    selectedCount,
    allVisibleSelected,
    selectionIndeterminate,
    allVisibleRevealed,
    allVisibleCollapsed,
    load,
    create,
    update,
    remove,
    markBackupPending,
    markBackupDone,
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
