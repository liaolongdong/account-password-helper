/**
 * utils/shareCard 分享卡片文本构造测试
 *
 * 覆盖五类约束：
 * 1. 排版——简体中文用全角冒号、英文用 ASCII 冒号加空格，两者互斥且不留半角/全角混排；
 * 2. 字段白名单——卡片只含用户名 / 密码 / 网址，备注 / 标签 / TOTP 不得泄入；
 *    网址为空时整行省略；
 * 3. 值完整性——换行折叠为单行防止行注入，其余逐字保真（含 javascript: 等
 *    可疑协议，证明按 verbatim 契约输出，不做静默篡改）；
 * 4. 安全边界——卡片含明文密码，严禁进入日志；构造必须同步完成，
 *    以免 await 消耗侧边栏的瞬时用户激活导致剪贴板写入失败；
 * 5. 空密码分流——条目密码为空时卡片不含可用凭据，两个入口都必须把成功
 *    提示换成告警，同时判空口径不得反向污染逐字输出。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { buildShareCard, hasShareCardPassword, type ShareCardLabels } from '@/utils/shareCard';
import { makePasswordEntry } from '@/tests/helpers/passwordEntry';

const ROOT = path.resolve(__dirname, '../..');

/** 读取源码文件文本（用于跨文件的契约守卫） */
const readSource = (relPath: string): string => readFileSync(path.join(ROOT, relPath), 'utf8');

/** 与 zh-CN/common.json 实际取值一致的标签 */
const ZH_LABELS: ShareCardLabels = { username: '用户名', password: '密码', url: '网址' };
/** 与 en/common.json 实际取值一致的标签 */
const EN_LABELS: ShareCardLabels = { username: 'Username', password: 'Password', url: 'URL' };

const source = (username: string, password: string, url: string) => ({ username, password, url });

describe('buildShareCard 排版', () => {
  it('简体中文使用全角冒号且其后不加空格', () => {
    const card = buildShareCard(source('alice', 'p@ss', 'https://example.com'), ZH_LABELS, 'zh-CN');
    expect(card).toBe('用户名：alice\n密码：p@ss\n网址：https://example.com');
    expect(card).not.toContain(': ');
  });

  it('英文使用 ASCII 冒号且其后加空格', () => {
    const card = buildShareCard(source('alice', 'p@ss', 'https://example.com'), EN_LABELS, 'en');
    expect(card).toBe('Username: alice\nPassword: p@ss\nURL: https://example.com');
    expect(card).not.toContain('：');
  });

  it('不含表头与尾随换行（尾随换行粘贴进聊天框会触发误发送）', () => {
    const card = buildShareCard(source('alice', 'p@ss', 'https://example.com'), ZH_LABELS, 'zh-CN');
    expect(card.startsWith('用户名')).toBe(true);
    expect(card.endsWith('https://example.com')).toBe(true);
  });
});

