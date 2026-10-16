import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { E2E_PAGE_ORIGIN, expect } from './harness';

/**
 * 身份提示气泡的真机读数工装（`identity-hint.spec.ts` 与演示台那条共用一套量具）
 *
 * 抽出来的理由只有一个：气泡长在 **Closed Shadow DOM** 里，主世界既拿不到 `shadowRoot`
 * 也查不到内容节点，测试侧唯一的读法是经 CDP 的 pierce 视图遍历。这套读法本身有两条
 * 会静默出错的坑（见 {@link readFirst} 与 {@link refocus} 的注释），复制两份就意味着
 * 以后修一条坑要记得修两处——比几何判据那种「各用例自己写」的重复更值得合并。
 */

/** CDP pierce 视图里的节点（只声明用到的字段） */
export type CdpNode = {
  nodeId: number;
  nodeName?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
};

/**
 * `DOM.getBoxModel` 返回值里用到的部分
 *
 * 四点是 `x1,y1,x2,y2,x3,y3,x4,y4` 顺时针（左上→右上→右下→左下）：
 * 上边 y 是 `[1]`、下边 y 是 `[5]`、左边 x 是 `[0]`、右边 x 是 `[2]`。
 * 把 `[3]` 当成下边会让「翻转档」断言恒真，这套坐标只在 {@link toRect} 一处解释。
 */
type CdpBox = { content: number[]; border: number[] };

/** 视口矩形（CSS 像素，与 `getBoundingClientRect` 同一坐标系） */
export type Rect = { top: number; bottom: number; left: number; right: number };

/** 读取节点的 class 属性 */
function classOf(node: CdpNode): string {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === 'class') return attrs[i + 1] ?? '';
  }
  return '';
}

/** 按 class 整词命中（`aph-idh` 与 `aph-idh__role` 互为前缀，子串匹配会串味） */
export const byClass =
  (needle: string) =>
  (node: CdpNode): boolean =>
    classOf(node).split(/\s+/).includes(needle);

/**
 * 取一次 pierce 视图的文档根
 *
 * `depth: -1` + `pierce: true` 才会把 closed shadow root 的内容一并送回来。
 * 每次查询都重新取文档：气泡随聚焦重建，缓存 nodeId 会拿到失效句柄。
 */
async function snapshotRoot(cdp: CDPSession): Promise<CdpNode> {
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode };
  return root;
}

/** 在一棵已取到的快照里按判据收集节点 */
function collect(root: CdpNode, matcher: (node: CdpNode) => boolean): CdpNode[] {
  const out: CdpNode[] = [];
  const walk = (node: CdpNode): void => {
    if (matcher(node)) out.push(node);
    (node.children ?? []).forEach(walk);
    (node.shadowRoots ?? []).forEach(walk);
    if (node.contentDocument) walk(node.contentDocument);
  };
  walk(root);
  return out;
}

/** 在 pierce 视图里查找节点 */
export async function queryPierced(cdp: CDPSession, matcher: (node: CdpNode) => boolean): Promise<CdpNode[]> {
  return collect(await snapshotRoot(cdp), matcher);
}

/** 读一个节点的纯文本（气泡内容全是文本节点，标签一律抹掉） */
async function nodeText(cdp: CDPSession, node: CdpNode): Promise<string> {
  const { outerHTML } = (await cdp.send('DOM.getOuterHTML', { nodeId: node.nodeId })) as { outerHTML: string };
  return outerHTML.replace(/<[^>]*>/g, '').trim();
}

/**
 * 在同一次快照里「按 class 找第一个节点 + 立刻读数」
 *
 * 单独返回 `CdpNode` 供后续调用是错的：下一次 `DOM.getDocument` 会换掉整批 nodeId，
 * 而 Chrome 可能把旧 id 复用到别的节点上——那时读到的几何/文本来自不相干的元素，测试会
 * 静默地拿错读数。所以取节点与读数必须一次快照内完成，本工装没有任何跨快照的句柄。
 */
async function readFirst(cdp: CDPSession, needle: string, mode: 'rect' | 'text'): Promise<Rect | string> {
  const [node] = await queryPierced(cdp, byClass(needle));
  if (!node) throw new Error(`pierce 视图里找不到 .${needle}`);
  if (mode === 'text') return nodeText(cdp, node);
  const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as { model: CdpBox };
  return toRect(model.border);
}

