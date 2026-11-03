/**
 * 本地开发页的环境绑定（会话级）
 *
 * 回答的是一件事：「`localhost:3000` 这一页，用户声明它其实是哪个环境的前端」。
 * 这个信息不在 URL 里（dev/fat/uat/prod 用的是同一个前端地址），只能由用户在侧边栏
 * 芯片上点一次；点完之后，五个入口（侧边栏列表、内联下拉、一键填充、右键菜单、Popup 计数）
 * 必须看到同一个答案，所以它存在后台，而不是存在某个面板的内存里。
 *
 * 三条设计取舍：
 * - **只落 `chrome.storage.session`**：绑定等于「允许另一个主机的凭证被填进眼前这一页」，
 *   属于一次开机内的授权，不该活过浏览器重启（详见 `SESSION_MEMORY_KEYS.ENV_BINDINGS`）。
 * - **内存镜像 + 存储为事实来源**：内联下拉每次打开都要读一次，镜像省掉 IPC；
 *   SW 被回收后镜像为空，从存储重建，不会把内存当持久状态。
 * - **写入串行化**：读-改-写整张表，并发写会互相覆盖（与 `pendingCipherKeyStore` 同因）。
 */
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { logger } from '@/utils/logger';
import { canonicalSiteHost, isLoopbackHost } from '@/utils/domain';
import { requiresEnvConfirmation } from '@/utils/envFamily';
import type { EnvBindingResultData } from '@/utils/types';

/** 端点键 → 绑定记录 */
interface EnvBindingRecord {
  /** 环境主机（`fat.example.com`） */
  env: string;
  /** 写入时间戳（epoch 毫秒），用于过期与上限修剪 */
  at: number;
}

/** 整张绑定表（storage.session 里的形态） */
type EnvBindingTable = Record<string, EnvBindingRecord>;

/** 单端点绑定的存活时长：超过即视为用户早已换过工作，不再自动带出远端凭证 */
const BINDING_TTL_MS = 12 * 60 * 60 * 1000;

/** 同时记住的端点数上限（本地一般 3-5 个 dev server，留足冗余同时防无界增长） */
const MAX_BINDINGS = 32;

/** 内存镜像；null 表示尚未从存储加载 */
let mirror: Map<string, EnvBindingRecord> | null = null;

/** 线上环境确认过的环境主机集合（同一浏览器会话内有效） */
let prodAcks: Set<string> | null = null;

/** 读-改-写的串行队列，避免并发写互相覆盖整张表 */
let writeChain: Promise<void> = Promise.resolve();

/**
 * 组装端点键
 *
 * 端口参与键值：`localhost:3000` 与 `localhost:5173` 是两个前端，各连各的后端。
 * 默认端口与「取不到端口」统一记作 `noport`，避免同一端点因解析口径不同留下两条绑定。
 *
 * @param host - 页面 hostname
 * @param port - 页面端口，null 表示默认端口或取不到
 * @returns 端点键
 */
export function endpointKeyOf(host: string, port: string | null): string {
  return `${canonicalSiteHost(host)}:${port ?? 'noport'}`;
}

/** 未过期记录判定 */
function isLive(record: EnvBindingRecord | undefined, now: number): record is EnvBindingRecord {
  return !!record && now - record.at < BINDING_TTL_MS;
}

/** 从存储加载整张表到镜像（失败降级为空表，绑不上只是芯片回到未选状态） */
async function loadMirror(): Promise<Map<string, EnvBindingRecord>> {
  if (mirror) return mirror;
  const table = await chrome.storage.session
    .get(SESSION_MEMORY_KEYS.ENV_BINDINGS)
    .then(area => area[SESSION_MEMORY_KEYS.ENV_BINDINGS] as EnvBindingTable | undefined)
    .catch(() => undefined);
  const now = Date.now();
  mirror = new Map(Object.entries(table ?? {}).filter(([, record]) => isLive(record, now)));
  return mirror;
}

/**
 * 把镜像写回存储（一次性带上修剪结果，保持两处同构）
 *
 * 落盘失败必须回报：只记一句 warn 的话，内存镜像会领先于存储，SW 一旦被回收绑定就静默消失，
 * 而用户以为这一页还声明着 fat——「列表里忽然少了整个环境」是最难排查的那种表现。
 */
async function persistMirror(map: Map<string, EnvBindingRecord>): Promise<boolean> {
  const now = Date.now();
  const live = Array.from(map.entries())
    .filter(([, record]) => isLive(record, now))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_BINDINGS);
  // 修剪掉过期与超额条目，顺带把镜像收敛到落盘的那一份，两处不会分叉
  if (live.length !== map.size) {
    map.clear();
    for (const [key, record] of live) map.set(key, record);
  }
  const table: EnvBindingTable = Object.fromEntries(live);
  try {
    await chrome.storage.session.set({ [SESSION_MEMORY_KEYS.ENV_BINDINGS]: table });
    return true;
  } catch (error) {
    logger.warn('环境绑定落盘失败:', error);
    return false;
  }
}

/**
 * 读取某端点当前生效的环境主机
 *
 * @param host - 页面 hostname（非环回主机恒返回 null）
 * @param port - 页面端口
 * @returns 环境主机；未绑定、已过期或页面不可绑定时为 null
 */
