/**
 * 身份信息库列表排序（纯计算，无 Vue / 存储 / i18n 依赖）
 *
 * 单独成文件而不是留在 `useIdentityVault` 里，理由与 `utils/vaultPagination.ts` 同源：
 * 比较器是可直接单测的纯函数，而那个 composable 持有解密明文与剪贴板副作用，
 * 把排序口径写在里面，就只能靠挂组件才能验证「换档位到底换成了什么顺序」。
 *
 * 标题排序依赖运行时 ICU 的中文拼写排序（Chrome 与 Node ≥ 13 默认 full-icu），
 * 因此它是** locale 相关**的：中文按拼音、英文按字典序，切语言顺序可能随之变化，
 * 这是「按标题排序」的常规预期，不是抖动。类别档序刻意不跟随译名（见 categoryRank）。
 *
 * `manual` 档不做任何比较，只查调用方注入的序位数组（见 `IdentitySortContext.orderIndexOf`）。
 * 与之配套的 `normalizeManualOrder` / `applyManualMove` 也留在这里：过滤态「只在可见子集内
 * 重排」是这一档最容易写错、又最难在 UI 上看出错的口径，放在纯函数里才能直接单测。
 */
import type { IdentityCategory, IdentityEntry, IdentityMoveSide, IdentitySortMode } from './types';
import { CATEGORY_ORDER, DEFAULT_IDENTITY_SORT_MODE } from './constants';

/**
 * `manual` 档未登记 id 的序位哨兵
 *
 * 新建 / 导入进来的条目不在落盘顺序数组里，给极大值而不是 -1：极大值经比较器落到末尾、
 * 再由 `tieBreak` 按时间倒序安定排列，保证「不在数组里」的条目**出现**在列表尾部而不是消失。
 * 用 `MAX_SAFE_INTEGER` 而非 `MAX_VALUE`：两个序位相减不会溢出成 Infinity，符号仍然正确。
 */
export const MANUAL_ORDER_UNRANKED = Number.MAX_SAFE_INTEGER;

/**
 * 排序上下文
 *
 * 由调用方注入，使本模块不反向依赖 i18n 取词与列表标题回退链（那些属于 composable / 弹窗）。
 */
export interface IdentitySortContext {
  /** 列表标题（`displayTitle` 回退链的结果），仅 `title` 档使用 */
  titleOf: (entry: IdentityEntry) => string;
  /** Intl 排序语言，跟随界面语言（'zh-CN' | 'en'） */
  locale: string;
  /**
   * id → 手动顺序里的序位，仅 `manual` 档使用
   *
   * 未登记的 id 必须返回 {@link MANUAL_ORDER_UNRANKED}（落末尾）；顺序数组住在存储层，
   * 注入而不是 import，与 `titleOf` 同一取舍：排序口径可以单测，存储依赖留在调用方。
   */
  orderIndexOf: (id: string) => number;
}

/**
 * 类别档序权重
 *
 * 取既有 `CATEGORY_ORDER`（与工具栏类别按钮同一顺序），未知值（理论上只可能来自
 * 被绕过导入校验的数据）排到末档，而不是 -1 抢在最前。
 */
