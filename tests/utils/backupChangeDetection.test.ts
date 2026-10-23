/**
 * 备份提醒变更判据单元测试（`utils/backup/changeDetection.ts`）
 *
 * 钉住四件事：
 * 1. 密码侧只把「会让既有 `.aph` 备份过期」的差异算作变更，使用痕迹落盘必须判 false——
 *    否则「越常用密码越常被提醒备份」，与用户诉求正好相反；
 * 2. 同一条判据**不能**与 `isMetadataOnlyChange` 合并：两者对同一批字段的答案相反，
 *    这里用同一份输入把两条答案并排断言，防止后人「顺手抽取公共遍历」时把白名单合一；
 * 3. 身份库没有使用痕迹，所以 `updateTime` 在它是可信信号——同一条差异在密码侧判 false、
 *    在身份侧判 true，这条差值同样并排钉住；
 * 4. 提醒判定与「待备份」状态的分支全覆盖，含三条边界：从未备份、变更时刻与备份时刻同拍、
 *    兜底间隔的严格大于。
 */
import { describe, expect, it } from 'vitest';
import {
  decidePasswordBackupReminder,
  hasPendingIdentityBackup,
  isBackupRelevantIdentityChange,
  isBackupRelevantPasswordChange,
  isKeyRotationBatch,
} from '@/utils/backup/changeDetection';
import { isMetadataOnlyChange } from '@/utils/storage/passwordCrud';

/** 基准时刻（判据只做差值比较，取一个真实量级的毫秒时间戳即可） */
const T0 = 1_700_000_000_000;

/** 密码条目的存储形状（`order` / 使用痕迹都在其中，与 at-rest 条目一致） */
const pwEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'a',
  username: 'u',
  password: 'p',
  url: 'https://example.com',
  tag: '工作',
  remark: '',
  totp: '',
  order: 0,
  favorite: false,
  createTime: T0,
  updateTime: T0,
  lastUsedAt: T0,
  favoriteUsedAt: T0,
  ...overrides,
});

/** 身份记录的存储形状（四个明文键 + 密文，与 `identityCrud` 落盘一致） */
const idRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'a',
  encryptedPayload: 'cipher-a',
  createTime: T0,
  updateTime: T0,
  ...overrides,
});

/** 由两条同形状条目组成新旧数组，只让 `field` 一个键发生变化 */
function differOnlyIn<T extends Record<string, unknown>>(field: keyof T | string, base: T, next: T) {
  const oldRow = { ...base, [field]: base[field] };
  const newRow = { ...base, [field]: next[field] };
  return { oldValue: [oldRow], newValue: [newRow] };
}

describe('isBackupRelevantPasswordChange（密码侧「内容变了没」）', () => {
  it('完全无差异 → 不提醒', () => {
    const rows = [pwEntry(), pwEntry({ id: 'b', order: 1 })];
    expect(isBackupRelevantPasswordChange(rows, [...rows])).toBe(false);
  });

  it('空库对空库 → 不算变更', () => {
    expect(isBackupRelevantPasswordChange([], [])).toBe(false);
  });

  it('仅使用痕迹落盘 → 不算变更（每次自动填充都会 bump 这三个键）', () => {
    for (const field of ['lastUsedAt', 'favoriteUsedAt', 'updateTime']) {
      const { oldValue, newValue } = differOnlyIn(field, pwEntry(), pwEntry({ [field]: T0 + 60_000 }));
      expect(isBackupRelevantPasswordChange(oldValue, newValue), `${field} 落盘被判成变更`).toBe(false);
    }
    // 一次元数据 flush 同时 bump 三个键（flushMetadataUpdates 的行为），同样必须判 false
    const flushed = [pwEntry({ lastUsedAt: T0 + 1, favoriteUsedAt: T0 + 1, updateTime: T0 + 1 })];
    expect(isBackupRelevantPasswordChange([pwEntry()], flushed)).toBe(false);
  });

  it('条数变化（新增 / 删除）→ 算变更', () => {
    expect(isBackupRelevantPasswordChange([pwEntry()], [pwEntry(), pwEntry({ id: 'b', order: 1 })])).toBe(true);
    expect(isBackupRelevantPasswordChange([pwEntry(), pwEntry({ id: 'b' })], [pwEntry()])).toBe(true);
  });

  it('条目重排（id 序列错位，拖拽排序的路径）→ 算变更', () => {
    const a = pwEntry({ id: 'a', order: 0 });
    const b = pwEntry({ id: 'b', order: 1 });
    expect(isBackupRelevantPasswordChange([a, b], [b, a])).toBe(true);
  });

  it('密文变化（编辑条目或换主密码重加密）→ 算变更', () => {
    expect(isBackupRelevantPasswordChange([pwEntry()], [pwEntry({ password: 'p2' })])).toBe(true);
  });

  it('形状不明（首次写入、存储损坏）→ 保守判为变更', () => {
    // 漏报的代价是用户丢数据，误报的代价只是多一条通知
    expect(isBackupRelevantPasswordChange(undefined, [pwEntry()])).toBe(true);
    expect(isBackupRelevantPasswordChange([pwEntry()], undefined)).toBe(true);
    expect(isBackupRelevantPasswordChange('oops', [pwEntry()])).toBe(true);
  });

  it('字段被整体抹掉（旧值有、新值无）→ 算变更', () => {
    const oldRow = { ...pwEntry(), extra: 'x' };
    expect(isBackupRelevantPasswordChange([oldRow], [pwEntry()])).toBe(true);
  });
});

