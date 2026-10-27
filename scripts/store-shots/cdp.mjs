/**
 * CDP HTTP 端点。
 *
 * 端口可由 `SHOT_CDP_PORT` 覆盖（默认仍是 9333，跑批命令不必改）。这不是可有可无的
 * 便利开关：同机上另一个 checkout 的验证脚本也会起 `--remote-debugging-port=9333`
 * 的 Chrome，并按 9333 找「它的」浏览器——谁的批在跑，另一批的命令就会打到别人的
 * 实例上（实测两边都出现过 target 被关、整批挂死在 `Runtime.evaluate` 超时）。
 * 并行跑批时给每一路单独一个端口。
 */
const PORT = Number(process.env.SHOT_CDP_PORT || 9333);
const HOST = `http://127.0.0.1:${PORT}`;

/** 浏览器级端点：`initExtension` 要用它拿 `webSocketDebuggerUrl`，端口只能有这一份真源。 */
export const BROWSER_VERSION_URL = `${HOST}/json/version`;

export async function listTargets() {
  const res = await fetch(`${HOST}/json`);
  return res.json();
}

export function findTarget(targets, pred) {
  return targets.find(pred);
}

export class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  /**
   * 发一条 CDP 命令并等结果。
   *
   * 必须带超时：调试端口偶尔会收下命令却永不回包（实测截图批次整体挂死、CPU 时间
   * 不再增长），没有超时的话整批跑批会无限期阻塞且看不到卡在哪一条命令上。
   */
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: err => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new Session(ws);
  }

  close() {
    this.ws.close();
  }
}

export async function evalIn(session, expression, awaitPromise = true) {
  const r = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

export async function newTab(url) {
  const res = await fetch(`${HOST}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  return res.json();
}

/** 按 targetId 关闭标签（跑批之间清理，避免残留标签干扰目标定位）。 */
export async function closeTab(id) {
  await fetch(`${HOST}/json/close/${id}`).catch(() => {});
}
