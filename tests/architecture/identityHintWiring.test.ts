/**
 * 身份库召唤提示（形态一）的跨文件接线守卫
 *
 * 这条链跨 content / background / options 三个文档，而三个上下文各自的可测部分都已有行为级
 * 回归（`identityHint.test.ts`、`formDetector.identityHint.test.ts`、`senderValidation.test.ts`、
 * `useRuntimeMessageHandler.identityVault.test.ts`）。本文件只守**行为测试看不见的那一层**：
 * 接线点是否还挂在对方的插座上，以及明文出口是否还是那一个。这类漂移不会产生红灯，
 * 只会让功能静默消失（页面照常出提示，点了按钮什么也不发生）或静默变宽（取值通道多一条）。
 *
 * 各条守一个真实漂移方向：
 * 1. Options 侧必须把回调接到 `useRuntimeMessageHandler` 的选项上；漏接时后台照收消息，
 *    但页面侧按钮成为死点击。
 * 2. 身份库弹窗的可打开路径必须只有复验门槛那一处；新入口直接置 `true` 等于绕过三档复验。
 * 3. 由提示打开时，类别筛选与预填搜索词都必须排在复验之后；写在之前会让「取消复验」
 *    留下一副莫名少一批条目、检索框还带着别人名字的抽屉。
 * 4. 页面侧模块只允许一条取值通道（`piiClassifier.selfNameValueNear`）、只在点击那一刻调用，
 *    且不得就地读 `.value`、不得发页面 URL——这条是隐私承诺，单测只证了 canary，
 *    这里按整个模块的文本兜网。
 * 5. 搜索词在两处边界（后台、选项页）各自收口，且必须复用同一个 `normalizeSearchKeyword`；
 *    任何一侧改用本地裁剪，64 字上限就有了第二份真源并很快漂移。
 * 6. 两个标签里只有角色可以进日志：后台那条分支整条不写日志（一行都不许有），选项页只留一行且不带出词值——
 *    「逐行不含 keyword」在零行分支上是空真，所以「有没有行可查」本身也是判据。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const IDENTITY_HINT = 'entrypoints/content/IdentityHint.ts';
const OPTIONS_APP = 'entrypoints/options/App.vue';
const FORM_DETECTOR = 'entrypoints/content/FormDetector.ts';
const MESSAGE_ROUTER = 'entrypoints/background/messageRouter.ts';
const MESSAGE_HANDLER = 'composables/useRuntimeMessageHandler.ts';

/** 「打开身份库」的唯一门槛函数与其弹窗可见态 */
const GATE_FN = 'openIdentityVaultWithVerify';
const DIALOG_VISIBLE = 'showIdentityVaultDialog.value = true';

/** 跨入口指令名，两个收口点按它切分支 */
const MSG = 'OPEN_OPTIONS_AND_IDENTITY';

/**
 * 两个收口点各自的分支起始串
 *
 * 不能只按指令名切：后台文件里它的第一个出现位置是 `EXTENSION_CONTEXT_COMMANDS` 白名单，
 * 从那里切出的窗口与本分支无关，会让下面的收口判据读错段落。
 */
const BRANCH_START: Record<string, string> = {
  [MESSAGE_ROUTER]: `case MessageType.${MSG}: {`,
  [MESSAGE_HANDLER]: `else if (message.type === MessageType.${MSG}) {`,
};

/**
 * 切出源码里某条指令分支的文本窗口（到下一条 `case` / `else if (message.type` 为止）
 *
 * 守卫按分支切而不是全文匹配，是为了不让「另一条通道里也有 normalizeSearchKeyword」
 * 冒充本通道的收口——全文 `toContain` 会为此静默放行。
 */