describe('两条密码判据的答案差（禁止合并白名单）', () => {
  /** 会进 `.aph` 的元数据：favorite / tag 逐字段序列化，排序体现为条目序列 */
  const BACKED_UP_META_FIELDS = ['favorite', 'tag', 'order'];
  /** 使用痕迹：既免重新解密，也免提醒 */
  const USAGE_TRACE_FIELDS = ['lastUsedAt', 'favoriteUsedAt', 'updateTime'];

  it('元数据单键变化：两判据都要放行，但对「要不要提醒」答案相反', () => {
    for (const field of [...BACKED_UP_META_FIELDS, ...USAGE_TRACE_FIELDS]) {
      const { oldValue, newValue } = differOnlyIn(field, pwEntry(), pwEntry({ [field]: field === 'tag' ? '生活' : 7 }));
      // 正向对照：这些键确实都在重新解密白名单里（否则下面的对比失去意义）
      expect(isMetadataOnlyChange(oldValue, newValue), `${field} 已不在 METADATA_FIELDS`).toBe(true);
      expect(isBackupRelevantPasswordChange(oldValue, newValue), field).toBe(BACKED_UP_META_FIELDS.includes(field));
    }
  });

  it('敏感字段变化：需要重新解密（false），且必然算备份变更（true）', () => {
    const { oldValue, newValue } = differOnlyIn('username', pwEntry(), pwEntry({ username: 'other' }));
    expect(isMetadataOnlyChange(oldValue, newValue)).toBe(false);
    expect(isBackupRelevantPasswordChange(oldValue, newValue)).toBe(true);
  });
});

describe('isBackupRelevantIdentityChange（身份库无可忽略字段）', () => {
  it('完全无差异 / 空库 → 不算变更', () => {
    const rows = [idRecord(), idRecord({ id: 'b' })];
    expect(isBackupRelevantIdentityChange(rows, [...rows])).toBe(false);
    expect(isBackupRelevantIdentityChange([], [])).toBe(false);
  });

  it('updateTime 单键变化：身份侧算变更，而同一形状喂给密码侧判 false', () => {
    // 身份记录没有使用痕迹，所以 `updateTime` 在库里就是可信的变更信号；
    // 密码侧必须忽略它（每次自动填充都会 bump），两条判据因此不能共用同一份白名单。
    const { oldValue, newValue } = differOnlyIn('updateTime', idRecord(), idRecord({ updateTime: T0 + 1 }));
    expect(isBackupRelevantIdentityChange(oldValue, newValue)).toBe(true);
    expect(isBackupRelevantPasswordChange(oldValue, newValue)).toBe(false);
  });

  it('密文 / 新增 / 删除 / 重排 / 首次写入 → 全部算变更', () => {
    expect(isBackupRelevantIdentityChange([idRecord()], [idRecord({ encryptedPayload: 'cipher-b' })])).toBe(true);
    expect(isBackupRelevantIdentityChange([idRecord()], [idRecord(), idRecord({ id: 'b' })])).toBe(true);
    expect(isBackupRelevantIdentityChange([idRecord(), idRecord({ id: 'b' })], [idRecord()])).toBe(true);
    const a = idRecord({ id: 'a' });
    const b = idRecord({ id: 'b' });
    expect(isBackupRelevantIdentityChange([a, b], [b, a])).toBe(true);
    expect(isBackupRelevantIdentityChange(undefined, [idRecord()])).toBe(true);
  });
});

describe('isKeyRotationBatch（换钥匙批次不算内容变更）', () => {
  it('同批带上新包裹数据密钥 = rekey，判 true（不该刷新待备份时间戳）', () => {
    expect(isKeyRotationBatch({ oldValue: 'old-wrap', newValue: 'new-wrap' })).toBe(true);
  });

  it('该键被移除是锁定语义，判 false（否则上锁会吞掉紧随其后的真实变更）', () => {
    expect(isKeyRotationBatch({ oldValue: 'old-wrap', newValue: undefined })).toBe(false);
  });

  it('该键不在这一批里（普通增删改）判 false', () => {
    expect(isKeyRotationBatch(undefined)).toBe(false);
  });

  it('只看「有没有被换成新值」，不看新值真假：空串/null 也算换过', () => {
    expect(isKeyRotationBatch({ newValue: '' })).toBe(true);
    expect(isKeyRotationBatch({ newValue: null })).toBe(true);
  });
});

