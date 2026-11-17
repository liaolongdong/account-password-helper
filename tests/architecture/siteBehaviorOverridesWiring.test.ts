/**
 * 「按站点覆盖悬浮按钮显隐 / 跨子域匹配档位」（B1）的接线守卫
 *
 * B1 给站点规则加了两个可选覆盖轴，消费方横跨五个上下文：内容脚本（按钮显隐门禁）、
 * Background（匹配策略）、侧边栏 / Popup（列表可见集）、自动保存（去向提示）、
 * 设置面板（归因提示）。与 C6 同型：漏接一处的症状是「面板显示 A、页面行为 B」，
 * 且只在设了规则的那一个站点复现，review 很难看出来，所以逐条机械扫描。
 *
 * 各条守住的真实漂移方向：
 * 1. 管理器的显隐判定必须走带覆盖的解析器，init / applyConfig / show 三处门禁同源；
 * 2. storage 监听必须先记旧生效值再落地新值——顺序颠倒会让「全局+规则同批变更」
 *    的过渡判定恒为「没变化」，按钮该出现时不出现；
 * 3. Background 的两条匹配入口都必须走 getEffectiveSitePolicy，规则镜像由
 *    SITE_RULES 变更复位，且不得顺带失效密码缓存（那会杀掉秒开快照快路径）；
 * 4. 侧边栏的全局档位与生效档位必须是两个变量（computed 派生），直接写回全局
 *    会让站点覆盖污染其它域名的列表；
 * 5. 自动保存提示读规则必须走动态 import——本模块在 popup 首屏 eager 依赖图里，
 *    静态值导入会把 siteRules 挂进 modulepreload（sidepanelClosure 预算守卫会红）；
 * 6. 导入侧两个新字段先过类型守卫再落库，空规则判定必须把它们算进去；
 * 7. 表单「跟随全局」必须以不写字段表达，清空全部覆盖必须走删除分支；
 * 8. 扫描面自身非空（正向对照），防止正则失配让守卫静默空跑。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const MANAGER = 'entrypoints/content/floatingButtons/FloatingButtonManager.ts';
const SETTINGS_PANEL = 'entrypoints/content/floatingButtons/SettingsPanel.ts';
const PANEL_VIEW = 'entrypoints/content/floatingButtons/settingsPanelView.ts';
const PANEL_TYPES = 'entrypoints/content/floatingButtons/types.ts';
const PASSWORD_CACHE = 'entrypoints/background/passwordCache.ts';
const BACKGROUND_SERVICES = 'entrypoints/background/backgroundServices.ts';
const SIDEPANEL_APP = 'entrypoints/sidepanel/App.vue';
const POPUP_INIT = 'composables/usePopupInit.ts';
const AUTO_SAVE = 'utils/storage/autoSaveManager.ts';
const TRANSFER = 'utils/siteRulesTransfer.ts';
const RULES_DIALOG = 'components/options/SiteRulesDialog.vue';
const SITE_RULES = 'utils/storage/siteRules.ts';
const DOMAIN = 'utils/domain.ts';

/** 取一个函数体开括号之后的一段窗口，够覆盖本守卫关心的判据 */
const bodyWindow = (source: string, anchor: string, size = 1600): string => {
  const index = source.indexOf(anchor);
  expect(index, `锚点失配：${anchor}`).toBeGreaterThan(-1);
  return source.slice(index, index + size);
};

