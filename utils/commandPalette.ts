import { matchesKeyword } from '@/utils/searchMatch';

/**
 * 命令面板（Options 页 Ctrl/Cmd+K）纯逻辑
 *
 * 仅承担「与 Vue/DOM 无关」的算法：动作模型、按关键词过滤、活动项索引推进。
 * 过滤复用 {@link matchesKeyword}（子串优先，拼音模块预热后自动补齐全拼/首字母），
 * 与密码列表搜索同一套匹配口径，保证用户输入心智一致。全部本地计算，零网络、零存储。
 */

/** 命令分组标识（面板内分组标题由 `options.commandPalette.group.${group}` 解析） */
export type CommandGroup = 'entry' | 'data' | 'security' | 'preferences';

/**
 * 命令动作：面板中可被检索并执行的一条命令。
 *
 * `label` 为已翻译好的展示文本（由调用方以当前语言注入），`keywords` 为额外的
 * 中英文检索别名（仅用于匹配、不渲染，故不受 i18n 约束）。`run` 触发既有 handler，
 * 与下拉菜单点击走完全相同的落码路径，不新增行为。
 */
export interface CommandAction {
  /** 稳定唯一标识 */
  id: string;
  /** 所属分组 */
  group: CommandGroup;
  /** 展示名（已翻译） */
  label: string;
  /** 检索别名（小写中英文词，命中用） */
  keywords: string[];
  /** 执行：复用既有打开弹窗/命令处理，可同步或异步 */
  run: () => void | Promise<void>;
}

/**
 * 按关键词过滤命令（保持传入顺序，即分组预排好的顺序）。
 *
 * 空关键词返回全部；非空时任一命中（展示名或任一别名）即保留。
 *
 * @param actions 全量动作
 * @param keyword 用户输入（可含前后空白）
 * @returns 过滤后的动作数组
 */
export function filterActions(actions: CommandAction[], keyword: string): CommandAction[] {
  if (!keyword.trim()) return actions;
  return actions.filter(action => matchesKeyword([action.label, ...action.keywords], keyword));
}

/**
 * 计算「上/下移动一格」后的活动项索引（循环）。
 *
 * @param current 当前索引
 * @param total 列表总长度
 * @param delta 步进（+1 下移 / -1 上移）
 * @returns 新的活动索引；total<=0 时返回 0（空列表无活动项）
 */
export function nextActiveIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/**
 * 将活动索引收敛回有效范围（过滤结果变短时的兜底）。
 *
 * @param current 当前索引
 * @param total 列表总长度
 * @returns 落在 `[0, total-1]` 的索引；total<=0 时返回 0
 */
export function clampActiveIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(current, 0), total - 1);
}
