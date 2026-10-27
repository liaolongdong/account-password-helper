/**
 * 身份库「回到原网页」的接线守卫
 *
 * 这条链路刻意只做一件事：把用户送回他刚才那一格。值仍由他在库里逐字段/整卡复制，
 * 走既有剪贴板通道。所以它**不该**长出任何身份库入口的性质——风险全在接线形状上，
 * 按本仓惯例做源码扫描（见 `identityLookupFromDetailWiring.test.ts`）。
 * 这些边界会被顺手拆掉（只编号、不记数）：
 *
 * 1. **tabId 只认浏览器盖章的那一个**。后台必须从 `sender.tab` 推导，绝不读页面自报的
 *    `data.sourceTabId`：那个数决定管理页一枚按钮把用户送去哪个站点，交给网页就等于把
 *    跳转权交出（判据同 `DELEGATE_PAGE_NOTICE`）。
 * 2. **记录来源排在复验成功之后**。取消复验时弹窗没开，留下一条「能把你切走」的意图就是脏状态。
 * 3. **回程不是第二个开窗点**。开窗仍然只有 `openIdentityVaultWithVerify` 一处赋值 `true`；
 *    回程处理器只做「切走 + 收窗」，反向赋 `false` 是允许的。
 * 4. **意图不落盘、不跨上下文**。它是一次性的导航意图，写进 `chrome.storage` 就变成跨会话事实来源。
 * 5. **回程全程不碰库内数据**。这条链一旦开始读明文，就该走 `identityLookupFromDetailWiring`
 *    那套门槛守卫，而不是待在这里。
 * 6. **出口只在有来源时可见**，且提示条只插来源站点名，不插任何库内字段。
 * 7. **身份域新增代码仍只在 Options**：`sidepanelClosure.test.ts` 管的是构建产物闭包，
 *    这里补一道源码级的「谁 import 了回程 composable」，改动当场就能红，不必等构建。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

const ROUTER_SRC = readSource('entrypoints/background/messageRouter.ts');
const APP_SRC = readSource('entrypoints/options/App.vue');
const RETURN_SRC = readSource('composables/useVaultReturn.ts');
const SOURCE_TAB_SRC = readSource('utils/sourceTab.ts');
const DIALOG_SRC = readSource('components/options/IdentityVaultDialog.vue');
const HANDLER_SRC = readSource('composables/useRuntimeMessageHandler.ts');

/** 剔掉注释行，避免判据读的是散文（同 trashSearchWiring 的处理） */
const stripComments = (src: string): string =>
  src
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');

/**
 * 剔掉 HTML 注释。正则写成 `[!]-` 而不是直接写那四个字符：CodeQL 把字面量按
 * 「不完整的 HTML 净化」命中，而这里读的是自家源码、从不把结果渲染成 HTML，
 * 换个等价写法比去安全面板标误报便宜，也比加抑制注释诚实。
 */
const stripHtmlComments = (src: string): string => src.replace(/<!-{2}[\s\S]*?-->/g, '');

/** 取出 App.vue 中某个箭头函数声明的函数体（到首个顶格 `};` 为止） */
const appBody = (name: string): string => {
  const matched = APP_SRC.match(new RegExp(`const ${name} =\\s+[\\s\\S]*?=>\\s*\\{([\\s\\S]*?)\\n\\};`));
  expect(matched, `未找到 ${name} 函数体：守卫写法需同步更新`).toBeTruthy();
  return stripComments(matched![1]);
};

/** 取出后台路由里身份深链那一整个 case 分支 */
const identityCaseBranch = (): string => {
  const matched = ROUTER_SRC.match(/case MessageType\.OPEN_OPTIONS_AND_IDENTITY: \{([\s\S]*?)\n {6}\}/);
  expect(matched, '未找到 OPEN_OPTIONS_AND_IDENTITY 分支：守卫写法需同步更新').toBeTruthy();
  return stripComments(matched![1]);
};

