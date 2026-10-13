/** @vitest-environment jsdom */
/**
 * 自动保存标签预填清洗测试
 *
 * 盯住三类契约：
 * 1. 真实页面标题语料收敛出的预填值（站点名优先、短、可读）；
 * 2. 预填值必然能原样通过 Options 标签编辑器的归一化——不触发「超限丢弃」警告，也不被逗号拆成多标签；
 * 3. 上限与编辑器 `MAX_TAG_LENGTH` 的同口径关系（本模块刻意不 import 那份常量，靠这条兜住漂移）。
 */
import { describe, expect, it } from 'vitest';
import { CAPTURED_TAG_MAX_LENGTH, deriveCapturedTag } from '@/utils/capturedTag';
import { normalizeTagInput, parseTags } from '@/utils/tagUtils';
import { MAX_TAG_LENGTH } from '@/utils/constants';

/** 真实站点标题语料：[document.title, hostname, 期望预填值] */
const CORPUS: readonly [string, string, string][] = [
  // 首末段都命中域名锚点时取末段——「页面名 · 站点名」是最主流的排版
  ['Sign in to GitHub · GitHub', 'github.com', 'GitHub'],
  // 「站点: 标语」形态：锚点命中首段
  ['GitHub: Where the world builds software', 'github.com', 'GitHub'],
  // 逗号枚举型标题：锚点命中首段，中段枚举词不得被选中
  ['Amazon.com: Online Shopping for Electronics, Apparel, Computers, Books, DVDS & more', 'amazon.com', 'Amazon.com'],
  // 品牌词与域名不同源（Gmail ↔ mail.google.com）时退到位置偏好，取末段
  ['Home - Gmail', 'mail.google.com', 'Gmail'],
  // 大小写不敏感命中：标题里的 JD.COM ↔ jd.com
  ['京东(JD.COM)-正品低价、品质保障、配送及时、轻松购物！', 'jd.com', '京东(JD.COM)-正品低价'],
  // 标题本身就是短站点名时，行为与改造前一致
  ['GitHub', 'github.com', 'GitHub'],
  // 单字母主域名不作为锚点（一个字符的包含判断会在标题里到处误命中）
  ['X', 'x.com', 'X'],
];

describe('deriveCapturedTag：真实标题语料', () => {
  it.each(CORPUS)('「%s」（%s）收敛为「%s」', (title, hostname, expected) => {
    expect(deriveCapturedTag(title, hostname)).toBe(expected);
  });
});

describe('deriveCapturedTag：收敛不出来时不预填', () => {
  it('单段长标题超过上限 → 空串（不塞回一个存不回去的值）', () => {
    const title = '这是一条超过三十个字符的页面标题用来验证收敛失败时不预填的行为';
    expect(title).toHaveLength(31);
    expect(deriveCapturedTag(title, 'example.com')).toBe('');
  });

  it('首末段都超上限 → 空串', () => {
    expect(deriveCapturedTag(`${'x'.repeat(40)} - ${'y'.repeat(35)}`, 'example.com')).toBe('');
  });

  it('空标题 / 纯分隔符 / 缺省值 → 空串', () => {
    expect(deriveCapturedTag('', 'example.com')).toBe('');
    expect(deriveCapturedTag(' - | · ', 'example.com')).toBe('');
    expect(deriveCapturedTag(undefined, 'example.com')).toBe('');
    expect(deriveCapturedTag(null, 'example.com')).toBe('');
  });
});

describe('deriveCapturedTag：分隔符判定', () => {
  it('弱分隔符两侧都无空白时不切碎名称', () => {
    expect(deriveCapturedTag('E-commerce Tips', 'example.com')).toBe('E-commerce Tips');
    expect(deriveCapturedTag('12:30 直播回放', 'example.com')).toBe('12:30 直播回放');
    expect(deriveCapturedTag('docs/guide index', 'example.com')).toBe('docs/guide index');
  });

  it('弱分隔符单侧有空白即分段', () => {
    expect(deriveCapturedTag('Dashboard: Admin Panel', 'example.com')).toBe('Admin Panel');
  });

  it('逗号是强分隔符：预填值不得含逗号，否则会被 parseTags 拆成多个标签', () => {
    const derived = deriveCapturedTag('Hello, World Inc，Awesome Site', 'example.com');
    expect(derived).toBe('Awesome Site');
    expect(derived).not.toContain(',');
    expect(derived).not.toContain('，');
    expect(parseTags(derived)).toHaveLength(1);
  });
});

describe('deriveCapturedTag：归一化与参数', () => {
  it('控制字符与连续空白压成单空格后再分段', () => {
    expect(deriveCapturedTag('  My\n\tSite  ', 'example.com')).toBe('My Site');
    expect(deriveCapturedTag('A\x01B - C', 'example.com')).toBe('C');
  });

  it('maxLength 由调用方覆盖：候选超上限就落到下一个候选', () => {
    expect(deriveCapturedTag('Sign in to GitHub · GitHub', 'github.com', 6)).toBe('GitHub');
    expect(deriveCapturedTag('Sign in to GitHub · GitHub', 'github.com', 5)).toBe('');
  });

  it('缺省 hostname 时退化为位置偏好（末段优先）', () => {
    expect(deriveCapturedTag('Sign in to GitHub · GitHub')).toBe('GitHub');
  });
});

describe('预填值与 Options 标签编辑器口径一致', () => {
  it('语料中的预填值原样通过 normalizeTagInput（既不超长被丢，也不被拆成多标签）', () => {
    for (const [title, hostname, expected] of CORPUS) {
      const derived = deriveCapturedTag(title, hostname);
      const { accepted, rejectedTooLong } = normalizeTagInput([derived], MAX_TAG_LENGTH);
      expect(rejectedTooLong, `${title} → ${expected}`).toEqual([]);
      expect(accepted).toEqual([expected]);
    }
  });

  it('CAPTURED_TAG_MAX_LENGTH 与编辑器单标签上限同口径', () => {
    expect(CAPTURED_TAG_MAX_LENGTH).toBe(MAX_TAG_LENGTH);
  });
});
