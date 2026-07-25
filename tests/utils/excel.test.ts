import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcelUtils } from '@/utils/excel';
import type { ImportFormat } from '@/utils/excelFormatMap';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

/**
 * excel.ts 特征化测试
 *
 * 锁定导入/导出的当前行为，作为「拆分为多模块」重构的护栏：
 * - CSV 解析：各格式列映射（显式 format）、auto 自动检测（含既有优先级）、
 *   引号转义/内嵌逗号、空用户名过滤、行数不足返回空；
 * - JSON 解析：数组与 { entries } 两种结构、中英文字段映射、时间戳解析、
 *   空用户名过滤、非法 JSON 抛错；
 * - 导出序列化：CSV 带 BOM 与引号转义、JSON 结构、模板内容
 *   （经 Blob/document/URL 打桩捕获生成内容，不触发真实下载）。
 *
 * createTime/updateTime 由 Date.now() 生成，断言时用 toMatchObject 忽略。
 */

/** 将字符串编码为 UTF-8 ArrayBuffer（模拟上传的 CSV 字节） */
const buf = (s: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(s);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
};

beforeEach(() => {
  // excel 解析/导出路径含 info/warn/error/debug 日志，静默 console 保持输出整洁
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseCSV：显式格式列映射', () => {
  it('native（中文表头）解析并 trim 字段', () => {
    const csv = [
      '用户名(必填),密码,网址,标签,备注,两步验证',
      'alice,secret,https://a.com,work,note1,JBSW',
      'bob,pw2,https://b.com,,,',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), 'native');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      username: 'alice',
      password: 'secret',
      url: 'https://a.com',
      tag: 'work',
      remark: 'note1',
      totp: 'JBSW',
    });
    expect(result[1]).toMatchObject({
      username: 'bob',
      password: 'pw2',
      url: 'https://b.com',
      tag: '',
      remark: '',
      totp: '',
    });
  });

  it('chrome 格式：name→tag、其余按列名映射', () => {
    const csv = ['name,url,username,password', 'GitHub,https://github.com,octocat,ghpass'].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), 'chrome');
    expect(result[0]).toMatchObject({
      username: 'octocat',
      password: 'ghpass',
      url: 'https://github.com',
      tag: 'GitHub',
    });
  });

  it('lastpass 格式：grouping→tag、extra→remark、totp→totp', () => {
    const csv = [
      'url,username,password,totp,extra,name,grouping',
      'https://x.com,user1,pass1,SEED,notes-extra,MySite,Social',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), 'lastpass');
    expect(result[0]).toMatchObject({
      username: 'user1',
      password: 'pass1',
      url: 'https://x.com',
      tag: 'Social',
      remark: 'notes-extra',
      totp: 'SEED',
    });
  });

  it('bitwarden 格式：login_* 与 folder→tag、notes→remark', () => {
    const csv = [
      'folder,name,notes,login_uri,login_username,login_password,login_totp',
      'Work,GH,my notes,https://gh.com,ghuser,ghpw,TOTPSEED',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), 'bitwarden');
    expect(result[0]).toMatchObject({
      username: 'ghuser',
      password: 'ghpw',
      url: 'https://gh.com',
      tag: 'Work',
      remark: 'my notes',
      totp: 'TOTPSEED',
    });
  });

  it('1password 格式：Title→tag、Notes→remark、OTPAuth→totp', () => {
    const csv = [
      'Title,Url,Username,Password,Notes,OTPAuth',
      'My Login,https://op.com,opuser,oppw,some notes,otpseed',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), '1password');
    expect(result[0]).toMatchObject({
      username: 'opuser',
      password: 'oppw',
      url: 'https://op.com',
      tag: 'My Login',
      remark: 'some notes',
      totp: 'otpseed',
    });
  });
});

describe('parseCSV：auto 自动检测与解析细节', () => {
  it('auto 检测 native（中文表头）', () => {
    const csv = ['用户名(必填),密码,网址', 'alice,secret,https://a.com'].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv));
    expect(result[0]).toMatchObject({ username: 'alice', password: 'secret', url: 'https://a.com' });
  });

  it('auto 检测优先级：含 name+username+password 时按 chrome 处理（既有行为）', () => {
    // 该表头同时具备 lastpass 特征（grouping），但 chrome 判定在先
    const csv = ['url,username,password,grouping,name', 'https://x.com,u1,p1,Social,MySite'].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv));
    // chrome 映射下 name→tag
    expect(result[0]).toMatchObject({ username: 'u1', password: 'p1', url: 'https://x.com', tag: 'MySite' });
  });

  it('auto 检测 native（英文表头）：含 TOTP 列不误判为 lastpass，标签/备注不丢失', () => {
    const csv = [
      'Username,Password,URL,Tag,Remark,TOTP,Created At,Updated At',
      'alice,secret,https://a.com,work,note1,JBSW,2026/1/1,2026/1/1',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv));
    expect(result[0]).toMatchObject({
      username: 'alice',
      password: 'secret',
      url: 'https://a.com',
      tag: 'work',
      remark: 'note1',
      totp: 'JBSW',
    });
  });

  it('auto 检测 native（英文模板表头 Username (Required)）', () => {
    const csv = [
      '"Username (Required)","Password","URL","Tag","Remark","TOTP"',
      'bob,pw,https://b.com,Work,Sample,',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv));
    expect(result[0]).toMatchObject({ username: 'bob', password: 'pw', url: 'https://b.com', tag: 'Work' });
  });

  it('支持引号包裹字段：内嵌逗号与转义双引号', () => {
    const csv = [
      '用户名(必填),密码,网址,标签,备注,两步验证',
      '"smith, jr","pa""ss",https://x.com,"a,b","he said ""hi""",',
    ].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), 'native');
    expect(result[0]).toMatchObject({ username: 'smith, jr', password: 'pa"ss', tag: 'a,b', remark: 'he said "hi"' });
  });

  it('跳过用户名为空的行', () => {
    const csv = ['用户名(必填),密码', ',orphanpass', 'valid,p'].join('\n');
    const result = ExcelUtils.parseCSV(buf(csv), 'native');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ username: 'valid', password: 'p' });
  });

  it('少于两行（仅表头）返回空数组', () => {
    expect(ExcelUtils.parseCSV(buf('用户名(必填),密码'), 'native')).toEqual([]);
  });
});