function branchOf(source: string, branchStart: string): string {
  const start = source.indexOf(branchStart);
  expect(start, `守卫判据落空：源码里找不到分支起始串 ${branchStart}`).toBeGreaterThan(-1);
  const rest = source.slice(start + branchStart.length);
  const next = rest.search(/\n\s*(?:case |(?:\} else if|else if) \(message\.type)/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('身份提示的跨上下文接线', () => {
  const optionsApp = readSource(OPTIONS_APP);
  const identityHint = readSource(IDENTITY_HINT);

  it('扫描面读到了被测源文件（守卫不得静默空跑）', () => {
    for (const file of [IDENTITY_HINT, OPTIONS_APP, FORM_DETECTOR, MESSAGE_ROUTER, MESSAGE_HANDLER]) {
      expect(readSource(file).length).toBeGreaterThan(0);
    }
    // 正向对照：门槛函数存在，且弹窗可见态真的写在它函数体内
    expect(optionsApp).toContain(`const ${GATE_FN} = async`);
    expect(optionsApp).toContain(DIALOG_VISIBLE);
  });

  it('Options 把「由提示打开身份库」接到 runtime 消息处理的选项上', () => {
    const callIndex = optionsApp.indexOf('useRuntimeMessageHandler({');
    expect(callIndex, 'App.vue 不再以对象参数调用 useRuntimeMessageHandler：判据需重新确认').toBeGreaterThan(-1);
    const optionsBlock = optionsApp.slice(callIndex, callIndex + 1200);
    expect(optionsBlock).toContain('openIdentityVault: openIdentityVaultFromPage');
  });

  it('身份库弹窗的可见态只有门槛函数一处能置真（新增入口不得绕过三档复验）', () => {
    const sites = [...optionsApp.matchAll(new RegExp(DIALOG_VISIBLE.replace(/\./g, '\\.'), 'g'))];
    expect(sites, '出现第二处直接打开身份库弹窗的代码：复验门槛被绕过').toHaveLength(1);

    // 唯一可见态必须排在复验调用之后：门槛函数一旦被拆走判定，这条链就变成「直接开抽屉」
    const gateIndex = optionsApp.indexOf(`const ${GATE_FN} = async`);
    const siteIndex = sites[0].index as number;
    const body = optionsApp.slice(gateIndex, siteIndex);
    expect(body).toContain('shouldVerifyIdentityVault(');
    expect(body).toContain('promptAndVerifyMasterPassword(');
  });

  it('由提示打开时，类别筛选与预填搜索词都排在复验通过之后', () => {
    const fromPage = optionsApp.slice(optionsApp.indexOf('const openIdentityVaultFromPage'));
    const thenWindow = fromPage.slice(0, fromPage.indexOf('};'));
    // 词必须作为参数交给门槛函数预填，不得在门槛外直接写检索框
    expect(thenWindow).toContain(`void ${GATE_FN}(keyword)`);
    expect(thenWindow).not.toContain('identityVault.keyword.value');
    // 门槛未通过（用户取消复验）时不得留下筛选态
    expect(thenWindow).toMatch(/if\s*\(\s*passed\s*&&\s*role\s*\)/);
    expect(thenWindow).not.toContain(DIALOG_VISIBLE);
  });

  it('页面侧只有一条具名取值通道，且只在点击那一刻调用', () => {
    // 取值即扩大明文存活上下文：本模块不得出现任何 `.value` 读取，也不得自己读库内结构
    expect(identityHint).not.toMatch(/\.value\b/);
    expect(identityHint).not.toMatch(/location\.(href|search)|document\.URL|document\.referrer/);
    expect(identityHint).not.toMatch(/IdentityEntry|IdentityPayload|identityCrud|decryptIdentity/);
    // 唯一通道：调用点全模块只许出现一次，且必须落在「从身份库选择」按钮的 click 回调里
    // （落在展示路径 = 聚焦期间就把明文读进了闭包，等于把存活时间从一次消息拉长到整段聚焦）
    expect([...identityHint.matchAll(/selfNameValueNear\(/g)], '取值通道被复制成多处，须逐个确认新通道').toHaveLength(
      1,
    );
    const clickWindow = identityHint.slice(identityHint.indexOf("pick.addEventListener('click'"));
    expect(clickWindow.slice(0, clickWindow.indexOf('});'))).toContain('selfNameValueNear(');
  });

  it('出口只有两个标签，空白搜索词不写出空串键', () => {
    const payload = identityHint.slice(identityHint.indexOf('function openIdentityVault'));
    expect(payload).toContain('data: keyword ? { role, keyword } : { role }');
  });

  it('指令仍在「只接受扩展内部来源」的白名单里，后台与选项页各自复用同一个收口', () => {
    // 移出白名单等于把这条深链对外部通道敞开：页面侧可自报角色与姓名直接驱动管理页。
    // 判据只吃数组字面量那一段——用「文件里某处还有这个名字」当证据会被下面的 case 冒充。
    const routerSource = readSource(MESSAGE_ROUTER);
    const listStart = routerSource.indexOf('export const EXTENSION_CONTEXT_COMMANDS');
    expect(listStart, '白名单常量改名或移除，本条判据需重新确认').toBeGreaterThan(-1);
    expect(routerSource.slice(listStart, routerSource.indexOf('];', listStart))).toContain(`MessageType.${MSG}`);
    for (const file of [MESSAGE_ROUTER, MESSAGE_HANDLER]) {
      const branch = branchOf(readSource(file), BRANCH_START[file]);
      expect(branch, `${file} 的身份库分支不再收口搜索词：64 字上限出现第二份真源或彻底失守`).toContain(
        'normalizeSearchKeyword(',
      );
      expect(branch).toContain('normalizeIdentityHintRole(');
      // 降级口径：角色不合法时不许只让词那一半穿透
      expect(branch).toMatch(/role\s*\?/);
    }
  });

  it('姓名只作筛选词：后台分支整条不写日志，选项页那条日志行不带出词值', () => {
    const routerBranch = branchOf(readSource(MESSAGE_ROUTER), BRANCH_START[MESSAGE_ROUTER]);
    const handlerBranch = branchOf(readSource(MESSAGE_HANDLER), BRANCH_START[MESSAGE_HANDLER]);
    // 后台分支的载荷整包来自页面自报，这一侧刻意一条日志都不写。原写法「遍历日志行、逐行不含
    // keyword」在这条分支上是**空真**（零行 ⇒ 循环零次 ⇒ 恒绿），所以把「没有日志行」本身钉成判据：
    // 哪天有人往这条分支补一行带取值的 debug，这里会红，而不是静默通过。
    expect(
      [...routerBranch.matchAll(/logger\./g)],
      '后台身份库分支新写了日志：该分支的 role 与 keyword 都是页面自报的不可信输入，整条分支不进日志',
    ).toHaveLength(0);
    const handlerLogs = handlerBranch.split('\n').filter(line => line.includes('logger.'));
    // 选项页这一侧是有日志的（只记角色），先证「确有行可查」再逐行判——又是防「空集合当证据」
    expect(handlerLogs, '选项页身份库分支的日志行消失或变成多行：本条判据会退化成空跑，须重新确认').toHaveLength(1);
    for (const line of handlerLogs) {
      expect(line, '选项页的日志行带出了搜索词：姓名是 PII，不得入日志').not.toMatch(/keyword/i);
    }
  });
});
