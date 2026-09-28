// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBasicAuthHeader,
  FILE_PREFIX,
  FILE_SUFFIX,
  mapWebDavStatus,
  MAX_DOWNLOAD_BYTES,
  needsInsecureConfirm,
  normalizeWebDavDirUrl,
  parseSnapshotFileName,
  WebDavAdapter,
} from '@/utils/cloudSync/adapters/webdav';
import type { WebDavCredentials } from '@/utils/cloudSync/types';

/**
 * WebDAV 适配器测试（WebDAV 规格 §4、§9）
 *
 * mock fetch 锁定：Basic/Bearer 头选择、非 ASCII 凭证、URL 归一化与编码、
 * MKCOL 幂等、PROPFIND 多命名空间解析与过滤、PUT/GET/DELETE、下载上限、
 * 状态码映射全表、传输安全校验。jsdom 环境提供 DOMParser。
 */

const CREDS = { username: 'user', password: 'pass' };
const DIR = 'https://dav.example.com/dav/';
const BACKUP_DIR = `${DIR}aph-backup/`;

interface StubResponse {
  status?: number;
  body?: string;
}

function stubFetchSequence(responses: StubResponse[]): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      const status = next.status ?? 200;
      // 204 是 null-body 状态，Response 构造器拒绝任何 body（含空串）
      const body = status === 204 ? null : (next.body ?? '');
      return new Response(body, { status });
    }),
  );
  return { calls };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeAdapter(dirUrl = DIR, credentials: WebDavCredentials = CREDS): WebDavAdapter {
  return new WebDavAdapter({ dirUrl, credentials });
}

/** 构造一条 PROPFIND response 节点（前缀与外层 multistatus 一致，模拟真实服务器） */
function propResponse(href: string, opts: { collection?: boolean; size?: number; prefix?: string } = {}): string {
  const p = opts.prefix ?? 'D';
  const resourceType = opts.collection ? `<${p}:collection/>` : '';
  const size = opts.size !== undefined ? `<${p}:getcontentlength>${opts.size}</${p}:getcontentlength>` : '';
  return `<${p}:response><${p}:href>${href}</${p}:href><${p}:propstat><${p}:prop><${p}:resourcetype>${resourceType}</${p}:resourcetype>${size}</${p}:prop></${p}:propstat></${p}:response>`;
}

function multistatus(responses: string[], prefix = 'D'): string {
  return `<${prefix}:multistatus xmlns:${prefix}="DAV:">${responses.join('')}</${prefix}:multistatus>`;
}

describe('buildBasicAuthHeader', () => {
  it('生成 Basic base64(user:pass)', () => {
    expect(buildBasicAuthHeader('user', 'pass')).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('非 ASCII 用户名不抛错且可正确编码', () => {
    const header = buildBasicAuthHeader('张三', 'päss');
    expect(header.startsWith('Basic ')).toBe(true);
    // 还原验证：base64 → UTF-8 字节 → 原文
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), c => c.charCodeAt(0)));
    expect(decoded).toBe('张三:päss');
  });
});

describe('normalizeWebDavDirUrl', () => {
  it('补尾斜杠', () => {
    expect(normalizeWebDavDirUrl('https://x/dav')).toBe('https://x/dav/');
    expect(normalizeWebDavDirUrl('https://x/dav/')).toBe('https://x/dav/');
  });

  it('去除首尾空白', () => {
    expect(normalizeWebDavDirUrl('  https://x/dav  ')).toBe('https://x/dav/');
  });

  it('非 ASCII 路径按 URL 标准百分号编码；已编码输入不二次编码', () => {
    // URL 标准行为：非 ASCII 字符序列化为百分号编码（网络传输必需）
    expect(normalizeWebDavDirUrl('https://x/remote.php/dav/files/张三/')).toBe(
      'https://x/remote.php/dav/files/%E5%BC%A0%E4%B8%89/',
    );
    // 已编码输入原样保留：% 不被再次编码为 %25
    expect(normalizeWebDavDirUrl('https://x/dav/files/%E5%BC%A0%E4%B8%89/')).toBe(
      'https://x/dav/files/%E5%BC%A0%E4%B8%89/',
    );
  });

  it('非法 URL 抛 notFound', () => {
    expect(() => normalizeWebDavDirUrl('not a url')).toThrowError(expect.objectContaining({ kind: 'notFound' }));
  });
});

