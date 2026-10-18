/**
 * 落地页「不执行 JS 时也拿得到东西」守卫
 *
 * 背景：`#showcase` 的 13 屏此前完全由页内脚本 `innerHTML` 注入，服务器返回的字节里那一块只剩一行
 * 注释；`<noscript>` 也只有一段窄屏页头的兜底样式，没有任何文字。执行 JS 的 Googlebot 看得到，
 * 不执行 JS 的消费者（GPTBot / ClaudeBot / PerplexityBot，以及关掉脚本的访客）抓到的是空区块。
 * 这与 2026-09-27 那次「`FAQS` 里一个未转义撇号把主脚本炸掉、41 条问答在服务字节里一条都不存在」
 * 是同一类事故，只是那次是故障、这次是设计。
 *
 * 现在 `#carouselTrack` 里静态写着首帧那一屏，页头之后多了一条 `<noscript>` 文字兜底。于是本文件
 * 固化四件事：
 *
 * 1. **首帧确实在服务字节里**，且它挂的字典 key、卡面字节、`alt` 同源于 `I18N`——静态 DOM、
 *    `SLIDES[0]`（运行时渲染同一屏）、`build-en-page.mjs` 的 alt 替换三条路径只有一个真源；
 * 2. **中英各归各位**：中文页那一屏是中文，英文页那一屏是英文，且英文页的截图指向 `-en` 那一套
 *    （文件必须真实存在，否则首帧就是一张 404）；
 * 3. **静态首帧不会变成第二份渲染**：`renderCarousel()` 起手 `track.innerHTML = ''`，开着 JS 的人
 *    永远看不到这一块——这条一旦失守，页面会先闪一屏再被 13 屏覆盖；
 * 4. **`<noscript>` 兜底文字与字典逐字一致**，并且页内 `<noscript>` 恰好两处（head 兜样式、
 *    body 兜文字），防止有人再把 FAQ 抄成第三份手工节选（来历见 `landingFaqDom.test.ts`）。
 *
 * 首帧与兜底段都挂着 `<!-- prettier-ignore -->`：printWidth 120 会把长句在 CJK 之间折行，折行在
 * HTML 里塌成一个空格，「本地存储方案」会变成「本地 存储方案」。所以这里按「规范排版」逐字比对——
 * 排版标记被 prettier 抢走时，卡面就不再逐字等于字典值，断言随之变红（自检那三例证的就是这条牙）。
 *
 * 数「页内有几处某标记」一律先过 `servedDom`：脚本里的 `I18N` 字典与注释都会把这些串再说一遍，
 * 直接对整份文件计数会把 2 数成 7。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(__dirname, '../..');

/** 连续 4 个及以上汉字——成句中文的指纹，用来区分「漏翻」与英文文案里合法引用的界面词 */
const CJK_RUN = /[\u4e00-\u9fff]{4}/;

/** 静态首帧那一屏的块形状：14 空格缩进、整块三行 */
const SLIDE_BLOCK_RE = /^ {14}<div class="slide">\n([\s\S]*?)\n {14}<\/div>$/m;

/** 首帧这一屏挂的两个字典 key */
const S1 = { title: 'showcase.s1.title', desc: 'showcase.s1.desc' } as const;

/** `<noscript>` 兜底段挂的 key（句子里那条 llms.txt 纯文摘要入口也在一起） */
const NOSCRIPT_KEY = 'noscript.note';

/** `<noscript>` 兜底段必须是单行整块 */
const NOSCRIPT_BLOCK_RE =
  /^ {4}<noscript><div class="container noscript-note"><p data-i18n-html="([^"]+)">([\s\S]*?)<\/p><\/div><\/noscript>$/m;

/** 中英两页：en.html 由 `pnpm gen:en` 从 index.html 生成，两侧都要被钉住 */
const PAGES = [
  { file: 'index.html', lang: 'zh' as const, label: '中文页' },
  { file: 'en.html', lang: 'en' as const, label: '英文页' },
];

interface StaticSlide {
  /** `<img>` 的 src（相对路径原样） */
  src: string;
  alt: string;
  titleKey: string;
  title: string;
  descKey: string;
  desc: string;
}

const readPage = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * 剥掉 `<script>` 内容与 HTML 注释，只留服务给消费者的 DOM。
 *
 * `I18N` 字典把 `<noscript>`、`href="./llms.txt"` 这些串又写了一遍，`<style>` 里的注释也是；不剥就会
 * 把「页面上有一处」数成「文件里出现 N 次」，而本守卫要的恰恰是前者。
 */
