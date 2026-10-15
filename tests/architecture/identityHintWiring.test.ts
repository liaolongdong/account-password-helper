/**
 * 身份库召唤提示（形态一）的跨文件接线守卫
 *
 * 这条链跨 content / background / options 三个文档，而三个上下文各自的可测部分都已有行为级
 * 回归（`identityHint.test.ts`、`formDetector.identityHint.test.ts`、`senderValidation.test.ts`、
 * `useRuntimeMessageHandler.identityVault.test.ts`）。本文件只守**行为测试看不见的那一层**：
 * 接线点是否还挂在对方的插座上。这类漂移不会产生红灯，只会让功能静默消失——
 * 页面照常出提示，点了按钮什么也不发生。
 *
 * 四条各守一个真实漂移方向：
 * 1. Options 侧必须把回调接到 `useRuntimeMessageHandler` 的选项上；漏接时后台照收消息，
 *    但页面侧按钮成为死点击。
 * 2. 身份库弹窗的可打开路径必须只有复验门槛那一处；新入口直接置 `true` 等于绕过三档复验。
 * 3. 由提示打开时，筛选写入必须排在复验通过之后；写在之前会让「取消复验」留下一副莫名
 *    少一批条目的抽屉。
 * 4. 页面侧模块不得读取字段值、不得把页面 URL 或任何库内内容送进消息——出口只有角色枚举。
 *    这条是隐私承诺，单测只证了一枚 canary，这里按整个模块的文本兜网。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const IDENTITY_HINT = 'entrypoints/content/IdentityHint.ts';
const OPTIONS_APP = 'entrypoints/options/App.vue';
const FORM_DETECTOR = 'entrypoints/content/FormDetector.ts';

/** 「打开身份库」的唯一门槛函数与其弹窗可见态 */
const GATE_FN = 'openIdentityVaultWithVerify';
const DIALOG_VISIBLE = 'showIdentityVaultDialog.value = true';

describe('身份提示的跨上下文接线', () => {
  const optionsApp = readSource(OPTIONS_APP);
  const identityHint = readSource(IDENTITY_HINT);

  it('扫描面读到了被测源文件（守卫不得静默空跑）', () => {
    for (const file of [IDENTITY_HINT, OPTIONS_APP, FORM_DETECTOR]) {
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

  it('由提示打开时，类别筛选写在复验通过之后', () => {
    const fromPage = optionsApp.slice(optionsApp.indexOf('const openIdentityVaultFromPage'));
    const thenWindow = fromPage.slice(0, fromPage.indexOf('};'));
    expect(thenWindow).toContain(`void ${GATE_FN}()`);
    // 门槛未通过（用户取消复验）时不得留下筛选态
    expect(thenWindow).toMatch(/if\s*\(\s*passed\s*&&\s*role\s*\)/);
    expect(thenWindow).not.toContain(DIALOG_VISIBLE);
  });

  it('页面侧模块不读字段值、不发页面 URL，出口只有角色枚举', () => {
    // 取值即扩大明文存活上下文：`.value` / 页面地址 / 库内数据都不允许出现在这个模块里
    expect(identityHint).not.toMatch(/\binput\.value\b|\bfield\.value\b|\.value\s*===?\s*/);
    expect(identityHint).not.toMatch(/location\.(href|search)|document\.URL|document\.referrer/);
    const payload = identityHint.slice(identityHint.indexOf('function openIdentityVault'));
    expect(payload).toContain('data: { role }');
    // 除类型标注外不得再引用 IdentityVault 的数据结构：模块只允许认识「角色」这一个标签
    expect(identityHint).not.toMatch(/IdentityEntry|IdentityPayload|identityCrud|decryptIdentity/);
  });
});