describe('needsInsecureConfirm：传输安全校验（规格 §4.4）', () => {
  it('https → 无需确认', () => {
    expect(needsInsecureConfirm('https://x/dav/')).toBe(false);
  });

  it('http + localhost/127.0.0.1/[::1] → 无需确认（本地开发）', () => {
    expect(needsInsecureConfirm('http://localhost/dav/')).toBe(false);
    expect(needsInsecureConfirm('http://127.0.0.1/dav/')).toBe(false);
    expect(needsInsecureConfirm('http://[::1]/dav/')).toBe(false);
  });

  it('http + 内网/公网 IP → 需确认', () => {
    expect(needsInsecureConfirm('http://192.168.1.5/dav/')).toBe(true);
    expect(needsInsecureConfirm('http://nas.local/dav/')).toBe(true);
  });

  it('非 http(s) 协议 → 抛 notFound', () => {
    expect(() => needsInsecureConfirm('ftp://x/dav/')).toThrowError(expect.objectContaining({ kind: 'notFound' }));
    expect(() => needsInsecureConfirm('file:///x')).toThrowError(expect.objectContaining({ kind: 'notFound' }));
  });
});

describe('mapWebDavStatus：状态码映射全表（规格 §4.3）', () => {
  it('按规格映射到领域错误类别', () => {
    expect(mapWebDavStatus(401, 'x').kind).toBe('invalidCredential');
    expect(mapWebDavStatus(403, 'x').kind).toBe('permission');
    expect(mapWebDavStatus(404, 'x').kind).toBe('notFound');
    expect(mapWebDavStatus(405, 'x').kind).toBe('unknown');
    expect(mapWebDavStatus(407, 'x').kind).toBe('permission');
    expect(mapWebDavStatus(409, 'x').kind).toBe('notFound');
    expect(mapWebDavStatus(413, 'x').kind).toBe('tooLarge');
    expect(mapWebDavStatus(423, 'x').kind).toBe('writeConflict');
    expect(mapWebDavStatus(429, 'x').kind).toBe('rateLimit');
    expect(mapWebDavStatus(507, 'x').kind).toBe('quota');
    expect(mapWebDavStatus(500, 'x').kind).toBe('network');
    expect(mapWebDavStatus(502, 'x').kind).toBe('network');
    expect(mapWebDavStatus(418, 'x').kind).toBe('unknown');
  });

  it('保留原始状态码于 code', () => {
    expect(mapWebDavStatus(413, 'too big').code).toBe(413);
  });
});

describe('parseSnapshotFileName：文件名时间戳解析（规格 §5.3）', () => {
  it('解析 UTC 紧凑时间戳为 epoch 毫秒', () => {
    // 2026-09-24 10:15:30 UTC
    expect(parseSnapshotFileName('aph-20260924101530-k3n9x2.aphdav')).toBe(Date.UTC(2026, 8, 24, 10, 15, 30));
  });

  it('非快照文件名 / 时间戳非法 → 0', () => {
    expect(parseSnapshotFileName('notes.txt')).toBe(0);
    expect(parseSnapshotFileName('aph-notanumber-x.aphdav')).toBe(0);
    expect(parseSnapshotFileName('aph-20261345999999-x.aphdav')).toBe(0); // 月份 13 非法
  });
});

