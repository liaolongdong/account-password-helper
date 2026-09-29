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

describe('parseFeishuUrl：私有化部署（自定义 API 地址）', () => {
  const OPTIONS = { feishuBaseUrl: 'https://open.corp.example' };

  it('配置自定义地址后放行自有域名的 base / wiki 链接', () => {
    expect(parseFeishuUrl('https://docs.corp.example/base/tok123?table=tbl1', OPTIONS)).toEqual({
      provider: 'feishu',
      fileKey: 'tok123',
      subKey: 'tbl1',
    });
    expect(parseFeishuUrl('https://docs.corp.example/wiki/node9', OPTIONS)?.fileKey).toBe('node9');
  });

  it('官方域名链接在私有化模式下照常解析', () => {
    expect(parseFeishuUrl('https://x.feishu.cn/base/tok', OPTIONS)?.fileKey).toBe('tok');
  });

  it('仍要求 /base|/wiki/<token> 形态与 http(s) 协议', () => {
    expect(parseFeishuUrl('https://docs.corp.example/sheet/tok', OPTIONS)).toBeNull();
    expect(parseFeishuUrl('https://docs.corp.example/', OPTIONS)).toBeNull();
    expect(parseFeishuUrl('ftp://docs.corp.example/base/tok', OPTIONS)).toBeNull();
  });

  it('未配置自定义地址（含空白串）时域名白名单不变', () => {
    expect(parseFeishuUrl('https://docs.corp.example/base/tok')).toBeNull();
    expect(parseFeishuUrl('https://docs.corp.example/base/tok', { feishuBaseUrl: '   ' })).toBeNull();
    expect(parseFeishuUrl('https://docs.corp.example/base/tok', { feishuBaseUrl: null })).toBeNull();
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

describe('parseTencentUrl：私有化部署（自定义 API 地址）', () => {
  const OPTIONS = { tencentBaseUrl: 'https://docs.corp.example' };

  it('配置自定义地址后放行自有域名的 sheet / smartsheet 链接', () => {
    expect(parseTencentUrl('https://intranet.corp.example/sheet/ABCDEF?tab=tab1', OPTIONS)).toEqual({
      provider: 'tencent',
      fileKey: 'ABCDEF',
      subKey: 'tab1',
    });
    expect(parseTencentUrl('http://intranet.corp.example/smartsheet/XYZ', OPTIONS)?.fileKey).toBe('XYZ');
  });

  it('官方域名链接在私有化模式下照常解析', () => {
    expect(parseTencentUrl('https://docs.qq.com/sheet/tok', OPTIONS)?.fileKey).toBe('tok');
  });

  it('未配置自定义地址时域名白名单不变', () => {
    expect(parseTencentUrl('https://intranet.corp.example/sheet/tok')).toBeNull();
    expect(parseTencentUrl('https://intranet.corp.example/sheet/tok', { tencentBaseUrl: '   ' })).toBeNull();
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

  it('私有化选项分别透传给对应平台，不串台', () => {
    const options = {
      feishuBaseUrl: 'https://open.corp.example',
      tencentBaseUrl: 'https://docs.corp.example',
    };
    expect(parseCloudUrl('feishu', 'https://docs.corp.example/base/tok', options)?.fileKey).toBe('tok');
    expect(parseCloudUrl('tencent', 'https://docs.corp.example/sheet/tok', options)?.fileKey).toBe('tok');
    expect(
      parseCloudUrl('tencent', 'https://docs.corp.example/sheet/tok', {
        feishuBaseUrl: 'https://open.corp.example',
      }),
    ).toBeNull();
  });
});
