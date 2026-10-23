/**
 * 检索首个命中的定位落点
 *
 * 「搜到了一格，但它在折叠线以下」在这条链路上有三种成因，落点必须各自答对：
 * - 单张卡片按字段逐行铺开（`el-descriptions :column="1"`），比列表滚动区（55vh）更高，
 *   命中的那一格常落在卡片下部——即使容器停在顶部也看不见；
 * - 弹窗未设 `destroy-on-close`，列表节点跨次打开常驻，上一次的滚动偏移会留到这一次；
 * - 深链（身份提示 → 复验 → 预填词）把用户送到的是「筛好的列表」，但他要看的是那一个格。
 *
 * 所以落点取**第一张结果卡内文档序最前的命中节点**，而不是卡片本身：卡片顶部是用户已经
 * 知道的位置，需要被带进视野的始终是那一格。命中节点有两种形态——严格检索的强调分段
 * （`.search-hit`，标题与字段值、字段名都走高亮），与「把这句话认成某一格」放宽态的
 * 字段名命中（`.identity-field__name-hit`），二者都要认。
 *
 * 卡内取不到命中节点时退回卡片头部，有两种成因，都不该跳去后面的卡：
 * - 折叠卡（`.is-collapsed`）的字段区是 `v-if`，节点根本不在 DOM 里。按既定取舍**不**自动
 *   展开用户显式收起的卡片，要不要展开留给用户；
 * - 机密字段（证件号、卡号）在掩码态渲染的是纯文本掩码，不参与高亮，值命中的那一格因此没有
 *   可定位的节点——此时值本身也还看不见，滚到卡头是这套展示语义下唯一诚实的落点。
 */

/** 卡片内可定位的命中节点：严格态的强调分段 + 放宽态的整串字段名 */
const SEARCH_HIT_SELECTOR = '.search-hit, .identity-field__name-hit';

/**
 * 找出应当滚动进入视野的元素
 *
 * @param container 列表滚动容器（`.identity-list`），未挂载时为 null
 * @returns 第一张结果卡内的首个命中节点；卡内取不到节点（折叠卡、掩码态的机密命中）时退为卡片
 *          本身；列表尚未渲染出结果卡时返回 null
 */
export function findSearchRevealTarget(container: HTMLElement | null): HTMLElement | null {
  if (!container) return null;
  const firstCard = container.querySelector<HTMLElement>('.identity-card');
  if (!firstCard) return null;
  return firstCard.querySelector<HTMLElement>(SEARCH_HIT_SELECTOR) ?? firstCard;
}
