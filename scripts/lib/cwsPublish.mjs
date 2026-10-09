/**
 * Chrome Web Store 发布 API v2 的薄客户端与发布前预检。
 *
 * 为什么不用第三方 action：v1.1 发布 API 在 2026-10-15 停止支持（Google 原文见
 * docs/store/CWS_PUBLISHING_GUIDE.md「第三步」），而 v2 才支持服务账号——服务账号没有
 * OAuth 同意屏幕「Testing」模式下 refresh token 7 天过期的问题，是 CI 唯一能长期免维护的
 * 凭据形态。端点、字段与枚举全部取自免鉴权的 discovery 文档
 * `https://chromewebstore.googleapis.com/$discovery/rest?version=v2`，不靠二手教程。
 *
 * 本模块只做两件事：把 HTTP 调用如实发出去，把失败原因翻译成人话。它不读环境变量、
 * 不打印凭据、不决定发不发——那些留在 `scripts/cwsPublish.mjs` 与 workflow 里，
 * 这样每条断言都能在本地被测（见 tests/scripts/cwsPublishCli.test.ts 的假商店服务）。
 *
 * `apiRoot` / `tokenUri` 可注入，只为一件事：让验收测试把同一套代码指向本地假商店，
 * 逐字断言请求形状。生产路径永远用导出的默认值。
 *
 * @file scripts/lib/cwsPublish.mjs
 */

import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';

/** v2 服务端点根（元数据类方法直接挂在其下，媒体上传挂在 `${root}/upload` 下）。 */
export const CWS_API_ROOT = 'https://chromewebstore.googleapis.com';
/** 服务账号 JWT 换取 access token 的令牌端点。 */
export const CWS_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** 写操作必需的 scope；fetchStatus 额外接受 `.readonly`，发布链路一次拿写 scope 即可。 */
export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

/** discovery 里四个方法共同的 `name` 路径参数约束。 */
const ITEM_NAME_PATTERN = /^publishers\/[^/]+\/items\/[^/]+$/;
/** Chrome Web Store 商品 ID：32 位 `a-p` 小写字母。 */
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/**
 * 拼出 API 里的 item 资源名。
 *
 * @param {string} publisherId Dashboard「Publisher → Settings」里的开发者 ID
 * @param {string} extensionId 商品 ID（即扩展 ID）
 * @returns {string} `publishers/{publisherId}/items/{extensionId}`
 */
export function itemName(publisherId, extensionId) {
  return `publishers/${publisherId}/items/${extensionId}`;
}

/**
 * 校验三项凭据/标识的**形状**。只看形状、不触碰值本身，因此返回文案可以安全落日志。
 *
 * @param {{extensionId?: string, publisherId?: string, saEmail?: string}} input
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validateIdentifiers({ extensionId, publisherId, saEmail }) {
  const problems = [];
  if (!extensionId || !EXTENSION_ID_PATTERN.test(extensionId)) {
    problems.push(
      `CWS_EXTENSION_ID 应为 32 位 a-p 小写字母，实际长度 ${charLength(extensionId)}（粘贴时带入空格/换行是最常见原因）`,
    );
  }
  if (!publisherId || !ITEM_NAME_PATTERN.test(itemName(publisherId, 'x'))) {
    problems.push(
      `CWS_PUBLISHER_ID 缺失或含非法字符（应取 Dashboard「Publisher → Settings」里的纯 ID，实际长度 ${charLength(publisherId)}）`,
    );
  }
  if (!saEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(saEmail)) {
    problems.push(`CWS_SA_EMAIL 不是合法的服务账号邮箱（实际长度 ${charLength(saEmail)}）`);
  }
  return { ok: problems.length === 0, problems };
}

function charLength(value) {
  return typeof value === 'string' ? value.length : 0;
}

/**
 * 用服务账号私钥签发 JWT assertion（RS256）。
 *
 * 走 Google 的 jwt-bearer 换票而不是 `gcloud auth print-access-token`：runner 上没有
 * gcloud 凭据链，而私钥本来就必须落 Secret，两者等价且少一个外部依赖。
 *
 * @param {{email: string, privateKey: string, scope?: string, audience?: string, ttlSeconds?: number, nowSeconds?: number}} input
 * @returns {string} `header.payload.signature`
 */
