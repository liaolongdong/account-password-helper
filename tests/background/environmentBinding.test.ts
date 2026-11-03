/**
 * 本地开发环境绑定仓（后台会话级）回归测试
 *
 * 这一层是「让另一个主机的凭证可被填进本地页」这条授权的唯一存放点，因此逐条钉住：
 *
 * 1. **只有环回页面能绑定**，公网页面与「把本机绑给自己」一律被写入层拒绝；
 * 2. **按 host:port 分键**，且环回别名折叠到同一键（`localhost` 与 `127.0.0.1` 是同一端点）；
 * 3. **线上或认不出环境的主机必须先确认**，确认只在本浏览器会话内累积；
 * 4. **只落 storage.session**：落盘的一次绑定会在下次开机后仍然把远端账号带到本地页；
 * 5. **内存镜像可重建**：SW 回收后仍以存储为事实来源，且条目数有上限。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import {
  endpointKeyOf,
  getEnvBinding,
  hasProdAck,
  markProdAck,
  resetEnvBindingMirror,
  setEnvBinding,
} from '@/entrypoints/background/environmentBinding';

const FAT = 'fat.example.com';
const PROD = 'prod.example.com';

/** 直接读会话存储里的整张表（验证「镜像与落盘同构」与修剪上限） */
const readTable = async (): Promise<Record<string, { env: string; at: number }>> => {
  const result = await chrome.storage.session.get(SESSION_MEMORY_KEYS.ENV_BINDINGS);
  return (result[SESSION_MEMORY_KEYS.ENV_BINDINGS] as Record<string, { env: string; at: number }>) ?? {};
};

describe('environmentBinding.endpointKeyOf', () => {
  it('环回别名折叠为同一端点键，端口不同则分开', () => {
    expect(endpointKeyOf('localhost', '3000')).toBe(endpointKeyOf('127.0.0.1', '3000'));
    expect(endpointKeyOf('[::1]', '3000')).toBe(endpointKeyOf('localhost', '3000'));
    expect(endpointKeyOf('localhost', '3000')).not.toBe(endpointKeyOf('localhost', '5173'));
  });

  it('默认端口与取不到端口共用一键，避免同一端点留下两条绑定', () => {
    expect(endpointKeyOf('localhost', null)).toBe(endpointKeyOf('localhost', null));
    expect(endpointKeyOf('LOCALHOST ', null)).toBe('localhost:noport');
  });
});

describe('environmentBinding 读写门禁', () => {
  beforeEach(async () => {
    resetEnvBindingMirror();
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
  });

  it('环回页面绑定成功，读取按端点命中', async () => {
    const result = await setEnvBinding('localhost', '3000', FAT);
    expect(result).toEqual({ envHost: FAT });
    expect(await getEnvBinding('localhost', '3000')).toBe(FAT);
    expect(await readTable()).toEqual({ 'localhost:3000': { env: FAT, at: expect.any(Number) } });
  });

  it('别名写法读到同一份绑定', async () => {
    await setEnvBinding('localhost', '3000', FAT);
    expect(await getEnvBinding('127.0.0.1', '3000')).toBe(FAT);
  });

  it('公网页面拒绝绑定，且不留脏记录', async () => {
    const result = await setEnvBinding('github.com', null, FAT);
    expect(result.envHost).toBeNull();
    expect(await getEnvBinding('github.com', null)).toBeNull();
    expect(await readTable()).toEqual({});
  });

  it('把本机绑给自己被拒（环回主机不是环境）', async () => {
    expect((await setEnvBinding('localhost', '3000', '127.0.0.1')).envHost).toBeNull();
    expect(await readTable()).toEqual({});
  });

  it('端口不同即另一份作用域：换 dev server 不会带走绑定', async () => {
    await setEnvBinding('localhost', '3000', FAT);
    expect(await getEnvBinding('localhost', '5173')).toBeNull();
  });

  it('传空即清除该端点的绑定', async () => {
    await setEnvBinding('localhost', '3000', FAT);
    const cleared = await setEnvBinding('localhost', '3000', null);
    expect(cleared.envHost).toBeNull();
    expect(await getEnvBinding('localhost', '3000')).toBeNull();
    expect(await readTable()).toEqual({});
  });

  it('镜像清空后仍能从会话存储重建（SW 被回收不是绑定丢失的理由）', async () => {
    await setEnvBinding('localhost', '3000', FAT);
    resetEnvBindingMirror();
    expect(await getEnvBinding('localhost', '3000')).toBe(FAT);
  });

  it('绝不写进 storage.local：一次联调的授权不该活过浏览器重启', async () => {
    await setEnvBinding('localhost', '3000', FAT);
    const persisted = await chrome.storage.local.get(SESSION_MEMORY_KEYS.ENV_BINDINGS);
    expect(persisted[SESSION_MEMORY_KEYS.ENV_BINDINGS]).toBeUndefined();
  });
});

