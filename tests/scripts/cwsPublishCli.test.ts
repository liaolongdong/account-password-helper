/**
 * Chrome Web Store 发布链路线上格式测试（假商店 + CLI 子进程）
 *
 * 为什么用「起子进程跑 `scripts/cwsPublish.mjs` + 本地假商店」而不是 import lib：
 * 1. 仓库既有口径是「守卫不依赖被守卫的模块」（见 `tests/docs/siteMeta.test.ts` 第 19 行的
 *    批注），`scripts/**` 也不在 tsconfig 的 include 里，import 会让 typecheck 直接挂；
 * 2. 更关键的是它能验到**真实请求形状**——发布 API 一旦在 2026-10-15 从 v1.1 切到 v2，
 *    错的 URL、错的 Content-Type、漏掉异步上传轮询，都不会有编译错误，只会在发版当天变红。
 *    这里把它钉成断言：端点路径、方法、请求头、zip 字节、publish 请求体的三个字段、
 *    以及 `IN_PROGRESS → SUCCEEDED` 的轮询次数。判据来自免鉴权的 discovery 文档
 *    `https://chromewebstore.googleapis.com/$discovery/rest?version=v2`。
 * 3. 服务账号 JWT 用真实 RSA 密钥对**验签**，不是比对字符串——签错的 JWT 在 Google 侧
 *    只表现为一句 `invalid_grant`，本地不验签就永远发现不了。
 *
 * 全部用例都在本地回环上跑，不碰 Chrome Web Store：这里没有一次真实提审。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PUBLISHER_ID = '01234567890123456789';
const EXTENSION_ID = 'fgimkdodpjfkddmildjieojpfakpanli';
const ITEM_NAME = `publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}`;
const FAKE_ACCESS_TOKEN = 'fake-access-token-should-never-be-logged';

interface RecordedRequest {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: Buffer;
}

interface FakeStoreScript {
  /** fetchStatus 依次返回的响应；用完重复最后一个。 */
  statuses: Array<Record<string, unknown>>;
  tokenStatus?: number;
  tokenError?: Record<string, unknown>;
  uploadStatus?: number;
  uploadError?: Record<string, unknown>;
  publishStatus?: number;
  publishError?: Record<string, unknown>;
}

interface FakeStore {
  base: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

let store: FakeStore | undefined;
let scratchDir: string;
let goodZipPath: string;
let staleZipPath: string;
let saEmail: string;
let saPrivateKey: string;
let saPublicKeyPem: string;
let packageVersion: string;

beforeAll(async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  saPrivateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  saPublicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  saEmail = 'cws-ci@account-password-helper.iam.gserviceaccount.com';

  scratchDir = mkdtempSync(path.join(os.tmpdir(), 'aph-cws-test-'));
  // 版本从 package.json 取，不写死：写死的夹具在下一次版本跳档时会变成一条假红。
  packageVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  goodZipPath = buildFixtureZip('good', { version: packageVersion, permissions: ['storage', 'activeTab'] });
  staleZipPath = buildFixtureZip('stale', { version: '0.0.0', permissions: ['storage'] });
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

/** 在临时目录里造一个真能解压的 zip（发布链路读的就是真包，不是假对象）。 */
function buildFixtureZip(name: string, manifest: Record<string, unknown>): string {
  const dir = path.join(scratchDir, name);
  mkdirSync(dir, { recursive: true });
  writeSource(dir, manifest);
  const zipPath = path.join(scratchDir, `${name}.zip`);
  execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: dir });
  return zipPath;
}

function writeSource(dir: string, manifest: Record<string, unknown>) {
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, ...manifest }, null, 2));
  writeFileSync(path.join(dir, 'background.js'), 'void 0;');
}

