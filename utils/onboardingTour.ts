/**
 * 新手引导（聚光引导）纯逻辑层
 *
 * 只做两件事，且都不碰 DOM：
 * 1. **剧本**（{@link TOUR_STEPS}）——步骤顺序、锚点键名与期望方位，是引导的唯一真源；
 * 2. **几何**（{@link expandToSpot} / {@link resolvePlacement}）——把「锚点矩形 + 卡片尺寸 +
 *    视口尺寸」算成「聚光框位置 + 卡片落点」。
 *
 * 单列成 `utils/` 而非留在 composable，是因为 vitest 固定 `environment: 'node'`，
 * 只有不依赖 DOM 的部分可被直接断言；方位翻转与越界收口这类分支一旦绑上
 * `getBoundingClientRect()`，就只能靠人眼在浏览器里逐个试。
 *
 * @module utils/onboardingTour
 */

/** 引导步骤期望的卡片方位；`center` 表示无锚点、卡片居中 */
export type TourPlacementSide = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** 视口坐标系下的矩形（与 `DOMRect` 的可取字段对齐，便于直接传入） */
export interface TourRectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 聚光框：锚点外扩后的矩形 + 圆角 */
export interface TourSpot extends TourRectLike {
  /** 圆角半径 */
  radius: number;
}

/** 卡片尺寸（高度需渲染后才能测得，故由调用方传入） */
export interface TourCardSize {
  width: number;
  height: number;
}

/** 视口尺寸 */
export interface TourViewport {
  width: number;
  height: number;
}

/** 卡片落点计算结果 */
export interface TourPlacement {
  /** 实际采用的方位（与请求不一致时说明发生了翻转） */
  side: TourPlacementSide;
  top: number;
  left: number;
}

/** 剧本中的单个步骤 */
export interface TourStep {
  /**
   * 步骤标识，同时是 i18n 键的中段
   *
   * 文案键固定推导为 `onboarding.{id}.title` / `onboarding.{id}.desc`（可选
   * `onboarding.{id}.tip`），因此增删步骤只需改本数组与两份语言包，
   * 由 `tests/utils/onboardingTour.test.ts` 逐条校验中英齐全。
   */
  id: string;
  /**
   * 锚点键名，对应页面上 `[data-tour="…"]` 元素
   *
   * `null` 表示无锚点（欢迎步整屏居中）。非 `null` 时若该元素不在 DOM 中，
   * 本步骤在开场前被整体剔除——所以互斥的界面状态（空库引导卡 / 搜索筛选栏）
   * 各写一步即可，运行时自然只留一条。
   */
  anchor: string | null;
  /** 期望方位；放不下时按 {@link SIDE_FALLBACK_ORDER} 翻转 */
  prefer: TourPlacementSide;
  /** 是否带第三行提示（决定 i18n 守卫要不要校验该步骤的 `tip` 文案） */
  hasTip?: boolean;
}

/** 聚光框相对锚点的外扩间距（px） */
export const SPOT_PADDING = 10;

/** 聚光框圆角上限（px）；矮锚点取其半高，避免圆角吃掉整条边 */
export const SPOT_RADIUS = 12;

/** 卡片与聚光框的间距（px） */
export const CARD_GAP = 18;

/** 卡片与视口边缘的最小留白（px） */
export const VIEWPORT_PADDING = 16;

/** 卡片宽度（px）；高度不固定，由组件渲染后回传 */
export const CARD_WIDTH = 340;

/**
 * 剧本
 *
 * 顺序即用户旅程：先讲「东西在哪、为什么安全」，再落到「加第一条」，
 * 然后是日常会用到的检索、导入、自动化与体检，最后收尾在个性化。
 * `empty` 与 `search` 互斥（空库时前者存在、有数据时后者存在），
 * 由锚点存在性自动二选一。
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', anchor: null, prefer: 'center' },
  { id: 'add', anchor: 'add', prefer: 'bottom', hasTip: true },
  { id: 'empty', anchor: 'empty', prefer: 'top' },
  { id: 'search', anchor: 'search', prefer: 'bottom' },
  { id: 'data', anchor: 'data', prefer: 'bottom', hasTip: true },
  { id: 'settings', anchor: 'settings', prefer: 'bottom' },
  { id: 'health', anchor: 'health', prefer: 'bottom' },
  { id: 'personalize', anchor: 'personalize', prefer: 'top' },
];

/**
 * 翻转顺序：同轴对侧优先，再退到横轴，最后强制回原方位并收口
 *
 * 顶部工具栏的按钮被选中时最常见的是「下方空间不足」，故对侧（top）
 * 比横轴更值得先试；横轴留到最后是因为把卡片甩到按钮左右两侧都会离正文太远。
 */
const SIDE_FALLBACK_ORDER: Record<TourPlacementSide, TourPlacementSide[]> = {
  bottom: ['bottom', 'top', 'right', 'left'],
  top: ['top', 'bottom', 'right', 'left'],
  right: ['right', 'left', 'bottom', 'top'],
  left: ['left', 'right', 'bottom', 'top'],
  center: ['center'],
};