/** 把盒模型的四点折成视口矩形 */
function toRect(quad: number[]): Rect {
  return { top: quad[1], bottom: quad[5], left: quad[0], right: quad[2] };
}

export const bubbleRect = (cdp: CDPSession): Promise<Rect> => readFirst(cdp, 'aph-idh', 'rect') as Promise<Rect>;
export const bubbleText = (cdp: CDPSession): Promise<string> => readFirst(cdp, 'aph-idh', 'text') as Promise<string>;
export const roleText = (cdp: CDPSession): Promise<string> =>
  readFirst(cdp, 'aph-idh__role', 'text') as Promise<string>;
export const buttonRect = (cdp: CDPSession, variant: 'ghost' | 'primary'): Promise<Rect> =>
  readFirst(cdp, `aph-idh__btn--${variant}`, 'rect') as Promise<Rect>;

/** 收起只清内容、保留宿主，所以判「有没有提示」数的是气泡而不是宿主 */
export const bubbleCount = async (cdp: CDPSession): Promise<number> =>
  (await queryPierced(cdp, byClass('aph-idh'))).length;

/**
 * 一次快照同时读「有几枚气泡」与「第一枚的角色词」
 *
 * 演示台要逐字段扫五十多行账本，分两样读就是每行两趟 `DOM.getDocument`——而那是本链路上最贵的
 * 一次往返（整文档 + 全部 shadow root）。合成一趟既把预算砍半，也让这两个读数天然来自同一快照，
 * 不存在「数的时候有、读词的时候已经收了」这种跨快照错读。
 *
 * 没有气泡时角色词为空串，**不是** `null`：调用方拿它去 `toMatch(文案正则)`，空串必然不匹配，
 * 于是「该出提示却没出」和「出了但角色不对」都归成同一条可读的红灯。
 */
export async function hintState(cdp: CDPSession): Promise<{ count: number; role: string }> {
  const root = await snapshotRoot(cdp);
  const bubbles = collect(root, byClass('aph-idh'));
  const [roleNode] = collect(root, byClass('aph-idh__role'));
  return { count: bubbles.length, role: bubbles.length === 0 || !roleNode ? '' : await nodeText(cdp, roleNode) };
}

/**
 * 聚焦某个字段并读一次提示状态（不轮询）
 *
 * 只用于**已经过就绪门**的逐行扫描：`focusin` 上的判定与建泡都是同步的，撤焦点再回来之后
 * 状态即已落定。真正确保内容脚本已挂载的是扫描开始前那一道门（见各 spec 的 `focusUntilHint`），
 * 顺序不能反——否则第一轮读数会把「脚本还没到」读成「这框不该出提示」。
 */
export async function focusAndReadState(
  page: Page,
  cdp: CDPSession,
  id: string,
): Promise<{ count: number; role: string }> {
  await refocus(page, id);
  return hintState(cdp);
}

/** 页面里某个元素的视口矩形（主世界坐标，与 CDP 盒模型同一坐标系） */
export function fieldRect(page: Page, id: string): Promise<Rect> {
  return page.evaluate(targetId => {
    const box = document.getElementById(targetId)?.getBoundingClientRect();
    if (!box) throw new Error(`页面上找不到 #${targetId}`);
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  }, id);
}

/**
 * 快速填充那把钥匙当前的可见矩形，不可见时为 `null`
 *
 * 让位判据挡掉身份提示的前提，是同一框确实归了钥匙——这个前提只有真浏览器量得到，而钥匙
 * 和气泡一样长在 closed shadow 里，因此同样只能走 pierce 视图。可见性判据取组件自己那枚
 * `visible` class（样式表里 `.aph-trigger{display:none}` / `.visible{display:inline-flex}`），
 * 它比盒模型更直接，也不会把「节点常驻但藏着」读成「有钥匙」。
 */
export async function keyRect(cdp: CDPSession): Promise<Rect | null> {
  const root = await snapshotRoot(cdp);
  const [node] = collect(root, byClass('aph-trigger'));
  if (!node || !classOf(node).split(/\s+/).includes('visible')) return null;
  const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as { model: CdpBox };
  return toRect(model.border);
}

