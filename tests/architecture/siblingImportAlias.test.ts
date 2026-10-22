/**
 * 同目录兄弟模块的导入方式守卫（存量登记 + 只准减不准增）
 *
 * `AGENTS.md`「同目录文件使用 `./`；其他本地模块使用已配置的 `@/` 别名」与
 * `.qoder/rules/wxt-rules.md` 第 5 条是同一条硬约束，但仓库**存量**大面积按 `@/` 写：
 * 2026-10-18 实测 82 个文件、172 处（见下方登记表）。ESLint / typecheck 都不查这一项，
 * 所以它不会因新增一处而让任何门禁变红——本守卫把「不再新增」这件事固化成断言。
 *
 * 判据只认**兄弟模块**：说明符解析后的目录 == 引用方所在目录。跨目录的 `@/utils/...`
 * 是别名用法的正题，不在登记范围内；`./xxx` 与 `../xxx` 一律放行。
 *
 * 为什么是登记表而不是全仓整改：一次性把 82 个文件的说明符换成相对路径属全仓库重构，
 * 会制造一个纯机械的超大 diff（AGENTS.md「不扩展成全仓库重构」「不得为『符合规范』
 * 重排存量」），且与任何当前任务无关。因此本轮只把**新写的那一处在同一个 import 块里
 * 分裂口径**的问题改掉（`entrypoints/content/FormDetector.ts` 六处），并把其余存量登记在此。
 *
 * 三条纪律：
 * 1. 新增一处即红（登记表对不上）；
 * 2. 顺手清理也要**同步删表**，防止登记表虚高后没人发现守卫已失效；
 * 3. 判据自检用合成源码验证，扫描规模有下限断言，避免目录漂移时静默空跑。
 */
import { describe, expect, it } from 'vitest';
import { extractSpecifiers, listSourceFiles, readSource, resolveSpecifier } from '../helpers/architectureScan';

/** 扫描范围：会被打包或运行的源码目录，与 `lintBypassInventory` 同口径（不含 `e2e/`、`tests/`） */
const SCANNED_DIRS = ['components', 'composables', 'entrypoints', 'utils'];

/** 存量登记：文件 → 同目录别名导入处数（2026-10-18 实测，只准减不准增） */
const EXISTING_INVENTORY: Record<string, number> = {
  'components/options/BackupImportDialog.vue': 1,
  'components/options/ChangeMasterPasswordDialog.vue': 1,
  'components/options/IdentityVaultDialog.vue': 1,
  'components/options/ImportDialog.vue': 1,
  'components/options/MasterPasswordSetupView.vue': 3,
  'components/options/PasswordFormDialog.vue': 2,
  'components/options/PasswordHealthDialog.vue': 1,
  'components/options/PasswordTable.vue': 1,
  'components/options/PasswordVerifyView.vue': 2,
  'components/options/TrashDialog.vue': 1,
  'components/sidepanel/SidepanelAuthView.vue': 1,
  'composables/useIdentityVault.ts': 1,
  'composables/usePasswordManagement.ts': 4,
  'composables/usePopupInit.ts': 3,
  'composables/useSessionTimer.ts': 1,
  'composables/useSidepanelData.ts': 2,
  'entrypoints/content/CheckboxHandler.ts': 1,
  'entrypoints/content/InputFiller.ts': 1,
  'entrypoints/content/LoginAutoSave.ts': 4,
  'entrypoints/content/LoginFormAnalyzer.ts': 2,
  'entrypoints/content/NativeNotification.ts': 1,
  'entrypoints/content/PasswordVisibilityToggle.ts': 1,
  'entrypoints/content/SavePasswordPrompt.ts': 1,
  'entrypoints/content/contextMenuTarget.ts': 1,
  'entrypoints/content/floatingButtons/AnimationController.ts': 1,
  'entrypoints/content/floatingButtons/DragHandler.ts': 2,
  'entrypoints/content/floatingButtons/FloatingButtonManager.ts': 5,
  'entrypoints/content/floatingButtons/SettingsPanel.ts': 2,
  'entrypoints/content/floatingButtons/index.ts': 7,
  'entrypoints/content/floatingButtons/settingsPanelView.ts': 3,
  'entrypoints/content/floatingButtons/styles.ts': 1,
  'entrypoints/content/floatingButtons/types.ts': 1,
  'entrypoints/options/main.ts': 1,
  'entrypoints/popup/main.ts': 1,
  'entrypoints/sidepanel/main.ts': 1,
  'utils/backup/parseBackupEntries.ts': 1,
  'utils/backupExport.ts': 5,
  'utils/browserStartupRelock.ts': 1,
  'utils/capturedTag.ts': 1,
  'utils/clipboard.ts': 1,
  'utils/commandPalette.ts': 1,
  'utils/constants.ts': 2,
  'utils/contentScriptReadiness.ts': 1,
  'utils/dialogScroll.ts': 1,
  'utils/emailBackup.ts': 3,
  'utils/encryption.ts': 5,
  'utils/excel.ts': 5,
  'utils/excelCsv.ts': 3,
  'utils/excelExport.ts': 3,
  'utils/excelJson.ts': 2,
  'utils/favicon.ts': 2,
  'utils/fillEntry.ts': 1,
  'utils/formValidators.ts': 2,
  'utils/frameFill.ts': 4,
  'utils/i18n-lite.ts': 2,
  'utils/identityVaultAccess.ts': 1,
  'utils/lazyImport.ts': 1,
  'utils/logger.ts': 1,
  'utils/masterPasswordVerify.ts': 1,
  'utils/passphraseGenerator.ts': 1,
  'utils/passwordFilter.ts': 5,
  'utils/passwordHealth.ts': 2,
  'utils/passwordSort.ts': 2,
  'utils/pendingCredentialCodec.ts': 1,
  'utils/perfMetrics.ts': 2,
  'utils/platform.ts': 2,
  'utils/preWarmSw.ts': 1,
  'utils/qrScanner.ts': 1,
  'utils/sessionLock.ts': 3,
  'utils/sessionManager-storage.ts': 9,
  'utils/sessionManager.ts': 3,
  'utils/shareCard.ts': 1,
  'utils/shortcutCommands.ts': 4,
  'utils/siteRulesTransfer.ts': 3,
  'utils/siteUtils.ts': 2,
  'utils/storage/passwordHistory.ts': 1,
  'utils/tagUtils.ts': 3,
  'utils/theme.ts': 1,
  'utils/types.ts': 3,
  'utils/updateChecker.ts': 5,
  'utils/warmSidePanelResources.ts': 3,
  'utils/weakPasswordDict.ts': 1,
};

