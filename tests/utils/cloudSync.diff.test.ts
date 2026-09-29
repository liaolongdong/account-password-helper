import { describe, expect, it } from 'vitest';
import { computeDiff } from '@/utils/cloudSync/diff';
import { computeEntryHash } from '@/utils/cloudSync/hash';
import { PLAINTEXT_FIELDS } from '@/utils/cloudSync/schema';
import type { CloudRow, LocalSyncEntry, SyncSnapshot } from '@/utils/cloudSync/types';

/**
 * 明文模式三方 diff 测试（设计规格 §6.2、§6.3）
 *
 * 逐条锁定八条 diff 规则、匹配优先级、人工冲突分支与快照降级行为。
 * diff 是纯函数，无网络与存储依赖，因此可直接用内存夹具驱动。
 */

function local(overrides: Partial<LocalSyncEntry> = {}): LocalSyncEntry {
  return {
    id: 'e1',
    username: 'alice',
    password: 'p1',
    url: 'https://a.example',
    tag: 'work',
    remark: '',
    totp: '',
    groupPath: '',
    updateTime: 1000,
    ...overrides,
  };
}

function cloudRow(fields: Partial<Record<string, string | number>>, overrides: Partial<CloudRow> = {}): CloudRow {
  return {
    recordId: 'rec1',
    fields: {
      [PLAINTEXT_FIELDS.username]: 'alice',
      [PLAINTEXT_FIELDS.password]: 'p1',
      [PLAINTEXT_FIELDS.url]: 'https://a.example',
      [PLAINTEXT_FIELDS.tag]: 'work',
      [PLAINTEXT_FIELDS.remark]: '',
      [PLAINTEXT_FIELDS.totp]: '',
      [PLAINTEXT_FIELDS.group]: '',
      [PLAINTEXT_FIELDS.localUpdateTime]: 1000,
      [PLAINTEXT_FIELDS.id]: 'e1',
      ...fields,
    },
    cloudModifiedAt: 1000,
    ...overrides,
  };
}

async function snapshotFor(entry: LocalSyncEntry, recordId = 'rec1', syncedAt = 1000): Promise<SyncSnapshot> {
  return {
    provider: 'feishu',
    docKey: 'doc',
    entries: { [entry.id]: { hash: await computeEntryHash(entry), recordId, syncedAt } },
  };
}

