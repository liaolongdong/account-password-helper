/**
 * 「按站点覆盖快速填充入口」（C6）的接线守卫
 *
 * C6 把一个原本只有两个布尔字段的设置（`fillMode` + `autoShowSidepanel`）变成三档语义，
 * 再让**三方**消费同一份口径：设置面板（渲染与写回）、内容脚本（决定弹侧边栏还是显示
 * 内联图标）、站点规则（按域名覆盖）。这类「一次派生、多处消费」的接线漏一处，
 * 产生的是一种极难归因的缺陷——面板显示 A、页面行为 B，且只在某些站点复现。
 * 本仓已有同型先例（跨子域档位漏传形参，见 `crossSubdomainTierWiring.test.ts`），
 * 所以这里同样做机械扫描，而不是指望 review 看出来。
 *
 * 各条分别守住一个真实漂移方向：
 * 1. 内容脚本必须走带站点覆盖的解析入口，且不得回头手搓两字段派生（派生只有一份实现）；
 * 2. 自动开侧边栏的唯一调用点必须排在档位分派之后，否则「仅手动」档会被点击绕过；
 * 3. 站点档位必须真的送进面板，否则用户看不到归因提示，只觉设置「不生效」；
 * 4. 覆盖参数必须是可选的——另两处复用（侧边栏 / Options）不该被本次改动波及；
 * 5. 读取 storage/导入文件里的档位值必须先过 `isFillEntry`；
 * 6. 「跟随全局」必须以「不写该字段」表达——写死当前全局档位会让用户之后的全局变更
 *    在这个站点上被永久挡掉；而清掉唯一覆盖时必须真的把规则撤掉，不能只靠空规则校验拦；
 * 7. 列表列宽之和必须留在弹窗可用宽度之内，否则表格静默变成横向滚动；
 * 8. 扫描面自身非空（正向对照），防止正则失配让守卫静默空跑。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const FORM_DETECTOR = 'entrypoints/content/FormDetector.ts';
const FILL_ENTRY_MODULE = 'utils/fillEntry.ts';
const SETTINGS_PANEL = 'entrypoints/content/floatingButtons/SettingsPanel.ts';
const PANEL_VIEW = 'entrypoints/content/floatingButtons/settingsPanelView.ts';
const PANEL_TYPES = 'entrypoints/content/floatingButtons/types.ts';
const TRANSFER = 'utils/siteRulesTransfer.ts';
const RULES_DIALOG = 'components/options/SiteRulesDialog.vue';

/** 内容脚本里「配置对象 → 原始两字段」的读取形态（注释里的同名字段不算） */
const RAW_FIELD_READ = /this\.floatingButtonConfig\.(?:fillMode|autoShowSidepanel)\b/g;

/** 面板 HTML 与内容脚本两处 `showSidePanel()` 之间必须存在的档位判据窗口 */
const GUARD_WINDOW = 600;

/**
 * 弹窗宽度里不属于表格的部分
 *
 * `.el-dialog` 是 border-box + `--el-dialog-padding-primary: 16px`（左右各一份），
 * 滚动容器 `.dialog-body-scroll` 另有 `padding-right: 4px`（`entrypoints/options/App.vue`）。
 * 弹窗比「四列之和 + 这个数」再窄一格，el-table 就开始横向滚动。
 */
const DIALOG_INNER_PADDING = 36;