export function buildJwtAssertion({
  email,
  privateKey,
  scope = CWS_SCOPE,
  audience = CWS_TOKEN_URI,
  ttlSeconds = 3600,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      sub: email,
      scope,
      aud: audience,
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  return `${signingInput}.${sign.sign(privateKey).toString('base64url')}`;
}

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * 服务账号 JWT → access token。
 *
 * @param {{fetchImpl?: typeof fetch, email: string, privateKey: string, scope?: string, tokenUri?: string, nowSeconds?: number}} input
 * @returns {Promise<{accessToken: string, expiresInSeconds: number, tokenType: string}>} 调用方负责不把 `accessToken` 写进任何日志
 */
export async function mintAccessToken({
  fetchImpl = fetch,
  email,
  privateKey,
  scope = CWS_SCOPE,
  tokenUri = CWS_TOKEN_URI,
  nowSeconds,
}) {
  const assertion = buildJwtAssertion({ email, privateKey, scope, audience: CWS_TOKEN_URI, nowSeconds });
  const res = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = await readJson(res);
  if (!res.ok || !payload.access_token) {
    // 令牌端点的错误码不走 explainFailure：这里的 400/401 与业务方法的语义不同。
    const code = tokenErrorCode(payload);
    throw new CwsPublishError({
      status: res.status,
      body: payload,
      hint: `换取 access token 失败（error=${code}）：确认 CWS_SA_EMAIL 与 CWS_SA_PRIVATE_KEY 出自同一个 JSON key、私钥含 PEM 头尾整段未被打断、且 Cloud 项目已启用 Chrome Web Store API`,
      method: 'token',
    });
  }
  return {
    accessToken: String(payload.access_token),
    expiresInSeconds: Number(payload.expires_in ?? 0),
    tokenType: String(payload.token_type ?? 'Bearer'),
  };
}

/**
 * 取令牌端点的错误码。OAuth 端点按 RFC 返 `{"error":"invalid_grant"}`（字符串），
 * Google 的 JSON 错误封装则返 `{"error":{"code":401,"status":"UNAUTHENTICATED"}}`，
 * 两种都要认——只认一种时，另一种在日志里是一句无信息量的 `error=unknown`。
 *
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function tokenErrorCode(payload) {
  const error = payload?.error;
  if (typeof error === 'string') return error;
  const shape = /** @type {Record<string, unknown>|undefined} */ (error);
  const fromShape = [shape?.error, shape?.code, shape?.status].find(v => typeof v === 'string' && v);
  return String(fromShape ?? payload?.error_description ?? 'unknown');
}

/** API 失败的统一载体：带 HTTP 状态、原始响应体与一句可执行的修复提示。 */
export class CwsPublishError extends Error {
  /**
   * @param {{status: number, body: unknown, hint?: string, method?: string}} input
   */
  constructor({ status, body, hint = '', method }) {
    super(hint || `Chrome Web Store API ${method ?? ''} 失败（HTTP ${status}）`.trim());
    this.name = 'CwsPublishError';
    this.status = status;
    this.body = body;
    this.method = method;
  }
}

/**
 * 把状态码翻译成能照着做的提示。只读 `error.code`/`error.message`，不回显请求内容。
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {string}
 */
export function explainFailure(status, body) {
  const signals = failureSignals(body);
  if (status === 401) {
    return '凭据被拒：确认服务账号邮箱与私钥成套，且 access token 未过期。';
  }
  if (status === 403) {
    if (signals.includes('accessnotconfigured')) {
      return 'Cloud 项目未启用 Chrome Web Store API：APIs & Services → Library 搜 Chrome Web Store API → Enable。';
    }
    return '权限被拒：服务账号邮箱必须加进 Developer Dashboard → Account 才能调写接口（一个 publisher 只能加一个）。';
  }
  if (status === 404) {
    return '找不到商品：核对 CWS_PUBLISHER_ID 与 CWS_EXTENSION_ID，或商品尚未在 Dashboard 建出来（v2 不支持用 API 新建商品）。';
  }
  if (status === 400 && signals.includes('failedprecondition')) {
    return '商品状态不允许再次提审：上一版仍在审核中，先 cancelSubmission 撤掉当前提交（每天上限 6 次），或等审核结束。';
  }
  if (status === 400) {
    return '请求被拒：多为包内 manifest 版本与已发布版本相同，或包内容与商品不符。';
  }
  if (status === 429) {
    return '触发配额限制：稍后重试；撤回审核请求每天最多 6 次。';
  }
  return `未识别的错误（HTTP ${status}），按响应体排查。`;
}

