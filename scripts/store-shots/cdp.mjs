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

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
