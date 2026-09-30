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
 */
import type { IdentityCategory, IdentityEntry, IdentitySortMode } from './types';
import { CATEGORY_ORDER, DEFAULT_IDENTITY_SORT_MODE } from './constants';

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