/**
 * Google 两侧把原因放在不同字段：v1.1 用 `error.code`（字符串，如 `failedPrecondition`），
 * v2 用 gRPC 风格的 `error.status`（如 `FAILED_PRECONDITION`）。判据必须同时认这两种写法，
 * 否则同一句「上一版还在审核中」会在一次 API 升级后静默退化成「未识别的错误码」。
 *
 * @param {unknown} body
 * @returns {string} 小写、去掉下划线/驼峰分隔符后的信号串
 */
function failureSignals(body) {
  const error = body && typeof body === 'object' ? /** @type {{error?: unknown}} */ (body).error : undefined;
  const shape = error && typeof error === 'object' ? /** @type {any} */ (error) : {};
  const parts = [
    shape.status,
    typeof shape.code === 'string' ? shape.code : '',
    ...(Array.isArray(shape.errors) ? shape.errors.map(item => item?.reason) : []),
  ];
  return parts
    .filter(p => typeof p === 'string' && p)
    .map(p => /** @type {string} */ (p).toLowerCase().replace(/[^a-z]/g, ''))
    .join(' ');
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 800) };
  }
}

/**
 * 元数据类方法（fetchStatus / cancelSubmission）的统一收发。
 * GET 既不带请求体也不声明 Content-Type——v2 对这些方法只认 Authorization 头，
 * 多发一个 JSON 头不影响结果，但会让「只读请求」在日志里看起来像写请求。
 *
 * @param {{fetchImpl: typeof fetch, method: 'GET'|'POST', url: string, token: string, body?: string}} input
 * @returns {Promise<Record<string, unknown>>}
 */
async function sendJson({ fetchImpl, method, url, token, body }) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(url, { method, headers, body });
  const payload = await readJson(res);
  if (!res.ok) {
    throw new CwsPublishError({
      status: res.status,
      body: payload,
      hint: explainFailure(res.status, payload),
      method: url.slice(url.lastIndexOf('/') + 1),
    });
  }
  return payload;
}

/**
 * 读商品状态。只读，不发任何写请求——dry-run 与审核后追踪状态都靠它。
 *
 * @param {{fetchImpl?: typeof fetch, token: string, name: string, apiRoot?: string}} input
 * @returns {Promise<Record<string, unknown>>} FetchItemStatusResponse
 */
export async function fetchItemStatus({ fetchImpl = fetch, token, name, apiRoot = CWS_API_ROOT }) {
  return sendJson({ fetchImpl, method: 'GET', url: `${apiRoot}/v2/${name}:fetchStatus`, token });
}

/**
 * 撤回当前正在排队的那次提交。每天每 publisher 上限 6 次。
 *
 * @param {{fetchImpl?: typeof fetch, token: string, name: string, apiRoot?: string}} input
 * @returns {Promise<Record<string, unknown>>} CancelSubmissionResponse（成功时为空对象）
 */
export async function cancelSubmission({ fetchImpl = fetch, token, name, apiRoot = CWS_API_ROOT }) {
  return sendJson({ fetchImpl, method: 'POST', url: `${apiRoot}/v2/${name}:cancelSubmission`, token, body: '{}' });
}

/**
 * 上传扩展包。媒体上传走 discovery 里的 simple 协议路径 `/upload/v2/{name}:upload`，
 * 请求体就是 zip 字节（`uploadType=media`）。
 *
 * @param {{fetchImpl?: typeof fetch, token: string, name: string, zipBytes: Uint8Array, apiRoot?: string, contentType?: string}} input
 * @returns {Promise<Record<string, unknown>>} UploadItemPackageResponse（`uploadState` 可能为 `IN_PROGRESS`）
 */
