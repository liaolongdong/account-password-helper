import type { PasswordEntry } from '@/utils/types';

/**
 * 构造合法的 PasswordEntry 测试夹具
 *
 * 供各 utils 测试共用，避免在多个测试文件中重复维护默认字段。
 * 仅提供满足类型约束的最小默认值，具体字段由 overrides 覆盖。
 *
 * @param overrides 需要覆盖的字段
 * @returns 完整的 PasswordEntry
 */
export function makePasswordEntry(overrides: Partial<PasswordEntry> = {}): PasswordEntry {
  return {
    id: 'id',
    username: 'u',
    password: 'p',
    url: '',
    tag: '',
    remark: '',
    createTime: 0,
    updateTime: 0,
    order: 0,
    ...overrides,
  };
}
