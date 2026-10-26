import { createEntry, expect, test } from './harness';
import { STORAGE_KEYS } from '../utils/storageKeys';

/**
 * 管理页头部在窄视口下的横向溢出守卫（评审报告 2026-10-26 未验证项 ① 的补做）
 *
 * 为什么必须有真机这一条：`.header-status` 写着 `flex-shrink: 0`，里面三枚控件
 * （备份徽标 / 会话徽标 / 一键锁定）都不换行，父行 `.header-title-row` 是 `flex-wrap: wrap`。
 * 「标题先换行、状态区整块挪到下一行」是设计意图；但**状态区自己有多宽**取决于文案长度——
 * 备份徽标 `critical` 档在英文态是长句，会话徽标随剩余时间变字，锁定按钮固定。
 * 源码层的判据（`tests/architecture/*`、骨架对齐断言）量不到像素，只有真实排版能回答
 * 「480px 宽的窗口里，这行会不会把页面顶出横向滚动条，或者把徽标切掉一半」。
 *
 * 全新 profile 走完首启即停在 `critical`（从未做过一次自检导出），正是这枚徽标最宽的那一档；
 * 语言在中英之间切换由 `chrome.storage.local` 的 `LOCALE` 驱动，管理页实时同步、无需重载文档。
 *
 * **2026-10-26 首跑实测**（Chrome for Testing 158，同一 profile 只落一条条目）：
 * 480px 与 640px 两档、中英两态全部通过——`scrollWidth === clientWidth`、状态区完整落在视口内、
 * 徽标文字未被裁切，报告里挂着的「未验证项 ①」到此核销。
 * 顺带量到一条**低于本守卫下限的真实缺陷**：320px 时状态区右缘 371px（zh）/ 419px（en），
 * 360px 同样越界，而 `scrollWidth` 仍等于 `clientWidth`——越界的部分不会给出横向滚动条，
 * 也就是看不见也够不着。试过只给 `.header-status` 加 `flex-wrap: wrap`：读数一字未变
 * （`flex-shrink: 0` 让这块永不被压窄，内部换行也就无从触发），说明真正的改法是让它能收缩或封顶，
 * 属窄屏布局变更，等用户拍板后再动，本守卫先钉住产品当前承诺的 480px 下限。
 */

/** 切换界面语言（与 `identity-vault-selectbar-density.spec.ts` 同一手法） */
const setLocale = (page: import('@playwright/test').Page, locale: 'zh-CN' | 'en'): Promise<void> =>
  page.evaluate(
    async payload => {
      await chrome.storage.local.set({ [payload.key]: payload.value });
    },
    { key: STORAGE_KEYS.LOCALE, value: locale },
  );

/** 头部相关容器的几何读数 + 页面是否出现横向溢出 */
const headerGeometry = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const doc = document.documentElement;
    const status = document.querySelector('.header-status');
    return {
      innerWidth: window.innerWidth,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      header: rect('.header'),
      titleRow: rect('.header-title-row'),
      status: rect('.header-status'),
      // 状态区内每枚控件的盒子与其文字盒：文字被裁（ellipsis / overflow hidden）时二者会分叉
      chips: [...(status?.children ?? [])].map(node => {
        const el = node as HTMLElement;
        const box = el.getBoundingClientRect();
        const label = el.querySelector('.backup-chip__text') ?? el.lastElementChild;
        const text = label?.getBoundingClientRect();
        return {
          cls: el.className.toString(),
          left: Math.round(box.left),
          right: Math.round(box.right),
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          width: Math.round(box.width),
          height: Math.round(box.height),
          textClipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
          textOverflowsBox: text ? Math.round(text.right) > Math.round(box.right) + 1 : false,
        };
      }),
    };
  });