export async function uploadPackage({
  fetchImpl = fetch,
  token,
  name,
  zipBytes,
  apiRoot = CWS_API_ROOT,
  contentType = 'application/zip',
}) {
  const res = await fetchImpl(`${apiRoot}/upload/v2/${name}:upload?uploadType=media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: zipBytes,
  });
  const payload = await readJson(res);
  if (!res.ok) {
    throw new CwsPublishError({
      status: res.status,
      body: payload,
      hint: explainFailure(res.status, payload),
      method: 'upload',
    });
  }
  return payload;
}

/**
 * 提交审核。`DEFAULT_PUBLISH` = 审核通过后自动上架；`STAGED_PUBLISH` = 通过后挂起等开发者放行。
 *
 * @param {{fetchImpl?: typeof fetch, token: string, name: string, publishType?: 'DEFAULT_PUBLISH'|'STAGED_PUBLISH', skipReview?: boolean, blockOnWarnings?: boolean, apiRoot?: string}} input
 * @returns {Promise<Record<string, unknown>>} PublishItemResponse（`state` 一般为 `PENDING_REVIEW`）
 */
export async function publishItem({
  fetchImpl = fetch,
  token,
  name,
  publishType = 'DEFAULT_PUBLISH',
  skipReview = false,
  blockOnWarnings = false,
  apiRoot = CWS_API_ROOT,
}) {
  const res = await fetchImpl(`${apiRoot}/v2/${name}:publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType, skipReview, blockOnWarnings }),
  });
  const payload = await readJson(res);
  if (!res.ok) {
    throw new CwsPublishError({
      status: res.status,
      body: payload,
      hint: explainFailure(res.status, payload),
      method: 'publish',
    });
  }
  return payload;
}

/**
 * 等异步上传落定。
 *
 * 这是 v2 相对 v1.1 最容易踩的新坑：`upload` 可能回 `IN_PROGRESS`，此时包还没解析完，
 * 直接 `publish` 会拿**上一个**已解析版本去提审。discovery 里
 * `UploadItemPackageResponse.uploadState` 明确写了「IN_PROGRESS 时用 fetchStatus 轮询」，
 * 判据取 `FetchItemStatusResponse.lastAsyncUploadState`。
 *
 * @param {{fetchImpl?: typeof fetch, token: string, name: string, apiRoot?: string, attempts?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void>, statusFetcher?: (i: {token: string, name: string, apiRoot?: string, fetchImpl?: typeof fetch}) => Promise<Record<string, unknown>>}} input
 * @returns {Promise<{uploadState: string, settled: boolean, polls: number}>}
 */
export async function waitForUpload({
  fetchImpl = fetch,
  token,
  name,
  apiRoot = CWS_API_ROOT,
  attempts = 10,
  intervalMs = 2000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  statusFetcher = fetchItemStatus,
}) {
  let uploadState = 'UNKNOWN';
  for (let poll = 1; poll <= attempts; poll += 1) {
    const status = await statusFetcher({ token, name, apiRoot, fetchImpl });
    uploadState = String(status.lastAsyncUploadState ?? 'UNKNOWN');
    if (uploadState !== 'IN_PROGRESS') {
      return { uploadState, settled: true, polls: poll };
    }
    await sleep(intervalMs);
  }
  return { uploadState, settled: false, polls: attempts };
}

/**
 * 从 zip 里取出 manifest.json。
 *
 * 用 `unzip -p` 而不是引第三方 zip 库：GitHub ubuntu runner 与 macOS 都自带 unzip，
 * 为一处读取新增运行时依赖会扩大包体和供应链面。`execImpl` 可注入以便单测。
 *
 * @param {{zipPath: string, execImpl?: typeof execFileSync}} input
 * @returns {Record<string, unknown>}
 */