/**
 * 把锚点矩形外扩成聚光框
 *
 * 圆角取 `min(SPOT_RADIUS, 短边 / 2)`：工具栏里的图标按钮高度不足 32px，
 * 固定 12px 圆角会让框看起来像个胶囊，按短边收一半才能保持「圆角矩形」的读感。
 *
 * @param rect 锚点视口矩形
 * @param padding 外扩间距，默认 {@link SPOT_PADDING}
 * @returns 聚光框
 */
export function expandToSpot(rect: TourRectLike, padding = SPOT_PADDING): TourSpot {
  const width = Math.max(0, rect.width) + padding * 2;
  const height = Math.max(0, rect.height) + padding * 2;
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width,
    height,
    radius: Math.min(SPOT_RADIUS, Math.min(width, height) / 2),
  };
}

/**
 * 按方位算出卡片的原始落点（不做越界处理）
 *
 * @param spot 聚光框
 * @param card 卡片尺寸
 * @param side 方位（不含 `center`）
 * @returns 卡片左上角坐标
 */
function anchorToSide(
  spot: TourSpot,
  card: TourCardSize,
  side: Exclude<TourPlacementSide, 'center'>,
): { top: number; left: number } {
  switch (side) {
    case 'bottom':
      return { top: spot.top + spot.height + CARD_GAP, left: spot.left };
    case 'top':
      return { top: spot.top - CARD_GAP - card.height, left: spot.left };
    case 'right':
      return { top: spot.top, left: spot.left + spot.width + CARD_GAP };
    default:
      return { top: spot.top, left: spot.left - CARD_GAP - card.width };
  }
}

/** 完整落在视口安全区内（无需收口）即为「放得下」 */
function fitsWithin(left: number, top: number, card: TourCardSize, viewport: TourViewport): boolean {
  return (
    left >= VIEWPORT_PADDING &&
    top >= VIEWPORT_PADDING &&
    left + card.width <= viewport.width - VIEWPORT_PADDING &&
    top + card.height <= viewport.height - VIEWPORT_PADDING
  );
}

/** 把坐标收进视口安全区；卡片比视口还高时贴安全区上沿，保证头部可见 */
function clampToViewport(
  left: number,
  top: number,
  card: TourCardSize,
  viewport: TourViewport,
): { top: number; left: number } {
  const maxLeft = Math.max(VIEWPORT_PADDING, viewport.width - card.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewport.height - card.height - VIEWPORT_PADDING);
  return {
    left: Math.min(Math.max(left, VIEWPORT_PADDING), maxLeft),
    top: Math.min(Math.max(top, VIEWPORT_PADDING), maxTop),
  };
}

/**
 * 求解卡片落点
 *
 * 依次尝试 {@link SIDE_FALLBACK_ORDER}，取第一个「完整放得下」的方位；
 * 全都放不下时退回原方位并收进视口——此时卡片可能与聚光框轻微重叠，
 * 但比把它整块推出屏幕好，且重叠不影响锚点可见（框只被压住一部分）。
 *
 * `spot` 为 `null` 表示无锚点步，直接返回 `center`，由组件用 CSS 居中，
 * 因此调用方在 `center` 分支拿不到 top/left（无需计算）。
 *
 * @param spot 聚光框；无锚点时为 null
 * @param card 卡片尺寸
 * @param viewport 视口尺寸
 * @param prefer 期望方位
 * @returns 实际方位与左上角坐标（`center` 时坐标为 0）
 */
export function resolvePlacement(
  spot: TourSpot | null,
  card: TourCardSize,
  viewport: TourViewport,
  prefer: TourPlacementSide,
): TourPlacement {
  if (!spot || prefer === 'center') return { side: 'center', top: 0, left: 0 };

  for (const side of SIDE_FALLBACK_ORDER[prefer]) {
    const { top, left } = anchorToSide(spot, card, side as Exclude<TourPlacementSide, 'center'>);
    if (fitsWithin(left, top, card, viewport)) return { side, top, left };
  }

  const fallbackSide = (SIDE_FALLBACK_ORDER[prefer][0] ?? prefer) as Exclude<TourPlacementSide, 'center'>;
  const raw = anchorToSide(spot, card, fallbackSide);
  return { side: fallbackSide, ...clampToViewport(raw.left, raw.top, card, viewport) };
}

/**
 * 按锚点存在性裁剪剧本
 *
 * 在引导开场那一刻取一次快照，之后步内序号恒定；若逐帧重算，
 * 用户在引导中途加了第一条账号就会让 `empty` 步消失、当前索引错位。
 *
 * @param steps 完整剧本
 * @param hasAnchor 判定某锚点当前是否可见（`anchor` 为 null 时不会被调用）
 * @returns 裁剪后的剧本
 */
export function pickSteps(steps: readonly TourStep[], hasAnchor: (anchor: string) => boolean): TourStep[] {
  return steps.filter(step => step.anchor === null || hasAnchor(step.anchor));
}

/**
 * 组装某步骤的 i18n 键
 *
 * @param id 步骤标识
 * @param part 文案部位
 * @returns 形如 `onboarding.add.desc` 的键名
 */
export function tourKey(id: string, part: 'title' | 'desc' | 'tip'): string {
  return `onboarding.${id}.${part}`;
}
