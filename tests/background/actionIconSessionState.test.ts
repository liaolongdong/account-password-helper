/**
 * 工具栏图标的会话状态切换（entrypoints/background/actionIcon）
 *
 * 钉四件「改坏了不会报错、但会静默错相」的事：
 *
 * ① **档位与路径的对应**。锁定态必须整体落在 `icon/locked/` 下——那批 PNG 由
 *    `scripts/generate-icons.mjs` 从 `assets/icons/icon-locked.svg` 生成，路径写错就是
 *    Chrome 静默不切换（`setIcon` 对不存在的资源只报一次错），用户看到的仍是解锁态钥匙。
 * ② **档位去重不等于状态冻结**。同一档位重复刷新只应调用一次 `setIcon`（storage 事件成批
 *    到达时不重复重绘），但档位真的变了必须重新应用；`_appliedState` 只在成功时置位，
 *    否则一次瞬时失败会把图标永久钉在错的那一档。
 * ③ **不越界到角标通道**。角标是「刚刚发生了什么」的一次性回执（✓ / ! / new），图标是
 *    「现在能不能用」的持续状态，两者互不覆写是本轮的设计前提。
 * ④ **不顺手触发 at-rest 密文检查**。`isSessionValid` 的后台分支会 fire-and-forget 跑一次
 *    全库密文化检查；图标刷新挂在 storage 事件上，漏了 `skipConsistencyCheck` 就等于给
 *    每次会话键变更都附加一次整库扫描。
 *
 * 每个用例重新 `import` 一次被测模块：档位镜像是模块级状态，共用实例会让用例互相依赖顺序。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMocks = vi.hoisted(() => ({
  isSessionValid: vi.fn(async () => true),
}));

vi.mock('@/utils/sessionManager-storage', () => sessionMocks);
vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** 一次 setIcon 调用的实参形状（与 chrome.action.setIcon 的 path 档一致） */
interface SetIconCall {
  path: Record<string, string>;
}

/** 解锁态与锁定态各自应有的四档路径（与 ICON_PATHS 逐字对齐） */
const UNLOCKED_PATH = { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png' };
const LOCKED_PATH = {
  '16': 'icon/locked/16.png',
  '32': 'icon/locked/32.png',
  '48': 'icon/locked/48.png',
  '128': 'icon/locked/128.png',
};

type ActionIconModule = typeof import('@/entrypoints/background/actionIcon');

let mod: ActionIconModule;
let setIcon: ReturnType<typeof vi.fn<(details: SetIconCall) => Promise<void>>>;
let setBadgeText: ReturnType<typeof vi.fn>;

/** 重置模块图，拿到一份档位镜像归零的全新实现 */
const loadModule = async (): Promise<void> => {
  vi.resetModules();
  mod = await import('@/entrypoints/background/actionIcon');
};

beforeEach(async () => {
  sessionMocks.isSessionValid.mockReset().mockResolvedValue(true);
  setIcon = vi.fn(async (_details: SetIconCall) => undefined);
  setBadgeText = vi.fn(async () => undefined);
  vi.spyOn(chrome.action, 'setIcon').mockImplementation(setIcon as never);
  vi.spyOn(chrome.action, 'setBadgeText').mockImplementation(setBadgeText as never);
  await loadModule();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 第 N 次 setIcon 调用实际传入的路径表 */
const pathOfCall = (index: number): Record<string, string> => setIcon.mock.calls[index][0].path;

describe('refreshActionIcon 按会话状态切档', () => {
  it('会话有效应用解锁态四档路径', async () => {
    await mod.refreshActionIcon();

    expect(setIcon).toHaveBeenCalledTimes(1);
    expect(setIcon).toHaveBeenCalledWith({ path: UNLOCKED_PATH });
  });

  it('会话无效应用锁定态，且每一档都落在 icon/locked/ 下', async () => {
    sessionMocks.isSessionValid.mockResolvedValue(false);

    await mod.refreshActionIcon();

    expect(pathOfCall(0)).toEqual(LOCKED_PATH);
    // 锁定态不得复用解锁态产物：两档共用一个目录，「一眼看出是否锁定」就失效了
    for (const size of ['16', '32', '48', '128']) {
      expect(pathOfCall(0)[size], `${size}px 档不是锁定态产物`).toContain('icon/locked/');
    }
  });

  it('校验会话时跳过 at-rest 密文检查', async () => {
    await mod.refreshActionIcon();

    expect(sessionMocks.isSessionValid).toHaveBeenCalledWith({ skipConsistencyCheck: true });
  });

  it('只改图标，不触碰角标通道', async () => {
    sessionMocks.isSessionValid.mockResolvedValue(false);

    await mod.refreshActionIcon();

    expect(setIcon).toHaveBeenCalledTimes(1);
    expect(setBadgeText).not.toHaveBeenCalled();
  });
});

describe('档位去重与失败重试', () => {
  it('同一档位重复刷新只重绘一次，档位变化必须重新应用', async () => {
    await mod.refreshActionIcon();
    await mod.refreshActionIcon();
    expect(setIcon).toHaveBeenCalledTimes(1);

    sessionMocks.isSessionValid.mockResolvedValue(false);
    await mod.refreshActionIcon();
    expect(setIcon).toHaveBeenCalledTimes(2);
    expect(pathOfCall(1)).toEqual(LOCKED_PATH);
  });

  it('setActionIconState 与刷新共用同一份档位镜像', async () => {
    sessionMocks.isSessionValid.mockResolvedValue(false);

    mod.setActionIconState('locked');
    expect(pathOfCall(0)).toEqual(LOCKED_PATH);

    // 已知档位与刷新结果一致时不再重绘：两处共用同一份镜像，而不是各记各的账
    await mod.refreshActionIcon();
    expect(setIcon).toHaveBeenCalledTimes(1);
  });

  it('setIcon 失败不抛出、不记入已应用档位，下一次刷新会重试', async () => {
    setIcon.mockRejectedValueOnce(new Error('Extension context invalidated'));

    await expect(mod.refreshActionIcon()).resolves.toBeUndefined();
    expect(setIcon).toHaveBeenCalledTimes(1);

    await mod.refreshActionIcon();
    expect(setIcon).toHaveBeenCalledTimes(2);
  });
});

describe('在途档位切换的收敛（异步竞态）', () => {
  /** 冲排微任务，让单飞循环在 setIcon 兑现后继续比对下一档 */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it('在途 setIcon 完成期间到达的更晚档位不会被旧完成覆盖', async () => {
    // 第一次 setIcon 挂起，模拟 chrome.action.setIcon 在途、完成顺序晚于后续请求
    let releaseFirst!: () => void;
    setIcon.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseFirst = resolve;
        }),
    );

    // 请求 unlocked：drain 同步发起第一次 setIcon 后挂在 await 上
    mod.setActionIconState('unlocked');
    expect(setIcon).toHaveBeenCalledTimes(1);
    expect(pathOfCall(0)).toEqual(UNLOCKED_PATH);

    // 在途期间到达更晚的 locked：单飞循环仍在跑，只更新期望档位，不立即重绘
    mod.setActionIconState('locked');
    await flush();
    expect(setIcon).toHaveBeenCalledTimes(1);

    // 释放第一次（unlocked 完成）→ 循环发现期望 locked ≠ 已应用 unlocked，补写 locked
    releaseFirst();
    await flush();
    expect(setIcon).toHaveBeenCalledTimes(2);
    expect(pathOfCall(1)).toEqual(LOCKED_PATH);
  });
});