/**
 * 钥匙此刻是否正钉在指定字段上
 *
 * 只判「有没有钥匙」是不够的：图标是单例、按 `position: fixed` 落位，上一框遗留的可见状态
 * 一样能读出「有」。所以要再核一次几何归属——图标按 `rect.right - 22 - offset` 摆放，中心必须
 * 落在这框的矩形里（放宽 4px：字段高度小于 22 时垂直居中的 `top` 会略微上溢）。
 */
export async function keyAnchoredTo(page: Page, cdp: CDPSession, id: string): Promise<boolean> {
  const [field, key] = await Promise.all([fieldRect(page, id), keyRect(cdp)]);
  if (!key) return false;
  const center = { x: (key.left + key.right) / 2, y: (key.top + key.bottom) / 2 };
  return (
    center.x >= field.left - 4 &&
    center.x <= field.right + 4 &&
    center.y >= field.top - 4 &&
    center.y <= field.bottom + 4
  );
}

/**
 * 派发一次真实的 `focusin`
 *
 * `focus()` 打在**已经聚焦**的元素上不派发任何焦点事件，而气泡收起的四条路径里有三条
 * （Esc、点「收起」、走到无语义字段）都不动焦点——直接再 `focus()` 会空转，表现为
 * 「等不到提示」而不是「提示没重建」。所以每一轮都先撤焦点再回来，等价于用户 Tab 走又Tab 回。
 */
export function refocus(page: Page, id: string): Promise<unknown> {
  return page.evaluate(targetId => {
    const el = document.getElementById(targetId) as HTMLElement | null;
    el?.blur();
    el?.focus();
  }, id);
}

/**
 * 聚焦到某字段并等气泡落地
 *
 * 反复「撤焦点 + 回焦点」直到 pierce 视图读到恰好一枚气泡：内容脚本晚到时要再打一次事件；
 * `showIdentityHint` 对「同字段同角色」幂等，重复聚焦不会叠出第二枚。
 */
export async function focusUntilHint(cdp: CDPSession, page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await refocus(page, id);
        return bubbleCount(cdp);
      },
      { message: `聚焦 #${id} 之后没有出现身份提示`, timeout: 25_000 },
    )
    .toBe(1);
}

/** 聚焦并等气泡收起（用于「失焦即收」与开关切换之间的分隔） */
export async function blurUntilGone(page: Page, cdp: CDPSession, id: string): Promise<void> {
  await page.evaluate(targetId => (document.getElementById(targetId) as HTMLElement | null)?.blur(), id);
  await expect.poll(() => bubbleCount(cdp), { message: '失焦后气泡没收起' }).toBe(0);
}

/**
 * 等页面字段检测落到完成态再开始逐行扫描
 *
 * 让位判据（`shouldShowSidePanel`）要读 `usernameFields` / `passwordFields` 这些检测产物，
 * 而 `LoginFormAnalyzer` 把每个框的**首次**答案缓存在 `WeakMap` 里、只在重新检测时清。于是同一个框
 * 第一次被问是在检测跑完前还是后，会让它在整轮扫描里稳定地「出提示」或「不出」——实测演示台
 * 区块 A 的邮箱框就在两种读数之间翻转过。逐行账本量的是「这一框该不该出」，所以必须先把检测
 * 推到完成态，否则红的是量具而不是功能。
 *
 * 落定信号取「登录区的用户名框上真的出现了钥匙」：钥匙的出现以 `shouldShowSidePanel` 为真为前提，
 * 而那正是「检测已把用户名 + 口令对收进字段集」的直接读数，比睡固定时长可靠。
 */
export async function focusUntilKey(page: Page, cdp: CDPSession, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await refocus(page, id);
        return keyAnchoredTo(page, cdp, id);
      },
      { message: `聚焦 #${id} 之后没有出现快速填充钥匙 = 字段检测还没落定`, timeout: 25_000 },
    )
    .toBe(true);
}

/**
 * 打开一页表单并接好 CDP
 *
 * 页面由 `route.fulfill` 直接给出，不出网、不依赖 DNS，域名取 `*.e2e.test` 保留域。
 * `html` 可以是只含字段的片段，也可以是整份文档（演示台走的是后者，见 `pathName` 参数）。
 */
export async function openFormPage(
  extContext: BrowserContext,
  html: string,
  pathName = '/identity-hint',
): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await extContext.newPage();
  await page.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(`${E2E_PAGE_ORIGIN}${pathName}`);
  const cdp = await extContext.newCDPSession(page);
  await cdp.send('DOM.enable');
  return { page, cdp };
}