/**
 * 一个文件里的同目录别名导入处数
 *
 * 动态 `import()` 与 `import type` 一并计入：本守卫管的是**写法口径**（读代码时能不能一眼
 * 看出是同目录兄弟），不是产物依赖图，故不做类型层豁免。
 */
function countSiblingAliasImports(file: string, source: string): number {
  const ownDir = file.slice(0, file.lastIndexOf('/'));
  let count = 0;
  for (const { spec } of extractSpecifiers(source)) {
    if (!spec.startsWith('@/')) continue;
    const resolved = resolveSpecifier(spec, file);
    if (resolved && resolved.slice(0, resolved.lastIndexOf('/')) === ownDir) count += 1;
  }
  return count;
}

/** 折叠成 `file=count` 的可比较形状（两侧同一形状，避免格式漂移） */
function tally(pairs: [string, number][]): string[] {
  return pairs.map(([file, count]) => `${file}=${count}`).sort();
}

describe('同目录别名导入存量登记（只准减不准增）', () => {
  const scanned = SCANNED_DIRS.flatMap(dir => listSourceFiles(dir));

  it('扫描规模有下限，目录漂移时不允许静默空跑', () => {
    expect(scanned.length).toBeGreaterThan(200);
    const hits = scanned.reduce((sum, file) => sum + countSiblingAliasImports(file, readSource(file)), 0);
    expect(hits).toBe(Object.values(EXISTING_INVENTORY).reduce((a, b) => a + b, 0));
  });

  it('逐文件计数与登记表完全一致：新增一处、或删了代码却没同步删表，都当场变红', () => {
    const found = scanned
      .map((file): [string, number] => [file, countSiblingAliasImports(file, readSource(file))])
      .filter(([, count]) => count > 0);

    expect(tally(found)).toEqual(tally(Object.entries(EXISTING_INVENTORY)));
  });

  it('本轮改动的文件必须干净：FormDetector 六处已改回 ./（评审 P1-3 收口）', () => {
    const file = 'entrypoints/content/FormDetector.ts';
    expect(countSiblingAliasImports(file, readSource(file))).toBe(0);
  });
});

describe('判据自检（合成源码，不往仓库里塞假违规）', () => {
  /**
   * 说明符必须解析到**真实存在**的文件：`architectureScan` 的 `resolveSpecifier` 靠 statSync
   * 选 `.ts`/`.vue`/`index.ts` 候选，不存在的目标返回 null 而被跳过。
   * 因此这里一律借用仓库里真有的模块路径（`utils/types.ts`），但引用方文件是合成的。
   */
  it('同目录兄弟走 @/ 别名 → 命中（静态与动态 import 都算）', () => {
    expect(countSiblingAliasImports('utils/sessionLock.ts', `import { t } from '@/utils/types';`)).toBe(1);
    expect(countSiblingAliasImports('utils/sessionLock.ts', `const m = await import('@/utils/types');`)).toBe(1);
  });

  it('同目录兄弟走 ./ → 不命中（这正是规范写法）', () => {
    expect(countSiblingAliasImports('utils/sessionLock.ts', `import { t } from './types';`)).toBe(0);
  });

  it('跨目录使用 @/ 别名 → 不命中（别名用法的正题，不在登记范围）', () => {
    expect(countSiblingAliasImports('utils/storage/whatever.ts', `import { t } from '@/utils/types';`)).toBe(0);
    expect(countSiblingAliasImports('utils/sessionLock.ts', `import { g } from '@/utils/storage/getConfig';`)).toBe(0);
  });

  it('外部包说明符 → 不命中', () => {
    expect(countSiblingAliasImports('utils/sessionLock.ts', `import { ref } from 'vue';`)).toBe(0);
  });
});
