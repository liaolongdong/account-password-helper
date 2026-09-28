/**
 * 对话框「异步结果落点」接线守卫：await 之后再写视图状态，必须先过代际 / 作用域这道门
 *
 * 这一类缺陷的共同形状：弹窗打开 → `await` 存储或动画帧 → 把结果铺进 `ref`。中间那次挂起
 * 里用户可能已经关掉弹窗、或又开了一次（换成另一条条目 / 另一份报告）。缺代际守卫时结果照样
 * 落地，表现不是崩溃而是**隐藏态被写脏**：站点规则弹窗在关闭后进入预填表单、健康度弹窗把
 * 上一份报告的分数补进环形动画、身份库把已解密的 PII 一直留到会话失效。
 * 本机时序正常时它永远不出现，只在慢盘 / Windows 杀毒扫描 / 用户手快时偶发——正是最难手工复现
 * 的那类问题，因此用源码接线守卫把它钉成可判定的断言。
 *
 * 为什么是源码守卫而不是行为测试：本仓库无 `@vue/test-utils`，这几处逻辑与 el-dialog 的生命周期
 * 绑死（`@closed` 依赖过渡动画结束），造桩测的成本高于收益。纯状态侧的等价行为已由
 * `tests/composables/usePasswordHistory.test.ts`（真实竞态）与
 * `tests/composables/useIdentityVault.test.ts`（teardown 释放明文）覆盖，这里只补「UI 侧是否接上」那一段。
 *
 * 每条判据都配一个负向对照（把守卫那一行删掉后同一正则必须不再匹配）：没有对照的源码守卫
 * 会因为写得过宽而静默变成永真断言——那比没有守卫更糟。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '@/tests/helpers/architectureScan';

/** 受检文件（仓库相对路径） */
const FILES = {
  siteRules: 'components/options/SiteRulesDialog.vue',
  identityDialog: 'components/options/IdentityVaultDialog.vue',
  identityComposable: 'composables/useIdentityVault.ts',
  optionsApp: 'entrypoints/options/App.vue',
  healthDialog: 'components/options/PasswordHealthDialog.vue',
};

/**
 * 断言判据「仍有牙齿」：源文本命中，删掉守卫那一行后不再命中
 *
 * @param label 判据名（失败时定位用）
 * @param source 受检源文本
 * @param pattern 判据正则
 * @param removeLine 被删除的守卫行（须为该源中的唯一子串）
 */
function expectGuard(label: string, source: string, pattern: RegExp, removeLine: string): void {
  expect(pattern.test(source), `${label}：判据未命中，接线已漂移或写法变了`).toBe(true);
  expect(source.includes(removeLine), `${label}：负向对照找不到守卫行，判据可能已是永真`).toBe(true);
  const mutated = source.replace(removeLine, '');
  expect(mutated.includes(removeLine), `${label}：守卫行不唯一，负向对照失真`).toBe(false);
  expect(pattern.test(mutated), `${label}：删掉守卫后仍然命中，判据没有牙齿`).toBe(false);
}