for (const width of [320, 360, 480, 640]) {
  for (const locale of ['zh-CN', 'en'] as const) {
    test(`${width}px / ${locale}：头部不顶出横向滚动条，状态区内控件不被裁切`, async ({ optionsPage: page }) => {
      // 徽标在空库时是 hidden（没有数据可欠），而 `critical` 才是这行最宽的一档：
      // 先经表单落一条条目，让「从未备份」真的亮出来，否则下面量的是没有徽标的排版。
      await createEntry(page, { username: `narrow-${locale}`, password: 'synthetic-password' });
      await setLocale(page, locale);
      await page.setViewportSize({ width, height: 900 });
      // 文案随语言与档位变化，等一帧排版落定
      await expect
        .poll(() => headerGeometry(page).then(g => g.chips.length), `${locale} 态下状态区控件数`)
        .toBeGreaterThan(0);

      // 上一步 createEntry 留下的 `el-message` 从顶部居中滑出，会临时压住头部的某一枚控件；
      // 不等它散场，命中测试就会读到浮层而不是控件（同一轮里越靠后的宽度越容易「自己好了」）。
      await page
        .waitForFunction(() => !document.querySelector('.el-message'), null, { timeout: 15_000 })
        .catch(() => undefined);

      const g = await headerGeometry(page);

      // ① 页面不得出现横向溢出（溢出一像素也是溢出：窗口越窄，头部越先撞上）
      expect(
        g.scrollWidth,
        `横向溢出：scrollWidth ${g.scrollWidth} > clientWidth ${g.clientWidth}`,
      ).toBeLessThanOrEqual(g.clientWidth);
      // ② 状态区整体必须留在视口内——`flex-shrink: 0` 让它不压缩，只能整块换行
      expect(g.status!.left, `状态区左缘越出视口：${g.status!.left}`).toBeGreaterThanOrEqual(0);
      expect(g.status!.right, `状态区右缘越出视口：${g.status!.right} > ${g.innerWidth}`).toBeLessThanOrEqual(
        g.innerWidth,
      );
      /**
       * ③ 同一行内的控件不得互相压叠
       *
       * 只在垂直区间真的重叠时比左右缘：窄屏下状态区会折成多行（这正是 320/360 不丢按钮的前提），
       * 跨行比左右缘会把正常的换行读成「压叠」。
       */
      for (let i = 1; i < g.chips.length; i++) {
        const prev = g.chips[i - 1]!;
        const cur = g.chips[i]!;
        const sameRow = cur.top < prev.bottom && prev.top < cur.bottom;
        if (!sameRow) continue;
        expect(cur.left, `${cur.cls} 压到了 ${prev.cls} 上（${prev.cls} 右缘 ${prev.right}）`).toBeGreaterThanOrEqual(
          prev.right,
        );
      }
      // ④ 徽标文案不得被裁成省略号：档位含义（从未备份 / 待备份…）一旦看不见，
      //    「不只用颜色表达状态」这条可访问性前提就静默失效了
      for (const chip of g.chips) {
        expect(chip.textClipped, `${chip.cls} 的文字被裁切`).toBe(false);
        expect(chip.textOverflowsBox, `${chip.cls} 的文字溢出自己的盒子`).toBe(false);
      }
      /**
       * ⑤ 徽标与锁定按钮都在（少一枚说明窄屏下被 v-if 或 CSS 悄悄摘掉）
       *
       * 只钉这两枚是有意的：会话徽标受 `remainingText` 条件控制（有效期读数缺失时本就不该出现），
       * 把它写死会让守卫在合法的排版下变红。
       */
      const classes = g.chips.map(c => c.cls).join(' ');
      expect(classes, `状态区控件缺失：${JSON.stringify(g.chips.map(c => c.cls))}`).toContain('lock-btn');
      expect(classes, `备份徽标没出现，量不到最宽档：${JSON.stringify(g.chips.map(c => c.cls))}`).toContain(
        'backup-chip',
      );
      // ⑥ 语言确实切到了目标态（否则上面所有断言测的是另一种排版）
      const applied = await page.evaluate(
        key => chrome.storage.local.get(key).then(result => result[key]),
        STORAGE_KEYS.LOCALE,
      );
      expect(applied, `LOCALE 没落到 ${locale}，测的仍是另一种排版`).toBe(locale);
      // 徽标必须有字可读：空串意味着该语言下文案没渲染出来，上面四条会一起变成空转
      for (const chip of g.chips) {
        expect(chip.width, `${chip.cls} 宽度为 0，该语言下没渲染出来`).toBeGreaterThan(0);
      }
      /**
       * ⑦ 键盘必须能走到这枚徽标
       *
       * 它是 `<button>`，也是直达加密备份导出的入口；窄屏下只要它掉出 tab 序列或被前面的控件
       * 抢先，上面六条几何断言照样全绿，而用户看到的是「看得见按不到」。
       */
      let reached = false;
      for (let i = 0; i < 24 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() =>
          (document.activeElement?.getAttribute('class') ?? '').includes('backup-chip'),
        );
      }
      expect(reached, `${width}px / ${locale} 态下键盘走不到备份徽标`).toBe(true);

      /**
       * ⑧ 「立即锁定」必须真的点得到
       *
       * 这条是补测出来的缺陷留下的账：状态区原先写着 `flex-shrink: 0`，窗口 <420px 时这颗按钮
       * 整块被推出视口，而 `scrollWidth === clientWidth`——没有横向滚动条可以找回，用户失去的是
       * 离座前锁库的能力。中心点 `elementFromPoint` 命中它自己，才算「可达」，光看右缘数字不够。
       */
      const lockHit = await page.evaluate(() => {
        const el = document.querySelector('.lock-btn');
        if (!el) return { present: false };
        const b = el.getBoundingClientRect();
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        if (cx < 0 || cx >= window.innerWidth || cy < 0 || cy >= window.innerHeight) {
          return {
            present: true,
            inside: false,
            hit: false,
            right: Math.round(b.right),
            innerWidth: window.innerWidth,
          };
        }
        const h = document.elementFromPoint(cx, cy);
        return {
          present: true,
          inside: b.right <= window.innerWidth + 0.5,
          hit: !!h && (h === el || el.contains(h) || h.contains(el)),
          right: Math.round(b.right),
          innerWidth: window.innerWidth,
        };
      });
      expect(lockHit.present, `${width}px / ${locale} 下找不到「立即锁定」`).toBe(true);
      expect(lockHit.inside, `「立即锁定」右缘 ${lockHit.right} 越出 ${lockHit.innerWidth} 视口`).toBe(true);
      expect(lockHit.hit, `${width}px / ${locale} 下「立即锁定」中心点命中不到自己`).toBe(true);
    });
  }
}