async function startFakeStore(script: Partial<FakeStoreScript> = {}): Promise<FakeStore> {
  const requests: RecordedRequest[] = [];
  const statuses = script.statuses ?? [{ lastAsyncUploadState: 'SUCCEEDED' }];
  let statusCursor = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const url = req.url ?? '';
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (url === '/token') {
        if (script.tokenStatus && script.tokenStatus !== 200) {
          // 按 OAuth 端点的真实形状返回（顶层字符串 error），不是 Google 业务方法的封装形状。
          return json(
            script.tokenStatus,
            script.tokenError ?? { error: 'invalid_grant', error_description: 'Invalid grant' },
          );
        }
        return json(200, { access_token: FAKE_ACCESS_TOKEN, expires_in: 3600, token_type: 'Bearer' });
      }
      if (url.startsWith('/upload/v2/')) {
        if (script.uploadStatus && script.uploadStatus !== 200) {
          return json(script.uploadStatus, script.uploadError ?? { error: { code: script.uploadStatus } });
        }
        return json(200, { name: ITEM_NAME, itemId: EXTENSION_ID, crxVersion: '3.13.1', uploadState: 'IN_PROGRESS' });
      }
      if (url.endsWith(':publish')) {
        if (script.publishStatus && script.publishStatus !== 200) {
          return json(script.publishStatus, script.publishError ?? { error: { code: script.publishStatus } });
        }
        return json(200, { name: ITEM_NAME, itemId: EXTENSION_ID, state: 'PENDING_REVIEW' });
      }
      if (url.endsWith(':cancelSubmission')) {
        return json(200, {});
      }
      if (url.endsWith(':fetchStatus')) {
        const payload = statuses[Math.min(statusCursor, statuses.length - 1)];
        statusCursor += 1;
        return json(200, payload);
      }
      return json(404, { error: { code: 404, message: 'unexpected path' } });
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

interface CliResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
}

const execFileAsync = promisify(execFile);

/**
 * 异步跑 CLI：**不能**用 `execFileSync`。
 * 假商店就起在本进程的 event loop 上，同步 spawn 会把 loop 卡死——CLI 在等一个
 * 永远没人应答的 HTTP 响应，父进程在等 CLI 退出。第一次跑就是这么挂住的。
 * `timeout` 是给这个死锁留的第二道闸：真挂住时 30s 内报错，而不是拖满 vitest 超时。
 */
