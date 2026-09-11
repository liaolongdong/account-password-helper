#!/usr/bin/env node
/**
 * FAQPage 结构化数据的单一事实来源，供 `build-en-page.mjs` 生成英文块、供
 * `tests/docs/faqSchemaParity.test.ts` 守卫中英文块与可见 FAQ 的一致性。
 *
 * 背景：index.html 的可见 FAQ 由页面内 `FAQS` 数组在运行时渲染，而 FAQPage JSON-LD 是静态
 * 字节。两者一旦各写各的就会漂移——Google 要求结构化数据里的问答必须与页面可见内容一致，
 * 文案对不上会导致富媒体结果失效，且非 JS 爬虫（GPTBot / PerplexityBot / ClaudeBot）只能读到
 * JSON-LD，所以这里统一从 `FAQS` 取文，禁止在 JSON-LD 里另写一套措辞。
 *
 * @file scripts/lib/faq-schema.mjs
 */

/** 会被写进 FAQPage 结构化数据的可见问题（按此顺序输出，文案须与 `FAQS` 完全一致）。 */
export const FAQ_SCHEMA_QUESTIONS = [
  '我的密码会被上传到云端吗？',
  '忘记主密码了怎么办？',
  '如何修改主密码？',
  '会话有效期到了会发生什么？',
  '什么是自动闲置锁定？',
  '什么是安全体检？',
  '如何自定义快捷键？',
  '一键填充快捷键（Ctrl+Shift+F）是怎么工作的？',
  '插件会自动检测更新吗？',
  '什么是内联填充？',
  '支持从其他密码管理器导入吗？',
  '如何导出/导入加密备份？',
  '如何开启自动保存登录密码？',
  '侧边栏和内联填充有什么区别？',
  '如何使用两步验证（TOTP）？',
  '插件的性能表现如何？',
];

/** FAQPage 块起始注释（中英文块各自使用） */
export const FAQ_JSONLD_COMMENT = {
  zh: '<!-- FAQPage 结构化数据：由 scripts/lib/faq-schema.mjs 从页面可见 FAQS 生成，勿手工改文案 -->',
  en: '<!-- FAQPage structured data: generated from the visible FAQS array by scripts/lib/faq-schema.mjs — do not edit copy by hand -->',
};

/** 跳过空白字符 */
function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

/**
 * 解析一个 JS 字符串字面量（`'...'` 或 `"..."`，两者在 FAQS 中混用）。
 *
 * @param {string} text 源码
 * @param {number} i    起始引号所在偏移
 * @returns {{ value: string, next: number }} 字面量内容与结束引号之后的偏移
 */
function parseString(text, i) {
  const quote = text[i];
  if (quote !== "'" && quote !== '"') {
    throw new Error(`偏移 ${i} 处不是字符串字面量: ${text.slice(i, i + 20)}`);
  }
  let out = '';
  i += 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      out += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, next: i + 1 };
    out += ch;
    i += 1;
  }
  throw new Error(`偏移 ${i} 处的字符串未闭合`);
}

/** 读取 `key: <字符串>`，键不存在时返回 null */
function readKeyed(text, p, key) {
  const i = skipWs(text, p);
  if (!text.startsWith(`${key}:`, i)) return null;
  return parseString(text, skipWs(text, i + key.length + 1));
}

/**
 * 从 index.html 中解析可见 FAQ 的 `FAQS` 数组。
 *
 * @param {string} html index.html 源码
 * @returns {Array<{ zh: { q: string, a: string }, en: { q: string, a: string } }>}
 */
export function parseFaqEntries(html) {
  const start = html.indexOf('const FAQS = [');
  if (start === -1) throw new Error('未找到 FAQS 数组起点');
  const end = html.indexOf('];', start);
  if (end === -1) throw new Error('未找到 FAQS 数组终点');
  const block = html.slice(start, end);

  const entries = [];
  let cursor = 0;
  while (cursor < block.length) {
    const qi = block.indexOf('q: {', cursor);
    if (qi === -1) break;
    const qz = readKeyed(block, qi + 4, 'zh');
    if (!qz) {
      cursor = qi + 4;
      continue;
    }
    const qe = readKeyed(block, qz.next + 1, 'en');
    if (!qe) {
      cursor = qi + 4;
      continue;
    }
    const ai = block.indexOf('a: {', qe.next);
    if (ai === -1) break;
    const az = readKeyed(block, ai + 4, 'zh');
    const ae = az && readKeyed(block, az.next + 1, 'en');
    if (!az || !ae) {
      cursor = ai + 4;
      continue;
    }
    entries.push({ zh: { q: qz.value, a: az.value }, en: { q: qe.value, a: ae.value } });
    cursor = ae.next;
  }
  if (entries.length === 0) throw new Error('FAQS 数组解析结果为空');
  return entries;
}

/**
 * 按 `FAQ_SCHEMA_QUESTIONS` 的顺序与文案，从可见 FAQ 中挑选结构化数据条目。
 *
 * @param {ReturnType<typeof parseFaqEntries>} entries 可见 FAQ 条目
 * @returns {typeof entries} 选中条目（顺序与 FAQ_SCHEMA_QUESTIONS 一致）
 */
export function selectFaqEntries(entries) {
  const byQuestion = new Map(entries.map(entry => [entry.zh.q, entry]));
  return FAQ_SCHEMA_QUESTIONS.map(question => {
    const entry = byQuestion.get(question);
    if (!entry) throw new Error(`FAQ_SCHEMA_QUESTIONS 中的问题在可见 FAQ 里不存在: ${question}`);
    return entry;
  });
}

/**
 * 生成 FAQPage JSON-LD 块（含起始注释，缩进与 index.html 现有脚本块一致）。
 *
 * @param {ReturnType<typeof parseFaqEntries>} entries 条目（已按目标顺序排好）
 * @param {'zh' | 'en'} lang 输出语言
 * @returns {string} 以 `</script>\n` 结尾、可直接作为 `replaceOnce` 替换值的文本块
 */
export function buildFaqPageJsonLd(entries, lang) {
  const questions = entries
    .map(({ zh, en }) => {
      const item = lang === 'zh' ? zh : en;
      return [
        '          {',
        '            "@type": "Question",',
        `            "name": ${JSON.stringify(item.q)},`,
        '            "acceptedAnswer": {',
        '              "@type": "Answer",',
        `              "text": ${JSON.stringify(item.a)}`,
        '            }',
        '          }',
      ].join('\n');
    })
    .join(',\n');

  return [
    `    ${FAQ_JSONLD_COMMENT[lang]}`,
    '    <script type="application/ld+json">',
    '      {',
    '        "@context": "https://schema.org",',
    '        "@type": "FAQPage",',
    '        "mainEntity": [',
    questions,
    '        ]',
    '      }',
    '    </script>',
    '',
  ].join('\n');
}

/**
 * 生成 index.html 中文块的整体替换文本（供一次性迁移脚本使用）。
 *
 * @param {string} html index.html 源码
 * @returns {{ html: string, count: number }} 替换后的 HTML 与条目数
 */
export function syncIndexHtmlFaqJsonLd(html) {
  const entries = selectFaqEntries(parseFaqEntries(html));
  const block = buildFaqPageJsonLd(entries, 'zh');
  const re = /[ \t]*<!-- FAQPage 结构化数据[\s\S]*?<\/script>\n/;
  if (!re.test(html)) throw new Error('未匹配到 index.html 的 FAQPage 结构化数据块');
  return { html: html.replace(re, block), count: entries.length };
}
