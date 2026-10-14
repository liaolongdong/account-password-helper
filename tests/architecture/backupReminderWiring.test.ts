/**
 * 备份提醒（密码库 + 身份库）的接线守卫
 *
 * 这条链路曾经整条绿着上线过一次：`markBackupDone` 有定义、有导出、进了 `IdentityVault`
 * 类型，却没有任何调用点——于是 `LAST_IDENTITY_BACKUP_AT` 恒为空，`hasPendingIdentityBackup`
 * 对任何非空库都返回 true，提醒条的显隐条件退化回改造前的「有数据就常驻」。
 * `pnpm typecheck` 与 `pnpm lint` 都看不见 `.vue` 的 `<script>` 块（本仓无 vue-tsc），
 * 全量单测也照样 0 红：没有任何一条断言读过这两个函数。因此判据必须落在**使用位**。
 *
 * 各条分别守住一个真实漂移方向：
 * 1. 扫描面非空 + 正向对照（四个判据、三个时间戳读写函数都真的存在）；
 * 2. 加密导出成功后撤提醒，且只在作用域覆盖全库时撤——子集导出留下的是残缺备份；
 * 3. 明文导出不得撤提醒（明文 JSON 不是可长期保管的备份形态）；
 * 4. 增 / 删 / 改 / 导入四条写路径都置「待备份」，其中导入绕开 composable 的 CRUD，
 *    必须由弹窗显式补一次；
 * 5. 提醒条显隐读 `identityBackupPending`，不许退回 `rows.length > 0` 常驻；
 * 6. `markBackupDone` 必须真的落盘时间戳，`load()` 必须真的用判据函数算落盘态；
 * 7. SW 侧：变更时间戳由 `storage.onChanged` 记录，但身份库不得进 `relevantKeys`
 *    （否则每次身份编辑误触发密码缓存失效，把侧边栏打回全量解密）；
 * 8. SW 侧：`verdict === null` 的早退必须排在 `setLastAutoBackupTime()` 之后——
 *    本功能只决定「这一拍要不要响」，不许顺手改闹钟节奏（提醒频率上限是既有承诺）；
 * 9. 变更分支的文案在中英两套都存在且都带 `{count}`。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const DIALOG = 'components/options/IdentityVaultDialog.vue';
const COMPOSABLE = 'composables/useIdentityVault.ts';
const BACKGROUND = 'entrypoints/background/backgroundServices.ts';
const CHANGE_DETECTION = 'utils/backup/changeDetection.ts';
const STORAGE_KEYS = 'utils/storageKeys.ts';
const CONFIG_MANAGER = 'utils/storage/configManager.ts';
const I18N_LITE = 'utils/i18n-lite.ts';

/** 函数体之间的判据窗口（与 `siteFillEntryOverrideWiring` 同口径） */
const GUARD_WINDOW = 400;