describe('站点覆盖悬浮按钮显隐 / 匹配档位的接线', () => {
  it('扫描面读到了被测源文件，解析器确实导出（守卫不得静默空跑）', () => {
    for (const file of [
      MANAGER,
      SETTINGS_PANEL,
      PANEL_VIEW,
      PANEL_TYPES,
      PASSWORD_CACHE,
      BACKGROUND_SERVICES,
      SIDEPANEL_APP,
      POPUP_INIT,
      AUTO_SAVE,
      TRANSFER,
      RULES_DIALOG,
      SITE_RULES,
      DOMAIN,
    ]) {
      expect(readSource(file).length).toBeGreaterThan(0);
    }
    expect(readSource(SITE_RULES)).toContain('export function resolveFloatingButtonVisible');
    expect(readSource(DOMAIN)).toContain('export function resolveDomainMatchMode');
  });

  it('管理器三处显隐门禁同源：init 不创建、applyConfig 挂类、show 不做动画都走覆盖判定', () => {
    const manager = readSource(MANAGER);
    expect(manager).toContain('resolveFloatingButtonVisible(this.config.visible, this.siteRule)');

    // init：隐藏分支必须在创建 Shadow DOM 之前返回（创建了再藏起来不是本次语义）
    const init = bodyWindow(manager, 'async init()', 900);
    const gate = init.indexOf('!this.isEffectivelyVisible()');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(init.indexOf('this.createShadowDOM()'));

    // applyConfig：hidden 类判定不得退回裸全局开关
    const apply = bodyWindow(manager, 'private applyConfig()', 700);
    expect(apply).toContain('this.isEffectivelyVisible()');
    expect(apply).not.toContain('this.config.visible');

    // show：补建与展示动画各自有门禁，动画不得摘掉 applyConfig 刚挂上的 hidden 类
    const show = bodyWindow(manager, 'async show()', 900);
    expect(show).toContain('!this.shadowRoot && this.isEffectivelyVisible()');
    const animGate = show.indexOf('if (this.isEffectivelyVisible())');
    expect(animGate).toBeGreaterThan(-1);
    expect(animGate).toBeLessThan(show.indexOf('this.animationController?.show()'));
  });

  it('storage 监听双键齐全，且先记旧生效值再落地新值（同批变更只触发一次过渡）', () => {
    const listener = bodyWindow(readSource(MANAGER), 'private setupStorageListener()', 1500);
    expect(listener).toContain('STORAGE_KEYS.FLOATING_BUTTON_CONFIG');
    expect(listener).toContain('STORAGE_KEYS.SITE_RULES');

    const wasVisible = listener.indexOf('const wasVisible = this.isEffectivelyVisible()');
    const landConfig = listener.indexOf('this.config = { ...StorageUtils.getDefaultFloatingButtonConfig()');
    const landRule = listener.indexOf('this.siteRule = this.pickSiteRule(');
    expect(wasVisible).toBeGreaterThan(-1);
    expect(wasVisible).toBeLessThan(landConfig);
    expect(wasVisible).toBeLessThan(landRule);
  });

  it('Background 两条匹配入口都走 getEffectiveSitePolicy，策略镜像不再被直接消费', () => {
    const cache = readSource(PASSWORD_CACHE);
    const effective = bodyWindow(cache, 'export async function getEffectiveSitePolicy', 700);
    expect(effective).toContain('resolveSiteRuleForHosts(rules, host, domain)');
    expect(effective).toContain('resolveDomainMatchMode(policy.mode, rule)');
    // 端口轴不在覆盖范围：覆盖只换 mode，portScope 原样保留
    expect(effective).toContain('{ ...policy, mode }');

    expect(cache.match(/getEffectiveSitePolicy\(domain, page\)/g)?.length).toBeGreaterThanOrEqual(2);
    // 两条匹配入口的函数体内不得再直接消费全局策略镜像（绕过覆盖的回归方向）
    for (const anchor of ['export async function sortMatchesForDomain', 'export async function getMatchingAccounts']) {
      const body = bodyWindow(cache, anchor, 2500);
      expect(body).toContain('getEffectiveSitePolicy(domain, page)');
      expect(body).not.toContain('getCachedSitePolicy');
    }
  });

  it('SITE_RULES 变更只复位规则镜像，不得失效密码缓存（秒开快照快路径不被规则编辑杀掉）', () => {
    const services = readSource(BACKGROUND_SERVICES);
    const branch = bodyWindow(services, 'STORAGE_KEYS.SITE_RULES in changes', 300);
    expect(branch).toContain('resetSiteRulesMirror()');
    expect(branch).not.toContain('invalidatePasswordCache');
  });

  it('侧边栏全局档位与生效档位分离：computed 派生，storage 只写全局与规则两份源', () => {
    const app = readSource(SIDEPANEL_APP);
    expect(app).toContain('resolveDomainMatchMode(globalDomainMatchMode.value, currentSiteRule.value)');
    expect(app).toContain('resolveSiteRuleForHosts(siteRules.value, currentSiteHost.value, currentDomain.value)');
    // 生效档位是 computed：任何直接赋值都是把站点覆盖写回全局的漂移（=== 比较不算赋值）
    expect(app).not.toMatch(/domainMatchMode\.value\s*=(?!=)/);
    const handler = bodyWindow(app, 'STORAGE_KEYS.SITE_RULES', 400);
    expect(handler).toContain('siteRules.value =');
  });

  it('Popup 与自动保存提示都按站点覆盖解析档位；autoSave 读规则走动态 import 保住 eager 预算', () => {
    expect(readSource(POPUP_INIT)).toContain('resolveDomainMatchMode(sitePolicy.value.mode, rule)');

    const autoSave = readSource(AUTO_SAVE);
    const note = bodyWindow(autoSave, 'async function buildWillCreateNote', 1400);
    expect(note).toContain('resolveDomainMatchMode(mode, rule)');
    expect(note).toContain("await import('./siteRules')");
    // 静态值导入会把 siteRules 挂进 popup.html 的 modulepreload（eager 文件数 +1）
    expect(autoSave).not.toMatch(/^import\s[^;]*from\s'\.\/siteRules'/m);
  });

  it('导入侧两个新字段先过类型守卫再落库，空规则判定把它们算进去', () => {
    const transfer = readSource(TRANSFER);
    const fabAssign = transfer.indexOf('rule.floatingButton = source.floatingButton');
    const fabGuard = transfer.indexOf("typeof source.floatingButton === 'boolean'");
    expect(fabAssign).toBeGreaterThan(-1);
    expect(fabGuard).toBeGreaterThan(-1);
    expect(fabGuard).toBeLessThan(fabAssign);

    const modeAssign = transfer.indexOf('rule.domainMatchMode = source.domainMatchMode');
    const modeGuard = transfer.indexOf('isDomainMatchMode(source.domainMatchMode)');
    expect(modeAssign).toBeGreaterThan(-1);
    expect(modeGuard).toBeGreaterThan(-1);
    expect(modeGuard).toBeLessThan(modeAssign);

    const emptyCheck = bodyWindow(transfer, '全部覆盖项都没有才算空规则', 500);
    expect(emptyCheck).toContain('rule.floatingButton !== undefined');
    expect(emptyCheck).toContain('rule.domainMatchMode !== undefined');
  });

  it('表单「跟随全局」= 不写字段；清空全部覆盖走删除；列宽之和留在弹窗可用宽度内', () => {
    const dialog = readSource(RULES_DIALOG);
    expect(dialog).toMatch(/if\s*\(\s*formData\.floatingButton\s*!==\s*FOLLOW_GLOBAL\s*\)\s*patch\.floatingButton\s*=/);
    expect(dialog).toMatch(
      /if\s*\(\s*formData\.domainMatchMode\s*!==\s*FOLLOW_GLOBAL\s*\)\s*patch\.domainMatchMode\s*=/,
    );
    // 无条件写入会把「跟随全局」冻结成当下的全局值
    expect(dialog).not.toMatch(/floatingButton:\s*formData\.floatingButton/);
    expect(dialog).not.toMatch(/domainMatchMode:\s*formData\.domainMatchMode/);

    const clearing = bodyWindow(dialog, 'const clearingAll', 400);
    expect(clearing).toContain('formData.floatingButton === FOLLOW_GLOBAL');
    expect(clearing).toContain('formData.domainMatchMode === FOLLOW_GLOBAL');

    // 列宽预算与 C6 守卫同口径：四列之和 ≤ 720 − 36，超出即横向滚动
    const dialogWidth = Number(dialog.match(/<el-dialog[\s\S]{0,400}?\swidth="(\d+)px"/)?.[1] ?? 0);
    const columnWidths = dialog
      .split('<el-table-column')
      .slice(1)
      .map(chunk => chunk.slice(0, chunk.indexOf('>')))
      .map(attrs => attrs.match(/(?:^|\s)(?:min-)?width="(\d+)/)?.[1])
      .filter((width): width is string => width !== undefined)
      .map(Number);
    expect(columnWidths).toHaveLength(4);
    expect(dialogWidth).toBeGreaterThan(0);
    expect(columnWidths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(dialogWidth - 36);
  });

  it('设置面板把显隐覆盖真的送进视图，提示元素常驻且参数可选（另两处复用零改动）', () => {
    expect(readSource(SETTINGS_PANEL)).toContain('setSiteVisibleOverride(');
    expect(readSource(PANEL_TYPES)).toContain('setSiteVisibleOverride(visible: boolean | null)');
    const view = readSource(PANEL_VIEW);
    expect(view).toMatch(/siteVisibleOverride\?:\s*boolean\s*\|\s*null/);
    expect(view).toContain('data-visible-override');
  });
});