describe('parseJSON', () => {
  it('解析数组结构并保留时间戳', () => {
    const text = JSON.stringify([
      { username: 'a', password: 'p', url: 'u', tag: 't', remark: 'r', totp: 'x', createTime: 100, updateTime: 200 },
    ]);
    expect(ExcelUtils.parseJSON(text)).toEqual([
      { username: 'a', password: 'p', url: 'u', tag: 't', remark: 'r', totp: 'x', createTime: 100, updateTime: 200 },
    ]);
  });

  it('解析 { entries } 结构与中文字段映射', () => {
    const text = JSON.stringify({
      entries: [
        { 用户名: '张三', 密码: 'mm', 网址: 'w', 标签: 'tg', 备注: 'bz', 两步验证: 'tt', createTime: 1, updateTime: 2 },
      ],
    });
    expect(ExcelUtils.parseJSON(text)[0]).toMatchObject({
      username: '张三',
      password: 'mm',
      url: 'w',
      tag: 'tg',
      remark: 'bz',
      totp: 'tt',
    });
  });

  it('字符串时间戳被解析；缺失的一侧回退到另一侧', () => {
    const text = JSON.stringify([{ username: 't', createTime: '2020-01-01T00:00:00Z' }]);
    const ts = Date.parse('2020-01-01T00:00:00Z');
    expect(ExcelUtils.parseJSON(text)[0]).toMatchObject({ createTime: ts, updateTime: ts });
  });

  it('过滤用户名为空的条目', () => {
    const text = JSON.stringify([{ password: 'x' }, { username: 'ok' }]);
    const result = ExcelUtils.parseJSON(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ username: 'ok' });
  });

  it('空数据返回空数组', () => {
    expect(ExcelUtils.parseJSON('[]')).toEqual([]);
  });

  it('非法 JSON 抛出「JSON 文件格式不正确」', () => {
    expect(() => ExcelUtils.parseJSON('not json')).toThrow('JSON 文件格式不正确');
  });
});

describe('导出序列化（经 Blob/document/URL 打桩捕获生成内容）', () => {
  let blobContent: string;

  beforeAll(async () => {
    // 预加载 en 语言包：后续 beforeEach 会 stub 全局 URL，破坏动态 import
    const { setLocale } = await import('@/utils/i18n');
    await setLocale('en');
    await setLocale('zh-CN');
  });

  beforeEach(() => {
    blobContent = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: unknown[]) {
          blobContent = parts.map(String).join('');
        }
      },
    );
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
  });

  it('exportToCSV：带 BOM、引号包裹表头、双引号转义', () => {
    const entry = makePasswordEntry({ username: 'a"b', password: 'p,c', url: 'u', tag: '', remark: '' });
    ExcelUtils.exportToCSV([entry], 'f.csv');
    expect(blobContent.startsWith('\uFEFF')).toBe(true);
    expect(blobContent).toContain('"用户名","密码","网址","标签","备注","两步验证","创建时间","更新时间"');
    // a"b → "a""b"；p,c → "p,c"
    expect(blobContent).toContain('"a""b"');
    expect(blobContent).toContain('"p,c"');
  });

  it('exportToJSON：{ version:1, count, entries } 结构', () => {
    const entry = makePasswordEntry({ username: 'alice', password: 'secret' });
    ExcelUtils.exportToJSON([entry], 'f.json');
    const parsed = JSON.parse(blobContent);
    expect(parsed.version).toBe(1);
    expect(parsed.count).toBe(1);
    expect(parsed.entries[0]).toMatchObject({ username: 'alice', password: 'secret' });
  });

  it('downloadTemplate：包含中文模板表头与示例行', () => {
    ExcelUtils.downloadTemplate();
    expect(blobContent).toContain('"用户名(必填)"');
    expect(blobContent).toContain('example@email.com');
  });

  it('英文语言下导出/模板使用英文表头（可被 auto 导入回读）', async () => {
    const { setLocale } = await import('@/utils/i18n');
    await setLocale('en');
    try {
      ExcelUtils.exportToCSV([makePasswordEntry({ username: 'alice' })], 'f.csv');
      expect(blobContent).toContain('"Username","Password","URL","Tag","Remark","TOTP","Created At","Updated At"');

      ExcelUtils.downloadTemplate();
      expect(blobContent).toContain('"Username (Required)"');
      expect(blobContent).toContain('"Work"');
    } finally {
      await setLocale('zh-CN');
    }
  });
});

// 类型层面确认 ImportFormat 类型契约仍可用（典型来源：@/utils/excelFormatMap）
const _fmt: ImportFormat = 'auto';
void _fmt;
