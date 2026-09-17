/**
 * 身份信息库（Identity Vault）响应式状态与生命周期
 *
 * 单一实例由 `entrypoints/options/App.vue` 创建并注入给列表弹窗（props），
 * 保证会话失效时 App.vue 侧的 `teardown()` 与弹窗共享同一份状态：
 * - 状态：rows（解密后条目）/ loading / revealedIds（掩码显隐）/ selectedIds（导出勾选）/ keyword / categoryFilter；
 * - 派生：filteredRows（类别过滤 + 搜索 + updateTime 倒序）；
 * - 生命周期：load() / teardown() / resetViewState()；
 * - 视图态：卡级显隐 toggleReveal / 批量 toggleRevealAll（仅作用可见含机密卡）/ 勾选选择态 / 过滤清除 clearFilters；
 * - 领域：displayTitle（列表标题回退链）/ copyField（逐字段复制）/ copyCard（整卡复制，恒走限时自动清除通道）。
 *
 * 搜索刻意**不加防抖**：既有 200ms 防抖是为上百条密码设计，身份库 ≤30 条，
 * 即时过滤更简单（有意偏离，见方案 §4.1）。
 */
import { computed, ref, shallowRef } from 'vue';
import type { IdentityCategory, IdentityEntry, IdentityPayload } from '@/utils/identity/types';
import { deleteIdentities, getAllIdentity, saveIdentity, updateIdentity } from '@/utils/storage/identityCrud';
import { hasSecretFields } from '@/utils/identity/fields';
import { matchesKeyword } from '@/utils/searchMatch';
import { copySecretToClipboard, copyTextToClipboard } from '@/utils/clipboard';
import { logger } from '@/utils/logger';
import { useI18n } from '@/utils/i18n';

const { t } = useI18n();

/** 类别过滤器取值（'all' 表示不过滤） */
export type IdentityCategoryFilter = 'all' | IdentityCategory;

/** 收集参与搜索匹配的全部字段文本（机密字段参与匹配但不高亮） */
function collectSearchableFields(payload: IdentityPayload): string[] {
  const fields = [
    payload.name,
    payload.idNumber,
    payload.phone,
    payload.email,
    payload.address,
    payload.cardNo,
    payload.cardBank,
    payload.cardHolder,
    payload.cardExpiry,
    payload.cardCvv,
    payload.remark,
  ].filter((value): value is string => typeof value === 'string');
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
  const keyword = ref('');
  const categoryFilter = ref<IdentityCategoryFilter>('all');

  /** 类别过滤 + 搜索过滤后的条目（保持 load 时的 updateTime 倒序） */
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
    return list;
  });

  /**
   * 加载并解密全部身份条目（updateTime 倒序）
   *
   * 解密失败的单条由 getAllIdentity 跳过并告警；整体读取失败仅记录日志，
   * 交由调用方决定是否提示（弹窗打开时调用，失败不阻断弹窗骨架）。
   */
  async function load(): Promise<void> {
    loading.value = true;
    try {
      const { entries } = await getAllIdentity();
      entries.sort((a, b) => b.updateTime - a.updateTime);
      rows.value = entries;
    } catch (error) {
      logger.error('加载身份信息失败:', error);
      rows.value = [];
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
    keyword.value = '';
    categoryFilter.value = 'all';
  }

  /** 会话失效时清空全部内存明文（rows + 视图状态），防止 PII 残留 */
  function teardown(): void {
    rows.value = [];
    resetViewState();
  }

  /** 列表标题回退链：name ?? cardHolder ?? email ?? phone ?? 类别名 */
  function displayTitle(entry: IdentityEntry): string {
    const p = entry.payload;
    return p.name || p.cardHolder || p.email || p.phone || t(`identity.category.${p.category}`);
  }

  /** 自动清除完成回调（复用 fill 命名空间既有文案） */
  function notifyClipboardCleared(ok: boolean): void {
    if (ok) {
      ElMessage.info(t('fill.clipboardCleared'));
    } else {
      ElMessage.warning(t('fill.clipboardClearFailed'));
    }
  }

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
    keyword,
    categoryFilter,
    filteredRows,
    selectedCount,
    allVisibleSelected,
    selectionIndeterminate,
    allVisibleRevealed,
    load,
    create,
    update,
    remove,
    toggleReveal,
    toggleRevealAll,
    isRevealed,
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
