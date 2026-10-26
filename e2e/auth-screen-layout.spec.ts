import type { Page } from '@playwright/test';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { MASTER_PASSWORD, createEntry, expect, test } from './harness';
import { textOf } from './i18n';

/**
 * 认证屏（首次设置 / 解锁）与主内容区的版式回归
 *
 * 这一组用例守的都是「肉眼在小屏上才发现、机器在标准视口下永远看不见」的形状缺陷，
 * 全部按盒模型读数判定，不依赖截图比对：
 *
 * 1. **整屏容器不得裁切内容**。`MasterPasswordSetupView` / `PasswordVerifyView` 曾用
 *    `height:100vh + align-items:center + overflow:hidden`，内容比视口高时上下两端各溢出约一半，
 *    而 hidden 让两端都不可达——真机读数：设置页卡片恒高 856px，1112×628 溢出 165px，
 *    页面标题 top = −149（整块在屏幕外）、安全声明 bottom = 736（被切一半），连 1440×800 也溢出 79px。
 *    现在改走 flex 子项 `margin:auto` 安全居中，判据变成「顶部不被推出屏幕 + 底部一定滚得到」。
 * 2. **错误行与提示语行不得挤在同一行**。父级 `.el-form-item__content` 被 EP 定成
 *    `display:flex; flex-wrap:wrap`，两块 div 不占满行宽时会被并排塞进一行。中文态合计 268px
 *    < 350px 可用宽 → 两句拼成一句读；英文态 369px 反而自动折行。也就是说这个缺陷跟语言包走，
 *    只在中文态暴露——所以判据必须同时钉住「不同行」和「各自占满行宽」。
 * 3. **主内容区的色块共用一条左右基线**。备份提醒卡片曾只写 `margin-bottom`，是全页唯一
 *    贴视口边缘通栏铺开的色块。
 * 4. **新手引导的卡片不得被视口切掉**，也不得把底部按钮挤到折行——**中英两态各跑一遍**。
 *    卡片高度按语言变（中文每行约 26 字、英文约 55 字符），只测一种语言等于给
 *    「文案再写长一点」装了免检，而引导文案恰恰是改得最勤的那一类。
 *
 * 逃生出口那一行的两条判据（两枚按钮不折行、首枚文字与主按钮同基线、向导让位给恢复弹窗）
 * 需要「本机已登记恢复密钥」这个现场，只有 `e2e/offline-recovery.spec.ts` 已经付得起那次
 * PBKDF2，因此钉在那里，不在本文件重复造一遍状态。
 */

/** 小屏笔记本候选视口：常见分辨率扣掉浏览器工具栏后的可视高 */
const SMALL_VIEWPORTS = [
  { label: '1112x628', width: 1112, height: 628 },
  { label: '1280x660', width: 1280, height: 660 },
  { label: '1440x800', width: 1440, height: 800 },
];

/** 量某个整屏容器：滚到顶时头部是否在屏内、滚到底时尾部是否在屏内 */
async function measureClipping(page: Page, rootSelector: string, headSelector: string, tailSelector: string) {
  return page.evaluate(
    async args => {
      const root = document.querySelector<HTMLElement>(args.rootSelector);
      const head = document.querySelector<HTMLElement>(args.headSelector);
      const tail = document.querySelector<HTMLElement>(args.tailSelector);
      if (!root || !head || !tail) return { missing: `${args.rootSelector}/${args.headSelector}/${args.tailSelector}` };

      const raf = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      // 判据是「两端都滚得到」，不是「一次摆全」：内容比视口高时必然要滚，
      // 缺陷的形状是 `overflow:hidden` 让溢出的一端根本滚不到。
      window.scrollTo(0, 0);
      root.scrollTop = 0;
      await raf();
      const headTop = Math.round(head.getBoundingClientRect().top);

      window.scrollTo(0, document.documentElement.scrollHeight);
      root.scrollTop = root.scrollHeight;
      await raf();
      const tailBottom = Math.round(tail.getBoundingClientRect().bottom);

      return { viewportHeight: innerHeight, headTop, tailBottom };
    },
    { rootSelector, headSelector, tailSelector },
  );
}

