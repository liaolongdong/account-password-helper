/**
 * 条目详情抽屉是「全文读通道」：值字段折行、字段名不得逐字竖排
 *
 * 钉这一条是因为抽屉的定位就是「列表里被截断的东西在这里完整可读」（见组件头注释），
 * 而 `el-descriptions` 的 border 形态渲染成 `<table>`，两件事会同时坏掉，且坏法很隐蔽：
 *
 * ① 值列只要声明 `white-space: nowrap`，`table-layout` 为 auto 时该列的 min-content
 *    就等于整串文本宽度，表格撑破抽屉、值列把标签 `<th>` 挤到一字宽。中文可在任意字间断行，
 *    于是「用户名」排成三行 —— 用户看到的是截图里那种竖排标签，而不是「哪里溢出了」。
 * ② 反过来把值改成省略号截断，抽屉就退化成列表的副本，全文通道只剩编辑弹窗一处。
 *
 * 数值口径来自真浏览器实测（headless Chrome，把改动前后两份**真实** `<style scoped>` 注入
 * EP 的 descriptions 规则骨架，抽屉 440px、body padding 20px）：
 * - 改动前：标签格 37px（内容 15px），「用户名 / 两步验证」各排 3、4 行，表格 793px、
 *   右缘越出抽屉 333px（抽屉 body 是 `overflow:auto`，表现为横向滚动）；
 * - 改动后：标签格 79px（= 最长标签「两步验证」整词宽度）、全部 1 行，表格 440px 不越界，
 *   96 字符的网址折成 3 行完整可读。
 *
 * ③ `flex-shrink: 0` 与 ①② 是一体的：值文本一旦可折行，其 flex 基准（max-content，整段一行）
 *    远超容器，负剩余空间按「收缩系数 × 基准尺寸」分摊到同行每个弹性项，20px 的图标按钮会被
 *    一起挤扁（实测不加这一句时长备注行只剩约 10px）。同一份量具里补上这一句后按钮恒为 26px。
 *
 * 头部 `.detail-header__username` / `__site` 保留省略号是刻意的：那两行是下方字段行的副本，
 * 全文在字段行里已经在，截断不损失信息。因此本守卫不写「全文件零省略号」，而是把省略号
 * 关进这两条规则的范围内 —— 新增第三条截断规则会立刻变红。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const FILE = 'components/options/PasswordDetailDrawer.vue';

/** 值字段文本的三条选择器：用户名 / 网址 / 备注全文 */
const VALUE_TEXTS = ['.detail-value__text', '.detail-url__text', '.detail-remark__text'];

/** 允许截断的两条头部规则（全文在下方字段行里，截断不损失信息） */
const ELLIPSIS_ALLOW_LIST = ['.detail-header__username', '.detail-header__site'];

/** 标签格那条按源码里的原样钉住（写成别的 `:deep` 形状就查不到，正是要防的静默失配） */
const LABEL_RULE = '.detail-descriptions :deep(.el-descriptions__label)';

/** 取 `<style scoped>` 并摘掉注释（注释里就写着 `white-space: nowrap` 这类片段，按文本扫会命中注释） */
const scopedCss = (src: string) => {
  const style = src.match(/<style scoped>([\s\S]*?)<\/style>/);
  if (!style) throw new Error('找不到 `<style scoped>` 块');
  return style[1].replace(/\/\*[\s\S]*?\*\//g, '');
};

/** 定位一条规则的声明体；找不到即抛，不让「规则被改名」读成「属性没写」 */
const ruleBody = (css: string, selector: string) => {
  const head = `${selector} {`;
  const at = css.indexOf(head);
  if (at < 0) throw new Error(`\`${selector} {}\` 不在样式里 —— 改名或删除都会让本守卫空跑`);
  const start = at + head.length;
  const end = css.indexOf('}', start);
  if (end < 0) throw new Error(`\`${selector} {}\` 没有闭合`);
  return css.slice(start, end);
};

/** 取某条规则里某个属性的值；缺失返回 null（区别于抛错：本守卫要断言「没有这个属性」） */
const declValue = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+?)\\s*(?:;|$)`));
  return m ? m[1] : null;
};

/** 只改写某一条规则里的某个声明（整份 CSS 里 `flex-shrink: 0` 出现多次，全局 replace 会改到别的规则） */
const rewriteInRule = (css: string, selector: string, prop: string, value: string) => {
  const head = `${selector} {`;
  const at = css.indexOf(head);
  if (at < 0) throw new Error(`\`${selector} {}\` 不在样式里`);
  const start = at + head.length;
  const end = css.indexOf('}', start);
  const body = css.slice(start, end);
  const pattern = new RegExp(`${prop}:\\s*[^;]+;`);
  if (!pattern.test(body)) throw new Error(`\`${selector}\` 里没有 \`${prop}\` 声明，变异串是空的`);
  return css.slice(0, start) + body.replace(pattern, `${prop}: ${value};`) + css.slice(end);
};

