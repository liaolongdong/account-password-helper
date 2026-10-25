/**
 * 备份徽标与轻提醒的接线守卫
 *
 * 档位判据本身由 `tests/utils/backupChipState.test.ts` 覆盖（纯函数），这里钉的是
 * **只有源码能证明、断掉后不会有任何测试变红**的那一类：
 *
 * 1. 徽标不再有两份事实来源。菜单顶部那条 `backup-status-bar` 已随本次改版下线，
 *    留着文案键等于给下一位改动者留一个「哪边才是真的」的坑。
 * 2. 徽标不偷偷变重。它常驻管理页头部，一旦有人为「拿准确条数」在这里整包读 `PASSWORDS`
 *    或解密身份库，代价直接落在 Options 首屏 SLA 上，而功能测试只会看到「显示对了」。
 * 3. 轻提醒保持收紧。它的触发条件是「从未备份」或「本页会话内确实改过数据」，
 *    退回「档位一到待备份就每次打开都推一条」就是把它变成噪音。
 * 4. 提醒文案的两条口径：点名哪个库就写哪个库的扩展名（一份映射，不是两处三元），
 *    以及**不许宣称导出耗时**——`.aph` 付 3 次、`.aphid` 付 2 次 PBKDF2 600k，
 *    同一个动作在不同机器上差好几倍，写死的秒数一定会变成假话。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const HEADER_BAR = 'components/options/HeaderBar.vue';
const APP = 'entrypoints/options/App.vue';
const CHIP_COMPOSABLE = 'composables/useBackupChip.ts';
const NUDGE_BANNER = 'components/options/BackupNudgeBanner.vue';
const ZH_OPTIONS = 'utils/i18n/locales/zh-CN/options.json';
const EN_OPTIONS = 'utils/i18n/locales/en/options.json';

describe('备份状态只有一份事实来源', () => {
  it('菜单顶部的旧状态条已下线，样式与文案键一并清掉', () => {
    const header = readSource(HEADER_BAR);
    expect(header).not.toContain('backup-status-bar');
    expect(header).not.toContain('backupStatusText');
    expect(readSource(ZH_OPTIONS)).not.toMatch(/options\.header\.backupStatus/);
    expect(readSource(EN_OPTIONS)).not.toMatch(/options\.header\.backupStatus/);
  });

  it('徽标显隐只认判据的 visible，不在组件里另算一套空库规则', () => {
    expect(readSource(HEADER_BAR)).toContain('v-if="backupChip.visible"');
  });

  it('档位到颜色的映射只有一处定义（VERDICT_TO_LEVEL），组件不再复制字面量档名', () => {
    const detection = readSource('utils/backup/changeDetection.ts');
    expect(detection).toContain('const VERDICT_TO_LEVEL');
    expect(readSource(NUDGE_BANNER)).not.toMatch(/'never'\s*\|\s*'stale'\s*\|\s*'pending'/);
  });
});

describe('徽标的成本边界', () => {
  it('不为徽标解密任何数据：不 import 加密、会话与整包读密码库', () => {
    const source = readSource(CHIP_COMPOSABLE);
    expect(source).not.toMatch(/from '@\/utils\/(encryption|sessionManager)/);
    expect(source).not.toContain('STORAGE_KEYS.PASSWORDS');
    expect(source).not.toMatch(/getAllPasswords|decryptPasswordEntry/);
  });

  it('不轮询：天数级信息靠事件刷新，不装定时器', () => {
    const source = readSource(CHIP_COMPOSABLE);
    // 判据只看调用面：注释里写「不装 setInterval」正是在解释为什么没有，不该被当成违规
    expect(source).not.toMatch(/setInterval\s*\(/);
    expect(source).toContain('chrome.storage.onChanged.addListener');
  });

  it('监听器成对注册与回收，避免管理页反复进出累积', () => {
    const source = readSource(CHIP_COMPOSABLE);
    expect(source).toContain('onScopeDispose(');
    expect(source).toContain('chrome.storage.onChanged.removeListener(handleStorageChanged)');
  });
});

describe('徽标与轻提醒的出口', () => {
  it('出口按「欠哪一份备份」分派，不把用户送去备错文件', () => {
    const header = readSource(HEADER_BAR);
    // 两个库是两份互不覆盖的备份：密码库走 `.aph` 导出，个人信息库的 `.aphid`
    // 只在库内弹窗里。徽标因身份库亮红时若仍送到 `.aph`，用户照做后红色纹丝不动。
    expect(header).toContain('@click="handleBackupChipClick"');
    expect(header).toContain("if (props.backupChip.worstVault === 'identity') {");
    expect(header).toContain("emit('openIdentity');");
    expect(header).toContain("emit('dataCommand', 'backupExport');");

    const app = readSource(APP);
    expect(app).toContain("if (backupNudge.value?.vault === 'identity') {");
    expect(app).toContain('void openIdentityVaultWithVerify();');
    expect(app).toContain('@backup="handleBackupNudgeAction"');
  });

  it('提醒文案点名对应的文件形态，不写死 .aph', () => {
    const banner = readSource(NUDGE_BANNER);
    // 库 → 扩展名只允许一份映射：主句与「下一份」副句点名的是两个库，各写一遍三元就会漂移。
    expect(banner).toMatch(
      /const fileOf = \(vault: 'passwords' \| 'identity'\)[^\n]*\n?[^\n]*identity' \? '\.aphid' : '\.aph'/,
    );
    expect(banner).toContain('fileOf(props.vault)');
    expect(banner).toContain('fileOf(props.otherVault ?? props.vault)');
    expect(banner).toMatch(/t\('options\.backupNudge\.(never|stale)', \{[^}]*file[^}]*\}\)/);
    expect(readSource(ZH_OPTIONS)).toContain('导出一份 {file}');
    expect(readSource(EN_OPTIONS)).toContain('Export a {file}');
  });

  it('提醒不再宣称导出耗时：那是「派生次数 × 机器速度」的乘积，文案侧无法验证', () => {
    // .aph 走 3 次 PBKDF2 600k（复验 + 加密 + 自检）、.aphid 走 2 次，同一次导出在不同机器上
    // 差好几倍；写死的秒数迟早变成假话。允许的事实是「再验一次主密码」「不改动库里的数据」。
    for (const file of [ZH_OPTIONS, EN_OPTIONS]) {
      const stale = readSource(file).match(/"options\.backupNudge\.stale":\s*"([^"]*)"/);
      expect(stale, `缺少 options.backupNudge.stale：${file}`).not.toBeNull();
      expect(stale![1]).not.toMatch(/秒|second|sec\b/);
    }
  });

  it('横幅点名「下一份」时按同一条出声判据筛库，不把 ok / 空库也说成欠着', () => {
    const app = readSource(APP);
    expect(app).toContain('isVerdictOwedNow(backupChip.value.perVault[other].verdict)');
    expect(app).toContain(':other-vault="backupNudgeOtherVault"');
  });

  it('横幅的 CTA 走强档实底：白字压 --aph-primary 实测只有 2.78:1', () => {
    // 与 `themeContrast.test.ts` 里「strong 压白底 >= 4.5:1」是同一个数（对比度对前后景对称），
    // 那条已证数值；这里只钉管理页那两条实心规则确实把底色换成了强档、hover 也继续压暗。
    const css = readSource('entrypoints/options/styles.css');
    const solid = css.match(/:deep\(\.el-button--primary:not\(\.is-link, \.is-text\)\)\s*\{([^}]*)\}/)?.[1];
    expect(solid, '实心主按钮规则被改名或删掉').toContain('background: var(--aph-primary-strong)');
    expect(css.match(/:deep\(\.el-button--primary:not\(\.is-link, \.is-text\):hover\)\s*\{([^}]*)\}/)?.[1]).toMatch(
      /background: color-mix\(in srgb, var\(--aph-primary-strong\) \d+%, #000\)/,
    );
  });

  it('横幅的两枚动作都够 24px 最小命中区（WCAG 2.5.8）', () => {
    const banner = readSource(NUDGE_BANNER);
    expect(banner).toMatch(/\.backup-nudge__actions :deep\(\.el-button\)\s*\{[^}]*min-height: 24px/);
  });

  it('轻提醒保持收紧：清单在场不出，待备份档还要求本页会话内真的改过数据', () => {
    const app = readSource(APP);
    expect(app).toContain('backupNudgeDismissed.value || showActivationChecklist.value');
    expect(app).toContain("if (chip.level === 'critical') return { state: 'never', days: 0, vault: chip.worstVault };");
    expect(app).toContain("chip.level === 'urgent' && mutatedThisSession.value");
  });

  it('状态不只靠颜色：徽标同时挂 title 与 aria-label，文案按档位分列', () => {
    const header = readSource(HEADER_BAR);
    expect(header).toContain(':title="backupChipDetail"');
    expect(header).toContain(':aria-label="t(\'options.header.backupChipAria\', { detail: backupChipDetail })"');
    for (const key of ['Never', 'Pending', 'Stale', 'Today', 'Days', 'Empty']) {
      expect(header).toContain(`options.header.backupChip${key}`);
    }
  });

  it('横幅的两档也不只靠红 / 橙：图标形状跟着档位换，装饰图标对读屏器隐藏', () => {
    const banner = readSource(NUDGE_BANNER);
    expect(banner).toContain(`<CircleCloseFilled v-if="state === 'never'" />`);
    expect(banner).toMatch(/<el-icon[\s\S]{0,60}aria-hidden="true"/);
    expect(banner).toMatch(/import \{ CircleCloseFilled, WarningFilled \} from '@element-plus\/icons-vue'/);
  });
});
