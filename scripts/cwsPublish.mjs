#!/usr/bin/env node
/**
 * Chrome Web Store 发布 CLI（API v2 + 服务账号）。
 *
 * 子命令：
 *   preflight  纯离线预检：zip 产物、包内 manifest 版本与 package.json/tag 对账、标识符形状。不联网。
 *   token      只验证服务账号凭据能否换到 access token（打印有效期与类型，不打印 token）。
 *   status     只读查询商品状态——dry-run 的终点：证明整条凭据链通，而不动商店。
 *   publish    预检 → 传包 → 等异步上传落定 → 提审（`--no-submit` 只传包不提审）。
 *   cancel     撤回当前排队中的提交（每天每 publisher 上限 6 次）。
 *
 * 凭据从环境变量读取：`CWS_EXTENSION_ID` / `CWS_PUBLISHER_ID` / `CWS_SA_EMAIL` /
 * `CWS_SA_PRIVATE_KEY`（JSON key 的 `private_key`，含 PEM 头尾整段），可选
 * `CWS_REQUIRED_PERMISSIONS`（逗号分隔，用于权限漂移告警）。
 *
 * 退出码非零时打印可执行的修复提示；任何输出都不含 access token 与私钥。
 *
 * @file scripts/cwsPublish.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CWS_API_ROOT,
  CWS_TOKEN_URI,
  CwsPublishError,
  evaluatePreflight,
  fetchItemStatus,
  itemName,
  mintAccessToken,
  publishItem,
  cancelSubmission,
  readManifestFromZip,
  summarizeStatus,
  uploadPackage,
  waitForUpload,
} from './lib/cwsPublish.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = path.join(root, '.output');

/**
 * 端点覆盖只服务于一件事：验收测试把同一套代码指向本地假商店，逐字断言请求形状。
 * 生产不设这两个变量，永远走 Google 官方端点。
 */
const API_ROOT = process.env.CWS_API_ROOT || CWS_API_ROOT;
const TOKEN_URI = process.env.CWS_OAUTH_TOKEN_URI || CWS_TOKEN_URI;

const HELP = `用法：node scripts/cwsPublish.mjs <preflight|token|status|publish|cancel> [选项]

选项：
  --zip <path>               指定 zip 包（默认取 .output/ 下最新的 *-chrome.zip）
  --expect-version <semver>  期望版本号（workflow 里传 release tag，允许带前导 v）
  --no-submit                只上传包，不提交审核
  --staged                   提审时用 STAGED_PUBLISH（审核通过后挂起，由开发者手动放行）
  --ids-optional             标识符 Secret 还没配时把该项降为告警（给未配服务账号的分支跑离线预检用）
  --skip-preflight           跳过离线预检（排查产物本身问题时用）
`;

