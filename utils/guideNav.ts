/**
 * 指引页目录数据与滚动取位
 *
 * 目录项与正文锚点必须一一对应：正文里 `<section id="guide-sec-<id>">` 是硬编码的，
 * 目录却由这里驱动，所以把清单收到一个可被测试 import 的模块，`tests/utils/guideNav.test.ts`
 * 才能拿它去比对 `GuideView.vue` 源码里的锚点集合（同 `i18nBundles.test.ts` 数 help 条目的做法）。
 */

/** 目录项：`id` 同时是 `#guide/<id>` 锚点与 `guide-sec-<id>` 元素 id 的那一段 */
export interface GuideNavTarget {
  /** 只增不改——它会出现在用户收藏的 URL 片段里 */
  id: string;
  /** 词条 key（中英文语言包里都存在） */
  labelKey: string;
}

/** 一级章节，可挂二级子项（常见问题按四组拆分） */
export interface GuideSection extends GuideNavTarget {
  children?: readonly GuideNavTarget[];
}

/** 章节清单：顺序即正文滚动顺序，导航与滚动跟随都按它 */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  { id: 'product', labelKey: 'options.guide.sectionProduct' },
  { id: 'gs', labelKey: 'help.groupSecurity' },
  { id: 'gb', labelKey: 'help.groupBasic' },
  { id: 'gd', labelKey: 'help.groupData' },
  { id: 'gc', labelKey: 'help.groupConfig' },
  { id: 'shortcut', labelKey: 'help.shortcutTitle' },
  {
    id: 'faq',
    labelKey: 'help.faqTitle',
    children: [
      { id: 'faq-s', labelKey: 'help.groupSecurity' },
      { id: 'faq-b', labelKey: 'help.groupBasic' },
      { id: 'faq-d', labelKey: 'help.groupData' },
      { id: 'faq-c', labelKey: 'help.groupConfig' },
    ],
  },
];

/** 文档顺序展开的全部锚点（父章节紧跟它的子项），滚动取位按这份清单 */
export const GUIDE_ANCHORS: readonly GuideNavTarget[] = GUIDE_SECTIONS.flatMap(section => [
  { id: section.id, labelKey: section.labelKey },
  ...(section.children ?? []),
]);

/** 滚动取位的输入：锚点 id 与其相对滚动容器可视顶部的距离（px，可为负） */
export interface GuideAnchorPosition {
  id: string;
  top: number;
}

/** 折线在吸顶条下沿之外再留的余量，与样式里 `scroll-padding-top` 的同一档（真机落点 = 条高 + 本值） */
export const GUIDE_FOLD_SLACK = 12;

/**
 * 折线的亚像素容差
 *
 * 点击导航后章节的落点，在数学上正好等于折线（CSS 的 `scroll-padding-top` 与 `GUIDE_FOLD_SLACK`
 * 同值），而真机读数是 67.1 / 67.3 这种带小数的值——严格 `<=` 会差 0.1px 判成「没越过」，
 * 高亮跳回上一节。容差只要覆盖亚像素抖动即可，不影响正常滚动时的取位。
 */
export const GUIDE_FOLD_TOLERANCE = 1;

/**
 * 折线到滚动容器可视顶部的距离
 *
 * 折线取吸顶条的**实测**高度而不是抄 CSS 里的 `--guide-bar-h`：条高一旦随文案变化，
 * 抄的常量会静默失准，实测不会。
 */
export const guideFoldY = (barHeight: number): number => barHeight + GUIDE_FOLD_SLACK + GUIDE_FOLD_TOLERANCE;

/**
 * 取「当前章节」：最后一个越过折线的锚点
 *
 * 折线是吸顶条下沿，`top <= foldY` 即该锚点已滚到条下方。一条都没越过时回落到第一个；
 * 滚到底时强制点亮最后一项——末章往往比视口矮，永远越不过折线，不特殊处理会一直亮着倒数第二项。
 *
 * @param anchors 文档顺序的锚点位置数组（空数组返回空串）
 * @param foldY 折线到滚动容器可视顶部的距离（用 `guideFoldY` 算，别自己拼）
 * @param atBottom 是否已滚到底
 */
export const pickActiveId = (anchors: readonly GuideAnchorPosition[], foldY: number, atBottom = false): string => {
  if (!anchors.length) return '';
  if (atBottom) return anchors[anchors.length - 1].id;
  let active = anchors[0].id;
  for (const anchor of anchors) {
    if (anchor.top <= foldY) active = anchor.id;
  }
  return active;
};