function categoryRank(category: IdentityCategory): number {
  const index = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

/**
 * 同档兜底：时间倒序 → id 字典序
 *
 * 必须有这一层，否则结果的先后取决于 `storage.local` 对象的键序，同一条库在
 * 两次 load 之间可能给出不同顺序（`Array.prototype.sort` 稳定，但输入不稳定）。
 */
function tieBreak(a: IdentityEntry, b: IdentityEntry): number {
  if (a.updateTime !== b.updateTime) return b.updateTime - a.updateTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 时间档共用：倒序，同值再走兜底 */
function byTime(timeOf: (entry: IdentityEntry) => number): IdentityComparator {
  return (a, b) => timeOf(b) - timeOf(a) || tieBreak(a, b);
}

/** 档位比较器：一对条目 → 负 / 零 / 正 */
type IdentityComparator = (a: IdentityEntry, b: IdentityEntry) => number;

/**
 * 档位 → 比较器工厂
 *
 * 写成 `satisfies Record<IdentitySortMode, …>` 的映射表，而不是 mode 上的 if / 三元链：
 * 前者在「加了第五档却忘了在这里登记」时直接编译失败，后者会静默走进兜底分支，用户看到的是
 * 「换了个名字、顺序却没变」——这类缺陷既没有报错也没有测试能替人接住，只能靠类型系统提前拦。
 *
 * 工厂形态而不是直接给比较器，是因为 `title` 档的 Collator 必须**每次排序只构造一个**
 * （`Intl.Collator` 构造不便宜，放进比较器里会退化成 O(n log n) 次）。
 */
const COMPARATORS = {
  updated: () => byTime(entry => entry.updateTime),
  created: () => byTime(entry => entry.createTime),
  category: () => (a, b) => categoryRank(a.payload.category) - categoryRank(b.payload.category) || tieBreak(a, b),
  title: (ctx: IdentitySortContext) => {
    const collator = new Intl.Collator(ctx.locale, { numeric: true, sensitivity: 'base' });
    return (a, b) => collator.compare(ctx.titleOf(a), ctx.titleOf(b)) || tieBreak(a, b);
  },
  // 手排档不比时间也不比文本，只查注入的序位；未登记（新建 / 导入）的 id 同为
  // MANUAL_ORDER_UNRANKED，差值归零后由 tieBreak 安定落到尾部。
  manual: (ctx: IdentitySortContext) => (a, b) => ctx.orderIndexOf(a.id) - ctx.orderIndexOf(b.id) || tieBreak(a, b),
} satisfies Record<IdentitySortMode, (ctx: IdentitySortContext) => IdentityComparator>;

/**
 * 按档位返回排序后的新数组（永不原地重排）
 *
 * `rows` 是 shallowRef 里的同一份数组，就地 sort 会把「导出顺序」「勾选摘要」等
 * 其它消费点一并改掉，因此这里固定先拷贝。
 *
 * @param entries 待排序条目（可为过滤后的子集）
 * @param ctx 排序上下文（标题取值与语言）
 * @param mode 排序档位；缺省取 {@link DEFAULT_IDENTITY_SORT_MODE}
 * @returns 新的排序数组；入参为空时返回空数组
 */
export function sortIdentityEntries(
  entries: readonly IdentityEntry[],
  ctx: IdentitySortContext,
  mode: IdentitySortMode = DEFAULT_IDENTITY_SORT_MODE,
): IdentityEntry[] {
  const list = [...entries];
  if (list.length < 2) return list;

  return list.sort(COMPARATORS[mode](ctx));
}

/**
 * 把落盘的手排顺序对齐到当前库里的条目集合
 *
 * 两件事一次做完，且都只在真正写盘时执行（读路径不写库）：
 * - **prune**：已删除条目的 id 从数组里去掉，否则数组会随删除无限增长；
 * - **append**：新建与 `.aphid` / 明文导入带来的新 id 追加到尾部，顺序取传入的
 *   现存 id 序列（即 `rows` 的基准序），与「未登记条目显示在末尾」这一档内表现一致。
 *
 * - **dedupe**：`stored` 里的重复 id 会被去掉——读侧已把重复数组整体回落成空数组，
 *   这里是写入侧的第二道闸门，保证「一次坏写入」不会长期污染后续排位。
 *
 * @param stored 存储里现有的顺序数组（可为脏数据，按只读处理）
 * @param presentIds 当前库中实际存在的条目 id（顺序即新出现条目的追加顺序）
 * @returns 新的顺序数组：保留原有相对次序 + 尾部追加新 id
 */
export function normalizeManualOrder(stored: readonly string[], presentIds: readonly string[]): string[] {
  const present = new Set(presentIds);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const id of stored) {
    if (present.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push(id);
    }
  }
  for (const id of presentIds) {
    if (!seen.has(id)) {
      seen.add(id);
      kept.push(id);
    }
  }
  return kept;
}

/** {@link applyManualMove} 的入参 */
export interface ManualMoveInput {
  /** 全量手排顺序（已 {@link normalizeManualOrder} 过，与库里条目一一对应） */
  globalIds: readonly string[];
  /** 当前可见（过滤后）条目的 id，顺序即列表呈现次序 */
  visibleIds: readonly string[];
  /** 被移动条目的 id */
  draggedId: string;
  /** 落点参照条目的 id */
  targetId: string;
  /** 插到参照卡之前还是之后 */
  side: IdentityMoveSide;
}

/**
 * 在可见子集内移动一条，并把结果回写到它在全局数组里的原槽位
 *
 * 过滤态（搜索词 / 类别过滤）下只能看见子集，若按「可见列表」整体覆盖全局数组，
 * 被隐藏条目会被静默挤到数组尾部、顺序全部丢失。这里的口径是：**可见项只在彼此之间
 * 换位，占据的全局槽位集合不变**，隐藏项一动也不动，取消过滤后手排结果与用户看到的一致。
 *
 * @param input 移动参数
 * @returns 新的全局数组与移动后在可见列表里的 0 基下标；无实际位移时返回 null（调用方据此不落盘）
 */
export function applyManualMove(input: ManualMoveInput): { ids: string[]; index: number } | null {
  const { globalIds, visibleIds, draggedId, targetId, side } = input;
  if (draggedId === targetId) return null;

  const from = visibleIds.indexOf(draggedId);
  const targetAt = visibleIds.indexOf(targetId);
  if (from === -1 || targetAt === -1) return null;

  const nextVisible = [...visibleIds];
  nextVisible.splice(from, 1);
  // 先摘掉被移动项再定位锚点：`before/after` 因此不必为「向下移动时目标下标已左移一位」特判
  const anchor = nextVisible.indexOf(targetId);
  const index = side === 'after' ? anchor + 1 : anchor;
  nextVisible.splice(index, 0, draggedId);

  const visible = new Set(visibleIds);
  const queue = [...nextVisible];
  const ids = globalIds.map(id => (visible.has(id) ? (queue.shift() ?? id) : id));
  return { ids, index };
}