/**
 * 量「标题是否真的居中」与「文档是否白多出一条滚动条」。
 *
 * 两条都是量出来才发现的：
 * - 标题居中：`.logo-section` 是 flex 行，把「图标 + 文字」整组居中，于是文字中心落在
 *   组中心右侧半个图标位（图标 32px + 间距 10px → 21px），而副标题是整行居中。
 *   两行中心差 21px，肉眼读出来就是「标题没居中」。判据只能比 h1 与卡片的中心 x。
 * - 幽灵滚动条：`min-height:100vh` 配 `padding:16px` 而缺 `box-sizing:border-box` 时，
 *   盒子实际高 = 100vh + 32px，于是**内容放得下也照样出滚动条**（真机 628 视口
 *   docScroll = 660，而内容本身只有 582px）。
 */
async function measureAlignment(page: Page, headerSel: string, cardSel: string) {
  return page.evaluate(
    args => {
      const h1 = document.querySelector<HTMLElement>(`${args.headerSel} h1`);
      const sub = document.querySelector<HTMLElement>(`${args.headerSel} .subtitle`);
      const card = document.querySelector<HTMLElement>(args.cardSel);
      if (!h1 || !sub || !card) return null;
      const cx = (el: HTMLElement) => {
        const b = el.getBoundingClientRect();
        return b.left + b.width / 2;
      };
      const cardCx = cx(card);
      return {
        h1Offset: Math.round(cx(h1) - cardCx),
        subtitleOffset: Math.round(cx(sub) - cardCx),
        docScroll: document.documentElement.scrollHeight,
        docClient: document.documentElement.clientHeight,
      };
    },
    { headerSel, cardSel },
  );
}

/** 关掉首次进入自动播放的新手引导（聚光层会吃掉所有点击） */
async function dismissTour(page: Page): Promise<void> {
  await page.evaluate(
    async key => chrome.storage.local.set({ [key]: { seen: true, outcome: 'skipped', finishedAt: Date.now() } }),
    STORAGE_KEYS.ONBOARDING_TOUR,
  );
  const skip = page.locator('.tour__btn--ghost');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.locator('.tour')).toBeHidden({ timeout: 10_000 });
}

/** 走 UI 清除会话，把管理页带回锁定态 */
async function lockSession(page: Page): Promise<void> {
  await page.locator('.session-chip').click();
  const validity = page.getByRole('dialog').filter({ hasText: textOf('options.validity.title') });
  await expect(validity).toBeVisible();
  await validity.getByRole('button', { name: textOf('options.validity.clearSession') }).click();
  await page
    .locator('.el-message-box')
    .getByRole('button', { name: textOf('session.clearConfirmBtn') })
    .click();
  await expect(page.getByRole('button', { name: textOf('auth.verifySubmit') })).toBeVisible({ timeout: 30_000 });
}

