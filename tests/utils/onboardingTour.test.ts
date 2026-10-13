/**
 * 新手引导纯逻辑与语言包对齐测试
 *
 * 覆盖 `utils/onboardingTour.ts` 的三块可断言逻辑（聚光框外扩、卡片落点求解、
 * 剧本裁剪），并补齐 `i18nBundles.test.ts` 管不到的一半：那边只管「源码用到的 key
 * 在不在 bundle 里」，这里管「剧本要求的 key 在不在语言包里」——`tourKey()` 拼的是
 * 动态键，静态扫描提取不到，改剧本忘补文案会直接在引导卡片上渲染出裸 key。
 *
 * 几何断言全部以常量（SPOT_PADDING / CARD_GAP / VIEWPORT_PADDING / CARD_WIDTH）
 * 为口径写成绝对数值，目的是让「顺手改个间距」必须显式改测试，而不是静默漂移。
 *
 * 末尾两个 describe 不在测这个模块，而是守引导的两处跨文件接线（`App.vue` 的 canOpen
 * 门槛、`OnboardingTour.vue` 的卡内动作按钮）：`.vue` 在本仓库的测试管线里挂不起来，
 * 这类接线回退又完全静默，只能在源码层钉死。
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import {
  CARD_GAP,
  CARD_WIDTH,
  SPOT_PADDING,
  SPOT_RADIUS,
  TOUR_STEPS,
  VIEWPORT_PADDING,
  expandToSpot,
  pickSteps,
  resolvePlacement,
  tourKey,
} from '@/utils/onboardingTour';
import type { TourCardSize, TourSpot, TourViewport } from '@/utils/onboardingTour';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES = ['zh-CN', 'en'] as const;

/** 读取 onboarding 命名空间语言包 */
function readOnboarding(locale: (typeof LOCALES)[number]): Record<string, string> {
  return JSON.parse(readFileSync(path.join(ROOT, `utils/i18n/locales/${locale}/onboarding.json`), 'utf-8'));
}

/** 构造聚光框（几何用例直接给定，绕开 expandToSpot 以便隔离被测函数） */
function spot(top: number, left: number, width: number, height: number): TourSpot {
  return { top, left, width, height, radius: SPOT_RADIUS };
}

describe('expandToSpot：锚点矩形 → 聚光框', () => {
  it('四边各外扩 SPOT_PADDING，宽高同步增加两倍 padding', () => {
    const result = expandToSpot({ top: 100, left: 200, width: 100, height: 40 });
    expect(result).toEqual({
      top: 100 - SPOT_PADDING,
      left: 200 - SPOT_PADDING,
      width: 100 + SPOT_PADDING * 2,
      height: 40 + SPOT_PADDING * 2,
      radius: SPOT_RADIUS,
    });
  });

  it('圆角按短边收一半，避免矮锚点被框成胶囊', () => {
    // 外扩后 20 × 24，短边 20 < 2 × SPOT_RADIUS(24)，取 10
    const flat = expandToSpot({ top: 0, left: 0, width: 0, height: 4 });
    expect(flat.width).toBe(SPOT_PADDING * 2);
    expect(flat.height).toBe(SPOT_PADDING * 2 + 4);
    expect(flat.radius).toBe(SPOT_PADDING);

    // 常规尺寸仍取上限
    expect(expandToSpot({ top: 0, left: 0, width: 120, height: 32 }).radius).toBe(SPOT_RADIUS);
  });

  it('负宽高先钳到 0，不产生反向尺寸', () => {
    const result = expandToSpot({ top: 5, left: 5, width: -30, height: -8 });
    expect(result.width).toBe(SPOT_PADDING * 2);
    expect(result.height).toBe(SPOT_PADDING * 2);
    expect(result.top).toBe(5 - SPOT_PADDING);
    expect(result.radius).toBe(SPOT_PADDING);
  });

  it('padding 可覆写，默认值只在未传参时生效', () => {
    const result = expandToSpot({ top: 100, left: 100, width: 50, height: 50 }, 0);
    expect(result).toEqual({ top: 100, left: 100, width: 50, height: 50, radius: SPOT_RADIUS });
  });
});

