/**
 * 商店截图演示站 —— 本地 HTTPS 静态服务 + 按域名合成 favicon。
 *
 *   node demo-server.mjs                # 监听 8443
 *   SHOT_PORT=9443 node demo-server.mjs
 *
 * 为什么必须是 HTTPS：条目网址在 `utils/favicon.ts` 里会被补成 `https://<host>`，
 * 而 Chrome 的 favicon 缓存按 `CanonicizeURL`（清掉 path/query/ref，**保留 scheme
 * 与 port**）建索引。只有真正访问过 `https://admin.example.com/…`，
 * `/_favicon/?pageUrl=https://admin.example.com` 才会命中站点自己的图标，
 * 否则只能拿到通用地球图标——「图标取自本地缓存」这个卖点就拍不出来。
 *
 * 80/443 属于特权端口，非 root 绑定必然 EACCES，因此改用高位端口配合
 * `--host-resolver-rules="MAP *.example.com 127.0.0.1:8443"`：只在解析层换端口，
 * 浏览器地址栏与 favicon 缓存 key 仍是干净的 `https://<host>`。
 *
 * 证书自签名、运行时生成到系统临时目录，仓库内不留私钥；Chrome 需带
 * `--ignore-certificate-errors` 启动。
 */
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SHOT_PORT || 8443);
const CERT_DIR = resolve(tmpdir(), 'aph-store-shots-cert');
const KEY = join(CERT_DIR, 'demo-key.pem');
const CERT = join(CERT_DIR, 'demo-cert.pem');

/** 图标尺寸：SiteFavicon 按显示尺寸的 2 倍请求，64 足够覆盖 16~32px 展示位。 */
const ICON_SIZE = 64;

/** 只放行演示页需要的类型，其余一律 404（顺带避免把流水线脚本本身暴露出去）。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * 生成自签名证书（缺失时）。
 *
 * `*.example.com` 通配 SAN 已覆盖全部演示子域；私钥只落在系统临时目录。
 */
function ensureCert() {
  if (existsSync(CERT) && existsSync(KEY)) return;
  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      KEY,
      '-out',
      CERT,
      '-days',
      '30',
      '-subj',
      '/CN=example.com',
      '-addext',
      'subjectAltName=DNS:*.example.com,DNS:example.com',
    ],
    { stdio: 'ignore' },
  );
}

/** 取 host 短标识作为图标字形：`dev-admin` → DA，`console` → C。 */
function initials(host) {
  const label = String(host).split(':')[0].split('.')[0] || '';
  return label
    .split(/[-_.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase();
}

/** 由域名稳定派生底色：FNV-1a 累加 + 移位雪崩后取色相，同域名恒定、不同域名尽量拉开。 */
function colorOf(host) {
  let h = 2166136261 >>> 0;
  for (const ch of String(host)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  h ^= h >>> 15;
  return `hsl(${h % 360}, 62%, 45%)`;
}

const _iconCache = new Map();

/**
 * 按 Host 头合成站点图标 PNG（内存缓存，不落盘）。
 *
 * @param {string} host 请求的 Host 头（可能带端口）
 * @returns {Promise<Buffer>} PNG 字节
 */
async function faviconPng(host) {
  const cached = _iconCache.get(host);
  if (cached) return cached;
  const mark = initials(host) || 'X';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}">
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="14" fill="${colorOf(host)}"/>
  <text x="${ICON_SIZE / 2}" y="${ICON_SIZE / 2}" dy="0.35em" text-anchor="middle"
    font-family="Helvetica Neue, Arial, sans-serif" font-size="${mark.length > 1 ? 26 : 34}"
    font-weight="700" fill="#FFFFFF">${mark}</text>
</svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  _iconCache.set(host, buf);
  return buf;
}

/** 预热页：只为让浏览器访问一次该域名以写入 favicon 缓存，无业务内容。 */
const warmPage = host => `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>${host}</title>
<link rel="icon" type="image/png" sizes="${ICON_SIZE}x${ICON_SIZE}" href="/favicon.png">
<style>body{margin:0;padding:40px;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:#8a94a6}</style>
</head><body>demo host: ${host}</body></html>`;

ensureCert();

const server = createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, async (req, res) => {
  const host = req.headers.host || '';
  const path = decodeURIComponent((req.url || '/').split('?')[0]);

  if (path === '/favicon.png' || path === '/favicon.ico') {
    try {
      const png = await faviconPng(host);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(png);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  if (path === '/' || path === '/warm') {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(warmPage(host.split(':')[0]));
    return;
  }

  const file = resolve(HERE, `.${path}`);
  const mime = MIME[extname(file)];
  if (!file.startsWith(HERE + sep) || !mime || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`demo site listening on https://127.0.0.1:${PORT}`);
  console.log(
    'chrome flags:\n  --host-resolver-rules="MAP *.example.com 127.0.0.1:%d" --ignore-certificate-errors',
    PORT,
  );
});