describe('详情抽屉的全文读通道', () => {
  const css = scopedCss(readSource(FILE));

  it('扫描非空：三条值文本规则与标签规则都在（抽取失配等于守卫空跑）', () => {
    for (const selector of [...VALUE_TEXTS, '.detail-value .el-button', LABEL_RULE]) {
      expect(() => ruleBody(css, selector)).not.toThrow();
    }
  });

  it('每个值字段都靠折行展示全文，而不是省略号截断', () => {
    for (const selector of VALUE_TEXTS) {
      const body = ruleBody(css, selector);
      expect(declValue(body, 'text-overflow'), `${selector} 又用省略号截断了，抽屉不再是全文通道`).toBeNull();
      expect(declValue(body, 'white-space'), `${selector} 声明了 white-space，长值会撑破表格`).not.toBe('nowrap');
      expect(
        declValue(body, 'overflow-wrap'),
        `${selector} 没有 overflow-wrap，超长串（无空格网址 / 长 token）折不了行`,
      ).not.toBeNull();
    }
  });

  it('字段名单元格锁在一行：竖排的唯一来源就是它被值列挤压', () => {
    const body = ruleBody(css, LABEL_RULE);
    expect(declValue(body, 'white-space'), '标签格没有 nowrap，中文标签会一字一行竖排').toBe('nowrap');
  });

  it('按钮不跟着弹性收缩：值文本一旦可折行，整行的负空间会分摊到图标上', () => {
    const body = ruleBody(css, '.detail-value .el-button');
    expect(declValue(body, 'flex-shrink'), '.detail-value 的图标按钮没有 flex-shrink: 0，长值行里会被挤扁').toBe('0');
  });

  it('省略号只许出现在头部那两条副本规则里（新增截断规则即红）', () => {
    let rest = css;
    for (const selector of ELLIPSIS_ALLOW_LIST) {
      const body = ruleBody(css, selector);
      expect(declValue(body, 'text-overflow'), `${selector} 本应保留省略号`).toBe('ellipsis');
      rest = rest.replace(body, '');
    }
    expect(rest.match(/text-overflow/g), '除头部两条副本之外还有规则在用省略号截断').toBeNull();
  });

  it('备注行复用值行的容器契约，并带上命中高亮与复制动作', () => {
    const src = readSource(FILE);
    // 不能按 `<template>…</template>` 截取：本 SFC 内部还有 `<template v-if>`，
    // 非贪婪匹配会在第一个内层闭合标签就截断，后面什么都查不到（守卫静默空跑的典型形状）。
    const at = src.indexOf('class="detail-value detail-remark"');
    expect(at, '备注行没有挂 detail-value，就脱离了一套图标密度与热区契约').toBeGreaterThan(-1);
    const remarkBlock = src.slice(at, src.indexOf('</div>', at));
    expect(remarkBlock).toContain('<SearchHighlight');
    expect(remarkBlock).toContain(':text="entry.remark"');
    expect(remarkBlock).toContain('copyText(entry.remark)');
  });

  // 牙齿：逐条自证判据读得动，防止写成恒真。变异必须落在指定那条规则里 ——
  // `flex-shrink: 0` 与 `white-space: nowrap` 在别的规则里也出现，全局 replace 会改错地方。
  it('牙齿：把 nowrap / 截断 / flex-shrink 塞回去，对应读数必须变', () => {
    const withNowrap = css.replace('.detail-value__text {', '.detail-value__text { white-space: nowrap;');
    expect(declValue(ruleBody(withNowrap, '.detail-value__text'), 'white-space'), '注入的 nowrap 没被读到').toBe(
      'nowrap',
    );

    const withEllipsis = css.replace('.detail-url__text {', '.detail-url__text { text-overflow: ellipsis;');
    expect(declValue(ruleBody(withEllipsis, '.detail-url__text'), 'text-overflow'), '注入的省略号没被读到').toBe(
      'ellipsis',
    );

    const loosenedShrink = rewriteInRule(css, '.detail-value .el-button', 'flex-shrink', '1');
    expect(
      declValue(ruleBody(loosenedShrink, '.detail-value .el-button'), 'flex-shrink'),
      '把 flex-shrink 改成 1，读数没有跟着变（说明变异落错了规则）',
    ).toBe('1');
    // 变异确实只落在这一条：头部那两条的 flex-shrink: 0 必须原样还在
    expect(declValue(ruleBody(loosenedShrink, '.detail-header__star'), 'flex-shrink')).toBe('0');

    const labelWrapped = rewriteInRule(css, LABEL_RULE, 'white-space', 'normal');
    expect(
      declValue(ruleBody(labelWrapped, LABEL_RULE), 'white-space'),
      '标签那条改回 normal，读数没有跟着变（说明判据锚错了规则）',
    ).toBe('normal');
  });
});
