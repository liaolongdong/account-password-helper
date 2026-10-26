import { describe, expect, it } from 'vitest';
import { computeImportClosure, readSource } from '@/tests/helpers/architectureScan';
import zhOptions from '@/utils/i18n/locales/zh-CN/options.json';
import enOptions from '@/utils/i18n/locales/en/options.json';

/** 只增补验证子组件约束，不替代或放松 masterPasswordHintWiring 的原有守卫。 */
describe('忘记主密码向导先验证备份', () => {
  it('验证区随向导关闭立即卸载，而不是等关闭动画或仅隐藏', () => {
    const source = readSource('components/options/ForgotPasswordDialog.vue');
    expect(source).toMatch(/<BackupCheckPanel\s+v-if="modelValue"\s*\/>/);
    expect(source).toContain("import BackupCheckPanel from './BackupCheckPanel.vue';");
    expect(source).toMatch(/modelValue: boolean;/);
    expect(source).toContain("emit('reset')");
  });

  it.each([
    'components/options/ForgotPasswordDialog.vue',
    'components/options/BackupCheckPanel.vue',
    'utils/backup/verifyBackupFile.ts',
  ])('%s 本文件不直接引用存储层、不发网络、不清库', file => {
    const source = readSource(file);
    expect(source).not.toMatch(/from ['"]@\/utils\/storage/);
    expect(source).not.toMatch(/chrome\.(?:storage|runtime)\./);
    expect(source).not.toMatch(/\b(?:fetch|clearAllData|resetMasterPassword|lockSession)\s*\(/);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\./);
  });

  /**
   * 闭包层面的真实边界：只读地查配置可以，触到会话与认证材料写入不行
   *
   * 上面那条单文件正则只能证「本文件不直接 import 存储」，而设计文档当初写的是向导
   * 「不 import 存储与加密模块」（评审报告 P2-22 指出这已成假话）。两者不等价：
   * `BackupCheckPanel` → `verifyBackupFile` → `backupExport` → `storage/configManager`
   * 是一条真实存在的**只读**链。与其把守卫措辞缩到刚好能过，不如把话说准并钉住那条
   * 真正不能越的线——验证区不许碰到会话密钥、校验哈希、改密与回收站这类写侧模块；
   * 谁把写路径接进验证区，这条立刻变红。
   */
  it('验证区的 import 闭包止于只读路径，不触会话与认证材料写入', () => {
    const closure = [...computeImportClosure(['components/options/BackupCheckPanel.vue'])];
    // 先确认闭包真的算出来了，否则下面每一条 not.toContain 都会空过
    expect(closure, '闭包为空说明扫描失效').toContain('utils/backupExport.ts');
    expect(closure, '只读验证确实会经 backupExport 读到 configManager，这条事实要留在判据里而不是藏进注释').toContain(
      'utils/storage/configManager.ts',
    );
    for (const forbidden of [
      'utils/sessionManager.ts',
      'utils/sessionManager-storage.ts',
      'utils/encryption.ts',
      'utils/storage/masterPassword.ts',
      'utils/storage/changeMasterPassword.ts',
      'utils/storage/recovery.ts',
      'utils/storage/passwordCrud.ts',
      'utils/storage/trashManager.ts',
    ]) {
      expect(closure, `验证区闭包里出现了写侧模块 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('中英文均先验证、再在隔离环境核对，最后才考虑清库', () => {
    expect(zhOptions['options.forgot.backupStep1']).toMatch(/验证/);
    expect(enOptions['options.forgot.backupStep1']).toMatch(/verify/i);
    expect(zhOptions['options.forgot.backupStep1']).not.toMatch(/重置|清空/);
    expect(enOptions['options.forgot.backupStep1']).not.toMatch(/reset|erase/i);
    expect(zhOptions['options.forgot.backupStep2']).toMatch(/独立.*Profile/);
    expect(enOptions['options.forgot.backupStep2']).toMatch(/separate.*profile/i);
    expect(zhOptions['options.forgot.backupStep3']).toMatch(/最后/);
    expect(enOptions['options.forgot.backupStep3']).toMatch(/last/i);
    expect(zhOptions['options.forgot.lead']).not.toContain('成功率');
    expect(enOptions['options.forgot.lead']).not.toContain('likelihood of success');
  });

  it('验证区所有静态文案在中英文 options 中成对注册', () => {
    const source = readSource('components/options/BackupCheckPanel.vue');
    const keys = [...source.matchAll(/t\('(options\.forgot\.[^']+)'/g)].map(match => match[1]!);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect((zhOptions as Record<string, string>)[key], key).toBeTruthy();
      expect((enOptions as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
