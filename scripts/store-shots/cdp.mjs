const HOST = 'http://127.0.0.1:9333';

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