describe('buildShareCard 字段白名单与空值', () => {
  it('网址为空或纯空白时省略该行，只输出两行', () => {
    for (const url of ['', '   ', '\t']) {
      const card = buildShareCard(source('alice', 'p@ss', url), ZH_LABELS, 'zh-CN');
      expect(card.split('\n')).toHaveLength(2);
      expect(card).not.toContain(ZH_LABELS.url);
    }
  });

  it('只分享用户名 / 密码 / 网址，备注与标签与 TOTP 一律不泄入', () => {
    const entry = makePasswordEntry({
      username: 'alice',
      password: 'p@ss',
      url: 'https://example.com',
      remark: '内网_only_备注',
      tag: 'staging_env',
      totp: 'JBSWY3DPEHPK3PXP',
    });
    const card = buildShareCard(entry, ZH_LABELS, 'zh-CN');
    expect(card.split('\n')).toHaveLength(3);
    expect(card).not.toContain('内网_only_备注');
    expect(card).not.toContain('staging_env');
    expect(card).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('用户名为空仍保留其标签行，避免接收方误读为漏项', () => {
    const card = buildShareCard(source('', 'p@ss', 'https://example.com'), ZH_LABELS, 'zh-CN');
    expect(card.split('\n')).toHaveLength(3);
    expect(card.split('\n')[0]).toBe('用户名：');
  });
});

describe('buildShareCard 值完整性', () => {
  it('值内换行折叠为空格，保持「一行一字段」不被行注入破坏', () => {
    const card = buildShareCard(source('ali\nce', 'p@ss', 'https://example.com\r\n/x'), ZH_LABELS, 'zh-CN');
    expect(card.split('\n')).toHaveLength(3);
    expect(card).toContain('用户名：ali ce');
    expect(card).toContain('网址：https://example.com /x');
  });

  it('逐字保留原始值：不 trim、不转义、不改写协议', () => {
    const card = buildShareCard(source(' alice ', '  p@ss  ', 'javascript:alert(1)'), ZH_LABELS, 'zh-CN');
    // verbatim 契约：卡片是纯文本、不构成导航 sink，故不接 toNavigableUrl 的静默改写
    expect(card.split('\n')[0]).toBe('用户名： alice ');
    expect(card.split('\n')[1]).toBe('密码：  p@ss  ');
    expect(card.split('\n')[2]).toBe('网址：javascript:alert(1)');
  });
});

describe('分享卡片的安全边界', () => {
  it('utils/shareCard 自身不引入任何日志能力', () => {
    const code = readSource('utils/shareCard.ts');
    expect(code).not.toMatch(/logger/);
    expect(code).not.toMatch(/console\./);
  });

  /** 卡片文本可能流经的调用方文件：新增消费方时需一并登记 */
  const CARD_CONSUMERS = [
    'composables/useSidepanelFill.ts',
    'components/options/PasswordDetailDrawer.vue',
    'components/sidepanel/PasswordListItem.vue',
    'components/sidepanel/SidepanelAuthView.vue',
    'entrypoints/sidepanel/App.vue',
  ];

  it('所有调用方的日志调用都不输出卡片内容或敏感值快照', () => {
    for (const relPath of CARD_CONSUMERS) {
      const logLines = readSource(relPath)
        .split('\n')
        .filter(line => line.includes('logger.'));
      for (const line of logLines) {
        // 命中对象是持有明文的标识符而非中文文案标签：日志里出现「分享卡片」四字是安全的，
        // 出现 card / *Snapshot / secret 才意味着把凭据打进了日志
        expect(line, `${relPath} 存在可能输出明文的日志: ${line.trim()}`).not.toMatch(/card|snapshot|secret/i);
      }
    }
  });

  it('卡片构造同步完成：写入剪贴板之前不存在多余的 await', () => {
    const code = readSource('composables/useSidepanelFill.ts');
    // 构造器必须是顶层静态导入——动态导入会在写入前引入一次 await，吃掉侧边栏的瞬时用户激活
    expect(code).toMatch(/^import \{[^}]*buildShareCard[^}]*\} from '@\/utils\/shareCard';$/m);
    expect(code).not.toMatch(/lazyImport\([^)]*shareCard/);

    const body = code.slice(code.indexOf('const copyShareCard = async'));
    const builtAt = body.indexOf('buildShareCard(');
    const wroteAt = body.indexOf('navigator.clipboard.writeText(card)');
    expect(builtAt).toBeGreaterThan(-1);
    expect(wroteAt).toBeGreaterThan(builtAt);
    // 构造之前不得有任何 await（含 `const { buildShareCard } = await lazyImport(...)` 这类改法）
    expect(body.slice(0, builtAt)).not.toContain('await');
    // 构造与写入之间只允许剪贴板自身那一次 await
    expect(body.slice(builtAt, wroteAt).match(/\bawait\b/g)).toHaveLength(1);
  });
});

describe('hasShareCardPassword 与空密码提示分流', () => {
  /** 复用同一判空的全部消费方：两个复制出口 + 行图标的 tooltip */
  const SHARE_CONSUMERS = [
    'composables/useSidepanelFill.ts',
    'components/options/PasswordDetailDrawer.vue',
    'components/sidepanel/PasswordListItem.vue',
  ];
  /** 实际执行复制、需要告警分支的两个出口 */
  const SHARE_ENTRY_POINTS = ['composables/useSidepanelFill.ts', 'components/options/PasswordDetailDrawer.vue'];

  it('密码为空或纯空白时判为「不含密码」', () => {
    for (const password of ['', '   ', '\t', '\n']) {
      expect(hasShareCardPassword(source('alice', password, 'https://example.com'))).toBe(false);
    }
  });

  it('前后带空格的密码仍算有密码，且判空不裁剪卡片里的原值', () => {
    const s = source('alice', ' p@ss ', 'https://example.com');
    expect(hasShareCardPassword(s)).toBe(true);
    expect(buildShareCard(s, ZH_LABELS, 'zh-CN').split('\n')[1]).toBe('密码： p@ss ');
  });

  it('纯空白密码照旧逐字输出该行——判空只用于提示，不篡改存储值', () => {
    const lines = buildShareCard(source('alice', '   ', 'https://example.com'), ZH_LABELS, 'zh-CN').split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('密码：   ');
  });

  it('所有消费方都复用 utils/shareCard 的同一判空', () => {
    for (const relPath of SHARE_CONSUMERS) {
      expect(readSource(relPath), `${relPath} 未复用判空`).toMatch(/hasShareCardPassword\(/);
    }
  });

  it('两个复制出口都在无密码时改走告警', () => {
    for (const relPath of SHARE_ENTRY_POINTS) {
      expect(readSource(relPath), `${relPath} 缺少空密码告警分支`).toMatch(
        /ElMessage\.warning\(t\('fill\.shareCardNoPassword'\)\)/,
      );
    }
  });
});
