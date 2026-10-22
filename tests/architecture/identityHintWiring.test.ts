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
 * 3. 由提示打开时，预填搜索词必须排在复验之后（写在之前会让「取消复验」留下一副检索框还带着
 *    别人名字的抽屉），且**深链不得写类别档位**——2026-10-17 改判：一条身份条目同时携带证件号、
 *    手机号等多个值，按角色预选类别会把该命中的条目筛出视野，档位恒为「全部」。
 * 4. 页面侧的取值只有一个分派点（`pickSearchKeyword`），它按角色选中两条通道之一
 *    （`piiClassifier.selfNameValueNear` 取本人姓名 / `piiClassifier.hintFieldKeyword` 取字段名），
 *    每条通道全模块只出现一次、且只在点击那一刻调用；不得就地读 `.value`、不得发页面 URL——
 *    这条是隐私承诺，单测只证了 canary，这里按整个模块的文本兜网。
 * 5. 跨入口载荷只剩搜索词一个标签：角色那一半已从契约移除，两个收口点都不许再引它；
 *    词本身必须复用同一个 `normalizeSearchKeyword`，任何一侧改用本地裁剪，64 字上限就有了
 *    第二份真源并很快漂移。
 * 6. 唯一的标签是 PII，所以后台那条分支整条不写日志（一行都不许有），选项页只留一行且不带出
 *    词值——「逐行不含 keyword」在零行分支上是空真，所以「有没有行可查」本身也是判据。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';