async function runCli(argv: string[], env: Record<string, string>): Promise<CliResult> {
  try {
    const { stdout } = await execFileAsync('node', [path.join(ROOT, 'scripts', 'cwsPublish.mjs'), ...argv], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    return { ok: true, status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { ok: false, status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    CWS_EXTENSION_ID: EXTENSION_ID,
    CWS_PUBLISHER_ID: PUBLISHER_ID,
    CWS_SA_EMAIL: saEmail,
    CWS_SA_PRIVATE_KEY: saPrivateKey,
    CWS_REQUIRED_PERMISSIONS: 'storage,activeTab',
    ...extra,
  };
}

function pathsOf(fetchedStore: FakeStore) {
  return fetchedStore.requests.map(r => `${r.method} ${r.url}`);
}

async function withStore(script: Partial<FakeStoreScript>, fn: (s: FakeStore) => Promise<void>) {
  store = await startFakeStore(script);
  try {
    await fn(store);
  } finally {
    await store.close();
    store = undefined;
  }
}

describe('preflight（离线预检，不联网）', { timeout: 30_000 }, () => {
  it('包内版本与 package.json 一致时全绿', async () => {
    const r = await runCli(['preflight', '--zip', goodZipPath], baseEnv());
    expect(r.stdout).toContain('✓ 包内版本 == package.json');
    expect(r.stdout).toContain('✓ 标识符形状');
    expect(r.ok).toBe(true);
  });

  it('包内版本对不上时判红并终止（版本错位是提审被拒最常见的原因）', async () => {
    const r = await runCli(['preflight', '--zip', staleZipPath], baseEnv());
    expect(r.ok).toBe(false);
    expect(r.stdout).toContain('✗ 包内版本 == package.json');
    expect(r.stderr).toContain('预检未通过');
  });

  it('扩展 ID 混入换行时按长度报出来，而不是拖到 API 报 404', async () => {
    const r = await runCli(['preflight', '--zip', goodZipPath], baseEnv({ CWS_EXTENSION_ID: `${EXTENSION_ID}\n` }));
    expect(r.ok).toBe(false);
    expect(r.stdout).toContain('CWS_EXTENSION_ID 应为 32 位 a-p 小写字母，实际长度 33');
  });

  it('给了 --expect-version 就同时校验包版本 == 发布 tag', async () => {
    const r = await runCli(['preflight', '--zip', goodZipPath, '--expect-version', 'v9.9.9'], baseEnv());
    expect(r.ok).toBe(false);
    expect(r.stdout).toContain('✗ 包内版本 == 发布 tag');
  });

  /**
   * 服务账号是这次新加的凭据：PR 分支上四项 Secret 天然是空的，
   * 但「包对不对、版本对不对」这一层必须先能单独给出结论，否则流水线在配置好凭据之前一直是红的。
   */
  it('--ids-optional 让未配凭据的分支只把标识符降为告警，包与版本照旧判', async () => {
    const noIds = {
      CWS_EXTENSION_ID: '',
      CWS_PUBLISHER_ID: '',
      CWS_SA_EMAIL: '',
      CWS_SA_PRIVATE_KEY: '',
      CWS_REQUIRED_PERMISSIONS: 'storage,activeTab',
    };
    const lenient = await runCli(['preflight', '--zip', goodZipPath, '--ids-optional'], noIds);
    expect(lenient.ok).toBe(true);
    expect(lenient.stdout).toContain('! 标识符形状');
    expect(lenient.stdout).toContain('✓ 包内版本 == package.json');

    const strict = await runCli(['preflight', '--zip', goodZipPath], noIds);
    expect(strict.ok).toBe(false);
    expect(strict.stdout).toContain('✗ 标识符形状');
  });
});

describe('publish（上传 → 等异步落定 → 提审）', { timeout: 30_000 }, () => {
  it('请求序列与线格式逐字正确，并在 IN_PROGRESS 之后轮询到 SUCCEEDED', async () => {
    await withStore(
      {
        statuses: [
          {
            lastAsyncUploadState: 'NOT_FOUND',
            publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '3.13.0' }] },
          },
          { lastAsyncUploadState: 'IN_PROGRESS' },
          { lastAsyncUploadState: 'SUCCEEDED' },
        ],
      },
      async s => {
        const r = await runCli(
          ['publish', '--zip', goodZipPath, '--expect-version', packageVersion],
          baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }),
        );
        expect(r.stdout).toContain('已提交审核：state=PENDING_REVIEW');
        expect(r.ok).toBe(true);

        expect(pathsOf(s)).toEqual([
          'POST /token',
          `GET /v2/${ITEM_NAME}:fetchStatus`,
          `POST /upload/v2/${ITEM_NAME}:upload?uploadType=media`,
          `GET /v2/${ITEM_NAME}:fetchStatus`,
          `GET /v2/${ITEM_NAME}:fetchStatus`,
          `POST /v2/${ITEM_NAME}:publish`,
          `GET /v2/${ITEM_NAME}:fetchStatus`,
        ]);

        const upload = s.requests.find(req => req.url.includes(':upload'));
        expect(upload?.headers['content-type']).toBe('application/zip');
        expect(upload?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
        expect(upload?.body.equals(readFileSync(goodZipPath))).toBe(true);

        const publish = s.requests.find(req => req.url.endsWith(':publish'));
        expect(JSON.parse(publish!.body.toString('utf8'))).toEqual({
          publishType: 'DEFAULT_PUBLISH',
          skipReview: false,
          blockOnWarnings: false,
        });

        const status = s.requests.find(req => req.url.endsWith(':fetchStatus'));
        expect(status?.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
        expect(status?.headers['content-type']).toBeUndefined();
      },
    );
  });

  it('服务账号 JWT 是可被公钥验签的真 RS256，claims 指向官方令牌端点与写 scope', async () => {
    await withStore({}, async s => {
      await runCli(['token'], baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }));
      const tokenReq = s.requests.find(req => req.url === '/token');
      const form = new URLSearchParams(tokenReq!.body.toString('utf8'));
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

      const [headerB64, claimsB64, sigB64] = form.get('assertion')!.split('.');
      const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
      expect(claims).toMatchObject({
        iss: saEmail,
        sub: saEmail,
        scope: 'https://www.googleapis.com/auth/chromewebstore',
        aud: 'https://oauth2.googleapis.com/token',
      });
      expect(claims.exp - claims.iat).toBe(3600);
      expect(JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))).toEqual({ alg: 'RS256', typ: 'JWT' });

      const verify = createVerify('RSA-SHA256');
      verify.update(`${headerB64}.${claimsB64}`);
      // 用一次性 verify(key, signature)：end(key, sig) 会把第二个参数当 encoding 解析，
      // 报 «Unknown encoding: …»，看起来像被测代码坏了，其实是量具写错。
      expect(verify.verify(saPublicKeyPem, Buffer.from(sigB64, 'base64url'))).toBe(true);
    });
  });

  it('access token 与服务账号私钥都不出现在任何输出里', async () => {
    await withStore({}, async s => {
      const r = await runCli(['status'], baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }));
      expect(r.ok).toBe(true);
      expect(`${r.stdout}${r.stderr}`).not.toContain(FAKE_ACCESS_TOKEN);
      expect(`${r.stdout}${r.stderr}`).not.toContain('PRIVATE KEY');
    });
  });

  it('--no-submit 只传包、不提审（改商店文案那一轮要的就是这个）', async () => {
    await withStore({ statuses: [{ lastAsyncUploadState: 'NOT_FOUND' }] }, async s => {
      const r = await runCli(
        ['publish', '--zip', goodZipPath, '--no-submit'],
        baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }),
      );
      expect(r.stdout).toContain('只传包、不提审');
      expect(s.requests.some(req => req.url.endsWith(':publish'))).toBe(false);
      expect(s.requests.some(req => req.url.includes(':upload'))).toBe(true);
    });
  });

  it('上一版还在审核中就不再提审，且一个字节都不上传', async () => {
    await withStore(
      {
        statuses: [
          {
            submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '3.13.1' }] },
          },
        ],
      },
      async s => {
        const r = await runCli(
          ['publish', '--zip', goodZipPath],
          baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }),
        );
        expect(r.ok).toBe(false);
        expect(r.stderr).toContain('上一版仍在审核中');
        expect(s.requests.some(req => req.url.includes(':upload'))).toBe(false);
      },
    );
  });

  it('包在商店侧解析失败（uploadState=FAILED）时不提审', async () => {
    await withStore({ statuses: [{ lastAsyncUploadState: 'FAILED' }] }, async s => {
      const r = await runCli(
        ['publish', '--zip', goodZipPath],
        baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }),
      );
      expect(r.ok).toBe(false);
      expect(r.stderr).toContain('包在商店侧解析失败');
      expect(s.requests.some(req => req.url.endsWith(':publish'))).toBe(false);
    });
  });

  it('403 permissionDenied 被翻译成「服务账号要加进 Dashboard → Account」', async () => {
    await withStore(
      { uploadStatus: 403, uploadError: { error: { code: 403, message: 'Permission denied' } } },
      async s => {
        const r = await runCli(
          ['publish', '--zip', goodZipPath],
          baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }),
        );
        expect(r.ok).toBe(false);
        expect(r.stderr).toContain('Developer Dashboard → Account');
      },
    );
  });

  it('400 failedPrecondition 提示先撤当前提交（每天上限 6 次）', async () => {
    await withStore(
      {
        statuses: [{ lastAsyncUploadState: 'SUCCEEDED' }, { lastAsyncUploadState: 'SUCCEEDED' }],
        publishStatus: 400,
        publishError: { error: { code: 400, message: 'failedPrecondition', status: 'FAILED_PRECONDITION' } },
      },
      async s => {
        const env = baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` });
        // 预检会把 publish 挡在联网之前，这里用 --skip-preflight 直达 API 层，验的是错误翻译。
        const r = await runCli(['publish', '--zip', staleZipPath, '--skip-preflight'], env);
        expect(r.ok).toBe(false);
        expect(r.stderr).toContain('先 cancelSubmission 撤掉当前提交');
      },
    );
  });

  it('429 报成配额/撤审上限，而不是裸 HTTP 码', async () => {
    await withStore({ uploadStatus: 429 }, async s => {
      const r = await runCli(
        ['publish', '--zip', goodZipPath],
        baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }),
      );
      expect(r.ok).toBe(false);
      expect(r.stderr).toContain('每天最多 6 次');
    });
  });
});

describe('status / cancel', { timeout: 30_000 }, () => {
  it('status 是纯只读的：一次换票、一次 fetchStatus', async () => {
    await withStore(
      {
        statuses: [
          { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '3.13.0' }] } },
        ],
      },
      async s => {
        const r = await runCli(['status'], baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }));
        expect(r.stdout).toContain('state=PUBLISHED');
        expect(r.stdout).toContain('published=3.13.0');
        expect(pathsOf(s)).toEqual(['POST /token', `GET /v2/${ITEM_NAME}:fetchStatus`]);
      },
    );
  });

  it('cancel 打的是 :cancelSubmission', async () => {
    await withStore({}, async s => {
      const r = await runCli(['cancel'], baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }));
      expect(r.ok).toBe(true);
      expect(pathsOf(s)).toContain(`POST /v2/${ITEM_NAME}:cancelSubmission`);
    });
  });

  it('缺私钥时直接说缺 CWS_SA_PRIVATE_KEY，不去敲 Google 拿一个 401', async () => {
    const r = await runCli(['status'], baseEnv({ CWS_SA_PRIVATE_KEY: '' }));
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('缺少 CWS_SA_PRIVATE_KEY');
  });

  it('换票失败时报 error 码并指向成套凭据，且不泄露 assertion', async () => {
    await withStore({ tokenStatus: 400, tokenError: { error: 'invalid_grant' } }, async s => {
      const r = await runCli(['status'], baseEnv({ CWS_API_ROOT: s.base, CWS_OAUTH_TOKEN_URI: `${s.base}/token` }));
      expect(r.ok).toBe(false);
      expect(r.stderr).toContain('error=invalid_grant');
      expect(`${r.stdout}${r.stderr}`).not.toContain('PRIVATE KEY');
    });
  });
});

/**
 * 自检：确认「验签用的公钥」和「签名用的私钥」确实是同一对，且上面的 zip 真能被解压。
 * 少了这一步，假商店永远返回 200 也能把整组用例跑绿——具先于结论。
 */
describe('测试夹具自证', () => {
  it('夹具 zip 能被 unzip 解出 manifest', () => {
    const out = execFileSync('unzip', ['-p', goodZipPath, 'manifest.json'], { encoding: 'utf8' });
    expect(JSON.parse(out).manifest_version).toBe(3);
  });

  it('RSA 密钥对自洽：用私钥签的报文能被公钥验过', () => {
    const sign = createSign('RSA-SHA256');
    sign.update('aph');
    sign.end();
    const signature = sign.sign(saPrivateKey);
    const verify = createVerify('RSA-SHA256');
    verify.update('aph');
    expect(verify.verify(saPublicKeyPem, signature)).toBe(true);
  });
});