/**
 * 取箭头函数体：从声明处到下一个**顶格** `};`
 *
 * 只认顶格闭合，避免把函数体内的 `const countArgs = { ... };`（缩进 2）当成结束。
 * 声明或结束找不到时直接让断言红，而不是返回空串把守卫变成空跑。
 *
 * @param source 源文件全文
 * @param name 函数名（ const 声明）
 * @returns 函数体文本（含声明行）
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = `);
  expect(start, `源文件里找不到 const ${name}：声明形状变了，本条守卫需要跟着调整`).toBeGreaterThan(-1);
  const end = source.indexOf('\n};', start);
  expect(end, `${name} 没有顶格 }; 结尾：提取口径失配`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('备份提醒的接线', () => {
  it('扫描面读到了被测源文件，判据与时间戳读写函数都在（守卫不得静默空跑）', () => {
    for (const file of [DIALOG, COMPOSABLE, BACKGROUND, CHANGE_DETECTION, STORAGE_KEYS, CONFIG_MANAGER, I18N_LITE]) {
      expect(readSource(file).length).toBeGreaterThan(0);
    }
    // 正向对照：四个判据确实导出，六个时间戳读写函数确实存在
    for (const name of [
      'isBackupRelevantPasswordChange',
      'isBackupRelevantIdentityChange',
      'decidePasswordBackupReminder',
      'hasPendingIdentityBackup',
    ]) {
      expect(readSource(CHANGE_DETECTION)).toContain(`export function ${name}`);
    }
    for (const name of [
      'getLastPasswordChangeAt',
      'setLastPasswordChangeAt',
      'getLastIdentityChangeAt',
      'setLastIdentityChangeAt',
      'getLastIdentityBackupAt',
      'markIdentityBackupAt',
    ]) {
      expect(readSource(CONFIG_MANAGER)).toContain(`export async function ${name}`);
    }
  });

  it('加密导出成功后撤提醒，且只在作用域覆盖全库时撤', () => {
    const body = functionBody(readSource(DIALOG), 'handleExport');
    const exportAt = body.indexOf('exportIdentityBackup(targets, masterPassword)');
    const doneAt = body.indexOf('markBackupDone()');
    expect(exportAt, '导出调用形状变了：本条判据需要跟着重新确认').toBeGreaterThan(-1);
    expect(doneAt, 'markBackupDone 又变成无人调用了：提醒会永远常驻（本次改造要修的就是这个）').toBeGreaterThan(-1);
    // 必须在导出真的落盘之后才撤——先撤再导出，导出失败就变成「该提醒却没提醒」
    expect(doneAt).toBeGreaterThan(exportAt);
    // 且必须受全库判据保护：子集导出撤下提醒等于谎报「已经备好了」
    expect(body.slice(Math.max(0, doneAt - GUARD_WINDOW), doneAt)).toContain('targets.length === rows.value.length');
  });

  it('明文导出不撤提醒（不是可长期保管的备份形态）', () => {
    const body = functionBody(readSource(DIALOG), 'handleExportPlaintext');
    expect(body).not.toContain('markBackupDone()');
    // 正向对照：这条函数确实存在且确实做了明文导出，否则上一条的 not.toContain 是空跑
    expect(body).toContain('exportIdentityPlaintext(targets)');
  });

  it('导入写回后补置「待备份」（它绕开了 composable 的 CRUD 路径）', () => {
    const body = functionBody(readSource(DIALOG), 'applyImportedData');
    const writeAt = body.indexOf('replaceAllIdentity(merged.records)');
    const pendingAt = body.indexOf('markBackupPending()');
    expect(writeAt, '导入写回调用了别的函数：本条判据需要跟着重新确认').toBeGreaterThan(-1);
    expect(pendingAt, '导入后没置待备份——SW 落时间戳是异步的，紧随其后的 load() 读不到').toBeGreaterThan(-1);
    expect(pendingAt).toBeGreaterThan(writeAt);
    // 反向对照：导入不得撤提醒（子集文件不等于全库已备好）。判据落在**调用**上，
    // 注释里出现同名函数名不算——把注释写进源文件是常态，扫它只会让守卫脆断。
    expect(body).not.toContain('markBackupDone()');
  });

  it('增 / 删 / 改三条 CRUD 路径各自置待备份', () => {
    const composable = readSource(COMPOSABLE);
    for (const name of ['create', 'update', 'remove']) {
      const start = composable.indexOf(`async function ${name}(`);
      expect(start, `${name} 的声明形状变了`).toBeGreaterThan(-1);
      const window = composable.slice(start, start + GUARD_WINDOW);
      expect(window, `${name} 没再置待备份`).toContain('markBackupPending()');
    }
  });

  it('提醒条显隐读 identityBackupPending，不退回「有数据就常驻」', () => {
    const dialog = readSource(DIALOG);
    const alertIndex = dialog.indexOf('identity-reminder');
    expect(alertIndex, '提醒条的类名变了：本条判据需要跟着重新确认').toBeGreaterThan(-1);
    const alertBlock = dialog.slice(Math.max(0, alertIndex - 600), alertIndex + 60);
    expect(alertBlock).toContain('v-if="identityBackupPending"');
    // 正向对照 + 反向对照：改造前这里就是 rows.length > 0，它一旦回来整条功能等于没做
    expect(alertBlock).not.toMatch(/v-if="rows\.length\s*>\s*0"/);
    expect(dialog).toContain('  identityBackupPending,');
  });

  it('composable 侧：撤提醒真的落盘，落盘态真的由判据函数算出', () => {
    const composable = readSource(COMPOSABLE);
    const doneAt = composable.indexOf('async function markBackupDone');
    expect(doneAt).toBeGreaterThan(-1);
    expect(composable.slice(doneAt, doneAt + GUARD_WINDOW)).toContain('await markIdentityBackupAt()');

    const loadAt = composable.indexOf('persistedBackupPending.value = hasPendingIdentityBackup(');
    expect(loadAt, 'load() 不再用判据函数计算落盘态').toBeGreaterThan(-1);
    // 提醒条的两个信号缺一不可：会话内即时标志 + 落盘结论
    const computedAt = composable.indexOf('const identityBackupPending = computed(');
    expect(computedAt).toBeGreaterThan(-1);
    const computedBlock = composable.slice(computedAt, computedAt + 400);
    expect(computedBlock).toContain('unbackedMutation.value');
    expect(computedBlock).toContain('persistedBackupPending.value');
    // 空库恒不提醒（没有条目就没有可备份的东西）
    expect(computedBlock).toContain('rows.value.length > 0');
  });

  it('SW 侧：onChanged 记录两个时间戳，但身份库不进 relevantKeys', () => {
    const background = readSource(BACKGROUND);
    expect(background).toContain('void recordBackupRelevantChanges(changes)');
    const recorderAt = background.indexOf('async function recordBackupRelevantChanges');
    expect(recorderAt).toBeGreaterThan(-1);
    const recorderBody = background.slice(recorderAt, recorderAt + 1400);
    expect(recorderBody).toContain('await StorageUtils.setLastPasswordChangeAt(now)');
    expect(recorderBody).toContain('await StorageUtils.setLastIdentityChangeAt(now)');

    // relevantKeys 驱动的是密码缓存失效：把 IDENTITY 放进去会让每次身份编辑误触发
    // invalidatePasswordCache()，侧边栏被打回全量解密回温路径（性能承诺直接受影响）
    const keysAt = background.indexOf('const relevantKeys = [');
    expect(keysAt, 'relevantKeys 的声明形状变了：本条判据需要跟着重新确认').toBeGreaterThan(-1);
    const keysBlock = background.slice(keysAt, background.indexOf('];', keysAt));
    expect(keysBlock).toContain('STORAGE_KEYS.PASSWORDS');
    expect(keysBlock).not.toContain('STORAGE_KEYS.IDENTITY');
  });

  it('SW 侧：静默早退排在闹钟时间戳推进之后，且 changed 分支用专属文案', () => {
    const background = readSource(BACKGROUND);
    const advanceAt = background.indexOf('await StorageUtils.setLastAutoBackupTime()');
    const silenceAt = background.indexOf('if (verdict === null)');
    expect(advanceAt).toBeGreaterThan(-1);
    expect(silenceAt, 'verdict 判据没被消费：提醒又变回无条件出声').toBeGreaterThan(-1);
    // 顺序即承诺：先推进时间戳再决定是否出声，闹钟节奏与改造前完全一致
    expect(silenceAt).toBeGreaterThan(advanceAt);
    expect(background).toContain("tl(verdict === 'changed' ? 'bg.backup.messageChanged' : 'bg.backup.message'");
  });

  it('变更分支文案中英两套都在，且都带 {count} 占位符', () => {
    const lite = readSource(I18N_LITE);
    const values = [...lite.matchAll(/'bg\.backup\.messageChanged':\s*\n?\s*'([^']*)'/g)].map(match => match[1]);
    expect(values.length, 'messageChanged 不是恰好两份（zh + en）：提取口径失配').toBe(2);
    for (const value of values) {
      expect(value).toContain('{count}');
    }
  });
});
