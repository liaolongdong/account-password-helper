/**
 * 「详情抽屉 → 身份信息库检索」的接线守卫
 *
 * 这条跳转刻意**不做跨库关联**：用户名只当搜索词递给身份库，因此它没有数据模型可测，
 * 全部风险都落在接线形状上（按本仓惯例做源码扫描，见 `trashSearchWiring.test.ts`）。
 * 四个会被顺手拆掉的边界：
 *
 * 1. **复验门槛不可绕过**：身份库含证件号/卡号等高敏 PII，开窗只有 `openIdentityVaultWithVerify`
 *    一个入口。新增入口直接 `showIdentityVaultDialog.value = true`，就等于给「会话已解锁但人离开
 *    座位」的旁人开了一条免密通道——而这正是当初加这道门槛要防的场景。
 *    门槛现在受三档策略控制（`utils/identityVaultAccess.ts`），所以「有没有复验」不再是
 *    无条件的事实，下面另有一条守卫钉住「问不问只由 `shouldVerifyIdentityVault` 决定」的形状，
 *    以及「已复验」凭据的置位与复位时机——这三处任一失联，策略档位就名存实亡。
 * 2. **预填不提前解密、不落盘**：预填词只能进 `identityVault.keyword` 那一个 `ref`。把它塞进
 *    `load()` 之前或写进存储，都会让一个「查一下」的动作为 PII 快照延长存活期。
 * 3. **预填不串到下次打开**：靠弹窗 `@closed → teardown() → resetViewState()` 清 keyword。
 *    这条清理链断掉，用户下次从菜单正常打开身份库会看到「只剩一条结果」的空列表，且没有任何提示。
 * 4. **抽屉侧零 PII 暴露面**：抽屉只上交用户名，不引入身份库状态或身份加解密，
 *    否则密码条目的展示层就开始持有证件号。
 * 5. **策略本身不可免验修改**：档位决定「打开身份库前问不问」。若改档位不需要证明知道
 *    主密码，坐在已解锁机器前的旁人只要把它拨到「跟随有效期」，门槛自身就当场变成免验通道。
 *    故设置弹窗的保存路径必须复验，且写入配置的地方只能有它一处。
 *
 * 另附外围：空用户名不得发起跳转（否则把空白搜索词当「全部结果」打开身份库），
 * 图标按钮必须带可读标签（无障碍），以及引用的 `options.detail.*` 文案在中英文语言包都在。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const DRAWER_SRC = read('components/options/PasswordDetailDrawer.vue');
const APP_SRC = read('entrypoints/options/App.vue');
const VAULT_HOOK_SRC = read('composables/useIdentityVault.ts');
const VAULT_DIALOG_SRC = read('components/options/IdentityVaultDialog.vue');
const ACCESS_SETTING_SRC = read('components/options/IdentityVaultAccessSetting.vue');
const POLICY_SRC = read('utils/identityVaultAccess.ts');

/** 剔掉注释行，避免顺序断言读的是散文（同 trashSearchWiring 的处理） */
const stripComments = (src: string): string =>
  src
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
    .join('\n');

/** 取出某个箭头函数声明的函数体（到首个顶格 `};` 为止） */
const functionBody = (src: string, name: string): string => {
  const matched = src.match(new RegExp(`const ${name} =\\s+[\\s\\S]*?=>\\s*\\{([\\s\\S]*?)\\n\\};`));
  expect(matched, `未找到 ${name} 函数体：守卫写法需同步更新`).toBeTruthy();
  return stripComments(matched![1]);
};

/** App.vue 中的函数体 */
const appBody = (name: string): string => functionBody(APP_SRC, name);

/**
 * 取出门槛里「要不要复验」那一段条件块
 *
 * 条件化之后，光看函数体在不在已不足以说明复验还在——必须能证明这次调用确实挂在
 * `shouldVerifyIdentityVault` 为真的分支里，而不是被移出分支或干脆删掉。
 */
const verifyBranch = (gateBody: string): string => {
  const matched =
    /if \(shouldVerifyIdentityVault\(verifyPolicy, identityVaultVerifiedThisSession\)\) \{\n([\s\S]*?)\n {2}\}/.exec(
      gateBody,
    );
  expect(matched, '复验不再由 shouldVerifyIdentityVault 的条件块包裹：守卫需随实现方式更新').toBeTruthy();
  return matched![1];
};