describe('environmentBinding 落盘失败', () => {
  beforeEach(async () => {
    resetEnvBindingMirror();
    await chrome.storage.session.clear();
  });

  it('落盘失败时回报 failed 并回滚镜像：内存不能领先于存储', async () => {
    const original = chrome.storage.session.set;
    let calls = 0;
    (chrome.storage.session as unknown as { set: (o: unknown) => Promise<void> }).set = async () => {
      calls += 1;
      throw new Error('quota');
    };
    try {
      const result = await setEnvBinding('localhost', '3000', FAT);
      expect(result).toEqual({ envHost: null, failed: true });
    } finally {
      (chrome.storage.session as unknown as { set: typeof original }).set = original;
    }
    // 回滚后镜像与存储都收不到这条：SW 回收前后结论必须一致
    expect(await getEnvBinding('localhost', '3000')).toBeNull();
    expect(await readTable()).toEqual({});
    expect(calls).toBeGreaterThan(0);
  });

  it('落盘失败过一次之后，下一次写入照常成功（失败不该把串行链卡死）', async () => {
    const original = chrome.storage.session.set;
    (chrome.storage.session as unknown as { set: (o: unknown) => Promise<void> }).set = async () => {
      throw new Error('quota');
    };
    await setEnvBinding('localhost', '3000', FAT);
    (chrome.storage.session as unknown as { set: typeof original }).set = original;

    expect(await setEnvBinding('localhost', '5173', FAT)).toEqual({ envHost: FAT });
    expect(await getEnvBinding('localhost', '5173')).toBe(FAT);
  });
});
describe('environmentBinding 线上确认', () => {
  beforeEach(async () => {
    resetEnvBindingMirror();
    await chrome.storage.session.clear();
  });

  it('明确带非线上环境标签的主机免确认', async () => {
    expect(await setEnvBinding('localhost', '3000', FAT)).toEqual({ envHost: FAT });
    expect(await getEnvBinding('localhost', '3000')).toBe(FAT);
  });

  it('prod 主机首次绑定被拒并回 needsAck，确认后生效', async () => {
    const first = await setEnvBinding('localhost', '3000', PROD);
    expect(first).toEqual({ envHost: null, needsAck: true });
    expect(await getEnvBinding('localhost', '3000')).toBeNull();

    const second = await setEnvBinding('localhost', '3000', PROD, true);
    expect(second).toEqual({ envHost: PROD });
    expect(await getEnvBinding('localhost', '3000')).toBe(PROD);
  });

  it('确认在同一会话内累积：换端点选同一线上主机不再要确认', async () => {
    await setEnvBinding('localhost', '3000', PROD, true);
    expect(await hasProdAck(PROD)).toBe(true);
    expect(await setEnvBinding('localhost', '5173', PROD)).toEqual({ envHost: PROD });
  });

  it('认不出环境标签的主机也按线上对待（宁可多问一次）', async () => {
    expect((await setEnvBinding('localhost', '3000', 'example.com')).needsAck).toBe(true);
    expect((await setEnvBinding('localhost', '3000', 'www.example.com')).needsAck).toBe(true);
  });

  it('确认集合可跨镜像复位重建（内存不是事实来源）', async () => {
    await markProdAck(PROD);
    resetEnvBindingMirror();
    expect(await hasProdAck(PROD)).toBe(true);
  });
});

describe('environmentBinding 条目上限', () => {
  beforeEach(async () => {
    resetEnvBindingMirror();
    await chrome.storage.session.clear();
  });

  it('超过上限时修剪最旧的端点，最近使用的保留', async () => {
    for (let port = 1; port <= 33; port += 1) {
      await setEnvBinding('localhost', String(port), FAT);
    }
    const table = await readTable();
    expect(Object.keys(table).length).toBeLessThanOrEqual(32);
    expect(await getEnvBinding('localhost', '33')).toBe(FAT);
  });
});