export function readManifestFromZip({ zipPath, execImpl = execFileSync }) {
  const out = execImpl('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(out);
}

/**
 * 发布前的离线判定：把「包是不是这一版、标识符对不对、产物在不在」这类问题，
 * 全部在排队进人工审核之前答完。
 *
 * `identifiersOptional` 只服务一种场景：fork 与「服务账号还没建出来」的分支上，
 * 三项标识符 Secret 天然是空的。此时把标识符降级为 warn，让「包与版本对不对」这一层
 * 仍然能单独给出结论——真正提审的那条路径不传这个标志，缺凭据照旧判红。
 *
 * @param {{zipPath?: string, manifest?: Record<string, unknown>|null, packageVersion?: string, expectedVersion?: string, identifiers?: {extensionId?: string, publisherId?: string, saEmail?: string}, identifiersOptional?: boolean, manifestPermissions?: string[]|null, requiredPermissions?: string[]}} input
 * @returns {{checks: Array<{name: string, status: 'pass'|'fail'|'warn', detail: string}>, ok: boolean}}
 */
export function evaluatePreflight({
  zipPath,
  manifest = null,
  packageVersion,
  expectedVersion,
  identifiers = {},
  identifiersOptional = false,
  manifestPermissions = null,
  requiredPermissions = [],
}) {
  /** @type {Array<{name: string, status: 'pass'|'fail'|'warn', detail: string}>} */
  const checks = [];
  const push = (name, status, detail) => checks.push({ name, status, detail });

  push(
    'zip 产物存在',
    zipPath ? 'pass' : 'fail',
    zipPath ? String(zipPath) : '在 .output/ 下找不到对应版本的 *-chrome.zip',
  );

  const ids = validateIdentifiers(identifiers);
  const idsAbsent = !identifiers.extensionId && !identifiers.publisherId && !identifiers.saEmail;
  push(
    '标识符形状',
    ids.ok ? 'pass' : identifiersOptional && idsAbsent ? 'warn' : 'fail',
    ids.ok
      ? 'extension / publisher / service-account 三项形状合法'
      : identifiersOptional && idsAbsent
        ? '未配置三项标识符（本轮只验包，不验凭据）：' + ids.problems.join('；')
        : ids.problems.join('；'),
  );

  if (!manifest) {
    push('包内 manifest 可读', 'fail', '读不到 manifest.json，包不可用');
  } else {
    push('包内 manifest 可读', 'pass', `manifest_version=${String(manifest.manifest_version ?? '缺失')}`);
    const inZip = String(manifest.version ?? '');
    push(
      '包内版本 == package.json',
      inZip && inZip === packageVersion ? 'pass' : 'fail',
      `包内 ${inZip || '缺失'} / package.json ${packageVersion || '缺失'}`,
    );
    if (expectedVersion) {
      push(
        '包内版本 == 发布 tag',
        inZip === expectedVersion ? 'pass' : 'fail',
        `包内 ${inZip || '缺失'} / tag ${expectedVersion}`,
      );
    }
    const declared = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    const missing = requiredPermissions.filter(p => !declared.includes(p));
    push(
      '权限集合符合预期',
      missing.length === 0 ? 'pass' : 'warn',
      missing.length === 0 ? `${declared.length} 项权限，未越出清单` : `包内缺少这些权限：${missing.join(', ')}`,
    );
    if (manifestPermissions) {
      // 比对集合而不是数量：数量相等但换了一项权限，正是「包与源码不同步」最可能的形状。
      const sorted = (/** @type {string[]} */ list) => [...list].sort();
      const zipPerms = sorted(declared);
      const repoPerms = sorted(Array.isArray(manifestPermissions) ? manifestPermissions : []);
      const onlyIn = (/** @type {string[]} */ a, /** @type {string[]} */ b) => a.filter(p => !b.includes(p));
      const zipExtra = onlyIn(zipPerms, repoPerms);
      const repoExtra = onlyIn(repoPerms, zipPerms);
      const same = zipExtra.length === 0 && repoExtra.length === 0;
      push(
        '仓库 manifest 与包内一致',
        same ? 'pass' : 'warn',
        same
          ? `${zipPerms.length} 项权限，与 .output/chrome-mv3 一致`
          : `包内多出 [${zipExtra.join(', ')}] / 仓库多出 [${repoExtra.join(', ')}]，产物可能来自旧提交`,
      );
    }
  }

  return { checks, ok: checks.every(c => c.status !== 'fail') };
}

/**
 * 汇总 fetchStatus 响应里与发版决策相关的字段。
 *
 * @param {Record<string, unknown>|null|undefined} status
 * @returns {{itemState: string, submittedVersion: string, publishedVersion: string, warned: boolean, takenDown: boolean}}
 */
export function summarizeStatus(status) {
  const revision = (/** @type {unknown} */ rev) => (rev && typeof rev === 'object' ? rev : {});
  const versionOf = (/** @type {any} */ rev) => {
    const channels = Array.isArray(rev?.distributionChannels) ? rev.distributionChannels : [];
    return channels.length ? String(channels[0].crxVersion ?? '') : '';
  };
  const submitted = revision(status?.submittedItemRevisionStatus);
  const published = revision(status?.publishedItemRevisionStatus);
  return {
    itemState: String(submitted.state ?? published.state ?? 'UNKNOWN'),
    submittedVersion: versionOf(submitted),
    publishedVersion: versionOf(published),
    warned: Boolean(status?.warned),
    takenDown: Boolean(status?.takenDown),
  };
}