/**
 * 取出 App.vue 中 `if (!authenticated) { … }` 的分支体
 *
 * 管理页有两处以 `!authenticated` 为条件的清理（明文缓存、身份库），按分支内的既有事实认领，
 * 避免依赖缩进或 watcher 的书写顺序。
 */
const unauthenticatedBranch = (marker: string): string => {
  const branches = [...stripComments(APP_SRC).matchAll(/if \(!authenticated\) \{\n([\s\S]*?)\n {2,}\}/g)].map(
    m => m[1],
  );
  expect(branches.length, '未在 App.vue 找到会话失效分支：守卫写法需同步更新').toBeGreaterThan(0);
  const branch = branches.find(b => b.includes(marker));
  expect(branch, `没有一处会话失效分支包含 ${marker}`).toBeTruthy();
  return branch!;
};

describe('详情抽屉到身份库的跳转接线', () => {
  it('抽屉把当前用户名作为搜索词上交，父级接住并走同一道门槛', () => {
    expect(DRAWER_SRC).toMatch(/searchIdentity:\s*\[username: string\]/);
    expect(functionBody(DRAWER_SRC, 'searchIdentity')).toMatch(/emit\('searchIdentity',\s*username\)/);
    expect(APP_SRC).toMatch(/@search-identity="onDetailSearchIdentity"/);

    const handler = appBody('onDetailSearchIdentity');
    expect(handler, '抽屉处理器不再经门槛函数开窗').toMatch(/await openIdentityVaultWithVerify\(username\)/);
    // 收起抽屉必须排在门槛通过之后：取消复验不该连带弄没用户正看着的详情
    expect(handler).toMatch(/if \(!\(await openIdentityVaultWithVerify\(username\)\)\) return;/);
    expect(handler.indexOf('showDetailDrawer.value = false')).toBeGreaterThan(
      handler.indexOf('openIdentityVaultWithVerify'),
    );
  });

  it('空用户名不发起跳转', () => {
    // 空串递过去会以「无过滤条件」打开整个身份库，等于点了个没有筛选效果的按钮
    const emitter = functionBody(DRAWER_SRC, 'searchIdentity');
    expect(emitter).toMatch(/const username = props\.entry\?\.username\.trim\(\);/);
    expect(emitter).toMatch(/if \(username\) emit\('searchIdentity', username\);/);
  });

  it('开窗只有复验门槛这一个入口，且预填排在门槛之后', () => {
    const assignments = APP_SRC.match(/showIdentityVaultDialog\.value = true/g) ?? [];
    expect(assignments, '身份库出现第二个开窗点：新增入口绕过复验即成免密通道').toHaveLength(1);

    const gate = appBody('openIdentityVaultWithVerify');
    const branch = verifyBranch(gate);
    const verifyAt = branch.indexOf('await promptAndVerifyMasterPassword(');
    const abortAt = branch.indexOf('if (!masterPassword) return false;');
    const prefillAt = gate.indexOf('identityVault.keyword.value = presetKeyword');
    const openAt = gate.indexOf('showIdentityVaultDialog.value = true');

    expect(verifyAt, '门槛不再复验主密码').toBeGreaterThanOrEqual(0);
    expect(abortAt, '复验失败不再有早退').toBeGreaterThanOrEqual(0);
    expect(prefillAt, '未找到预填语句').toBeGreaterThanOrEqual(0);
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(abortAt, '预填必须晚于「复验失败即返回」，否则取消也会把词留在内存里').toBeLessThan(prefillAt);
    expect(prefillAt, '开窗必须晚于预填，否则弹窗首帧按空关键词渲染再重排').toBeLessThan(openAt);
    expect(APP_SRC).toMatch(/const openIdentityVaultWithVerify = async \(presetKeyword = ''\): Promise<boolean>/);
    // 菜单那个既有入口仍按「不预填」调用，共用同一道门槛
    expect(APP_SRC).toMatch(/case 'identityVault':\n\s*openIdentityVaultWithVerify\(\);/);
  });

  it('问不问只由策略模块说了算，策略现读、已复验凭据只在复验成功后置位', () => {
    const gate = appBody('openIdentityVaultWithVerify');

    // 策略必须在每次开窗时现读：模块级缓存会让改档位要刷新页面才生效
    expect(gate, '门槛不再现读复验策略').toContain('await StorageUtils.getIdentityVaultAccessConfig();');
    // 判定权必须整体交给纯函数（`tests/utils/identityVaultAccess.test.ts` 测的是它的真值表）；
    // 这里钉的是两个实参的顺序与来源——写成硬编码 `true`、或把标志位与策略换位，
    // 都是「档位还在界面上、实际已经恒免验」的静默失效
    expect(gate).toContain('if (shouldVerifyIdentityVault(verifyPolicy, identityVaultVerifiedThisSession)) {');

    const branch = verifyBranch(gate);
    const verifyAt = branch.indexOf('await promptAndVerifyMasterPassword(');
    const abortAt = branch.indexOf('if (!masterPassword) return false;');
    const markAt = branch.indexOf('identityVaultVerifiedThisSession = true;');
    expect(markAt, 'perSession 档不再置位「本会话已复验」：档位等于没实现').toBeGreaterThanOrEqual(0);
    // 置位必须晚于失败早退：挪到前面，用户点一次「取消」就把门槛永久免掉了
    expect(markAt, '已复验凭据排在复验失败早退之前：取消一次即永久免验').toBeGreaterThan(abortAt);
    expect(verifyAt, '已复验凭据排在复验之前').toBeLessThan(markAt);

    // 初值必须是「没问过」，否则本文档首开即免验
    expect(APP_SRC).toMatch(/^let identityVaultVerifiedThisSession = false;$/m);
  });

  it('锁定/过期作废「本会话已复验」，perSession 不会退化成一次免验', () => {
    const branch = unauthenticatedBranch('identityVault.teardown();');
    expect(branch, '会话失效不再复位已复验凭据：门槛退化成「曾经解锁过就永久免验」').toContain(
      'identityVaultVerifiedThisSession = false;',
    );
  });

  it('改档位本身要复验主密码，设置弹窗不自带免验通道', () => {
    const save = functionBody(ACCESS_SETTING_SRC, 'handleSave');
    const verifyAt = save.indexOf('await promptAndVerifyMasterPassword(');
    const abortAt = save.indexOf('if (!masterPassword) return;');
    const writeAt = save.indexOf('saveIdentityVaultAccessConfig(');

    expect(verifyAt, '保存档位前不再复验主密码').toBeGreaterThanOrEqual(0);
    expect(abortAt, '复验取消后不再早退').toBeGreaterThanOrEqual(0);
    expect(writeAt, '未找到写配置的调用').toBeGreaterThanOrEqual(0);
    expect(verifyAt, '先写配置再复验').toBeLessThan(abortAt);
    expect(abortAt, '取消复验仍会写入档位：保存必须排在复验成功之后').toBeLessThan(writeAt);

    // 下拉档位与策略枚举必须同集：任何一侧悄悄加/删一档都会在这里变红
    for (const policy of ['always', 'perSession', 'followValidity']) {
      expect(ACCESS_SETTING_SRC, `下拉缺少 ${policy} 档`).toContain(`value="${policy}"`);
      expect(POLICY_SRC, `策略枚举里没有 ${policy} 档`).toContain(`'${policy}'`);
    }
  });

  it('身份库访问配置只有一个写入出口，绕开 configManager 就绕开了非法值收敛', () => {
    const touchers = ['components', 'composables', 'entrypoints', 'utils']
      .flatMap(dir => listSourceFiles(dir))
      .filter(file => readSource(file).includes('IDENTITY_VAULT_ACCESS_CONFIG'));
    expect(new Set(touchers), `存储键出现在 configManager 之外：${touchers.join(' | ')}`).toEqual(
      new Set(['utils/storageKeys.ts', 'utils/storage/configManager.ts']),
    );
  });

  it('跳转路径不解密、不落盘，也不提前取数', () => {
    const combined = appBody('openIdentityVaultWithVerify') + appBody('onDetailSearchIdentity');
    for (const banned of [/decrypt/i, /encrypt/i, /identityVault\.load\(/, /chrome\.storage/, /localStorage/]) {
      expect(combined, `跳转路径不得有 ${banned.source}`).not.toMatch(banned);
    }
  });

  it('预填词随弹窗关闭一起清掉，不串到下一次打开', () => {
    expect(VAULT_DIALOG_SRC).toMatch(/@closed="handleClosed"/);
    expect(functionBody(VAULT_DIALOG_SRC, 'handleClosed'), '弹窗关闭不再触发 teardown').toContain('teardown()');

    const teardownBody = (name: string) => {
      const matched = VAULT_HOOK_SRC.match(new RegExp(`function ${name}\\(\\): void \\{([\\s\\S]*?)\\n  \\}`));
      expect(matched, `未找到 ${name}`).toBeTruthy();
      return matched![1];
    };
    expect(teardownBody('resetViewState'), '复位视图态不再清关键词：预填会粘到下次打开').toMatch(/keyword\.value = ''/);
    expect(teardownBody('teardown'), 'teardown 不再连带复位视图态').toContain('resetViewState()');
  });

  it('深链零命中时，空态要给一条出路：说清是「没有含这个词的字段」，并复用工具栏那条添加事件', () => {
    const empty = VAULT_DIALOG_SRC.match(/filteredRows\.length === 0[\s\S]*?<\/el-empty>/);
    expect(empty, '未找到「无匹配」空态那一块').toBeTruthy();

    // 三条判据各自钉一个**元素**，不共用一个正则：`v-if="keyword.trim()"` 在这一块里出现两次
    // （说明行与出路按钮各一次），整块匹配会被另一处救活——变异实测只摘说明行那处时守卫照样绿。
    const hint = empty![0].match(/<p\b[\s\S]*?class="identity-empty__hint"[\s\S]*?<\/p>/);
    expect(hint, '空态里那行上下文说明不见了').toBeTruthy();
    expect(hint![0], '空态不再引用带上下文的说明文案').toMatch(/t\('identity\.noMatchHint'/);
    expect(hint![0], '说明文案必须把搜索词插进去，否则等于没说').toMatch(/\{\s*keyword:\s*keyword\.trim\(\)\s*\}/);
    // 引导只在「有搜索词」时出现：按类别筛空的那些形里，这句话会把人往错误的落点上引
    expect(hint![0], '说明行不再受搜索词约束，会在纯类别筛选的空态里乱指路').toMatch(/v-if="keyword\.trim\(\)"/);

    const addButton = empty![0].match(/<el-button\b[^>]*@click="\$emit\('add'\)"[\s\S]*?<\/el-button>/);
    expect(addButton, '空态的添加按钮绕开了工具栏那条事件，等于开出第二个入口').toBeTruthy();
    expect(addButton![0], '出路按钮不再受搜索词约束').toMatch(/v-if="keyword\.trim\(\)"/);
    expect(addButton![0], '出路按钮的文案不再是工具栏那一句').toMatch(/\{\{ t\('identity\.add'\) \}\}/);
    for (const banned of [/decrypt/i, /encrypt/i, /localStorage/, /chrome\.storage/]) {
      expect(empty![0], `空态里出现了 ${banned.source}`).not.toMatch(banned);
    }
  });

  it('抽屉不持有身份库状态，也不引入身份加解密', () => {
    expect(DRAWER_SRC, '抽屉引用了身份库状态：密码条目展示层开始持有 PII').not.toMatch(
      /useIdentityVault|@\/utils\/identity|identityVault/,
    );
  });

  it('图标按钮带可读标签与提示，且引用的文案 key 在中英文语言包都在', () => {
    const button = DRAWER_SRC.match(/<el-button\s[^>]*:icon="Search"[^>]*\/>/);
    expect(button, '未找到身份库检索按钮').toBeTruthy();
    expect(button![0]).toMatch(/:aria-label="t\('options\.detail\.searchIdentity'\)"/);
    expect(DRAWER_SRC).toMatch(/<el-tooltip\s*\n?\s*:content="t\('options\.detail\.searchIdentity'\)"/);

    const usedKeys = [...DRAWER_SRC.matchAll(/t\('(options\.detail\.[\w.]+)'/g)].map(m => m[1]);
    expect(usedKeys.length, '未扫描到详情抽屉文案 key，守卫写法需同步更新').toBeGreaterThan(0);
    for (const locale of ['zh-CN', 'en']) {
      const messages = JSON.parse(read(`utils/i18n/locales/${locale}/options.json`)) as Record<string, string>;
      for (const key of usedKeys) {
        expect(messages[key], `${locale} 语言包缺少 ${key}`).toBeTruthy();
      }
    }
  });
});
