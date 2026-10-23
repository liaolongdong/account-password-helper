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
  it('点击徽标直达加密备份导出（与菜单同一条 command，不另起一条链路）', () => {
    expect(readSource(HEADER_BAR)).toContain("$emit('dataCommand', 'backupExport')");
    expect(readSource(APP)).toContain('@backup="handleDataCommand(\'backupExport\')"');
  });

  it('轻提醒保持收紧：清单在场不出，待备份档还要求本页会话内真的改过数据', () => {
    const app = readSource(APP);
    expect(app).toContain('backupNudgeDismissed.value || showActivationChecklist.value');
    expect(app).toContain("if (chip.level === 'critical') return { state: 'never', days: 0 };");
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
});