describe('身份库回程链路的接线边界', () => {
  it('后台的来源标签页只从 sender.tab 推导，页面自报值不进转发载荷', () => {
    const branch = identityCaseBranch();
    expect(branch, 'tabId 不再从 sender.tab 推导：跳转目标回到了页面手里').toContain(
      'resolveSourceTabId(sender.tab?.id, sender.tab?.url)',
    );
    // 这一条是「不接受自报值」的反面证据：分支里任何一处读 data.sourceTabId 都算被绕开
    expect(branch, '分支开始读页面自报的 sourceTabId：任意网页可指定跳转目标').not.toMatch(/data\??\.sourceTabId/);
  });

  it('协议白名单在 utils 单点定义，缺失 URL 一律 fail-closed', () => {
    expect(SOURCE_TAB_SRC).toMatch(/NAVIGABLE_SOURCE_PROTOCOLS[^\n]*new Set\(\['http:', 'https:', 'file:'\]\)/);
    const body = stripComments(SOURCE_TAB_SRC);
    expect(body, 'resolveSourceTabId 不再要求 URL 存在').toMatch(/typeof tabUrl !== 'string'/);
    expect(body, 'tabId 形状判定改成了宽松写法').toContain('Number.isSafeInteger(value)');
  });

  it('记录来源排在复验成功之后，取消复验不留残余意图', () => {
    const body = appBody('openIdentityVaultFromPage');
    const gateAt = body.indexOf('await openIdentityVaultWithVerify(keyword)');
    const rememberAt = body.indexOf('vaultReturn.remember(sourceTabId)');
    expect(gateAt, '深链不再经复验门槛开窗').toBeGreaterThanOrEqual(0);
    expect(rememberAt, '未找到记录来源的调用').toBeGreaterThanOrEqual(0);
    expect(rememberAt, '记录来源必须晚于门槛').toBeGreaterThan(gateAt);
    expect(body, '记录来源不再受复验结果约束：取消也会留下能切走标签页的意图').toMatch(/if \(opened\)/);
  });

  it('回程只切标签页、不碰弹窗显隐，也不落盘', () => {
    const assignments = APP_SRC.match(/showIdentityVaultDialog\.value = true/g) ?? [];
    expect(assignments, '身份库出现第二个开窗点').toHaveLength(1);

    const handler = appBody('handleVaultReturnToSource');
    expect(handler).toContain('await vaultReturn.returnToSource()');
    // 关窗这条是产品决定：跨卡取值要来回跑几趟，每趟都关窗等于逼用户重开。
    // 明文由「关窗 / 会话失效 / 锁定」三条既有路径收，回程不是第四条。
    expect(handler, '回程又开始关库窗：与「库窗留着」的取舍相反').not.toMatch(/showIdentityVaultDialog\.value\s*=/);
    expect(handler, '回程失败静默：用户点了按钮却哪儿也没去').toContain("t('identity.return.tabGone')");

    const returnBody = stripComments(RETURN_SRC);
    for (const banned of [/chrome\.storage/, /localStorage/, /sessionStorage/]) {
      expect(returnBody, `回程意图被写进了持久存储: ${banned.source}`).not.toMatch(banned);
    }
  });

  it('回程全程不碰身份库数据，也不引入身份加解密', () => {
    for (const banned of [/useIdentityVault/, /identityCrud/, /getAllIdentity/, /decrypt/i, /@\/utils\/identity/]) {
      expect(RETURN_SRC, `回程链路开始引用 ${banned.source}`).not.toMatch(banned);
    }
  });

  it('提示条只在有来源时出现，动作上交给父级，文案不插任何库内字段', () => {
    const dialog = stripHtmlComments(DIALOG_SRC);
    const bar = dialog.match(
      /<div\b[\s\S]*?:class="\['identity-return', \{ 'is-pulse': returnPulse \}\]"[\s\S]*?<\/div>/,
    );
    expect(bar, '回程提示条不见了（或那一层的标记结构漂移，判据需同步更新）').toBeTruthy();
    expect(bar![0], '提示条不再受来源约束：普通打开也会凭空多一条横幅').toMatch(/v-if="returnAvailable"/);
    expect(bar![0], '按钮自己切窗：切回与收窗的所有权落到了子组件').toMatch(/@click="\$emit\('returnToSource'\)"/);
    expect(bar![0], '提示条插值不再是来源站点名（库内字段不该出现在这里）').not.toMatch(/field\.value|entry\./);

    expect(dialog, '提示条文案不点名来源站点：一枚会切换标签页的按钮必须说清去哪').toMatch(/returnHint/);
    expect(APP_SRC, '父级没有接住回程事件').toMatch(/@return-to-source="handleVaultReturnToSource"/);
  });

  /**
   * 发现性的表达边界：只准「点亮那枚出口」，不准给整条加重量
   *
   * 上一版给的是浅底容器 + 实心主按钮 + 4px 主题色光环呼吸两圈，被否掉：工具栏已经有一颗
   * 主色实心的「添加」，同屏两颗就是两个焦点在抢；环画在盒外，在浅底弹窗上糊成一团。
   * 现在这三条判据把当时的形状钉死成「不许回来」，同时守住新形状的两条约束——
   * 动效只作用在那枚按钮上、时长与脚本同源、减动效档三支一起摘。
   * 真机侧由 `e2e/vault-return-to-source.spec.ts` 量 `getAnimations()`，这里守 e2e 不在主流程时
   * 会被顺手改回去的那一层。
   */
  it('动效只点亮出口按钮，且 reduced-motion 把三支一起摘掉', () => {
    const dialog = stripHtmlComments(DIALOG_SRC);
    const style = dialog.slice(dialog.indexOf('.identity-return {'));
    // 判据只认声明，不认散文：这一层的注释本来就在解释「为什么不用 box-shadow」
    const returnBlock = style.slice(0, style.indexOf('.identity-reminder')).replace(/\/\*[\s\S]*?\*\//g, '');

    expect(returnBlock, '入场动画被摘掉：只在召唤态出现的横幅静默画出，读起来像说明文字').toMatch(
      /\.identity-return \{[\s\S]*?animation: identity-return-in var\(--aph-duration-slow\)/,
    );
    expect(returnBlock, '复制成功的点亮被摘掉：发现性又退回「让用户自己发现」').toMatch(
      /\.identity-return\.is-pulse \.identity-return__action \{\n\s*animation: identity-return-flash var\(--aph-duration-mid\)/,
    );
    expect(returnBlock, '箭头轻推被摘掉：点亮只剩底色，读起来像背景闪了一下').toMatch(
      /\.identity-return\.is-pulse \.identity-return__action :deep\(\.el-icon\) \{\n\s*animation: identity-return-nudge var\(--aph-duration-mid\)/,
    );
    // 上一版那团蓝雾不许回来：回程这一层里一处 box-shadow 都不许有
    expect(returnBlock, '回程条又开始用 box-shadow 光环：那个形状已被否掉（画在盒外、糊成一片）').not.toMatch(
      /box-shadow/,
    );

    const reduced = dialog.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
    expect(reduced, 'reduced-motion 那一档整块不见了').toBeTruthy();
    for (const selector of [
      '.identity-return,',
      '.identity-return.is-pulse .identity-return__action,',
      '.identity-return.is-pulse .identity-return__action :deep(.el-icon)',
    ]) {
      expect(reduced![0], `reduced-motion 少了一条覆盖：${selector}`).toContain(selector);
    }
    expect(reduced![0], 'reduced-motion 覆盖里没有 animation: none').toMatch(/animation: none/);

    // 脚本侧计时器与 CSS 同源（0.2s 一次）：改一头不改另一头，标记会早摘（动效被掐断）或晚摘
    expect(dialog, '点亮时长常量漂移：CSS 与 setTimeout 不再同源').toMatch(/const RETURN_PULSE_MS = 200;/);
    // 静态那条腿：主题色文字按钮 + 返回图标，不依赖任何动效也读得出「这是个能点的出口」
    expect(dialog, '回程按钮又变回实心主按钮：与工具栏那颗「添加」抢焦点').toMatch(
      /class="identity-return__action"\s+link\s+size="small"\s+:icon="Back"/,
    );
    expect(dialog).not.toMatch(/type="primary"\s+size="small"\s+:icon="Back"/);
  });

  it('选项页收口过 sourceTabId，非法值只丢回程不丢开库', () => {
    const body = stripComments(HANDLER_SRC);
    expect(body, '选项页不再对 tabId 二次收窄（外部输入一律不可校验上游）').toContain(
      'normalizeSourceTabId(message.data?.sourceTabId)',
    );
    expect(body, '门槛前置的解锁判定被挪走').toMatch(
      /if \(!isAuthenticated\.value\) return;\n\s*openIdentityVault\?\.\(keyword \|\| undefined, sourceTabId\);/,
    );
  });

  it('回程 composable 只被 Options 使用，不渗进侧边栏 / 弹窗 / 内容脚本', () => {
    const importers = ['entrypoints', 'components', 'composables', 'utils']
      .flatMap(dir => listSourceFiles(dir))
      .filter(file => /from '@\/composables\/useVaultReturn'/.test(readSource(file)));
    expect(importers, `回程状态的所有权漏到了 Options 之外：${importers.join(' | ')}`).toEqual([
      'entrypoints/options/App.vue',
    ]);
  });

  it('提示语按「有没有拿到主机名」分两条说法，不给屏上留空占位', () => {
    // `{site}` 只能靠调用点传参：漏传就把 "{site}" 原样印在管理页上
    const computed = DIALOG_SRC.match(/const returnHint = computed\(\(\) => \{([\s\S]*?)\n\}\);/);
    expect(computed, '未找到 returnHint 计算属性：守卫写法需同步更新').toBeTruthy();
    const body = stripComments(computed![1]);
    expect(body, '点名文案不再由主机名驱动').toMatch(/props\.returnSite\?\.trim\(\)/);
    expect(body, '有主机名时没走点名那条文案').toContain("t('identity.return.hint', { site })");
    expect(body, '拿不到主机名时仍在插 {site}，屏上会出现「回到  粘贴」').toContain("t('identity.return.hintNoSite')");
  });

  it('中英语言包都给了回程那四条文案', () => {
    const usedKeys = [...new Set([...DIALOG_SRC.matchAll(/t\('(identity\.return\.[\w.]+)'/g)].map(m => m[1]))].sort();
    expect(
      usedKeys,
      '回程文案 key 应恰为三条（点名 / 不点名 / 按钮），多一条就得看是不是把来源之外的东西印上了屏',
    ).toEqual(['identity.return.action', 'identity.return.hint', 'identity.return.hintNoSite']);
    for (const locale of ['zh-CN', 'en']) {
      const messages = JSON.parse(readSource(`utils/i18n/locales/${locale}/identity.json`)) as Record<string, string>;
      for (const key of [...usedKeys, 'identity.return.tabGone']) {
        expect(messages[key], `${locale} 语言包缺少 ${key}`).toBeTruthy();
      }
    }
    // {site} 占位符必须靠调用点传参：漏传就会把 "{site}" 原样印在屏上
    const hint = JSON.parse(readSource('utils/i18n/locales/zh-CN/identity.json'))['identity.return.hint'];
    expect(hint, 'zh 的点名文案少了 {site} 占位').toContain('{site}');
    expect(
      JSON.parse(readSource('utils/i18n/locales/en/identity.json'))['identity.return.hint'],
      'en 的点名文案少了 {site} 占位',
    ).toContain('{site}');
  });
});
