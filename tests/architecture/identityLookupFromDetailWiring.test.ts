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
 * 2. **预填不提前解密、不落盘**：预填词只能进 `identityVault.keyword` 那一个 `ref`。把它塞进
 *    `load()` 之前或写进存储，都会让一个「查一下」的动作为 PII 快照延长存活期。
 * 3. **预填不串到下次打开**：靠弹窗 `@closed → teardown() → resetViewState()` 清 keyword。
 *    这条清理链断掉，用户下次从菜单正常打开身份库会看到「只剩一条结果」的空列表，且没有任何提示。
 * 4. **抽屉侧零 PII 暴露面**：抽屉只上交用户名，不引入身份库状态或身份加解密，
 *    否则密码条目的展示层就开始持有证件号。
 *
 * 另附外围：空用户名不得发起跳转（否则把空白搜索词当「全部结果」打开身份库），
 * 图标按钮必须带可读标签（无障碍），以及引用的 `options.detail.*` 文案在中英文语言包都在。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const DRAWER_SRC = read('components/options/PasswordDetailDrawer.vue');
const APP_SRC = read('entrypoints/options/App.vue');
const VAULT_HOOK_SRC = read('composables/useIdentityVault.ts');
const VAULT_DIALOG_SRC = read('components/options/IdentityVaultDialog.vue');

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
    const verifyAt = gate.indexOf('await promptAndVerifyMasterPassword(');
    const abortAt = gate.indexOf('if (!masterPassword) return false;');
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
    expect(APP_SRC).toMatch(/case 'identityVault':\s*\n\s*openIdentityVaultWithVerify\(\);/);
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
