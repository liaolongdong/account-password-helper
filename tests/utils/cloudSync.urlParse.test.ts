import { describe, expect, it } from 'vitest';
import { parseCloudUrl, parseFeishuUrl, parseTencentUrl } from '@/utils/cloudSync/urlParse';

/**
 * 云文档 URL 解析测试（设计规格 §4.3）
 *
 * 锁定两平台链接形态的提取规则与非法输入的安全降级（返回 null，不猜测）。
 */

describe('parseFeishuUrl', () => {
  it('解析 base 链接与 table 查询参数', () => {
    expect(parseFeishuUrl('https://example.feishu.cn/base/bascnABC123?table=tblXYZ&view=vew1')).toEqual({
      provider: 'feishu',
      fileKey: 'bascnABC123',
      subKey: 'tblXYZ',
    });
  });

  it('解析 wiki 链接', () => {
    expect(parseFeishuUrl('https://x.feishu.cn/wiki/wikcnNode9?table=tbl1')).toEqual({
      provider: 'feishu',
      fileKey: 'wikcnNode9',
      subKey: 'tbl1',
    });
  });

  it('缺少 table 参数时 subKey 为 null（由后续探测补全）', () => {
    expect(parseFeishuUrl('https://x.feishu.cn/base/tokenOnly')?.subKey).toBeNull();
  });

  it('非飞书域名或缺少路径标识返回 null', () => {
    expect(parseFeishuUrl('https://docs.qq.com/base/x')).toBeNull();
    expect(parseFeishuUrl('https://x.feishu.cn/')).toBeNull();
    expect(parseFeishuUrl('not-a-url')).toBeNull();
    expect(parseFeishuUrl('')).toBeNull();
  });
});

describe('parseTencentUrl', () => {
  it('解析 sheet 与 smartsheet 链接', () => {
    expect(parseTencentUrl('https://docs.qq.com/sheet/ABCDEF?tab=tab1')).toEqual({
      provider: 'tencent',
      fileKey: 'ABCDEF',
      subKey: 'tab1',
    });
    expect(parseTencentUrl('https://docs.qq.com/smartsheet/XYZ')?.fileKey).toBe('XYZ');
  });

  it('非腾讯文档域名返回 null', () => {
    expect(parseTencentUrl('https://x.feishu.cn/sheet/abc')).toBeNull();
    expect(parseTencentUrl('https://docs.qq.com/')).toBeNull();
  });
});

describe('parseCloudUrl：按平台分发', () => {
  it('按 provider 选择对应解析器', () => {
    expect(parseCloudUrl('feishu', 'https://x.feishu.cn/base/tok')?.provider).toBe('feishu');
    expect(parseCloudUrl('tencent', 'https://docs.qq.com/sheet/tok')?.provider).toBe('tencent');
  });

  it('平台不匹配时返回 null', () => {
    expect(parseCloudUrl('tencent', 'https://x.feishu.cn/base/tok')).toBeNull();
  });
});
