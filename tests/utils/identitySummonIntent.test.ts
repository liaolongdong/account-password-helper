/**
 * 锁定态身份库召唤「解锁后续接」的判据单测
 *
 * `utils/identity/summonIntent.ts` 只回答一个问题：被门禁挡下的那一次召唤还算不算数。
 * 它的消费点在 `entrypoints/options/App.vue` 的 `isAuthenticated` 监听里，而 typecheck / lint
 * 都看不见 `.vue` 的 `<script setup>`（见 AGENTS.md 与既有同族守卫），所以判据必须在纯函数侧自证。
 *
 * 三条不可让的口径：
 * 1. **过期即丢**：自动打开含 PII 的库只在用户仍在这条链路上时才是「替他省一步」；
 * 2. **没有记录就是没有**：`null` 不返回空对象，否则调用方会把「没召唤」读成「召唤但没带词」；
 * 3. **两个标签原样带过**：收口在上游（后台与选项页各一次），这里既不重收窄也不放大——
 *    长度上限只有一份真源，加一道就多了会漂移的地方。
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_SUMMON_TTL_MS, takeIdentitySummon, type PendingIdentitySummon } from '@/utils/identity/summonIntent';

const BASE_MS = 1_800_000_000_000;

/** 造一条记录：默认「刚刚记下」，只覆盖用例关心的那一个标签 */
function pending(overrides: Partial<PendingIdentitySummon> = {}): PendingIdentitySummon {
  return { keyword: '张三', sourceTabId: 7, takenAt: BASE_MS, ...overrides };
}

describe('takeIdentitySummon', () => {
  it('有效期内：两个标签原样交出', () => {
    expect(takeIdentitySummon(pending(), BASE_MS + 1000)).toEqual({ keyword: '张三', sourceTabId: 7 });
  });

  it('恰好卡在 TTL 边界上仍算新鲜（判据是「超过」而不是「达到」）', () => {
    expect(takeIdentitySummon(pending(), BASE_MS + IDENTITY_SUMMON_TTL_MS)).toEqual({
      keyword: '张三',
      sourceTabId: 7,
    });
  });

  it('超过 TTL 一秒即作废：不再自动开窗', () => {
    expect(takeIdentitySummon(pending(), BASE_MS + IDENTITY_SUMMON_TTL_MS + 1)).toBeNull();
  });

  it('时钟回拨超过 TTL 也算过期：负差值不得绕过判据', () => {
    // 系统时间被校正会写出一个「相对当前时刻还在未来」的记下时刻；有符号差值在这里恒为负，
    // 于是那条记录永远过不了期——判据取绝对差，失败方向落在「让用户再右键一次」而不是「很久后自动开窗」
    expect(takeIdentitySummon(pending({ takenAt: BASE_MS + 600_000 }), BASE_MS)).toBeNull();
  });

  it('时钟小幅回拨（TTL 内）不误伤：刚刚记下的那次仍然续得上', () => {
    expect(takeIdentitySummon(pending({ takenAt: BASE_MS + 5_000 }), BASE_MS)).toEqual({
      keyword: '张三',
      sourceTabId: 7,
    });
  });

  it('没有记录时交出 null，而不是一个空对象', () => {
    expect(takeIdentitySummon(null, BASE_MS)).toBeNull();
  });

  /** 不带词是合法形态（右键菜单那条入口本来就不读字段），回程标签独立存在 */
  it('只带来源标签页、或什么都没带，都按原样交出', () => {
    expect(takeIdentitySummon(pending({ keyword: undefined }), BASE_MS)).toEqual({
      keyword: undefined,
      sourceTabId: 7,
    });
    expect(takeIdentitySummon(pending({ keyword: undefined, sourceTabId: undefined }), BASE_MS)).toEqual({
      keyword: undefined,
      sourceTabId: undefined,
    });
  });

  it('`sourceTabId` 为 0（首个标签页）不被当成「没带」', () => {
    expect(takeIdentitySummon(pending({ sourceTabId: 0 }), BASE_MS)).toEqual({ keyword: '张三', sourceTabId: 0 });
  });

  it('判据不改动入参：清记录这件事归调用方，函数保持可重复求值', () => {
    const record = pending();
    takeIdentitySummon(record, BASE_MS + IDENTITY_SUMMON_TTL_MS + 1);
    expect(record).toEqual(pending());
  });
});