describe('decidePasswordBackupReminder（这一拍要不要出声）', () => {
  const FLOOR = 7 * 24 * 60 * 60 * 1000;
  const input = (overrides: Record<string, unknown> = {}) => ({
    lastChangeAt: null as number | null,
    lastVerifiedBackupAt: T0 as number | null,
    floorMs: FLOOR,
    now: T0,
    ...overrides,
  });

  it('从未成功导出过 .aph → stale（无法证明有备份，保持既有行为）', () => {
    expect(decidePasswordBackupReminder(input({ lastVerifiedBackupAt: null }))).toBe('stale');
    expect(decidePasswordBackupReminder(input({ lastVerifiedBackupAt: null, lastChangeAt: T0 + 1 }))).toBe('stale');
  });

  it('备份之后有内容变更 → changed', () => {
    expect(decidePasswordBackupReminder(input({ lastChangeAt: T0 + 1, now: T0 + 1000 }))).toBe('changed');
  });

  it('变更时刻与备份同拍（写入先后竞态）→ 不谎报 changed', () => {
    // 相等不算「之后」：提醒退到兜底下限，宁可少说一次也不虚报内容变了
    expect(decidePasswordBackupReminder(input({ lastChangeAt: T0, now: T0 }))).toBeNull();
  });

  it('无变更且未超兜底下限 → 静默', () => {
    expect(decidePasswordBackupReminder(input({ now: T0 + FLOOR }))).toBeNull();
  });

  it('无变更但距上次成功备份超过兜底下限 → stale（严格大于）', () => {
    expect(decidePasswordBackupReminder(input({ now: T0 + FLOOR + 1 }))).toBe('stale');
  });

  it('存量数据（lastChangeAt 为 null）但已有备份且未超下限 → 静默', () => {
    expect(decidePasswordBackupReminder(input({ lastChangeAt: null, now: T0 + 60_000 }))).toBeNull();
  });

  it('变更早于备份 → 不重复提醒同一次变更', () => {
    expect(decidePasswordBackupReminder(input({ lastChangeAt: T0 - 1000, now: T0 + 60_000 }))).toBeNull();
  });
});

describe('hasPendingIdentityBackup（身份库是否还有未备份的变更）', () => {
  const records = (...ages: number[]) => ages.map(age => ({ createTime: T0 - age, updateTime: T0 - age }));

  it('空库恒不提醒（哪怕从未备份过）', () => {
    expect(hasPendingIdentityBackup({ records: [], lastChangeAt: null, lastBackupAt: null })).toBe(false);
  });

  it('从未完整导出过 + 有条目 → 提醒', () => {
    expect(hasPendingIdentityBackup({ records: records(1000), lastChangeAt: null, lastBackupAt: null })).toBe(true);
  });

  it('存在创建或更新时间晚于上次备份的条目 → 提醒', () => {
    const backupAt = T0;
    expect(
      hasPendingIdentityBackup({
        records: [{ createTime: backupAt + 1, updateTime: backupAt - 9 }],
        lastChangeAt: null,
        lastBackupAt: backupAt,
      }),
    ).toBe(true);
    expect(
      hasPendingIdentityBackup({
        records: [{ createTime: backupAt - 9, updateTime: backupAt + 1 }],
        lastChangeAt: null,
        lastBackupAt: backupAt,
      }),
    ).toBe(true);
  });

  it('删除最新一条：记录看起来都已备份，靠 lastChangeAt 补上', () => {
    // 删除会让记录消失，单看 `records` 反而「全部早于上次备份」，这条判据专用于补该盲区
    const backupAt = T0;
    expect(
      hasPendingIdentityBackup({ records: records(9000, 8000), lastChangeAt: backupAt + 1, lastBackupAt: backupAt }),
    ).toBe(true);
  });

  it('都已备份且无后续变更 → 不提醒', () => {
    const backupAt = T0;
    expect(hasPendingIdentityBackup({ records: records(9000, 8000), lastChangeAt: null, lastBackupAt: backupAt })).toBe(
      false,
    );
    expect(
      hasPendingIdentityBackup({ records: records(9000, 8000), lastChangeAt: backupAt - 1, lastBackupAt: backupAt }),
    ).toBe(false);
  });

  it('相等的时间戳不算晚于（同拍写入不谎报）', () => {
    const backupAt = T0;
    expect(
      hasPendingIdentityBackup({
        records: [{ createTime: backupAt, updateTime: backupAt }],
        lastChangeAt: backupAt,
        lastBackupAt: backupAt,
      }),
    ).toBe(false);
  });
});