describe('resolvePlacement：卡片落点求解', () => {
  const card: TourCardSize = { width: CARD_WIDTH, height: 200 };
  const viewport: TourViewport = { width: 1280, height: 800 };

  it('无锚点或期望居中时直接返回 center，坐标归零交给 CSS 居中', () => {
    expect(resolvePlacement(null, card, viewport, 'bottom')).toEqual({ side: 'center', top: 0, left: 0 });
    expect(resolvePlacement(spot(50, 90, 140, 52), card, viewport, 'center')).toEqual({
      side: 'center',
      top: 0,
      left: 0,
    });
  });

  it('下方放得下时按期望方位落位，不产生翻转', () => {
    const s = spot(50, 90, 140, 52);
    expect(resolvePlacement(s, card, viewport, 'bottom')).toEqual({
      side: 'bottom',
      top: 50 + 52 + CARD_GAP,
      left: 90,
    });
  });

  it('锚点贴近视口下沿时翻到对侧（top）', () => {
    const s = spot(700, 90, 140, 52);
    const result = resolvePlacement(s, card, viewport, 'bottom');
    expect(result.side).toBe('top');
    expect(result.top).toBe(700 - CARD_GAP - card.height);
    expect(result.left).toBe(90);
  });

  it('上下都放不下时退到横轴（right），沿用聚光框顶部对齐', () => {
    // 视口高 420：bottom 需要 238+200 > 404、top 需要 100-218 < 16，两者皆失败
    const tallViewportCard: TourCardSize = { width: CARD_WIDTH, height: 200 };
    const shortViewport: TourViewport = { width: 1400, height: 420 };
    const s = spot(100, 100, 140, 120);
    const result = resolvePlacement(s, tallViewportCard, shortViewport, 'bottom');
    expect(result).toEqual({ side: 'right', top: 100, left: 100 + 140 + CARD_GAP });
  });

  it('四个方位都放不下时退回原方位并收进安全区', () => {
    // 锚点贴在右上角：bottom 越右界、top 越上界、right 越右界、left 越上界
    const s = spot(6, 1200, 140, 52);
    const result = resolvePlacement(s, card, viewport, 'bottom');
    expect(result.side).toBe('bottom');
    expect(result.left).toBe(viewport.width - CARD_WIDTH - VIEWPORT_PADDING);
    expect(result.top).toBe(6 + 52 + CARD_GAP);
  });

  it('卡片比视口还高时贴安全区上沿，保证标题可见', () => {
    const tallCard: TourCardSize = { width: CARD_WIDTH, height: 400 };
    const smallViewport: TourViewport = { width: 1280, height: 300 };
    const result = resolvePlacement(spot(20, 100, 140, 52), tallCard, smallViewport, 'bottom');
    expect(result.side).toBe('bottom');
    expect(result.top).toBe(VIEWPORT_PADDING);
    expect(result.left).toBe(100);
  });

  it('任何输入组合下卡片都不越出安全区', () => {
    const cardSize: TourCardSize = { width: CARD_WIDTH, height: 220 };
    const vp: TourViewport = { width: 1280, height: 720 };
    for (const prefer of ['top', 'bottom', 'left', 'right'] as const) {
      for (const [top, left] of [
        [0, 0],
        [0, 1100],
        [600, 0],
        [600, 1100],
        [300, 480],
      ]) {
        const { side, top: t, left: l } = resolvePlacement(spot(top, left, 160, 48), cardSize, vp, prefer);
        expect(t).toBeGreaterThanOrEqual(VIEWPORT_PADDING);
        expect(l).toBeGreaterThanOrEqual(VIEWPORT_PADDING);
        expect(side).not.toBe('center');
        // 卡片比该轴可用空间还大时允许顶到安全区上限，否则必须完整可见
        const maxTop = Math.max(VIEWPORT_PADDING, vp.height - cardSize.height - VIEWPORT_PADDING);
        const maxLeft = Math.max(VIEWPORT_PADDING, vp.width - cardSize.width - VIEWPORT_PADDING);
        expect(t).toBeLessThanOrEqual(maxTop);
        expect(l).toBeLessThanOrEqual(maxLeft);
      }
    }
  });
});