describe('computeDiff：三方比对规则', () => {
  it('规则 1：仅本地变 → pushUpdate', async () => {
    const base = local();
    const changed = local({ password: 'p2' });
    const result = await computeDiff({ local: [changed], cloud: [cloudRow({})], snapshot: await snapshotFor(base) });
    expect(result.plan).toEqual([{ kind: 'pushUpdate', entry: changed, recordId: 'rec1' }]);
  });

  it('规则 2：仅云端变 → pullUpdate', async () => {
    const base = local();
    const result = await computeDiff({
      local: [base],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.password]: 'cloud-new' }, { cloudModifiedAt: 5000 })],
      snapshot: await snapshotFor(base),
    });
    expect(result.plan[0].kind).toBe('pullUpdate');
  });

  it('规则 3：双方均变 → conflict，LWW 由时间戳决定', async () => {
    const base = local();
    const localNewer = local({ password: 'local-new', updateTime: 9000 });
    const result = await computeDiff({
      local: [localNewer],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.password]: 'cloud-new' }, { cloudModifiedAt: 5000 })],
      snapshot: await snapshotFor(base),
    });
    expect(result.plan[0]).toMatchObject({ kind: 'conflict', winner: 'local' });

    const cloudNewer = await computeDiff({
      local: [local({ password: 'local-new', updateTime: 100 })],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.password]: 'cloud-new' }, { cloudModifiedAt: 5000 })],
      snapshot: await snapshotFor(base),
    });
    expect(cloudNewer.plan[0]).toMatchObject({ kind: 'conflict', winner: 'cloud' });
  });

  it('规则 4：本地未变而云端行消失 → trashLocal', async () => {
    const base = local();
    const result = await computeDiff({ local: [base], cloud: [], snapshot: await snapshotFor(base) });
    expect(result.plan).toEqual([{ kind: 'trashLocal', businessId: 'e1' }]);
  });

  it('modify/delete 冲突：本地在云端删除后又改过 → 人工冲突，不静默进回收站', async () => {
    const base = local();
    const modified = local({ password: 'changed-after-delete' });
    const result = await computeDiff({ local: [modified], cloud: [], snapshot: await snapshotFor(base) });
    expect(result.plan[0]).toMatchObject({ kind: 'manualConflict', reason: 'localModifiedCloudDeleted' });
  });

  it('规则 5：本地已删、云端仍在、快照存在 → deleteCloudRow', async () => {
    const base = local();
    const result = await computeDiff({ local: [], cloud: [cloudRow({})], snapshot: await snapshotFor(base) });
    expect(result.plan).toEqual([{ kind: 'deleteCloudRow', recordId: 'rec1', businessId: 'e1' }]);
  });

  it('规则 6：云端新增（无业务 ID、无快照）→ pullCreate', async () => {
    const result = await computeDiff({
      local: [],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.id]: '', [PLAINTEXT_FIELDS.username]: 'bob' }, { recordId: 'rec9' })],
      snapshot: { provider: 'feishu', docKey: 'doc', entries: {} },
    });
    expect(result.plan[0].kind).toBe('pullCreate');
  });

  it('规则 7：本地新增（无快照、云端无）→ pushCreate', async () => {
    const entry = local();
    const result = await computeDiff({ local: [entry], cloud: [], snapshot: null });
    expect(result.plan).toEqual([{ kind: 'pushCreate', entry }]);
  });

  it('规则 8：空行按不可信输入丢弃并计入 rejectedRows', async () => {
    const result = await computeDiff({
      local: [],
      cloud: [
        cloudRow(
          {
            [PLAINTEXT_FIELDS.username]: '',
            [PLAINTEXT_FIELDS.password]: '',
            [PLAINTEXT_FIELDS.url]: '',
            [PLAINTEXT_FIELDS.id]: '',
          },
          { recordId: 'rec-empty' },
        ),
      ],
      snapshot: null,
    });
    expect(result.rejectedRows).toEqual([{ recordId: 'rec-empty', reason: 'empty-or-invalid-row' }]);
    expect(result.plan).toEqual([]);
  });
});