export async function getEnvBinding(host: string, port: string | null): Promise<string | null> {
  if (!isLoopbackHost(host)) return null;
  const map = await loadMirror();
  const record = map.get(endpointKeyOf(host, port));
  if (!isLive(record, Date.now())) return null;
  return record.env;
}

/**
 * 写入或清除某端点的环境绑定
 *
 * 主机门禁在这一层再判一次：消息与侧边栏都是不可信调用方，「公网页面也能绑定」绝不能
 * 因为一个消息就成立；传入的环境主机同样必须是真实远端主机，不能是本机自己。
 *
 * 线上确认同样落在这里：确认这件事如果只写在芯片的点击处理里，界面少判一次就等于没有门禁。
 *
 * @param host - 页面 hostname
 * @param port - 页面端口
 * @param envHost - 环境主机；null 或空串表示清除
 * @param ack - 用户是否已确认「把线上/无法识别的环境账号带到本地页」
 * @returns 生效中的绑定；`needsAck` 为真时本次写入被拒绝（原绑定保持不变），调用方需先发起确认；
 *          `failed` 为真时镜像已回滚，调用方应把失败告诉用户而不是显示成已绑定
 */
export async function setEnvBinding(
  host: string,
  port: string | null,
  envHost: string | null,
  ack = false,
): Promise<EnvBindingResultData> {
  const key = endpointKeyOf(host, port);
  const allowed = envHost && isLoopbackHost(host) && !isLoopbackHost(envHost) ? envHost : null;
  if (!allowed) {
    const cleared = await enqueueWrite(map => {
      map.delete(key);
    });
    return cleared ? { envHost: null } : { envHost: null, failed: true };
  }
  if (requiresEnvConfirmation(allowed) && !ack && !(await hasProdAck(allowed))) {
    return { envHost: null, needsAck: true };
  }
  const written = await enqueueWrite(map => {
    map.set(key, { env: allowed, at: Date.now() });
  });
  if (!written) {
    // 存储没收下这条绑定，就把内存里刚写的那一条撤掉：两处必须一起失败，
    // 否则「这一轮看起来生效了」会在 SW 回收后变成无声消失
    await enqueueWrite(map => {
      map.delete(key);
    });
    return { envHost: null, failed: true };
  }
  if (requiresEnvConfirmation(allowed)) {
    // 确认只对「这一次开机 + 这一个环境主机」有效：下次换端点选线上仍会弹一次
    await markProdAck(allowed);
  }
  return { envHost: allowed };
}

/**
 * 串行执行一次读-改-写
 *
 * 绑定表是「整读整写」的形状，两次并发写会让后一次把前一次的条目覆盖掉；失败不抛出而是
 * 回报布尔，由调用方决定怎么向界面解释——消息处理器每条路径都必须有响应。
 */
function enqueueWrite(mutate: (map: Map<string, EnvBindingRecord>) => Promise<void> | void): Promise<boolean> {
  const step = writeChain
    .catch(() => undefined)
    .then(async () => {
      const map = await loadMirror();
      await mutate(map);
      return persistMirror(map);
    });
  // 链上永远挂一个已收口的 Promise：前一次失败不该让后续写全部落空
  writeChain = step.then(
    () => undefined,
    (error: unknown) => logger.warn('环境绑定写入失败:', error),
  );
  return step.catch((error: unknown) => {
    logger.warn('环境绑定写入失败:', error);
    return false;
  });
}

/** 从存储加载「已确认过的线上主机」集合到镜像 */
async function loadProdAcks(): Promise<Set<string>> {
  if (prodAcks) return prodAcks;
  const stored = await chrome.storage.session
    .get(SESSION_MEMORY_KEYS.ENV_PROD_ACKS)
    .then(area => area[SESSION_MEMORY_KEYS.ENV_PROD_ACKS] as string[] | undefined)
    .catch(() => undefined);
  prodAcks = new Set(stored ?? []);
  return prodAcks;
}

/**
 * 该环境主机是否已在本浏览器会话内确认过「线上账号带到本地页」
 *
 * @param envHost - 环境主机
 * @returns 是否已确认
 */
export async function hasProdAck(envHost: string): Promise<boolean> {
  return (await loadProdAcks()).has(envHost);
}

/**
 * 记录「已确认过线上环境绑定」
 *
 * 集合常驻内存后整写回存储，避免两次确认互相覆盖——确认必须累积，
 * 只留最后一次的话用户每切一个环境都要重新确认一遍。
 *
 * @param envHost - 环境主机
 */
export async function markProdAck(envHost: string): Promise<void> {
  const acks = await loadProdAcks();
  acks.add(envHost);
  await chrome.storage.session
    .set({ [SESSION_MEMORY_KEYS.ENV_PROD_ACKS]: Array.from(acks) })
    .catch(error => logger.warn('线上确认落盘失败:', error));
}

/**
 * 清空内存镜像（SW 冷启动复位与测试复位用）
 *
 * 只清内存，不动 storage.session——存储才是事实来源，重启后可重建。
 */
export function resetEnvBindingMirror(): void {
  mirror = null;
  prodAcks = null;
  writeChain = Promise.resolve();
}