function servedDom(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 取出页内 `I18N` 字典（与 `build-en-page.mjs` 同一截取值方式：纯对象字面量区域丢给 vm）。
 *
 * 英文页也带着同一份字典原样存在（`applyI18n` 只换 DOM 节点、不碰脚本），所以两页都能解析。
 */
function i18nDict(html: string, file: string): Record<string, { zh: string; en: string }> {
  const start = html.indexOf('const I18N = {');
  expect(start, `${file} 找不到 I18N 字典起点`).toBeGreaterThan(-1);
  const bodyStart = html.indexOf('{', start);
  const dictEnd = html.indexOf('};', bodyStart);
  expect(dictEnd, `${file} 找不到 I18N 字典终点`).toBeGreaterThan(bodyStart);
  return vm.runInNewContext(`(${html.slice(bodyStart, dictEnd + 1)})`) as Record<string, { zh: string; en: string }>;
}

/**
 * 解析 `#carouselTrack` 里静态写着的那一屏。
 *
 * 判据刻意写成「14 空格缩进的规范排版」：缩进或换行被改动即解析不到，等于同时守住
 * `prettier-ignore` 还在、结构仍是 `.slide > .slide-shot + .slide-info` 这两件事。
 */
function parseStaticSlide(html: string, file: string): StaticSlide {
  const block = SLIDE_BLOCK_RE.exec(html);
  expect(block, `${file} 的 #carouselTrack 里没有静态首帧（缩进或排版一变就解析不到）`).not.toBeNull();
  const inner = block![1];

  const img = /<img src="([^"]+)" alt="([^"]*)"(?:\s+width="\d+"\s+height="\d+")?\s+loading="lazy" \/>/.exec(inner);
  expect(img, `${file} 静态首帧的 <img> 不是规范形状（src/alt/可选宽高/loading 一行写齐）`).not.toBeNull();
  const h3 = /<h3 data-i18n="([^"]+)">([\s\S]*?)<\/h3>/.exec(inner);
  expect(h3, `${file} 静态首帧缺少带 data-i18n 的 <h3>`).not.toBeNull();
  const p = /<p data-i18n="([^"]+)">([\s\S]*?)<\/p>/.exec(inner);
  expect(p, `${file} 静态首帧缺少带 data-i18n 的 <p>`).not.toBeNull();

  return { src: img![1], alt: img![2], titleKey: h3![1], title: h3![2], descKey: p![1], desc: p![2] };
}

/** 取 body 里那条 `<noscript>` 文字兜底 */
function parseNoscriptNote(html: string, file: string): { key: string; text: string } {
  const note = NOSCRIPT_BLOCK_RE.exec(html);
  expect(note, `${file} 找不到 body 里的 <noscript> 文字兜底（它必须单行整块，别交给 prettier）`).not.toBeNull();
  return { key: note![1], text: note![2] };
}