/** 在已解锁的管理页设置主密码提示语（不需要当前主密码） */
async function setMasterPasswordHint(page: Page, hint: string): Promise<void> {
  await page.getByRole('button', { name: textOf('options.header.securitySettings') }).click();
  await page.getByRole('menuitem', { name: textOf('options.header.hint') }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.hint.title') });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder(textOf('options.hint.placeholder')).fill(hint);
  await dialog.getByRole('button', { name: textOf('common.saveSettings') }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** 全新 profile 走完「设置主密码」，把管理页带到已解锁态 */
async function setupMasterPassword(page: Page): Promise<void> {
  await page.getByPlaceholder(textOf('auth.setupPasswordPlaceholder')).fill(MASTER_PASSWORD);
  await page.getByPlaceholder(textOf('auth.confirmPasswordPlaceholder')).fill(MASTER_PASSWORD);
  await page.getByRole('button', { name: textOf('auth.setupSubmit') }).click();
  await expect(page.locator('.header-title h1')).toBeVisible({ timeout: 60_000 });
}

test.describe('认证屏与主内容区版式', () => {
  test('首次设置主密码页：任何小屏视口都不把标题与安全声明推出屏幕', async ({ extContext, extensionId }) => {
    test.setTimeout(120_000);
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.setup-page')).toBeVisible({ timeout: 30_000 });

    for (const vp of SMALL_VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);
      const m = await measureClipping(page, '.setup-page', '.setup-header', '.disclaimer-compact');
      expect(m, `${vp.label} 量不到元素`).not.toHaveProperty('missing');
      const { headTop, tailBottom, viewportHeight } = m as Awaited<ReturnType<typeof measureClipping>>;
      // 居中溢出是这个缺陷的形状：上端先消失，所以 top 为负就是被裁
      expect(headTop, `${vp.label} 页面标题被推出屏幕上方`).toBeGreaterThanOrEqual(0);
      expect(tailBottom, `${vp.label} 滚到底后安全声明仍不可达`).toBeLessThanOrEqual(viewportHeight + 1);
    }

    // 密码强度气泡在窄屏必须留在视口内：旧实现固定 placement="right"，320px 时把
    // 文档撑到 511px，横向滚动条恰好出现在第一次设置主密码的页面。
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(300);
    await page.getByPlaceholder(textOf('auth.setupPasswordPlaceholder')).focus();
    await page.waitForTimeout(300);
    const horizontal = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      horizontal.scrollWidth,
      `窄屏聚焦密码框后出现横向滚动（${horizontal.scrollWidth} > ${horizontal.clientWidth}）`,
    ).toBeLessThanOrEqual(horizontal.clientWidth + 1);
    await page.locator('.setup-header').click();
    await page.waitForTimeout(200);

    await page.setViewportSize({ width: 1440, height: 800 });
    await page.waitForTimeout(300);
    const align = await measureAlignment(page, '.setup-header', '.form-card');
    expect(align, '量不到设置页标题').not.toBeNull();
    const a = align as NonNullable<typeof align>;
    expect(a.h1Offset, `设置页标题中心偏离卡片中心 ${a.h1Offset}px`).toBeLessThanOrEqual(1);
    expect(a.subtitleOffset, '设置页副标题没居中').toBeLessThanOrEqual(1);
  });

  test('解锁页：错误行与提示语各占一行，提示语当场收得起来', async ({ extContext, extensionId }) => {
    test.setTimeout(240_000);
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.setup-page')).toBeVisible({ timeout: 30_000 });

    await setupMasterPassword(page);
    await dismissTour(page);
    await setMasterPasswordHint(page, '最喜欢的数字和符号组合');
    await lockSession(page);

    // 连错到阈值，让错误行与提示语条同时在场。
    // 多给几次：写提示语会短暂持有库锁，撞上 `VAULT_BUSY` 的那一次不算输错、不计数，
    // 只按 3 次写会把用例做成一个随机红（阈值本身由 `MAX_FAIL_BEFORE_HINT` 定义，这里不放宽判据）。
    await page.waitForTimeout(1_500);
    const input = page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).first();
    for (let i = 0; i < 6; i++) {
      if (
        await page
          .locator('.verify-hint-inline')
          .isVisible()
          .catch(() => false)
      )
        break;
      await input.fill('WrongBut!Formatted1');
      await page.getByRole('button', { name: textOf('auth.verifySubmit') }).click();
      await expect(page.locator('.verify-error-inline')).toBeVisible();
      await page.waitForTimeout(400);
    }
    await expect(page.locator('.verify-hint-inline'), '连错到阈值后提示语条没有出现').toBeVisible();

    const rows = await page.evaluate(() => {
      const err = document.querySelector<HTMLElement>('.verify-error-inline');
      const hint = document.querySelector<HTMLElement>('.verify-hint-inline');
      if (!err || !hint) return null;
      const eb = err.getBoundingClientRect();
      const hb = hint.getBoundingClientRect();
      return {
        errY: Math.round(eb.y),
        hintY: Math.round(hb.y),
        errWidth: Math.round(eb.width),
        hintWidth: Math.round(hb.width),
        contentWidth: Math.round((err.parentElement as HTMLElement).getBoundingClientRect().width),
      };
    });
    expect(rows, '错误行与提示语条没都在 DOM 里').not.toBeNull();
    const r = rows as NonNullable<typeof rows>;

    expect(r.hintY, '提示语条与错误行挤在同一行（中文态合计小于可用行宽时必现）').toBeGreaterThan(r.errY);
    expect(r.errWidth, '错误行没占满行宽，仍可能被 flex 并排塞走').toBeGreaterThan(r.contentWidth - 2);
    expect(r.hintWidth, '提示语条没占满行宽，同上').toBeGreaterThan(r.contentWidth - 2);

    // 「收起」是这条信息条的隐私出口：提示语明文躺在本机，旁人窥屏时要能当场收掉。
    // 收起后内容必须真的从屏上消失（不是只变颜色），且能再展开回来。
    const hintText = page.locator('.verify-hint-inline__text');
    await expect(hintText).toHaveText('最喜欢的数字和符号组合');
    await page.locator('.verify-hint-inline__toggle').click();
    await expect(hintText).toHaveCount(0);
    await page.locator('.verify-hint-inline__toggle').click();
    await expect(hintText).toHaveText('最喜欢的数字和符号组合');

    // 700 视口下错误行与提示语条都在场（最坏情况），仍不该出现滚动条。
    // 上一版这里恒定多 32px：`min-height:100vh` 加了上下 16px padding 却没配 `box-sizing`。
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.waitForTimeout(300);
    const align = await measureAlignment(page, '.verify-header', '.form-card');
    expect(align, '量不到解锁页标题').not.toBeNull();
    const a = align as NonNullable<typeof align>;
    expect(a.h1Offset, `解锁页标题中心偏离卡片中心 ${a.h1Offset}px`).toBeLessThanOrEqual(1);
    expect(a.subtitleOffset, '解锁页副标题没居中').toBeLessThanOrEqual(1);
    expect(
      a.docScroll,
      `内容放得下却多出 ${a.docScroll - a.docClient}px 滚动条（padding 没配 border-box 的幽灵高度）`,
    ).toBeLessThanOrEqual(a.docClient);

    // 「忘记密码」钉在行尾时，文字右缘要压到行的右边缘（= 卡片内容边）。
    // 真机量到按钮盒本来就在 815，但 link 按钮那 8px 右内边距让文字差一口气。
    const rightEdge = await page.evaluate(() => {
      const actions = document.querySelector<HTMLElement>('.verify-actions');
      const last = actions?.querySelector<HTMLElement>('.el-button:last-child');
      if (!actions || !last) return null;
      const range = document.createRange();
      range.selectNodeContents(last);
      return {
        rowRight: Math.round(actions.getBoundingClientRect().right),
        textRight: Math.round(range.getBoundingClientRect().right),
      };
    });
    expect(rightEdge, '量不到动作行末枚按钮').not.toBeNull();
    const edge = rightEdge as NonNullable<typeof rightEdge>;
    expect(edge.textRight - edge.rowRight, '末枚按钮文字右缘没贴到行右缘').toBeLessThanOrEqual(1);

    // 找回向导在窄屏必须完整落在视口内；它曾固定 620px，320px 下右侧按钮与 X 被推到横向滚动区。
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: textOf('auth.forgotPassword') }).click();
    const forgot = page.getByRole('dialog').filter({ hasText: textOf('options.forgot.title') });
    await expect(forgot).toBeVisible();
    const forgotDialog = page.locator('.el-dialog').filter({ hasText: textOf('options.forgot.title') });
    await expect(forgotDialog).toBeVisible();
    const forgotBox = await forgotDialog.evaluate(el => {
      const box = el.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(forgotBox, '量不到找回向导').not.toBeNull();
    const box = forgotBox as NonNullable<typeof forgotBox>;
    expect(box.left, '找回向导左侧越出视口').toBeGreaterThanOrEqual(0);
    expect(box.right, '找回向导右侧越出视口').toBeLessThanOrEqual(box.innerWidth + 1);
    expect(box.scrollWidth, '找回向导把文档撑出了横向滚动').toBeLessThanOrEqual(box.innerWidth + 1);
    await forgot.getByRole('button', { name: textOf('common.cancel') }).click();
    await expect(forgot).toBeHidden();

    // 整屏不裁切这条对解锁页同样成立
    for (const vp of SMALL_VIEWPORTS.slice(0, 2)) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);
      const m = await measureClipping(page, '.verify-page', '.verify-header', '.disclaimer-compact');
      const { headTop, tailBottom, viewportHeight } = m as Awaited<ReturnType<typeof measureClipping>>;
      expect(headTop, `${vp.label} 解锁页标题被推出屏幕上方`).toBeGreaterThanOrEqual(0);
      expect(tailBottom, `${vp.label} 滚到底后安全声明仍不可达`).toBeLessThanOrEqual(viewportHeight + 1);
    }
  });

  test('备份提醒卡片与搜索条、密码列表共用一条左右基线', async ({ optionsPage }) => {
    test.setTimeout(180_000);
    const page = optionsPage;
    await createEntry(page, { username: 'layout-nudge@qa.test', password: 'Synthetic!Layout1' });

    // 清单在场时横幅被互斥掉（同一件事不说两遍），先「暂不提醒」
    const checklist = page.locator('.activation');
    if (await checklist.isVisible().catch(() => false)) {
      await checklist.getByRole('button', { name: textOf('options.activation.dismiss') }).click();
      await expect(checklist).toBeHidden();
    }

    const nudge = page.locator('.backup-nudge');
    await expect(nudge, '从未备份时备份提醒横幅应当出现').toBeVisible({ timeout: 15_000 });

    for (const vp of [
      { label: '1440', width: 1440, height: 900 },
      { label: '700', width: 700, height: 900 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const inset = (sel: string) => {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { left: Math.round(b.left), right: Math.round(innerWidth - b.right) };
        };
        return { nudge: inset('.backup-nudge'), filters: inset('.filters'), table: inset('.password-list') };
      });
      expect(m.nudge, `${vp.label} 量不到备份提醒卡片`).not.toBeNull();
      const n = m.nudge as { left: number; right: number };
      // 通栏铺开（left/right 归零）就是原缺陷：它是这一屏唯一没缩进的色块
      expect(n.left, `${vp.label} 备份提醒卡片左边缘贴到了视口边`).toBeGreaterThan(0);
      expect(n.left, `${vp.label} 与搜索条左基线不一致`).toBe(m.filters?.left);
      expect(n.right, `${vp.label} 与搜索条右基线不一致`).toBe(m.filters?.right);
      expect(n.left, `${vp.label} 与密码列表左基线不一致`).toBe(m.table?.left);
    }
  });

  test('新手引导：中英两态每一步的卡片都完整落在视口内，底部按钮不折行', async ({ extContext, extensionId }) => {
    test.setTimeout(300_000);
    const url = `chrome-extension://${extensionId}/options.html`;

    // 卡片高度是按语言变的（中文每行约 26 字、英文约 55 字符，同一句话行数不同），
    // 只测一种语言等于给「文案再写长一点」装了免检。两态都跑一遍。
    for (const [locale, kicker] of [
      ['zh-CN', '新手引导'],
      ['en', 'Getting started'],
    ] as const) {
      const page = await extContext.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      // 同一个 `extContext` 共用一份 profile，`chrome.storage.local` 也是共用的：
      // 第二轮不先清库就会停在解锁页而不是设置页，测的就不是同一件事了。
      await page.evaluate(async () => {
        await chrome.storage.local.clear();
      });
      // 镜像键与 storage 键同名，但 `initI18n` 先读同步镜像并提前返回，
      // 只写 `chrome.storage.local` 会被上一轮的镜像盖掉，所以两处一起写。
      await page.evaluate(
        async args => {
          globalThis.localStorage.setItem(args.key, args.locale);
          await chrome.storage.local.set({ [args.key]: args.locale });
        },
        { key: STORAGE_KEYS.LOCALE, locale },
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.setup-page'), `${locale} 清库后应回到设置主密码页`).toBeVisible({ timeout: 30_000 });

      await setupMasterPassword(page);
      const tour = page.locator('.tour');
      await expect(tour, `${locale} 首次进入认证态应自动播放新手引导`).toBeVisible({ timeout: 30_000 });
      // 语言没切过去，下面两轮就是在量同一套文案，白跑
      await expect(page.locator('.tour__kicker'), `${locale} 界面语言没切过去`).toHaveText(kicker);

      for (const vp of [
        { label: '1280x660', width: 1280, height: 660 },
        { label: '1024x600', width: 1024, height: 600 },
      ]) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (let step = 0; step < 12; step++) {
          if (!(await tour.isVisible().catch(() => false))) break;
          await page.waitForTimeout(600);
          const m = await page.evaluate(() => {
            const card = document.querySelector<HTMLElement>('.tour__card');
            const foot = document.querySelector<HTMLElement>('.tour__foot');
            if (!card || !foot) return null;
            const b = card.getBoundingClientRect();
            const ys = [...foot.querySelectorAll<HTMLElement>('.tour__btn')].map(el =>
              Math.round(el.getBoundingClientRect().y),
            );
            return {
              top: Math.round(b.top),
              bottom: Math.round(b.bottom),
              viewportHeight: innerHeight,
              footRows: new Set(ys).size,
              buttonCount: ys.length,
            };
          });
          expect(m, `${locale} ${vp.label} 第 ${step + 1} 步量不到引导卡片`).not.toBeNull();
          const c = m as NonNullable<typeof m>;
          expect(c.top, `${locale} ${vp.label} 第 ${step + 1} 步卡片被切掉上沿`).toBeGreaterThanOrEqual(0);
          expect(c.bottom, `${locale} ${vp.label} 第 ${step + 1} 步卡片被切掉下沿`).toBeLessThanOrEqual(
            c.viewportHeight + 1,
          );
          expect(c.footRows, `${locale} ${vp.label} 第 ${step + 1} 步底部按钮折行`).toBe(1);

          const next = page.locator('.tour__foot .tour__btn--primary');
          if (!(await next.isVisible().catch(() => false))) break;
          await next.click();
        }
      }
      await page.close();
    }
  });
});