describe('站点覆盖快速填充入口的接线', () => {
  const formDetector = readSource(FORM_DETECTOR);
  const settingsPanel = readSource(SETTINGS_PANEL);

  it('扫描面读到了被测源文件（守卫不得静默空跑）', () => {
    for (const file of [
      FORM_DETECTOR,
      FILL_ENTRY_MODULE,
      SETTINGS_PANEL,
      PANEL_VIEW,
      PANEL_TYPES,
      TRANSFER,
      RULES_DIALOG,
    ]) {
      expect(readSource(file).length).toBeGreaterThan(0);
    }
    // 正向对照：口径模块确实导出四个函数，且内容脚本真的在用派生档位
    for (const name of ['getFillEntry', 'fillEntryToPatch', 'isFillEntry', 'resolveFillEntry']) {
      expect(readSource(FILL_ENTRY_MODULE)).toContain(`export function ${name}`);
    }
    expect(formDetector.match(/effectiveFillEntry/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('内容脚本的入口判定必须走带站点覆盖的 resolveFillEntry', () => {
    // getFillEntry 只看全局配置：内容脚本一旦改用它，站点规则在这条路径上静默失效
    // （首屏看不出任何异常，只有那个站点上的行为与面板设置不一致）
    expect(formDetector).not.toContain('getFillEntry(');
    expect(formDetector).toContain('resolveFillEntry(this.floatingButtonConfig, this.siteRule)');
    // 也不许回头手搓两字段派生——派生只有一份实现
    expect(formDetector.match(RAW_FIELD_READ) ?? []).toEqual([]);
  });

  it('自动开侧边栏的唯一调用点排在档位分派之后', () => {
    const calls = [...formDetector.matchAll(/this\.showSidePanel\(\)/g)];
    // 多于 1 处时本条的「唯一」前提就不成立了，先让它红在这里而不是静默放过新增调用点
    expect(calls).toHaveLength(1);

    const callIndex = calls[0].index as number;
    const window = formDetector.slice(Math.max(0, callIndex - GUARD_WINDOW), callIndex);
    expect(window).toContain('effectiveFillEntry');
    expect(window).toContain("'manual'");
  });

  it('悬浮按钮面板把当前站点的档位真的送进视图', () => {
    expect(settingsPanel).toContain('getSiteRule(');
    expect(settingsPanel).toContain('setSiteFillOverride(');
    // 句柄契约缺这一位时，SettingsPanel 的调用会红在类型层，守卫再兜一道口径
    expect(readSource(PANEL_TYPES)).toContain('setSiteFillOverride(entry: FillEntry | null)');
  });

  it('面板的档位写回走 fillEntryToPatch，不手搓两字段', () => {
    // 上方那条正向对照只证明 `utils/fillEntry.ts` 里**定义**了这个函数，
    // 而面板完全可以在点击处复刻一遍映射——那时定义位依旧存在、守卫照绿，
    // 用户看到的却是「面板显示 A、写回 B」。判据因此落在**使用位**上。
    const view = readSource(PANEL_VIEW);
    const callIndex = view.indexOf('fillEntryToPatch(entry)');
    expect(callIndex, '面板不再调用 fillEntryToPatch：两字段映射被复刻了一遍').toBeGreaterThan(-1);
    // 派生出的那份 patch 必须就是提交出去的那份（换成内联字面量等于绕开单一口径）
    expect(view.slice(callIndex, callIndex + GUARD_WINDOW)).toContain('onConfigChange(patch)');
    // 反向对照：手搓派生与手搓字面量补丁
    expect(view).not.toMatch(/config\.fillMode\s*===\s*'inline'/);
    expect(view).not.toMatch(/autoShowSidepanel:\s*(?:true|false)/);
  });

  it('面板的覆盖参数可选，提示元素默认隐藏（侧边栏与 Options 两处复用零改动）', () => {
    const view = readSource(PANEL_VIEW);
    expect(view).toMatch(/siteFillOverride\?:\s*FillEntry\s*\|\s*null/);
    // 面板 HTML 先渲染、站点规则之后异步读到，所以提示是「常驻元素 + hidden」而非条件插入
    expect(view).toContain('data-fill-override');
  });

  it('导入侧的档位值先过 isFillEntry 再落库', () => {
    const transfer = readSource(TRANSFER);
    const assign = transfer.search(/rule\.fillEntry\s*=\s*source\.fillEntry/);
    expect(assign).toBeGreaterThan(-1);
    const guardIndex = transfer.indexOf('isFillEntry(source.fillEntry)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(assign);
  });

  it('「跟随全局」表达为不写该字段，而不是冻结当前全局档位', () => {
    const dialog = readSource(RULES_DIALOG);
    // 表单以非空哨兵表达「跟随全局」：空串会被 `el-select` 判成未选（`getOption` 对空串返回
    // 空标签），选中这一档也不显示标签、只剩占位符——本仓未装 EP 语言包，那颗占位符是英文的。
    // 判据因此是「与哨兵比较」；退回真值判断后 `'follow'` 恒为真，每次保存都把当下的全局档位
    // 写死进规则，用户之后的全局变更在这个站点上被永久挡掉。
    expect(dialog).toMatch(/if\s*\(\s*formData\.fillEntry\s*!==\s*FOLLOW_GLOBAL\s*\)\s*patch\.fillEntry\s*=/);
    // 哨兵一旦与某个真实档位重名，「选了那一档」就静默等于「跟随全局」——存进去却没有覆盖
    const sentinel = dialog.match(/^const FOLLOW_GLOBAL = '([a-zA-Z]+)';$/m)?.[1];
    expect(sentinel, '哨兵字面量形状变了：本条判据需要跟着重新确认').toBeTruthy();
    const realEntries = [...dialog.matchAll(/<el-option\n\s+value="([a-zA-Z]+)"/g)].map(m => m[1]);
    expect(realEntries.length, '档位下拉的真实选项少于三条：提取口径失配').toBeGreaterThanOrEqual(3);
    expect(realEntries).not.toContain(sentinel);
    // 无条件写入（对象字面量里直接带 fillEntry）会把「跟随全局」变成「按当下的全局设死」
    expect(dialog).not.toMatch(/fillEntry:\s*formData\.fillEntry/);
    // 编辑态把唯一覆盖改回跟随全局必须走删除：这条分支一旦被「简化」掉，用户点开一条
    // 只有档位覆盖的规则、选「跟随全局」保存，就会被空规则校验拦下——一个改不回去的死路
    expect(dialog).toMatch(/if\s*\(\s*clearingAll\s*\)\s*await\s+removeSiteRule\(\s*domain\s*\)/);
  });

  it('列表列宽之和留在弹窗可用宽度之内（超出会让表格横向滚动）', () => {
    const dialog = readSource(RULES_DIALOG);
    const dialogWidth = Number(dialog.match(/<el-dialog[\s\S]{0,400}?\swidth="(\d+)px"/)?.[1] ?? 0);
    // 只取 <el-table-column ...> 开标签里的宽度，避免把表单控件上的 width 记进列预算
    const columnWidths = dialog
      .split('<el-table-column')
      .slice(1)
      .map(chunk => chunk.slice(0, chunk.indexOf('>')))
      .map(attrs => attrs.match(/(?:^|\s)(?:min-)?width="(\d+)/)?.[1])
      .filter((width): width is string => width !== undefined)
      .map(Number);

    // 正向对照：四列都真的被解析到，否则下面那条减法会因列清单为空而假绿
    expect(columnWidths).toHaveLength(4);
    expect(dialogWidth).toBeGreaterThan(0);
    expect(columnWidths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(dialogWidth - DIALOG_INNER_PADDING);
  });
});