describe('落地页不执行 JS 时的可见内容', () => {
  it('首帧静态写着，且卡面、alt、字典 key 与 SLIDES[0] 四条路径同源', () => {
    for (const { file, lang, label } of PAGES) {
      const html = readPage(file);
      const dict = i18nDict(html, file);
      const slide = parseStaticSlide(html, file);

      expect((servedDom(html).match(/^ {14}<div class="slide">$/gm) || []).length, `${label} 静态 slide 不止一屏`).toBe(
        1,
      );
      expect(slide.titleKey, `${label} 首帧标题挂错了 key`).toBe(S1.title);
      expect(slide.descKey, `${label} 首帧说明挂错了 key`).toBe(S1.desc);
      expect(dict[S1.title], `${label} 的字典缺少 ${S1.title}`).toBeTruthy();
      expect(slide.title, `${label} 首帧标题与服务字节里的字典值不同源`).toBe(dict[S1.title]![lang]);
      expect(slide.desc, `${label} 首帧说明与服务字节里的字典值不同源`).toBe(dict[S1.desc]![lang]);
      // alt 就是这一屏的标题：图片说明与可见标题不同源时，读屏与图片检索会各说一套
      expect(slide.alt, `${label} 首帧 alt 不等于标题`).toBe(dict[S1.title]![lang]);

      // 运行时渲染同一屏的那条路径也必须读同一个 key，否则改了字典只改到一半
      expect(html, `${label} 的 SLIDES[0] 没引用 I18N['${S1.title}']`).toContain(`title: I18N['${S1.title}'],`);
      expect(html, `${label} 的 SLIDES[0] 没引用 I18N['${S1.desc}']`).toContain(`desc: I18N['${S1.desc}'],`);
    }
  });

  it('首帧截图按页语言取对应那一套，且文件真实存在', () => {
    for (const { file, lang, label } of PAGES) {
      const slide = parseStaticSlide(readPage(file), file);
      expect(slide.src, `${label} 首帧应当指向 cws-store 里的产品截图`).toMatch(/^\.\/assets\/cws-store\/.+\.webp$/);
      // 与页内 `shotFile()` 同一条规则：英文页必须声明 `-en` 那一张，否则英文富结果挂中文图
      expect(slide.src, `${label} 的首帧截图语言不匹配`).toBe(
        `./assets/cws-store/screen-1-one-click-login${lang === 'en' ? '-en' : ''}.webp`,
      );
      expect(existsSync(path.join(ROOT, slide.src)), `${label} 首帧截图指向不存在的文件：${slide.src}`).toBe(true);
    }
  });

  it('语言各归各位：英文页首帧不残留成句中文', () => {
    const zh = parseStaticSlide(readPage('index.html'), 'index.html');
    expect(CJK_RUN.test(zh.title), '中文页首帧标题应为中文').toBe(true);
    expect(CJK_RUN.test(zh.desc), '中文页首帧说明应为中文').toBe(true);

    const en = parseStaticSlide(readPage('en.html'), 'en.html');
    expect(CJK_RUN.test(en.title), `英文页首帧标题残留中文：${en.title}`).toBe(false);
    expect(CJK_RUN.test(en.desc), '英文页首帧说明残留中文').toBe(false);
  });

  it('开着 JS 的人看不到静态首帧：renderCarousel 起手清空 track', () => {
    for (const { file, label } of PAGES) {
      const html = readPage(file);
      const render = /function renderCarousel\(\) \{([\s\S]{0,400})/.exec(html);
      expect(render, `${label} 找不到 renderCarousel()`).not.toBeNull();
      expect(render![1], `${label} 的 renderCarousel 不再清空 track，静态首帧会多出一屏`).toContain(
        "track.innerHTML = '';",
      );
      expect(html, `${label} 的 renderCarousel 没有被调用`).toContain('renderCarousel();');
    }
  });

  it('<noscript> 兜底与字典逐字同源，且页内只有两处 noscript', () => {
    for (const { file, lang, label } of PAGES) {
      const html = readPage(file);
      const dict = i18nDict(html, file);
      const note = parseNoscriptNote(html, file);

      expect(note.key, `${label} 兜底段挂错了字典 key`).toBe(NOSCRIPT_KEY);
      expect(note.text, `${label} 兜底段与服务字节里的字典值不同源`).toBe(dict[NOSCRIPT_KEY]![lang]);
      // 纯文版入口必须写在这句里：不执行 JS 的消费者正是需要它的人
      expect(note.text, `${label} 兜底段没有指向 llms.txt`).toContain('<a href="./llms.txt">llms.txt</a>');
      expect(servedDom(html).match(/<noscript\b/g) || [], `${label} 的 <noscript> 数量变了`).toHaveLength(2);
    }
  });

  it('兜底文字说明的受限区块与实际一致：首帧除外、生成器演示、语言切换', () => {
    const zh = parseNoscriptNote(readPage('index.html'), 'index.html').text;
    // 这句话的价值就在于「哪儿需要 JS」；把首帧也写成需要 JS 就成了假话
    expect(zh).toContain('首帧除外');
    expect(zh).toContain('密码生成器');
    expect(zh).toContain('语言切换');
    expect(zh).toContain('常见问题');
  });

  it('页脚有 llms.txt 入口，DOM 里共两处（页脚 + 兜底段）', () => {
    for (const { file, label } of PAGES) {
      const html = servedDom(readPage(file));
      expect(
        (html.match(/href="\.\/llms\.txt"/g) || []).length,
        `${label} 指向 llms.txt 的链接数不是 2（页脚 + <noscript> 兜底各一条）`,
      ).toBe(2);
      expect(readPage(file), `${label} 页脚那条 llms.txt 链接没走字典`).toContain('data-i18n="footer.llms"');
    }
  });
});

describe('守卫自检：卡面漂移与排版失守都会变红', () => {
  const ZH = readPage('index.html');
  const DICT = i18nDict(ZH, 'index.html');
  const SLIDE = parseStaticSlide(ZH, 'index.html');

  it('只改卡面不动字典 → 同源断言失配（证明这条断言有牙）', () => {
    expect(SLIDE.title, '基线：卡面此刻就等于字典值').toBe(DICT[S1.title]!.zh);
    const drifted = ZH.replace(
      `<h3 data-i18n="${S1.title}">${SLIDE.title}</h3>`,
      `<h3 data-i18n="${S1.title}">功能演示</h3>`,
    );
    expect(drifted).not.toBe(ZH);
    expect(parseStaticSlide(drifted, 'index.html').title).not.toBe(DICT[S1.title]!.zh);
  });

  it('让 prettier 拿到折行的排版权 → 卡面不再逐字等于字典值', () => {
    const folded = ZH.replace(SLIDE.desc, `${SLIDE.desc.slice(0, 20)}\n              ${SLIDE.desc.slice(20)}`);
    expect(parseStaticSlide(folded, 'index.html').desc).not.toBe(DICT[S1.desc]!.zh);
  });

  it('兜底段的 <p> 被拆到下一行 → 单行整块的解析落空', () => {
    const opened = `<noscript><div class="container noscript-note">\n        <p data-i18n-html="${NOSCRIPT_KEY}">`;
    expect(ZH, '夹具：兜底段此刻是单行整块').not.toContain(opened);
    const reflowed = ZH.replace(
      `<noscript><div class="container noscript-note"><p data-i18n-html="${NOSCRIPT_KEY}">`,
      opened,
    );
    expect(reflowed).not.toBe(ZH);
    expect(NOSCRIPT_BLOCK_RE.exec(reflowed)).toBeNull();
    expect(() => parseNoscriptNote(reflowed, 'index.html')).toThrow();
  });
});