describe('WebDavAdapter：认证头', () => {
  it('无 bearerToken → Basic', async () => {
    const { calls } = stubFetchSequence([{ status: 207, body: multistatus([]) }]);
    await makeAdapter().testConnection();
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('bearerToken 非空 → Bearer 优先，忽略 user/pass', async () => {
    const { calls } = stubFetchSequence([{ status: 207, body: multistatus([]) }]);
    await makeAdapter(DIR, { username: 'u', password: 'p', bearerToken: 'tk-123' }).testConnection();
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tk-123');
  });
});

describe('WebDavAdapter：testConnection（PROPFIND depth 0）', () => {
  it('备份目录存在 → 成功，Depth 头为 0', async () => {
    const { calls } = stubFetchSequence([
      { status: 207, body: multistatus([propResponse(BACKUP_DIR, { collection: true })]) },
    ]);
    await expect(makeAdapter().testConnection()).resolves.toBeUndefined();
    expect(calls[0].url).toBe(BACKUP_DIR);
    expect(calls[0].init.method).toBe('PROPFIND');
    expect((calls[0].init.headers as Record<string, string>).Depth).toBe('0');
  });

  it('备份目录 404 → 降级探测父目录，父目录可达即成功（目录将在备份时创建）', async () => {
    const { calls } = stubFetchSequence([
      { status: 404 },
      { status: 207, body: multistatus([propResponse(DIR, { collection: true })]) },
    ]);
    await expect(makeAdapter().testConnection()).resolves.toBeUndefined();
    expect(calls[0].url).toBe(BACKUP_DIR);
    expect(calls[1].url).toBe(DIR);
  });

  it('401 → invalidCredential', async () => {
    stubFetchSequence([{ status: 401 }]);
    await expect(makeAdapter().testConnection()).rejects.toMatchObject({ kind: 'invalidCredential' });
  });

  it('父目录也 404 → notFound', async () => {
    stubFetchSequence([{ status: 404 }, { status: 404 }]);
    await expect(makeAdapter().testConnection()).rejects.toMatchObject({ kind: 'notFound' });
  });
});

describe('WebDavAdapter：ensureDirectory（MKCOL 幂等）', () => {
  it('201（新建）→ true；405（已存在）→ false', async () => {
    stubFetchSequence([{ status: 201 }]);
    await expect(makeAdapter().ensureDirectory()).resolves.toBe(true);
    stubFetchSequence([{ status: 405 }]);
    await expect(makeAdapter().ensureDirectory()).resolves.toBe(false);
  });

  it('MKCOL 目标为备份子目录，方法正确', async () => {
    const { calls } = stubFetchSequence([{ status: 201 }]);
    await makeAdapter().ensureDirectory();
    expect(calls[0].init.method).toBe('MKCOL');
    expect(calls[0].url).toBe(BACKUP_DIR);
  });

  it('409（父目录不存在）→ notFound', async () => {
    stubFetchSequence([{ status: 409 }]);
    await expect(makeAdapter().ensureDirectory()).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('507（容量不足）→ quota', async () => {
    stubFetchSequence([{ status: 507 }]);
    await expect(makeAdapter().ensureDirectory()).rejects.toMatchObject({ kind: 'quota' });
  });
});

describe('WebDavAdapter：listFiles（PROPFIND depth 1 解析）', () => {
  it('多命名空间前缀（D:/d:）均按 localName 解析', async () => {
    const file = 'aph-20260924101530-k3n9x2.aphdav';
    for (const prefix of ['D', 'd']) {
      stubFetchSequence([
        { status: 207, body: multistatus([propResponse(`${BACKUP_DIR}${file}`, { size: 123, prefix })], prefix) },
      ]);
      const files = await makeAdapter().listFiles();
      expect(files).toEqual([{ name: file, url: `${BACKUP_DIR}${file}`, size: 123 }]);
    }
  });

  it('默认命名空间（无前缀）也能解析', async () => {
    const file = 'aph-20260924101530-k3n9x2.aphdav';
    const xml = `<multistatus xmlns="DAV:"><response><href>${BACKUP_DIR}${file}</href><propstat><prop><resourcetype/><getcontentlength>99</getcontentlength></prop></propstat></response></multistatus>`;
    stubFetchSequence([{ status: 207, body: xml }]);
    const files = await makeAdapter().listFiles();
    expect(files).toEqual([{ name: file, url: `${BACKUP_DIR}${file}`, size: 99 }]);
  });

  it('过滤集合自身与非 aph-*.aphdav 文件（绝不误列用户其他文件）', async () => {
    stubFetchSequence([
      {
        status: 207,
        body: multistatus([
          propResponse(BACKUP_DIR, { collection: true }),
          propResponse(`${BACKUP_DIR}aph-20260924101530-aaaaaa.aphdav`, { size: 10 }),
          propResponse(`${BACKUP_DIR}notes.txt`, { size: 5 }),
          propResponse(`${BACKUP_DIR}aph-20260924101531-bbbbbb.aphdav`, { size: 20 }),
        ]),
      },
    ]);
    const files = await makeAdapter().listFiles();
    expect(files.map(f => f.name)).toEqual(['aph-20260924101530-aaaaaa.aphdav', 'aph-20260924101531-bbbbbb.aphdav']);
  });

  it('href 为相对路径 / 含编码字符时取 basename 并 decode，url 由适配器重建', async () => {
    stubFetchSequence([
      {
        status: 207,
        body: multistatus([propResponse('/dav/aph-backup/aph-20260924101530-cccccc.aphdav', { size: 1 })]),
      },
    ]);
    const files = await makeAdapter().listFiles();
    // url 用 backupDirUrl + encodeURIComponent(name) 重建，不信任服务器 href 的绝对性
    expect(files[0].url).toBe(`${BACKUP_DIR}aph-20260924101530-cccccc.aphdav`);
  });

  it('getcontentlength 缺失 → size 0', async () => {
    stubFetchSequence([
      { status: 207, body: multistatus([propResponse(`${BACKUP_DIR}aph-20260924101530-dddddd.aphdav`)]) },
    ]);
    const files = await makeAdapter().listFiles();
    expect(files[0].size).toBe(0);
  });

  it('非 XML 响应 → unknown 错误', async () => {
    stubFetchSequence([{ status: 207, body: 'not xml at all' }]);
    await expect(makeAdapter().listFiles()).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('Depth 头为 1', async () => {
    const { calls } = stubFetchSequence([{ status: 207, body: multistatus([]) }]);
    await makeAdapter().listFiles();
    expect((calls[0].init.headers as Record<string, string>).Depth).toBe('1');
  });
});

describe('WebDavAdapter：putFile / getFile / deleteFile', () => {
  it('putFile 用 PUT + encodeURIComponent 文件名 + octet-stream', async () => {
    const { calls } = stubFetchSequence([{ status: 201 }]);
    await makeAdapter().putFile('aph-20260924101530-eeeeee.aphdav', '{"version":1}');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].url).toBe(`${BACKUP_DIR}aph-20260924101530-eeeeee.aphdav`);
    expect(calls[0].init.body).toBe('{"version":1}');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('putFile 413 → tooLarge', async () => {
    stubFetchSequence([{ status: 413 }]);
    await expect(makeAdapter().putFile('aph-x.aphdav', 'big')).rejects.toMatchObject({ kind: 'tooLarge' });
  });

  it('getFile 返回响应文本', async () => {
    stubFetchSequence([{ status: 200, body: 'file-content' }]);
    await expect(makeAdapter().getFile(`${BACKUP_DIR}aph-x.aphdav`)).resolves.toBe('file-content');
  });

  it('getFile expectedSize 超上限 → tooLarge（不发请求）', async () => {
    const { calls } = stubFetchSequence([{ status: 200, body: 'x' }]);
    await expect(makeAdapter().getFile(`${BACKUP_DIR}aph-x.aphdav`, MAX_DOWNLOAD_BYTES + 1)).rejects.toMatchObject({
      kind: 'tooLarge',
    });
    expect(calls).toHaveLength(0);
  });

  it('getFile 响应体超上限 → tooLarge（size 未知时读取后二次校验）', async () => {
    stubFetchSequence([{ status: 200, body: 'x'.repeat(100) }]);
    // maxDownloadBytes 为可测试性接缝，默认 MAX_DOWNLOAD_BYTES
    const adapter = new WebDavAdapter({ dirUrl: DIR, credentials: CREDS, maxDownloadBytes: 50 });
    await expect(adapter.getFile(`${BACKUP_DIR}aph-x.aphdav`)).rejects.toMatchObject({ kind: 'tooLarge' });
  });

  it('getFile 404 → notFound', async () => {
    stubFetchSequence([{ status: 404 }]);
    await expect(makeAdapter().getFile(`${BACKUP_DIR}gone.aphdav`)).rejects.toMatchObject({ kind: 'notFound' });
  });

  it('deleteFile 204 成功；404 视为业务成功（幂等）', async () => {
    stubFetchSequence([{ status: 204 }]);
    await expect(makeAdapter().deleteFile(`${BACKUP_DIR}aph-x.aphdav`)).resolves.toBeUndefined();
    stubFetchSequence([{ status: 404 }]);
    await expect(makeAdapter().deleteFile(`${BACKUP_DIR}gone.aphdav`)).resolves.toBeUndefined();
  });

  it('deleteFile 423 → writeConflict', async () => {
    stubFetchSequence([{ status: 423 }]);
    await expect(makeAdapter().deleteFile(`${BACKUP_DIR}aph-x.aphdav`)).rejects.toMatchObject({
      kind: 'writeConflict',
    });
  });
});

describe('WebDavAdapter：构造与取消', () => {
  it('http 内网地址未确认 → 构造即抛 notFound（不信任调用方）', () => {
    expect(() => new WebDavAdapter({ dirUrl: 'http://192.168.1.5/dav/', credentials: CREDS })).toThrowError(
      expect.objectContaining({ kind: 'notFound' }),
    );
  });

  it('http 内网地址 + allowInsecure → 构造成功', () => {
    expect(
      () => new WebDavAdapter({ dirUrl: 'http://192.168.1.5/dav/', credentials: CREDS, allowInsecure: true }),
    ).not.toThrow();
  });

  it('signal 已 abort → 请求前抛 aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetchSequence([{ status: 207, body: multistatus([]) }]);
    const adapter = new WebDavAdapter({ dirUrl: DIR, credentials: CREDS, options: { signal: controller.signal } });
    await expect(adapter.testConnection()).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('onApiCall 每次请求回调一次（配额预估）', async () => {
    const onApiCall = vi.fn();
    stubFetchSequence([{ status: 207, body: multistatus([]) }]);
    const adapter = new WebDavAdapter({ dirUrl: DIR, credentials: CREDS, options: { onApiCall } });
    await adapter.testConnection();
    expect(onApiCall).toHaveBeenCalledTimes(1);
  });

  it('文件前后缀常量符合规格', () => {
    expect(FILE_PREFIX).toBe('aph-');
    expect(FILE_SUFFIX).toBe('.aphdav');
  });
});
