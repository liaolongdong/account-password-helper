/**
 * 邮箱备份（mailto）回归测试
 *
 * 背景：「备份到邮箱」把凭据交给用户自己的邮件客户端，全程不经服务器，因此唯一可以
 * 被代码约束的就三件事：
 * 1. 守卫顺序 —— 没有数据 / 没有邮箱时必须**在此之前**返回，不能先触发一次文件下载
 *    （用户在空库上点备份，结果落一个只有表头的 CSV，属意外副作用）；
 * 2. 凭据边界 —— 打开的 mailto 链接只允许携带「条数 / 时间 / 文件名」这类元信息，
 *    账号、密码、URL、TOTP 一律不得进链接（进了就等于多一处明文落点：邮件草稿、
 *    邮件客户端历史、以及任何同步该草稿的服务）；
 * 3. 收件人字段不可注入 —— 邮箱输入框的内容会拼进 `mailto:`，若不做百分号编码，
 *    `a@b.co?cc=evil@x.com&subject=…` 这类输入就能往链接里塞额外头字段（抄送陌生地址、
 *    改写主题正文），把「发给自己的邮件」变成「发给别人」。
 *
 * `ExcelUtils.exportToCSV` 与 `window.open` 均以 spy 注入：前者会真实落盘下载，后者在
 * Node 环境不存在。文件名与主题里的日期用固定时钟钉住形状（`passwords_YYYYMMDD_HHmmss.csv`），
 * 不镜像 `dateFormat` 的实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import { EmailBackupUtils } from '@/utils/emailBackup';
import { registerMessages, currentLocale, type Messages } from '@/utils/i18n';
import zhForm from '@/utils/i18n/locales/zh-CN/form.json';
import enForm from '@/utils/i18n/locales/en/form.json';

registerMessages('zh-CN', zhForm as Messages);
registerMessages('en', enForm as Messages);

const exportToCSV = vi.hoisted(() => vi.fn());

vi.mock('@/utils/excel', () => ({
  ExcelUtils: { exportToCSV },
}));

/** 凭据哨兵值：任何一处出现在 mailto 链接里都算明文泄露 */
const SENTINELS = {
  username: 'alice@example-login',
  password: 'S3cr3t-P@ssw0rd-sentinel',
  url: 'https://vault.example.internal/path?token=abc',
  tag: 'tag-sentinel',
  totp: 'JBSWY3DPEHPK3PXP-sentinel',
  remark: 'remark-sentinel-不要外发',
};

const passwords = (): PasswordEntry[] => [
  {
    id: 'p1',
    order: 0,
    createTime: 1,
    updateTime: 2,
    ...SENTINELS,
  },
  {
    id: 'p2',
    order: 1,
    createTime: 3,
    updateTime: 4,
    username: 'bob',
    password: 'pw-2',
    url: '',
    tag: '',
    remark: '',
    totp: '',
  },
];

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  exportToCSV.mockReset();
  openSpy = vi.fn();
  vi.stubGlobal('window', { open: openSpy });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 2, 4, 5, 6, 7));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  currentLocale.value = 'zh-CN';
});

/** 取本次实际打开的 mailto 链接（断言多次调用会先失败，避免误取第二条） */
const openedUrl = (): string => {
  expect(openSpy).toHaveBeenCalledTimes(1);
  return openSpy.mock.calls[0][0] as string;
};

