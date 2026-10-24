import { describe, expect, it } from 'vitest';
import { readSource } from '@/tests/helpers/architectureScan';
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
  ])('%s 无存储访问、网络与复制的清库流程', file => {
    const source = readSource(file);
    expect(source).not.toMatch(/from ['"]@\/utils\/storage/);
    expect(source).not.toMatch(/chrome\.(?:storage|runtime)\./);
    expect(source).not.toMatch(/\b(?:fetch|clearAllData|resetMasterPassword|lockSession)\s*\(/);
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\./);
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