const args = parseArgs({
  allowPositionals: true,
  options: {
    zip: { type: 'string' },
    'expect-version': { type: 'string' },
    'no-submit': { type: 'boolean' },
    staged: { type: 'boolean' },
    'ids-optional': { type: 'boolean' },
    'skip-preflight': { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

const command = args.positionals[0];

if (args.values.help || !command) {
  process.stdout.write(HELP);
  process.exitCode = 2;
} else {
  run(command).catch(e => {
    process.stderr.write(`发布流程终止：${e instanceof Error ? e.message : String(e)}\n`);
    if (e instanceof CwsPublishError) {
      process.stderr.write(`API 响应体：${JSON.stringify(e.body).slice(0, 800)}\n`);
    }
    process.exitCode = 1;
  });
}

/**
 * @param {string} name
 */
async function run(name) {
  switch (name) {
    case 'preflight':
      return commandPreflight();
    case 'token':
      return commandToken();
    case 'status':
      return commandStatus();
    case 'publish':
      return commandPublish();
    case 'cancel':
      return commandCancel();
    default:
      process.stdout.write(HELP);
      throw new Error(`未知子命令：${name}`);
  }
}

function creds() {
  const env = process.env;
  return {
    extensionId: env.CWS_EXTENSION_ID ?? '',
    publisherId: env.CWS_PUBLISHER_ID ?? '',
    saEmail: env.CWS_SA_EMAIL ?? '',
    privateKey: env.CWS_SA_PRIVATE_KEY ?? '',
    requiredPermissions: (env.CWS_REQUIRED_PERMISSIONS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  };
}

function expectVersion() {
  return (args.values['expect-version'] ?? '').replace(/^v/, '');
}

/**
 * 取本次要发布的 zip：显式 `--zip` 优先，否则按 `.output/` 里 mtime 最新的那个；
 * 给了期望版本时只认文件名里带该版本的包，避免把旧版本包提审上去。
 */
function resolveZip() {
  if (args.values.zip) return args.values.zip;
  const version = expectVersion();
  const candidates = readdirSyncSafe(OUTPUT_DIR)
    .filter(f => f.endsWith('-chrome.zip'))
    .filter(f => !version || f.includes(`-${version}-chrome.zip`))
    .map(f => path.join(OUTPUT_DIR, f))
    .sort((a, b) => statSyncSafe(b).mtimeMs - statSyncSafe(a).mtimeMs);
  return candidates[0];
}

function readPackageVersion() {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function readRepoManifestPermissions() {
  try {
    const built = JSON.parse(readFileSync(path.join(OUTPUT_DIR, 'chrome-mv3', 'manifest.json'), 'utf8'));
    return Array.isArray(built.permissions) ? built.permissions : null;
  } catch {
    return null;
  }
}

function runPreflight() {
  const c = creds();
  const zipPath = resolveZip();
  let manifest = null;
  if (zipPath) {
    try {
      manifest = readManifestFromZip({ zipPath });
    } catch {
      manifest = null;
    }
  }
  const result = evaluatePreflight({
    zipPath,
    manifest,
    packageVersion: readPackageVersion(),
    expectedVersion: expectVersion(),
    identifiers: { extensionId: c.extensionId, publisherId: c.publisherId, saEmail: c.saEmail },
    identifiersOptional: Boolean(args.values['ids-optional']),
    manifestPermissions: readRepoManifestPermissions(),
    requiredPermissions: c.requiredPermissions,
  });
  for (const check of result.checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    process.stdout.write(`${mark} ${check.name}：${check.detail}\n`);
  }
  return result;
}

function commandPreflight() {
  const result = runPreflight();
  if (!result.ok) throw new Error('预检未通过——先按上面的 ✗ 项修，包不会上传');
}

async function acquireToken(c) {
  if (!c.privateKey) {
    throw new Error('缺少 CWS_SA_PRIVATE_KEY（服务账号 JSON key 里的 private_key，含 PEM 头尾整段）');
  }
  if (!c.saEmail) {
    throw new Error('缺少 CWS_SA_EMAIL（服务账号邮箱，同时必须已加进 Developer Dashboard → Account）');
  }
  return mintAccessToken({ email: c.saEmail, privateKey: c.privateKey, tokenUri: TOKEN_URI });
}

async function commandToken() {
  const issued = await acquireToken(creds());
  process.stdout.write(
    `凭据可用：access token 已换取（类型 ${issued.tokenType}，有效期 ${issued.expiresInSeconds}s）。本命令不打印 token 本身。\n`,
  );
}

async function commandStatus() {
  const c = creds();
  const { accessToken: token } = await acquireToken(c);
  printStatus(
    await fetchItemStatus({ token, name: itemName(c.publisherId, c.extensionId), apiRoot: API_ROOT }),
    '当前',
  );
}

async function commandPublish() {
  const c = creds();
  if (!args.values['skip-preflight']) {
    const result = runPreflight();
    if (!result.ok) throw new Error('预检未通过，已终止发布——这是排队人工审核之前最后一道离线闸');
  }
  const zipPath = resolveZip();
  if (!zipPath) throw new Error(`找不到 .output/*-chrome.zip${expectVersion() ? `（版本 ${expectVersion()}）` : ''}`);
  const name = itemName(c.publisherId, c.extensionId);
  const { accessToken: token } = await acquireToken(c);

  const before = await fetchItemStatus({ token, name, apiRoot: API_ROOT });
  printStatus(before, '提审前');
  const submitted = String(before?.submittedItemRevisionStatus?.state ?? '');
  if (submitted === 'PENDING_REVIEW' && !args.values['no-submit']) {
    throw new Error(
      '上一版仍在审核中，再次提审会被拒。先跑 `node scripts/cwsPublish.mjs cancel` 撤回当前提交（每天上限 6 次），或等审核结束。',
    );
  }

  const uploaded = await uploadPackage({ token, name, zipBytes: readFileSync(zipPath), apiRoot: API_ROOT });
  process.stdout.write(
    `包已上传：uploadState=${String(uploaded.uploadState ?? 'UNKNOWN')} crxVersion=${String(uploaded.crxVersion ?? '未回填')}\n`,
  );
  const settled = await waitForUpload({ token, name, apiRoot: API_ROOT });
  process.stdout.write(
    `异步上传${settled.settled ? '已落定' : '仍在进行'}：uploadState=${settled.uploadState}（轮询 ${settled.polls} 次）\n`,
  );
  if (settled.uploadState === 'FAILED') {
    throw new Error('包在商店侧解析失败、未提审：看 Dashboard 商品状态，多为 manifest 缺字段或包体积超限');
  }
  if (args.values['no-submit']) {
    process.stdout.write('已按要求只传包、不提审（--no-submit）。\n');
    return;
  }
  const published = await publishItem({
    token,
    name,
    apiRoot: API_ROOT,
    publishType: args.values.staged ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH',
  });
  process.stdout.write(`已提交审核：state=${String(published.state ?? 'UNKNOWN')}\n`);
  printStatus(await fetchItemStatus({ token, name, apiRoot: API_ROOT }), '提审后');
}

async function commandCancel() {
  const c = creds();
  const { accessToken: token } = await acquireToken(c);
  await cancelSubmission({ token, name: itemName(c.publisherId, c.extensionId), apiRoot: API_ROOT });
  process.stdout.write('当前提交已撤回。每天每 publisher 最多 6 次，用尽请等审核自然结束。\n');
}

function printStatus(status, label) {
  const s = summarizeStatus(status);
  process.stdout.write(
    `${label}状态：state=${s.itemState} submitted=${s.submittedVersion || '—'} published=${s.publishedVersion || '—'} warned=${s.warned} takenDown=${s.takenDown}\n`,
  );
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statSyncSafe(file) {
  try {
    return statSync(file);
  } catch {
    return { mtimeMs: 0 };
  }
}