describe('提交前守卫', () => {
  it('邮箱为空：抛错且既不下载文件也不唤起邮件客户端', async () => {
    await expect(EmailBackupUtils.backupToEmail(passwords(), '')).rejects.toThrow('目标邮箱地址不能为空');

    expect(exportToCSV).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('邮箱只有空白字符：同空邮箱处理（`!email` 放行空格，靠 trim 才拦得住）', async () => {
    await expect(EmailBackupUtils.backupToEmail(passwords(), '   ')).rejects.toThrow('目标邮箱地址不能为空');

    expect(exportToCSV).not.toHaveBeenCalled();
  });

  it('空密码库：抛「没有可备份的数据」，且不得先落一个只有表头的 CSV', async () => {
    await expect(EmailBackupUtils.backupToEmail([], 'me@example.com')).rejects.toThrow('没有可备份的密码数据');

    expect(exportToCSV).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('备份成功时的落地动作', () => {
  it('先下载带时间戳的 CSV，再以 _blank 打开一个 mailto 链接', async () => {
    await EmailBackupUtils.backupToEmail(passwords(), 'me@example.com');

    expect(exportToCSV).toHaveBeenCalledTimes(1);
    const [submitted, filename] = exportToCSV.mock.calls[0] as [PasswordEntry[], string];
    expect(submitted).toHaveLength(2);
    expect(filename).toMatch(/^passwords_\d{8}_\d{6}\.csv$/);
    expect(filename).toBe('passwords_20260304_050607.csv');

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('mailto:'), '_blank');
  });

  it('正文里的附件文件名与实际下载的文件名一致（否则用户按正文找不到附件）', async () => {
    await EmailBackupUtils.backupToEmail(passwords(), 'me@example.com');

    const filename = exportToCSV.mock.calls[0][1] as string;
    const body = new URL(openedUrl()).searchParams.get('body') ?? '';
    expect(body).toContain(filename);
  });
});

describe('凭据边界：mailto 链接只携带元信息', () => {
  it('账号 / 密码 / 网址 / TOTP / 备注一律不出现在链接里', async () => {
    await EmailBackupUtils.backupToEmail(passwords(), 'me@example.com');

    const url = openedUrl();
    const decoded = decodeURIComponent(url);
    for (const sentinel of Object.values(SENTINELS)) {
      expect(url).not.toContain(sentinel);
      expect(decoded, '解码后也不得出现凭据').not.toContain(sentinel);
    }
  });

  it('正文只含时间、条数、附件名与提示四段信息', async () => {
    await EmailBackupUtils.backupToEmail(passwords(), 'me@example.com');

    const body = new URL(openedUrl()).searchParams.get('body') ?? '';
    const lines = body.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('备份时间：2026-03-04 05:06:07');
    expect(lines[1]).toBe('备份条数：2条账号密码');
    expect(lines[2]).toMatch(/^附件文件：passwords_\d{8}_\d{6}\.csv$/);
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('请将已下载的Excel文件作为附件发送。');
  });

  it('条数按实际提交的条目数渲染（不是硬编码也不是总数减一）', async () => {
    await EmailBackupUtils.backupToEmail(passwords().slice(0, 1), 'me@example.com');

    const body = new URL(openedUrl()).searchParams.get('body') ?? '';
    expect(body).toContain('备份条数：1条账号密码');
    expect(body).not.toContain('备份条数：2');
  });
});

describe('收件人字段不可注入额外头', () => {
  it('邮箱里塞 ?cc=…&subject=… 只会成为被编码的地址文本，不会多出 cc 参数', async () => {
    const hostile = 'me@example.com?cc=attacker@evil.test&subject=hijacked';

    await EmailBackupUtils.backupToEmail(passwords(), hostile);

    const url = new URL(openedUrl());
    const subject = url.searchParams.getAll('subject');
    expect(subject).toHaveLength(1);
    expect(subject[0]).not.toContain('hijacked');
    expect(url.searchParams.has('cc')).toBe(false);
    // 收件人段（mailto: 与第一个 ? 之间）不得留有未编码的分隔符
    const addrPart = openedUrl().slice('mailto:'.length).split('?')[0];
    expect(addrPart).not.toContain('?');
    expect(addrPart).not.toContain('&');
    expect(addrPart).not.toContain('=');
  });

  it('主题与正文作为参数承载，换行经编码后可原样解回', () => {
    const url = EmailBackupUtils.buildMailtoUrl('me@example.com', '主题 A', '第一行\n第二行');

    expect(url).toContain('%0A');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('subject')).toBe('主题 A');
    expect(parsed.searchParams.get('body')).toBe('第一行\n第二行');
  });

  it('邮箱中的 @ 与点被编码，解码后仍是同一个地址', () => {
    const url = EmailBackupUtils.buildMailtoUrl('me@example.com', 's', 'b');

    const addrPart = url.slice('mailto:'.length).split('?')[0];
    expect(addrPart).not.toContain('@');
    expect(decodeURIComponent(addrPart)).toBe('me@example.com');
  });
});

describe('buildMailtoUrl 形状', () => {
  it('恰有 subject、body 两个参数，不含其他键', () => {
    const url = new URL(EmailBackupUtils.buildMailtoUrl('a@b.co', 's', 'b'));

    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
  });
});

describe('isValidEmail', () => {
  const valid = ['a@b.co', 'user.name+tag@sub.example.com', 'me@x.io', 'a@b.c.d.e'];
  const invalid = [
    '',
    '   ',
    'no-at-sign',
    'a@b',
    'a b@c.de',
    '@b.co',
    'a@.co',
    'a@@b.co',
    'a@b.co x',
    'me@example.com\nbcc@evil.test',
  ];

  it.each(valid)('接受 %s', email => {
    expect(EmailBackupUtils.isValidEmail(email)).toBe(true);
  });

  it.each(invalid)('拒绝 %j', email => {
    expect(EmailBackupUtils.isValidEmail(email)).toBe(false);
  });

  it('拒绝换行注入的第二个收件人（弹窗的表单校验正是靠它挡在提交前）', () => {
    expect(EmailBackupUtils.isValidEmail('me@example.com\nattacker@evil.test')).toBe(false);
  });
});

describe('文案语言', () => {
  it('英文环境下主题与正文均为英文', async () => {
    currentLocale.value = 'en';

    await EmailBackupUtils.backupToEmail(passwords(), 'me@example.com');

    const url = new URL(openedUrl());
    expect(url.searchParams.get('subject')).toBe('Password backup - 2026-03-04');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('Backup time:');
    expect(body).toContain('Entries: 2');
    expect(body).toContain('Please attach the downloaded file to this email.');
    expect(body).not.toContain('备份');
  });
});