import { escapeRegExp } from '../helpers/escapeRegExp';

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
    // 整串按字面量匹配：只转义 `.` 会给 `+`/`(`/`$` 这类元字符留口子，
    // 常量哪天被改动就会让这条「只许一处」的判据静默数错
    const sites = [...optionsApp.matchAll(new RegExp(escapeRegExp(DIALOG_VISIBLE), 'g'))];
    expect(sites, '出现第二处直接打开身份库弹窗的代码：复验门槛被绕过').toHaveLength(1);

    // 唯一可见态必须排在复验调用之后：门槛函数一旦被拆走判定，这条链就变成「直接开抽屉」
    const gateIndex = optionsApp.indexOf(`const ${GATE_FN} = async`);
    const siteIndex = sites[0].index as number;
    const body = optionsApp.slice(gateIndex, siteIndex);
    expect(body).toContain('shouldVerifyIdentityVault(');
    expect(body).toContain('promptAndVerifyMasterPassword(');
  });

  it('由提示打开时，预填搜索词排在复验通过之后，且深链不碰类别档位', () => {
    const fromPage = optionsApp.slice(optionsApp.indexOf('const openIdentityVaultFromPage'));
    const thenWindow = fromPage.slice(0, fromPage.indexOf('};'));
    // 词必须作为参数交给门槛函数预填，不得在门槛外直接写检索框
    expect(thenWindow).toContain(`void ${GATE_FN}(keyword)`);
    expect(thenWindow).not.toContain('identityVault.keyword.value');
    expect(thenWindow).not.toContain(DIALOG_VISIBLE);
    // 反向牙齿（2026-10-17 改判）：深链一律落在「全部」档。按角色预选类别会把一条条目
    // 身上的其它值（证件号、手机号…）筛出视野，用户原话即「有些内容会搜索不到」。
    // 判据按整个文件切：档位只允许弹窗单选按钮与 composable 的 clear/reset 改动。
    expect(optionsApp, '深链又开始按角色写类别档位：单一「全部」入口契约被破').not.toMatch(
      /categoryFilter\.value\s*=[^=]/,
    );
    expect(optionsApp).not.toContain('identityCategoryForRole');
  });

  it('页面侧只有一个是取值分派点，两条通道各自一处、只在点击那一刻调用', () => {
    // 取值即扩大明文存活上下文：本模块不得出现任何 `.value` 读取，也不得自己读库内结构
    expect(identityHint).not.toMatch(/\.value\b/);
    expect(identityHint).not.toMatch(/location\.(href|search)|document\.URL|document\.referrer/);
    expect(identityHint).not.toMatch(/IdentityEntry|IdentityPayload|identityCrud|decryptIdentity/);
    // 分派器只有一份定义、一个调用点，且调用点必须落在「从身份库选择」按钮的 click 回调里
    // （落在展示路径 = 聚焦期间就把明文读进了闭包，等于把存活时间从一次消息拉长到整段聚焦）
    expect([...identityHint.matchAll(/function pickSearchKeyword\(/g)], '取值分派被复制成多份定义').toHaveLength(1);
    expect(
      [...identityHint.matchAll(/openIdentityVault\(pickSearchKeyword\(\)\)/g)],
      '取值分派出现了第二个调用点，须逐个确认',
    ).toHaveLength(1);
    const clickWindow = identityHint.slice(identityHint.indexOf("pick.addEventListener('click'"));
    expect(clickWindow.slice(0, clickWindow.indexOf('});'))).toContain('openIdentityVault(pickSearchKeyword())');

    // 两条通道各一处调用，且都写在分派器体内、由角色互斥地选中（2026-10-18 编号族补第二条：
    // 库里没有那一格，落点是用户自拟的自定义字段，于是搜索词换成「这一格叫什么」）
    for (const channel of ['selfNameValueNear', 'hintFieldKeyword']) {
      expect(
        [...identityHint.matchAll(new RegExp(`${escapeRegExp(channel)}\\(`, 'g'))],
        `取值通道 ${channel} 被复制到多处，须逐个确认新通道`,
      ).toHaveLength(1);
    }
    const dispatch = identityHint.slice(identityHint.indexOf('function pickSearchKeyword'));
    const dispatchBody = dispatch.slice(0, dispatch.indexOf('\n}'));
    expect(dispatchBody).toContain('selfNameValueNear(');
    expect(dispatchBody).toContain('hintFieldKeyword(');
    // 分派判据必须是那份「以自定义字段为落点」的角色表，不许就地写角色名（表中新增一档时这里会红）
    expect(dispatchBody).toContain('CUSTOM_FIELD_LANDING_ROLES.includes(');
  });

  it('出口只有一个标签：搜索词，空白时整包载荷缺席而不是写出空串键', () => {
    // 窗口只吃这一个函数体（到首个顶格 `}` 为止）：切片一路到尾会把下面 `showIdentityHint`
    // 的 role 形参算进来，那条反向牙齿就成了恒红。
    const start = identityHint.indexOf('function openIdentityVault');
    const payload = identityHint.slice(start, identityHint.indexOf('\n}', start));
    expect(payload).toContain('data: keyword ? { keyword } : undefined');
    // 反向牙齿：角色已从跨入口契约里移除，谁把它塞回来（旧载荷形状复活）都要在这里红
    expect(payload).not.toMatch(/\brole\b/);
  });

  it('指令仍在「只接受扩展内部来源」的白名单里，后台与选项页各自复用同一个收口', () => {
    // 移出白名单等于把这条深链对外部通道敞开：页面侧可自报姓名直接驱动管理页。
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
      // 反向牙齿：角色不再跨入口，两个收口点都不该再引它。留着就是一段没人消费的收窄，
      // 而它的存在会让「把类别预选偷偷加回来」看起来像既有逻辑的一部分。
      expect(branch, `${file} 仍在收窄页面自报的角色：深链已改判为只带搜索词`).not.toContain(
        'normalizeIdentityHintRole(',
      );
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
      '后台身份库分支新写了日志：该分支的 keyword 是页面自报的不可信输入，整条分支不进日志',
    ).toHaveLength(0);
    const handlerLogs = handlerBranch.split('\n').filter(line => line.includes('logger.'));
    // 选项页这一侧是有日志的（只记指令本身），先证「确有行可查」再逐行判——又是防「空集合当证据」
    expect(handlerLogs, '选项页身份库分支的日志行消失或变成多行：本条判据会退化成空跑，须重新确认').toHaveLength(1);
    for (const line of handlerLogs) {
      expect(line, '选项页的日志行带出了搜索词：姓名是 PII，不得入日志').not.toMatch(/keyword/i);
    }
  });
});