describe('pickSteps：按锚点存在性裁剪剧本', () => {
  it('锚点齐全时原样保留顺序', () => {
    const picked = pickSteps(TOUR_STEPS, () => true);
    expect(picked.map(step => step.id)).toEqual(TOUR_STEPS.map(step => step.id));
  });

  it('无锚点步（欢迎 + 打开侧边栏）永远保留', () => {
    const picked = pickSteps(TOUR_STEPS, () => false);
    expect(picked.map(step => step.id)).toEqual(['welcome', 'sidepanel']);
  });

  it('空库引导卡与搜索栏互斥：只留当下存在的那一条', () => {
    const idsWith = (anchor: string) =>
      pickSteps(TOUR_STEPS, a => (a !== 'empty' && a !== 'search') || a === anchor).map(s => s.id);
    expect(idsWith('empty')).toEqual([
      'welcome',
      'add',
      'sidepanel',
      'empty',
      'data',
      'settings',
      'health',
      'personalize',
    ]);
    expect(idsWith('search')).toEqual([
      'welcome',
      'add',
      'sidepanel',
      'search',
      'data',
      'settings',
      'health',
      'personalize',
    ]);
  });

  it('欢迎步不查询锚点，判定函数只被有锚点的步骤调用', () => {
    const hasAnchor = vi.fn(() => true);
    pickSteps(TOUR_STEPS, hasAnchor);
    expect(hasAnchor).toHaveBeenCalledTimes(TOUR_STEPS.filter(step => step.anchor !== null).length);
  });
});

describe('tourKey：动态文案键拼装', () => {
  it('三段式键名与组件读取口径一致', () => {
    expect(tourKey('add', 'title')).toBe('onboarding.add.title');
    expect(tourKey('add', 'desc')).toBe('onboarding.add.desc');
    expect(tourKey('add', 'tip')).toBe('onboarding.add.tip');
  });
});

