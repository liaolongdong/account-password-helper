/**
 * 指引页目录守卫：目录项与正文锚点必须同集合、同顺序，滚动取位是纯函数
 *
 * 为什么钉在这里而不是靠肉眼：目录由 `utils/guideNav.ts` 驱动，正文锚点
 * `id="guide-sec-<id>"` 是模板里硬编码的，两者没有编译期联系。加一章只改一边，
 * 表现是「目录里点了没反应」或「滚到那一节时高亮不动」——都不报错、测试也不红，
 * 属于只能靠结构守卫拦住的静默漂移。顺序也算口径：目录必须按正文的滚动顺序排，
 * 为了「把动作项放最后」而反序同样不会被任何功能测试抓到，只有这里能拦。
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { GUIDE_ANCHORS, GUIDE_FOLD_SLACK, GUIDE_SECTIONS, guideFoldY, pickActiveId } from '@/utils/guideNav';

const GUIDE_SOURCE = readFileSync(path.resolve(__dirname, '../../components/options/GuideView.vue'), 'utf-8');

/** 按出现顺序取出正文里全部章节 / 子组锚点 id */
const bodyAnchorIds = (): string[] => [...GUIDE_SOURCE.matchAll(/id="guide-sec-([a-z0-9-]+)"/g)].map(m => m[1]);

describe('guideNav：目录与正文锚点对齐', () => {
  it('目录展开后的锚点集合与顺序，等于正文里 guide-sec-* 的出现顺序', () => {
    expect(bodyAnchorIds()).toEqual(GUIDE_ANCHORS.map(anchor => anchor.id));
  });

  it('七个一级章节各自拥有正文锚点，FAQ 额外挂四个子组', () => {
    expect(GUIDE_SECTIONS.map(section => section.id)).toEqual(['product', 'gs', 'gb', 'gd', 'gc', 'shortcut', 'faq']);
    expect(GUIDE_SECTIONS.find(section => section.id === 'faq')?.children?.map(child => child.id)).toEqual([
      'faq-s',
      'faq-b',
      'faq-d',
      'faq-c',
    ]);
  });
});

describe('guideNav：pickActiveId', () => {
  const anchors = [
    { id: 'product', top: -40 },
    { id: 'gs', top: 10 },
    { id: 'gb', top: 320 },
  ];

  it('取最后一个越过折线的锚点', () => {
    expect(pickActiveId(anchors, 53)).toBe('gs');
    expect(pickActiveId(anchors, 400)).toBe('gb');
  });

  it('一条都没越过折线时回落到第一项', () => {
    expect(
      pickActiveId(
        anchors.map(a => ({ ...a, top: a.top + 500 })),
        53,
      ),
    ).toBe('product');
  });

  it('top 恰好在折线上算已越过', () => {
    expect(pickActiveId([{ id: 'x', top: 53 }], 53)).toBe('x');
  });

  it('滚到底点亮最后一项，即使它永远越不过折线', () => {
    expect(pickActiveId(anchors, 53, true)).toBe('gb');
  });

  it('空清单返回空串，不抛异常', () => {
    expect(pickActiveId([], 53)).toBe('');
    expect(pickActiveId([], 53, true)).toBe('');
  });
});

describe('guideNav：折线与点击落点配对', () => {
  /** 真机读数：吸顶条实测 55，点击后章节落点 67.0～67.3（带亚像素抖动） */
  const BAR_HEIGHT = 55;
  const landing = BAR_HEIGHT + GUIDE_FOLD_SLACK;

  it('折线严格低于点击落点，刚点到的章节不会被判成「还没越过」', () => {
    expect(guideFoldY(BAR_HEIGHT)).toBeGreaterThan(landing);
    const anchors = [
      { id: 'faq-b', top: -420 },
      { id: 'faq-d', top: landing + 0.3 },
      { id: 'faq-c', top: landing + 900 },
    ];
    expect(pickActiveId(anchors, guideFoldY(BAR_HEIGHT))).toBe('faq-d');
  });

  it('CSS 的 scroll-padding-top 余量与 JS 的 GUIDE_FOLD_SLACK 是同一个数', () => {
    expect(GUIDE_SOURCE).toContain(`--guide-fold-slack: ${GUIDE_FOLD_SLACK}px;`);
    expect(GUIDE_SOURCE).toContain('scroll-padding-top: calc(var(--guide-bar-h) + var(--guide-fold-slack));');
  });

  /* 上面的用例钉住「余量」这一半，这一条钉另一半：CSS 的条带高度基准也不能跟这里跑偏。
     两处一旦不同步，表现是「点目录后高亮慢半拍」这种量不出来也测不出来的错位 */
  it('CSS 的 --guide-bar-h 与本用例用的条高是同一个数', () => {
    expect(GUIDE_SOURCE).toContain(`--guide-bar-h: ${BAR_HEIGHT}px;`);
  });
});
