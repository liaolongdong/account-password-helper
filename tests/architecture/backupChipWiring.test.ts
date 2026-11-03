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
const DETECTION = 'utils/backup/changeDetection.ts';
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
    // 判据已下沉到同域模块（`decideBackupNudge`），入口组件只留装配；两处都要还在：
    // 组件不再自己筛库，改由判据侧用同一条 `isVerdictOwedNow` 决定「下一份」点不点名。
    const app = readSource(APP);
    const detection = readSource(DETECTION);
    expect(app).toContain('decideBackupNudge({ chip: backupChip.value');
    expect(app).toContain(':other-vault="backupNudgeOtherVault"');
    expect(detection).toContain('isVerdictOwedNow(chip.perVault[other].verdict)');
  });

  it('实心主按钮保持品牌浅蓝：主题色由用户拍板，不许为了对比度自行换成深档', () => {
    // 2026-10-26 用户明确要求：按钮主题色必须与品牌图标一致的那支浅蓝。
    // 白字压 `--aph-primary` 确实只有 2.78:1（不达 WCAG AA），但那是**已知取舍**，
    // 由这条锁住，防止下一轮又以「修对比度」的名义把它换成 `--aph-primary-strong`。
    // 要改这个决定，得先改这条判据并拿到用户确认。
    const css = readSource('entrypoints/options/styles.css');
    const solid = css.match(/:deep\(\.el-button--primary:not\(\.is-link, \.is-text\)\)\s*\{([^}]*)\}/)?.[1];
    expect(solid, '实心主按钮规则被改名或删掉').toContain('background: var(--aph-primary)');
    expect(solid, '实心主按钮不许改用强档').not.toContain('--aph-primary-strong');
    const hover = css.match(/:deep\(\.el-button--primary:not\(\.is-link, \.is-text\):hover\)\s*\{([^}]*)\}/)?.[1];
    expect(hover, 'hover 应保持仓库惯例的「提亮一档」').toContain('background: var(--aph-primary-hover)');
    expect(hover, 'hover 不许改用强档或混黑').not.toMatch(/--aph-primary-strong|color-mix/);
  });

  it('横幅的两枚动作都够 24px 最小命中区（WCAG 2.5.8）', () => {
    const banner = readSource(NUDGE_BANNER);
    expect(banner).toMatch(/\.backup-nudge__actions :deep\(\.el-button\)\s*\{[^}]*min-height: 24px/);
  });

  it('轻提醒保持收紧：清单在场不出，待备份档还要求本页会话内真的改过数据', () => {
    const app = readSource(APP);
    const detection = readSource(DETECTION);
    expect(app).toMatch(/backupNudgeDismissed\.value\s*\|\|\s*showActivationChecklist\.value/);
    expect(detection).toContain(
      "if (chip.level === 'critical') return { state: 'never', days: 0, vault: chip.worstVault, otherVault };",
    );
    expect(detection, '「待备份」档若不再要求本会话真的改过数据，每次打开管理页都会推一条噪音').toContain(
      "chip.level === 'urgent' && mutatedThisSession",
    );
  });

  /**
   * 「三路读全才出声」与「关闭跨刷新存活」
   *
   * 两条都是被用户实际抱怨过的：条目数在列表到手那一刻就有、备份时间戳还要再读一次，
   * 中间那段档位算成「从未备份」——每次刷新先闪一条再消失；而关闭标记原先只是一个
   * `ref`，「本次不再提示」实际只等于「本次文档不再提示」，刷新就要重新关一次。
   * 判据钉的是形状：读全门必须排在出声之前，标记必须走内存存储而不是落盘或退回 `ref`。
   */
  it('轻提醒读全三路才出声，关闭态活过刷新但不落盘', () => {
    const app = readSource(APP);
    const dismissal = readSource('utils/backup/nudgeDismissal.ts');
    const chip = readSource(CHIP_COMPOSABLE);
    const keys = readSource('utils/storageKeys.ts');

    expect(app, '横幅又回到「先画一条再收掉」：读全门被摘掉了').toContain('!backupNudgeInputsReady.value');
    expect(app).toContain('backupChipReady.value && activationStateReady.value && backupNudgeDismissalRead.value');
    expect(chip, '徽标不再暴露「第一轮读完了没」，消费方只能继续猜时序').toContain('ready.value = true');

    expect(keys, '关闭标记没登记进 storage.session 键表').toContain("BACKUP_NUDGE_DISMISSED: 'backup_nudge_dismissed'");
    expect(dismissal, '关闭态改走落盘：一次「本次不再提示」不该变成永久静默').toContain('chrome.storage.session');
    expect(dismissal, '同一个模块顺手开始读落盘存储，边界就不清楚了').not.toContain('chrome.storage.local');
    expect(app).toContain('handleBackupNudgeDismiss');
    expect(app, '模板又直接改 ref：关闭只活到本次刷新').toContain('@dismiss="handleBackupNudgeDismiss"');
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

  it('横幅退场收的是高度、不只是淡出，且减动效档整段摘掉', () => {
    // 卡片高度由内容决定，CSS 无法在 `auto` 与 0 之间插值：只挂 opacity 的话，动画结束时
    // 下方内容会整块往上跳一次，比没有动画更扎眼。判据钉三件事——壳在、壳按 grid 收、
    // 减动效档不播（真机侧由 e2e/backup-nudge-lifecycle.spec.ts 量中间高度）。
    const app = readSource(APP);
    const css = readSource('entrypoints/options/styles.css');
    expect(app, '横幅又变回裸 v-if：关闭时那一下跳动回来了').toContain('<Transition name="backup-nudge">');
    expect(app).toContain('class="backup-nudge-shell"');
    expect(css, '壳不是 grid 收放：`auto → 0` 在 CSS 里根本不插值').toMatch(
      /\.backup-nudge-shell \{[^}]*display: grid;[^}]*grid-template-rows: 1fr;/,
    );
    expect(css, 'grid 项没让出自动最小尺寸，0fr 收不动').toMatch(/\.backup-nudge-shell > \* \{[^}]*min-height: 0;/);
    expect(css, '退场只淡不收').toMatch(
      /\.backup-nudge-enter-from,\s*\.backup-nudge-leave-to \{[^}]*grid-template-rows: 0fr;[^}]*opacity: 0;/,
    );
    expect(css, '减动效档没有摘掉横幅过渡：动画成了关不掉的项').toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.backup-nudge-enter-active,[\s\S]*?transition: none;/,
    );
  });
});