describe('对话框异步结果落点的接线守卫', () => {
  const siteRules = readSource(FILES.siteRules);
  const identityDialog = readSource(FILES.identityDialog);
  const identityComposable = readSource(FILES.identityComposable);
  const optionsApp = readSource(FILES.optionsApp);
  const healthDialog = readSource(FILES.healthDialog);

  it('受检文件抽取非空：路径漂移要让守卫变红而不是静默空跑', () => {
    for (const [name, rel] of Object.entries(FILES)) {
      expect(rel, `${name} 未落在受检目录形态内`).toMatch(/^(components|composables|entrypoints)\//);
      expect(readSource(rel).length, `${name} 源文本为空`).toBeGreaterThan(200);
    }
    // listSourceFiles 口径自证：管理页弹窗目录确实扫得到文件
    expect(listSourceFiles('components/options').length, 'components/options 扫描为空').toBeGreaterThan(10);
  });

  describe('站点规则弹窗：打开流程与列表加载各自受代际保护', () => {
    it('关闭即刻作废未落地的打开流程，预填视图不在隐藏态生效', () => {
      expectGuard(
        '打开流程关闭侧作废',
        siteRules,
        /if \(!open\) \{[\s\S]{0,160}?openFlowSeq \+= 1;[\s\S]{0,40}?return;[\s\S]{0,80}?\}/,
        '    openFlowSeq += 1;',
      );
    });

    it('预填前重新校验代际（await loadRules 之后、openPrefilledRule 之前）', () => {
      expectGuard(
        '预填代际校验',
        siteRules,
        /const seq = \+\+openFlowSeq;[\s\S]{0,120}?await loadRules\(\);[\s\S]{0,120}?if \(seq !== openFlowSeq\) return;[\s\S]{0,120}?openPrefilledRule\(domain\)/,
        '  if (seq !== openFlowSeq) return;\n  if (domain) openPrefilledRule(domain);',
      );
    });

    it('列表重载只让最新一次结果落地', () => {
      expectGuard(
        '列表加载代际',
        siteRules,
        /const seq = \+\+rulesLoadSeq;[\s\S]{0,120}?await getSiteRules\(\);[\s\S]{0,120}?if \(seq !== rulesLoadSeq\) return;[\s\S]{0,120}?rulesList\.value = /,
        '  if (seq !== rulesLoadSeq) return;\n  rulesList.value = Object.values(rules);',
      );
    });
  });

  describe('身份库：关闭即释放解密明文，但判重仍要对着存储真值', () => {
    it('列表弹窗的 @closed 走 teardown（连 rows 一起清），不再只复位视图态', () => {
      expectGuard(
        '关闭释放明文',
        identityDialog,
        /const handleClosed = \(\): void => \{\s*teardown\(\);/,
        '  teardown();',
      );
      expect(identityDialog, 'handleClosed 不应退回只清视图态（PII 会留到会话失效）').not.toMatch(
        /const handleClosed = \(\): void => \{\s*resetViewState\(\);/,
      );
    });

    it('teardown 确实清空 rows（否则上面的接线只是名字对了）', () => {
      expectGuard(
        'teardown 清明文',
        identityComposable,
        /function teardown\(\): void \{\s*rows\.value = \[\];\s*resetViewState\(\);/,
        '  function teardown(): void {\n    rows.value = [];',
      );
    });

    it('管理页在快照被释放后先按存储真值补加载，再判重', () => {
      expectGuard(
        '判重前补加载',
        optionsApp,
        /if \(identityVault\.rows\.value\.length === 0\) await identityVault\.load\(\);[\s\S]{0,240}?findDuplicateIdentity\(identityVault\.rows\.value/,
        '  if (identityVault.rows.value.length === 0) await identityVault.load();',
      );
    });
  });

  describe('健康度弹窗：补间帧与提醒状态不落到隐藏态', () => {
    it('开场补间帧被登记为可取消句柄，并在关闭 / 重开 / 销毁时取消', () => {
      expectGuard(
        '补间帧登记句柄',
        healthDialog,
        /scoreFrame = requestAnimationFrame\(\(\) => \{\s*scoreFrame = 0;[\s\S]{0,120}?if \(seq !== openSeq\) return;/,
        '        if (seq !== openSeq) return;',
      );
      const cancelCount = healthDialog.match(/cancelAnimationFrame\(scoreFrame\)/g) ?? [];
      expect(cancelCount.length, '关闭 / 重开与组件销毁两处都应取消待执行帧').toBe(2);
    });

    it('提醒状态按打开代际落地，且失败有兜底（不再产生未处理的 rejection）', () => {
      expectGuard(
        '提醒状态代际落地',
        healthDialog,
        /if \(openSeqAtStart !== openSeq\) return;\s*reminderStates\.value = states;/,
        '    if (openSeqAtStart !== openSeq) return;\n    reminderStates.value = states;',
      );
      expect(
        /catch \(error\) \{[\s\S]{0,300}?reminderStates\.value = \{\};/.test(healthDialog),
        'loadReminderStates 缺失败兜底：读取异常会变成未处理的 rejection，且旧文案粘在按钮上',
      ).toBe(true);
    });

    it('面板定位限定在本组件根节点内，不向全局 document 查同名 class', () => {
      // 只判代码位（先截到 <style> 前，再剥注释）：散文里出现同名 API 不是缺陷
      expect(healthDialog.includes('<style'), '未定位到 <style> 段，健康度弹窗的源形态已变').toBe(true);
      const healthCode = healthDialog.slice(0, healthDialog.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(healthCode, '仍在使用全局 document.querySelector').not.toMatch(/document\.querySelector/);
      expectGuard(
        '作用域内查面板',
        healthDialog,
        /healthRootRef\.value\?\.querySelector<HTMLElement>\(`\.health-panel-\$\{key\}`\)/,
        'healthRootRef.value?.querySelector',
      );
      // 模板里必须真有那个 ref 挂载点，否则 querySelector 恒为 undefined（静默失效）
      expect(healthDialog).toMatch(/ref="healthRootRef"/);
    });
  });
});