describe('TOUR_STEPS：剧本自身约束', () => {
  it('步骤 id 与锚点键名各自唯一', () => {
    const ids = TOUR_STEPS.map(step => step.id);
    expect(new Set(ids).size).toBe(ids.length);

    const anchors = TOUR_STEPS.map(step => step.anchor).filter((anchor): anchor is string => anchor !== null);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  /**
   * 无锚点步按显式白名单放行，而不是「只许有一个」
   *
   * 这条守卫的本意从来是「不许出现来历不明的无锚点步」。`sidepanel` 的无锚点是结构性的：
   * 侧边栏不在 Options 的 DOM 里，聚光灯圈不到，只能整屏幕布 + 卡内动作按钮。
   * 白名单写法保留了原来那条的牙——将来再冒出第三个无锚点 id，或者谁把居中偏好改掉，照样变红。
   */
  it('无锚点步恰为白名单那两个，都居中、欢迎仍排首位', () => {
    const anchorless = TOUR_STEPS.filter(step => step.anchor === null);
    expect(anchorless.map(step => step.id)).toEqual(['welcome', 'sidepanel']);
    for (const step of anchorless) expect(step.prefer).toBe('center');
    expect(TOUR_STEPS[0].anchor).toBeNull();
  });

  it('「打开侧边栏」紧跟「先放第一条进去」，存 → 取在同一段里走完', () => {
    // 位置即承诺：welcome.desc 那句「日常用侧边栏就够了」要在第 3 屏兑现，不是拖到末步
    expect(TOUR_STEPS.slice(0, 3).map(step => step.id)).toEqual(['welcome', 'add', 'sidepanel']);
  });

  it('锚点键名与页面上的 data-tour 契约保持 snake 简洁（无空格与点号）', () => {
    for (const step of TOUR_STEPS) {
      if (step.anchor === null) continue;
      expect(step.anchor).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

/** 递归列出目录下全部 `.vue` 源文件（相对 ROOT） */
function listVueSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listVueSources(rel));
    else if (entry.name.endsWith('.vue')) out.push(rel);
  }
  return out;
}

/** 扫描界面上真实写出的 `data-tour="…"` 锚点键名 */
function scanTourAnchors(): Set<string> {
  const found = new Set<string>();
  for (const file of [...listVueSources('components'), ...listVueSources('entrypoints')]) {
    const source = readFileSync(path.join(ROOT, file), 'utf-8');
    for (const match of source.matchAll(/data-tour="([^"]+)"/g)) found.add(match[1]);
  }
  return found;
}

describe('剧本锚点与页面 data-tour 双向对齐', () => {
  /**
   * 锚点是引导与界面之间唯一的隐式契约：`data-tour` 被改名或删掉时不会报错，
   * 只会让对应步骤在开场裁剪时静默消失——用户看到一条少了一步的引导，
   * 而类型检查与既有 i18n 守卫都察觉不到。两个方向都在这里钉死。
   */
  const anchors = scanTourAnchors();
  const scripted = TOUR_STEPS.map(step => step.anchor).filter((anchor): anchor is string => anchor !== null);

  it('剧本里的每个锚点在界面上都真实存在', () => {
    const missing = scripted.filter(anchor => !anchors.has(anchor));
    expect(missing, `以下 data-tour 锚点已不存在，对应步骤会静默消失: ${missing.join(', ')}`).toEqual([]);
  });

  it('界面上的每个锚点都被剧本认领', () => {
    const orphan = [...anchors].filter(anchor => !scripted.includes(anchor));
    expect(orphan, `以下 data-tour 没有任何步骤使用，属死标记: ${orphan.join(', ')}`).toEqual([]);
  });
});

/** 引导卡片自身 chrome 文案（非步骤派生），必须与 TOUR_STEPS 一起构成 onboarding 全集 */
const CHROME_KEYS = [
  'onboarding.kicker',
  'onboarding.skip',
  'onboarding.prev',
  'onboarding.next',
  'onboarding.finish',
  'onboarding.keyboardHint',
  'onboarding.progressAria',
  'onboarding.dotCurrent',
  'onboarding.dotJump',
  'onboarding.docsLead',
  'onboarding.docsGuide',
  'onboarding.docsOnline',
] as const;

/**
 * 步骤卡内「title / desc / tip 三件套」之外的附加文案（步骤 id → 键名后缀）
 *
 * 目前只有 `sidepanel` 有：卡内那颗动作按钮（`action`）与打开失败后的快捷键提示
 * （`shortcutHint`）。它们刻意不进 `tourKey()` 的 part 联合类型——组件里写成
 * `t('onboarding.sidepanel.action')` 这样的字面量，`i18nBundles.test.ts` 的静态扫描
 * 才提得到；动态拼出来的三件套扫描提不到，才由本文件逐条兜底。两种取词方式各守一头。
 */
const STEP_EXTRA_PARTS: Record<string, readonly string[]> = {
  sidepanel: ['action', 'shortcutHint'],
};

/** 某步骤的附加文案键名（`onboarding.<id>.<part>`） */
function extraKeysOf(id: string): string[] {
  return (STEP_EXTRA_PARTS[id] ?? []).map(part => `onboarding.${id}.${part}`);
}

describe('TOUR_STEPS 与 onboarding 语言包双向对齐', () => {
  it('每个步骤的 title / desc 在中英文里都非空', () => {
    for (const locale of LOCALES) {
      const messages = readOnboarding(locale);
      for (const step of TOUR_STEPS) {
        for (const part of ['title', 'desc'] as const) {
          const key = tourKey(step.id, part);
          expect(messages[key], `${locale} 缺少 ${key}，引导卡片会渲染裸 key`).toBeTruthy();
        }
      }
    }
  });

  it('卡内附加文案在中英文里都非空，且登记的步骤 id 真实存在', () => {
    const ids = new Set(TOUR_STEPS.map(step => step.id));
    expect(
      Object.keys(STEP_EXTRA_PARTS).every(id => ids.has(id)),
      '登记了剧本里没有的步骤',
    ).toBe(true);

    for (const locale of LOCALES) {
      const messages = readOnboarding(locale);
      for (const id of Object.keys(STEP_EXTRA_PARTS)) {
        for (const key of extraKeysOf(id)) {
          expect(messages[key], `${locale} 缺少 ${key}，卡内动作按钮会渲染裸 key`).toBeTruthy();
        }
      }
    }
  });

  it('tip 文案只在声明了 hasTip 的步骤上存在（不多不少）', () => {
    for (const locale of LOCALES) {
      const messages = readOnboarding(locale);
      for (const step of TOUR_STEPS) {
        const has = Object.prototype.hasOwnProperty.call(messages, tourKey(step.id, 'tip'));
        expect(has, `${locale} 的 ${step.id} ${step.hasTip ? '应有' : '不该有'} tip 文案`).toBe(!!step.hasTip);
      }
    }
  });

  it('语言包里的每个 key 都被剧本或 chrome 文案认领（防写下没人用的死文案）', () => {
    const stepKeys = new Set<string>();
    for (const step of TOUR_STEPS) {
      stepKeys.add(tourKey(step.id, 'title'));
      stepKeys.add(tourKey(step.id, 'desc'));
      if (step.hasTip) stepKeys.add(tourKey(step.id, 'tip'));
      for (const key of extraKeysOf(step.id)) stepKeys.add(key);
    }
    const owned = new Set<string>([...stepKeys, ...CHROME_KEYS]);

    for (const locale of LOCALES) {
      for (const key of Object.keys(readOnboarding(locale))) {
        expect(owned.has(key), `${locale}/onboarding.json 的 ${key} 不属于任何步骤或引导外框`).toBe(true);
      }
    }
  });

  it('占位符集合中英文一致（t() 只按名替换，单边改名会留下裸 {param}）', () => {
    const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    const zh = readOnboarding('zh-CN');
    const en = readOnboarding('en');
    for (const key of Object.keys(zh)) {
      expect(placeholders(en[key]), `${key} 的中英文占位符不一致`).toEqual(placeholders(zh[key]));
    }
  });
});

describe('引导期间的模态独占：命令面板不在幕布下开第二层', () => {
  /**
   * 引导自己声明 `aria-modal="true"` 并挂焦点陷阱，而面板的唤起挂在 `window` 的全局
   * keydown 上——两条链路互不经过，任何一侧改动都可能让「引导期间按 Ctrl/Cmd+K」重新
   * 开出一个藏在遮罩下、还在抢焦点的浮层。这种接线回退不报错、类型检查也看不见，
   * 所以在源码层钉死，并配一个负向对照（去掉门槛后判据必须不再命中）。
   */
  it('App.vue 的 canOpen 同时要求「已认证」「引导未激活」与「文档页未打开」', () => {
    const app = readFileSync(path.join(ROOT, 'entrypoints/options/App.vue'), 'utf-8');
    const gate = /canOpen: \(\) => isAuthenticated\.value && !tour\.isActive\.value && !guideActive\.value,/;

    expect(gate.test(app), 'App.vue 传给 useCommandPalette 的 canOpen 不再包含引导 / 文档页门槛').toBe(true);
    expect(app.replace('&& !tour.isActive.value', '')).not.toMatch(gate);
    expect(app.replace('&& !guideActive.value', '')).not.toMatch(gate);
  });
});

/**
 * 「打开侧边栏」这一步的卡内动作接线
 *
 * 本仓库的 vitest 管线（`WxtVitest()`）里没有 `@vitejs/plugin-vue`，项目 `.vue` 文件
 * 既不能 import 也挂载不起来：消息形状、失败降级这些**行为**只能在
 * `tests/composables/useOnboardingTour.dom.test.ts` 里测；而「模板有没有把那颗按钮接到
 * 这一步上」属于纯接线，删掉 `v-if`、换掉 `@click` 处理器、动效列表漏一项都不报错也不改
 * 类型，只能按上面 `canOpen` 那条的先例在文本层钉死。判据一律取「相邻两行」的写法，
 * 单个选择器换行位置被 prettier 挪动不会误红。
 */
describe('卡内动作按钮：接线固定在「打开侧边栏」这一步', () => {
  const cardSource = readFileSync(path.join(ROOT, 'components/options/OnboardingTour.vue'), 'utf-8');

  it('动作区按步骤 id 收口，其他步骤不渲染', () => {
    const gate = /v-if="isSidepanelStep"\s+class="tour__action"/;
    expect(gate.test(cardSource), '动作区不再按步骤 id 收口，会在每一步里常驻').toBe(true);
    expect(cardSource.replace('v-if="isSidepanelStep"', 'v-if="false"')).not.toMatch(gate);

    // 判定口径必须是步骤 id 常量，不能写死字符串——改 id 时类型层要跟着红
    expect(cardSource).toMatch(
      /const isSidepanelStep = computed\(\(\) => currentStep\.value\?\.id === SIDEPANEL_STEP_ID\);/,
    );
  });

  it('按钮点下去调 openSidePanel，文案取卡内动作 key', () => {
    expect(cardSource).toMatch(/@click="openSidePanel\(\)"/);
    expect(cardSource).toMatch(/\{\{ t\('onboarding\.sidepanel\.action'\) \}\}/);
  });

  it('打开失败后原位换成快捷键提示，按键真实读自 shortcuts 表', () => {
    expect(cardSource).toMatch(/v-if="!sidepanelFallback"/);
    expect(cardSource).toMatch(/v-else\s+class="tour__action-fallback"\s+role="status"/);
    expect(cardSource).toMatch(/\{\{ shortcutHint \}\}/);
    expect(cardSource).toMatch(
      /t\('onboarding\.sidepanel\.shortcutHint', \{ shortcut: shortcuts\.value\.toggle_sidepanel \}\)/,
    );
  });

  it('兜底文案换上去时把焦点收回卡片，模态陷阱不因此失效', () => {
    /**
     * 焦点陷阱的 Tab 监听挂在卡片容器上：按钮被 `v-if` 卸载后焦点掉回 `body`，
     * 那里的按键不会冒泡进容器，`aria-modal` 当场名存实亡。这行 `focus()` 是唯一防线。
     */
    expect(cardSource).toMatch(/if \(fallback\) cardEl\.value\?\.focus\(\{ preventScroll: true \}\);/);
  });

  it('卡内文案走文本节点，不引入 v-html', () => {
    // 引导文案来自语言包但仍属用户可见内容，渲染面保持纯文本
    expect(cardSource).not.toMatch(/v-html/);
  });

  it('入场错落与减弱动效两处列表都点名了动作区', () => {
    const mark = cardSource.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(mark, '组件不再含 prefers-reduced-motion 块').toBeGreaterThan(0);

    const before = cardSource.slice(0, mark);
    const reduced = cardSource.slice(mark);
    const pair = /\.tour__tip,\s*\n\s*\.tour__action,\s*\n\s*\.tour__meta/;

    expect(before, '动作区没跟着入场错落进场').toMatch(pair);
    expect(reduced, '动作区漏在减弱动效名单里').toMatch(pair);
    expect(before.replace('.tour__action,', '.tour__nothing,')).not.toMatch(pair);
  });

  it('动作区不复写色值：强调一律回到 --aph-primary 族', () => {
    const block = cardSource.slice(cardSource.indexOf('.tour__action {'), cardSource.indexOf('.tour__meta {'));
    expect(block.length).toBeGreaterThan(0);
    expect(block, '新增样式里出现写死色，换肤时不会跟随主题').not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(block).toMatch(/color: var\(--tour-accent\);/);
  });
});