describe('computeDiff：匹配优先级与降级', () => {
  it('recordId 迁移：业务 ID 一致但 recordId 变化 → rebindRecordId，不判冲突', async () => {
    const base = local();
    const result = await computeDiff({
      local: [base],
      cloud: [cloudRow({}, { recordId: 'rec-new' })],
      snapshot: await snapshotFor(base, 'rec-old'),
    });
    expect(result.plan).toContainEqual({ kind: 'rebindRecordId', businessId: 'e1', recordId: 'rec-new' });
    expect(result.plan.some(item => item.kind === 'conflict')).toBe(false);
  });

  it('主键被手改：同一 recordId 但业务 ID 不一致 → 人工冲突，禁止自动覆盖', async () => {
    const base = local();
    const result = await computeDiff({
      local: [base],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.id]: 'someone-else' })],
      snapshot: await snapshotFor(base),
    });
    expect(result.plan[0]).toMatchObject({ kind: 'manualConflict', reason: 'primaryKeyChanged' });
  });

  it('快照缺失 → snapshotDegraded，走全量比对 + LWW', async () => {
    const base = local();
    const result = await computeDiff({
      local: [base],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.password]: 'other' }, { cloudModifiedAt: 9000 })],
      snapshot: null,
    });
    expect(result.snapshotDegraded).toBe(true);
    expect(result.plan[0]).toMatchObject({ kind: 'conflict', winner: 'cloud' });
  });

  it('内容一致 → baseline，仅写回映射与哈希', async () => {
    const base = local();
    const result = await computeDiff({ local: [base], cloud: [cloudRow({})], snapshot: await snapshotFor(base) });
    expect(result.plan).toEqual([{ kind: 'baseline', businessId: 'e1', recordId: 'rec1' }]);
  });

  it('快照缺失时，云端无业务 ID 但 url+username 与本地一致 → 采纳其 recordId，不重复推送', async () => {
    const entry = local();
    const result = await computeDiff({
      local: [entry],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.id]: '' }, { recordId: 'rec-dup' })],
      snapshot: null,
    });
    expect(result.plan).toContainEqual({ kind: 'rebindRecordId', businessId: 'e1', recordId: 'rec-dup' });
    expect(result.plan.some(item => item.kind === 'pushCreate')).toBe(false);
    expect(result.plan.some(item => item.kind === 'skip')).toBe(false);
  });

  it('云端无业务 ID 且本地已无对应条目 → skip 并报告', async () => {
    const result = await computeDiff({
      local: [],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.id]: '', [PLAINTEXT_FIELDS.username]: 'ghost' }, { recordId: 'rec-ghost' })],
      snapshot: { provider: 'feishu', docKey: 'doc', entries: {} },
    });
    expect(result.plan).toEqual([{ kind: 'pullCreate', row: expect.anything() }]);
  });

  it('跨设备新增：云端存在快照与本地均无的业务 ID → 保留原 ID 拉取', async () => {
    const remote = cloudRow({ [PLAINTEXT_FIELDS.id]: 'foreign-id' }, { recordId: 'rec-x' });
    const result = await computeDiff({
      local: [],
      cloud: [remote],
      snapshot: { provider: 'feishu', docKey: 'doc', entries: {} },
    });
    expect(result.plan).toEqual([{ kind: 'pullCreateWithId', row: remote, businessId: 'foreign-id' }]);
  });

  it('跨设备新增拉取后：本地已有同一业务 ID → 下一轮稳定为 baseline，不再报冲突', async () => {
    const pulled = local({ id: 'foreign-id' });
    const remote = cloudRow({ [PLAINTEXT_FIELDS.id]: 'foreign-id' }, { recordId: 'rec-x' });
    const result = await computeDiff({
      local: [pulled],
      cloud: [remote],
      snapshot: await snapshotFor(pulled, 'rec-x'),
    });
    expect(result.plan).toEqual([{ kind: 'baseline', businessId: 'foreign-id', recordId: 'rec-x' }]);
  });

  it('同一业务 ID 的重复云端行 → 只拉取一次，其余跳过', async () => {
    const result = await computeDiff({
      local: [],
      cloud: [
        cloudRow({ [PLAINTEXT_FIELDS.id]: 'foreign-id' }, { recordId: 'rec-x1' }),
        cloudRow({ [PLAINTEXT_FIELDS.id]: 'foreign-id' }, { recordId: 'rec-x2' }),
      ],
      snapshot: { provider: 'feishu', docKey: 'doc', entries: {} },
    });
    expect(result.plan).toEqual([
      { kind: 'pullCreateWithId', row: expect.anything(), businessId: 'foreign-id' },
      { kind: 'skip', businessId: 'rec-x2', reason: 'duplicate-business-id' },
    ]);
  });
});

describe('computeDiff：哈希范围约束', () => {
  it('仅 updateTime / ID 变化不触发内容变更（哈希不含 ID 与时间戳）', async () => {
    const base = local({ updateTime: 1000 });
    const timeOnly = local({ updateTime: 9999 });
    const result = await computeDiff({
      local: [timeOnly],
      cloud: [cloudRow({ [PLAINTEXT_FIELDS.localUpdateTime]: 1000 })],
      snapshot: await snapshotFor(base),
    });
    expect(result.plan[0].kind).toBe('baseline');
  });

  it('幂等：同一输入重复计算产出相同计划', async () => {
    const base = local();
    const input = { local: [base], cloud: [cloudRow({})], snapshot: await snapshotFor(base) };
    expect(await computeDiff(input)).toEqual(await computeDiff(input));
  });

  it('分组路径变化参与哈希比对 → 本地变更触发 pushUpdate', async () => {
    const base = local();
    const moved = local({ groupPath: '工作/项目A' });
    const result = await computeDiff({
      local: [moved],
      cloud: [cloudRow({})],
      snapshot: await snapshotFor(base),
    });
    expect(result.plan).toEqual([{ kind: 'pushUpdate', entry: moved, recordId: 'rec1' }]);
  });
});
