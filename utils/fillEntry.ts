/**
 * 快速填充入口的派生与解析
 *
 * 「填充入口」是设置面板里那个三选一分段控件的对外语义，而存储里是两个字段
 * （`fillMode` + `autoShowSidepanel`）。把派生/回写这两段映射抽到这里，是因为现在
 * 有三方需要同一份口径：设置面板（渲染与写回）、内容脚本（决定是否弹侧边栏 / 是否
 * 显示内联图标）、站点规则（按站点覆盖全局）。留在面板模块里当私有函数时，后两者
 * 只能各自复刻一遍——三处映射不一致的后果是「面板显示 A、页面行为 B」这类归因极难
 * 的缺陷，所以口径必须只有一份实现。
 *
 * 纯函数、无 DOM 依赖，可直接单测。
 */
import type { FillEntry, FloatingButtonConfig } from '@/utils/types';

/** 参与派生的最小字段集合（整份 `FloatingButtonConfig` 天然满足） */
type FillFields = Pick<FloatingButtonConfig, 'fillMode' | 'autoShowSidepanel'>;

/** 参与覆盖的最小字段集合（站点规则 `SiteRule.fillEntry` 的结构子集，避免反向依赖存储层） */
type FillOverride = { fillEntry?: unknown };

/** 取值清单：顺序即分段控件与下拉选项的展示顺序 */
export const FILL_ENTRIES: readonly FillEntry[] = ['sidepanel', 'inline', 'manual'];

/**
 * 判定未知值是否为合法的填充入口
 *
 * storage 里的规则与导入文件里的字段都按不可信输入处理，读取端一律先过这里，
 * 避免把 `{ fillEntry: 'sidepanel-auto' }` 这类历史猜测值当成有效覆盖。
 */
export function isFillEntry(value: unknown): value is FillEntry {
  return typeof value === 'string' && (FILL_ENTRIES as readonly string[]).includes(value);
}

/**
 * 由配置派生当前填充入口
 *
 * 三态互斥，消除「内联开启 + 侧边栏自动」这种自相矛盾的组合：
 * - fillMode 为 'inline' 时优先判定为内联（此时 autoShowSidepanel 不生效）
 * - 否则按 autoShowSidepanel 区分「侧边栏自动」与「仅手动」
 *
 * @param config 参与派生的配置字段
 * @returns 当前填充入口
 */
export function getFillEntry(config: FillFields): FillEntry {
  if (config.fillMode === 'inline') return 'inline';
  return config.autoShowSidepanel ? 'sidepanel' : 'manual';
}

/**
 * 将填充入口映射回存储字段
 *
 * 每次选择都同时写入 fillMode 与 autoShowSidepanel，保证存储始终为规范态、
 * 不残留旧的矛盾组合。
 *
 * @param entry 目标填充入口
 * @returns 需增量保存的配置补丁
 */
export function fillEntryToPatch(entry: FillEntry): Pick<FloatingButtonConfig, 'fillMode' | 'autoShowSidepanel'> {
  switch (entry) {
    case 'inline':
      return { fillMode: 'inline', autoShowSidepanel: false };
    case 'manual':
      return { fillMode: 'sidepanel', autoShowSidepanel: false };
    case 'sidepanel':
    default:
      return { fillMode: 'sidepanel', autoShowSidepanel: true };
  }
}

/**
 * 解析当前生效的填充入口：站点规则优先于全局配置
 *
 * 站点规则只在用户显式选过某一档时才有值，未配置（`undefined`）即「跟随全局」——
 * 这是覆盖语义的关键：一条只管选择器的规则不应顺带改变填充入口，否则新增规则会
 * 静默推翻用户的全局偏好。
 *
 * 规则里的值来自 storage，读取时先过 `isFillEntry`：存着非法值时按「跟随全局」处理，
 * 而不是让它参与三档判定（那样任何非 'inline' 的字符串都会落到「自动弹侧边栏」分支）。
 *
 * @param config 全局配置字段
 * @param rule 当前域名的站点规则（可为 null / undefined，表示无规则或读取失败）
 * @returns 生效的填充入口
 */
export function resolveFillEntry(config: FillFields, rule?: FillOverride | null): FillEntry {
  const override = rule?.fillEntry;
  return isFillEntry(override) ? override : getFillEntry(config);
}
