/**
 * CSV 公式注入防护回归测试
 *
 * 覆盖 `utils/csvFormulaGuard.ts` 的两端与其在导入/导出链上的接线：
 * - 纯函数：`= + - @ TAB CR` 五种触发字符加前缀、非触发行零改动、还原的三种形状；
 * - 导出侧：`exportToCSV` 产出的每个单元格都带前缀（Excel / WPS 双击打开不再求值）；
 * - 导入侧：自家 `native` 模板还原前缀，保证「导出→导入」往返不改凭据；
 *   第三方格式（lastpass）**一律不还原**——那些文件不是本扩展写出的，剥首字符即篡改；
 * - 已知取舍：库里以 `'` + 触发字符开头的值（`'=abc`）往返会丢掉前导引号，
 *   此用例把它钉成契约，改动这一行为必须显式经过这里。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcelUtils } from '@/utils/excel';
import { neutralizeFormulaCell, restoreNeutralizedCell } from '@/utils/csvFormulaGuard';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';
import { registerMessages, type Messages } from '@/utils/i18n';
import zhExcel from '@/utils/i18n/locales/zh-CN/excel.json';
import enExcel from '@/utils/i18n/locales/en/excel.json';

registerMessages('zh-CN', zhExcel as Messages);
registerMessages('en', enExcel as Messages);

/** 将字符串编码为 UTF-8 ArrayBuffer（模拟上传的 CSV 字节） */
const buf = (s: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(s);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
};

/** 取导出 CSV 的「数据行」部分（去掉 BOM 与表头行） */
const dataRow = (csv: string): string => csv.replace(/^\uFEFF/, '').split('\r\n')[1] ?? '';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('neutralizeFormulaCell（导出侧加前缀）', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])('触发字符 %o 打头时补强制文本前缀', trigger => {
    expect(neutralizeFormulaCell(`${trigger}SUM(A1)`)).toBe(`'${trigger}SUM(A1)`);
  });

  it('普通值零改动', () => {
    expect(neutralizeFormulaCell('alice')).toBe('alice');
    expect(neutralizeFormulaCell('1+1')).toBe('1+1');
    expect(neutralizeFormulaCell(' https://a.com')).toBe(' https://a.com');
  });

  it('空串与仅前导引号不补前缀', () => {
    expect(neutralizeFormulaCell('')).toBe('');
    expect(neutralizeFormulaCell("'alice")).toBe("'alice");
  });

  it('触发字符出现在中间不算公式', () => {
    expect(neutralizeFormulaCell('pw=1')).toBe('pw=1');
  });
});

describe('restoreNeutralizedCell（导入侧还原）', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])('剥掉 %o 的强制文本前缀', trigger => {
    expect(restoreNeutralizedCell(`'${trigger}SUM(A1)`)).toBe(`${trigger}SUM(A1)`);
  });

  it('非自家前缀形状一律原样返回', () => {
    expect(restoreNeutralizedCell('alice')).toBe('alice');
    expect(restoreNeutralizedCell("''=x")).toBe("''=x"); // 两个前导引号：第二字符不是触发字符
    expect(restoreNeutralizedCell("'alice")).toBe("'alice");
    expect(restoreNeutralizedCell("'")).toBe("'");
    expect(restoreNeutralizedCell('')).toBe('');
  });
});

describe('native 模板导出→导入往返', () => {
  /** 打桩 Blob/document/URL 捕获导出内容，不触发真实下载 */
  const captureCSV = (password: string): string => {
    let content = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: unknown[]) {
          content = parts.map(String).join('');
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    ExcelUtils.exportToCSV([makePasswordEntry({ username: 'alice', password })], 'f.csv');
    vi.unstubAllGlobals();
    return content;
  };

  it.each(['=SUM(A1)', '+1', '-1', '@cmd|calc', 'p,c', 'a"b'])('凭据 %o 往返不变', value => {
    const csv = captureCSV(value);
    const parsed = ExcelUtils.parseCSV(buf(csv), 'native');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].password).toBe(value);
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd'])('导出行内 %o 带强制文本前缀', value => {
    expect(dataRow(captureCSV(value))).toContain(`"'${value}"`);
  });

  it('普通值导出行内不掺前缀（不污染用户可见数据）', () => {
    expect(dataRow(captureCSV('secret123'))).toContain('"secret123"');
  });

  it('TAB 打头：导出侧已中和，往返不保证原样（既有单元格 trim 会裁掉前导制表符）', () => {
    // 中和本身有效（前缀落在文件里），但既有解析对每个单元格做 trim，
    // 前导制表符在往返中本就会被裁掉——这是导入链的既有口径，不由本次防护引入。
    const value = '\t=SUM(A1)';
    expect(dataRow(captureCSV(value))).toContain(`"'${value}"`);
    expect(restoreNeutralizedCell(`'${value}`)).toBe(value);
  });

  it('已知取舍：以单引号 + 触发字符开头的值，往返会丢掉前导单引号', () => {
    // 值首字符是 `'` 而非触发字符 → 导出不补前缀；导入时该形状恰好与「强制文本前缀」
    // 撞车，被还原成 `=abc`。选择它是因为另一套做法（给所有前导引号加倍）会改写
    // 每一个以 `'` 开头的正常凭据，面更大。此用例把这份取舍固定为契约。
    const csv = captureCSV("'=abc");
    expect(dataRow(csv)).toContain('"\'=abc"');
    expect(ExcelUtils.parseCSV(buf(csv), 'native')[0].password).toBe('=abc');
  });
});

describe('第三方格式不还原前缀', () => {
  it("lastpass 表头下的 '=x 原样保留（不是本扩展写出的文件，剥首字符即篡改）", () => {
    const csv = ['url,username,password,totp,extra,name,grouping,fav', "https://a.com,alice,'=secret,,,n,,0"].join(
      '\n',
    );
    const parsed = ExcelUtils.parseCSV(buf(csv), 'lastpass');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].password).toBe("'=secret");
  });

  it('auto 检测命中第三方格式时同样不还原', () => {
    const csv = ['url,username,password,totp,extra,name,grouping,fav', 'https://a.com,alice,-1,,,,n,,0'].join('\n');
    const parsed = ExcelUtils.parseCSV(buf(csv), 'auto');
    expect(parsed[0].password).toBe('-1');
  });
});
