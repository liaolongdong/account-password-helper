/**
 * 扩展 E2E 夹具：真实 Chrome + 已加载的 MV3 包
 *
 * 三件事决定了这套测试能不能信：
 * 1. 被测页面必须来自 `chrome-extension://<id>/...`，`chrome.*` 才存在（dev server 的
 *    http 源下扩展根本没被加载，任何等待都是空等）；
 * 2. 扩展只能通过 `--load-extension` 在持久化上下文里加载，且必须用**独立 userDataDir**，
 *    绝不触碰开发者日常 Chrome 的 profile；
 * 3. 用例之间共享同一份 `storage.local`，因此每个用例都跑在**全新临时 profile** 上，
 *    并只操作 `*.e2e.test` 这类保留域名，避免污染真实数据。
 */
import { chromium, expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EXTENSION_PATH } from './global-setup';
import { textOf } from './i18n';

/**
 * 主密码只在测试 profile 内使用，不对应任何真实凭据
 *
 * 必须是这种「一次性合成品」：`fill()` 的入参会进 Playwright trace，CI 失败时
 * `test-results/` 作为产物上传（见 `.github/workflows/e2e.yml`），换成真实口令就等于把它发布出去。
 */
export const MASTER_PASSWORD = 'E2eOnly!Passw0rd';

/** 内容脚本测试用的保留域名页面：请求被 route 直接 fulfill，不出网、不依赖 DNS */
export const E2E_PAGE_ORIGIN = 'https://site-rules.e2e.test';

/**
 * 侧边栏 / 填充用例的假站点登录页
 *
 * 只放一组最「常规」的字段（`name=username` + `type=password`）：内容脚本的启发式
 * 必然命中，填充结果能直接从输入框的 value 读回来，是跨入口链路唯一的观测口。
 */
const LOGIN_PAGE_HTML = `<!doctype html><html><head><title>e2e login</title></head><body>
  <form><input id="login-username" name="username"><input id="login-password" type="password"></form>
</body></html>`;

type ExtensionFixtures = {
  /** 加载了本扩展的持久化上下文（每个用例一份全新 profile） */
  extContext: BrowserContext;
  /** 当前加载包的 ID */
  extensionId: string;
  /** 已打开并完成解锁的密码管理页 */
  optionsPage: Page;
};

/** 构造一个带扩展的持久化上下文；无头模式沿用 Chrome 新无头（扩展在其中可用） */
async function launchExtensionContext(): Promise<{ context: BrowserContext; userDataDir: string }> {
  if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`扩展产物不存在：${EXTENSION_PATH}（请先 pnpm build 或去掉 E2E_SKIP_BUILD）`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aph-e2e-profile-'));
  // `--load-extension` 只对 Chromium 系构建有效：品牌版 Google Chrome 自 135 起直接忽略该开关
  // （实测 Chrome 152 加 --enable-unsafe-extension-debugging 也不会加载），因此优先接受
  // E2E_EXECUTABLE_PATH 指定的 Chromium / Chrome for Testing，未指定时才退回 channel: 'chrome'。
  const executablePath = process.env.E2E_EXECUTABLE_PATH;
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: process.env.E2E_CHANNEL || 'chrome' }),
    headless: process.env.E2E_HEADLESS !== '0',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
    ],
  });
  return { context, userDataDir };
}

/** 取扩展 ID：MV3 的 Service Worker URL 主机名即 ID，冷启动时可能要等它注册 */
async function resolveExtensionId(context: BrowserContext): Promise<string> {
  const existing = context.serviceWorkers()[0];
  if (existing) return new URL(existing.url()).host;
  try {
    const worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    return new URL(worker.url()).host;
  } catch {
    throw new Error(
      '扩展 Service Worker 未注册 = Chrome 根本没有加载 .output/chrome-mv3。' +
        '排查顺序：① 不能用品牌版 Google Chrome（≥135 忽略 --load-extension），' +
        '设 E2E_EXECUTABLE_PATH 指向 Playwright Chromium 或 Chrome for Testing；' +
        '② macOS 13 不在 Playwright 的 chromium 分发矩阵内，可手动取 Chrome for Testing ' +
        '并把 E2E_EXECUTABLE_PATH 指向它（命令见 e2e/README.md）；③ 用 E2E_HEADLESS=0 观察窗口里的实际报错。',
    );
  }
}

export const test = base.extend<ExtensionFixtures>({
  // Playwright 强制 fixture 工厂的第一参数使用解构写法，本夹具不依赖任何内置 fixture，
  // 因此空模式是它的正确形式（改成 `(_, use)` 会直接抛 "must use the object destructuring pattern"）。
  // eslint-disable-next-line no-empty-pattern
  extContext: async ({}, use) => {
    const { context, userDataDir } = await launchExtensionContext();
    try {
      await use(context);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },

  extensionId: async ({ extContext }, use) => {
    await use(await resolveExtensionId(extContext));
  },

  optionsPage: async ({ extContext, extensionId }, use) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
    await onboardAndUnlock(page);
    await use(page);
  },
});

export { expect };

/**
 * 走完首次安装 / 锁屏两种入口，把管理页带到已解锁态
 *
 * 全新 profile 必然停在「设置主密码」，锁定态停在「输入主密码」，两者的输入框
 * placeholder 前缀相同，故先按提交按钮区分场景。
 *
 * 必须先等首屏落到三种确定状态之一再判分支：`domcontentloaded` 只保证 HTML 到位，
 * Vue mount 与其后的文案渲染还没发生，两次 `isVisible()` 会都拿到 false 而静默返回，
 * 把未解锁的页面交给用例——表现为下一条用例在 20s 动作超时里等一个不存在的按钮。
 * 末尾的断言把这种静默失败收口成「夹具没带你到已解锁态」这一条明确错误。
 */
export async function onboardAndUnlock(page: Page): Promise<void> {
  const unlockedHeader = page.locator('.header-title h1');
  const setupSubmit = page.getByRole('button', { name: textOf('auth.setupSubmit') });
  const verifySubmit = page.getByRole('button', { name: textOf('auth.verifySubmit') });
  const passwordInput = page.getByPlaceholder(textOf('auth.setupPasswordPlaceholder')).first();
  const confirmInput = page.getByPlaceholder(textOf('auth.confirmPasswordPlaceholder')).first();
  const verifyInput = page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).first();

  await expect(unlockedHeader.or(setupSubmit).or(verifySubmit).first()).toBeVisible({ timeout: 30_000 });

  if (await setupSubmit.isVisible().catch(() => false)) {
    await passwordInput.fill(MASTER_PASSWORD);
    await confirmInput.fill(MASTER_PASSWORD);
    await setupSubmit.click();
  } else if (await verifySubmit.isVisible().catch(() => false)) {
    await verifyInput.fill(MASTER_PASSWORD);
    await verifySubmit.click();
  }

  await expect(unlockedHeader).toBeVisible({ timeout: 30_000 });
}

/**
 * 走 HeaderBar 的「添加密码」录一条条目，并等到成功提示与弹窗关闭
 *
 * 条目在库里是密文，测试进程没有解密入口，所以前置条件一律经表单完成——
 * 走 storage 后门既造不出「已解锁会话下的条目」，也验证不到加解密链路；
 * 顺带让「新增」本身就是这条用例的第一次断言。
 */
export async function createEntry(
  page: Page,
  entry: { username: string; password?: string; url?: string; remark?: string },
): Promise<void> {
  await page.getByRole('button', { name: textOf('options.header.addPassword') }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder(textOf('options.form.usernamePlaceholder')).fill(entry.username);
  if (entry.password !== undefined) {
    await dialog.getByPlaceholder(textOf('options.form.passwordPlaceholder')).fill(entry.password);
  }
  if (entry.url !== undefined) {
    await dialog.getByPlaceholder(textOf('options.form.urlPlaceholder')).fill(entry.url);
  }
  if (entry.remark !== undefined) {
    await dialog.getByPlaceholder(textOf('options.form.remarkPlaceholder')).fill(entry.remark);
  }

  await expectSuccessToastFor(page, 'form.addSuccess', () => footerPrimary(dialog).click());
  await expect(dialog).toBeHidden();
}

/**
 * 断言「某个具体动作」的成功提示出现了
 *
 * 不能写成 `locator('.el-message--success')`：`ElMessage` 会把相邻动作的提示叠放，
 * 解锁主密码的 3s 提示经常还活着，类名选择器一次命中两个节点，直接撞 Playwright
 * strict mode 而误判失败（实测 3 个用例全栽在这里，而被测功能其实是对的）。
 * 按文案过滤同时把断言从「有个绿条」收紧成「绿条说的是这件事」。
 *
 * 只适用于「同一条文案在本用例里最多出现一次」的场合；连做两次同种动作
 * （比如连续录入两条账号）时它仍会命中两个节点，那种流程改用
 * {@link expectSuccessToastFor}。
 */
export async function expectSuccessToast(page: Page, key: string): Promise<void> {
  await expect(toast(page, key)).toBeVisible();
}

/**
 * 执行动作并断言「这一次」弹出了指定成功提示
 *
 * 同文案提示会在 3s 内叠放，所以既不能按 `.last()` 存在性断言（上一条残留会冒充本次反馈），
 * 也不能「先数、后动、再要求条数变多」：快照数里的旧提示随时会过期，动作耗时一旦超过它们的
 * 剩余寿命，计数只会 `3 → 1`，永远超不过快照值——实测「录入其实成功、库里也多了条目」
 * 却被报成「没有出现新的提示」，机器负载高时随机红、空闲时恰好绿（真机第二轮 2 条红灯即此）。
 *
 * 因此把基线归零：先等上一条同文案提示自然散场（ElMessage 默认 3s），再执行动作。
 * 此后出现的任何一条同文案提示都只可能来自本次动作，判据与旧提示的过期时刻再无关系。
 * 连续同种动作（例如逐条录入账号）每次最多多等约 3 秒，这是确定性的代价。
 */
export async function expectSuccessToastFor(page: Page, key: string, action: () => Promise<void>): Promise<void> {
  const alerts = page.getByRole('alert').filter({ hasText: textOf(key) });
  await expect(alerts).toHaveCount(0);
  await action();
  await expect.poll(async () => alerts.count(), { message: `动作后没有出现「${key}」提示` }).toBeGreaterThan(0);
}

/**
 * 走完全局「验证主密码」弹窗
 *
 * 导出、改主密码、调有效期、看回收站都会弹这个框。按提示文案定位而不是取
 * `getByRole('dialog').first()`：同屏可能还留着上一个已关闭弹窗的隐藏节点，
 * 而提示文本是每个入口唯一的。验证失败时弹窗不会关闭，因此以关闭为成功信号。
 */
export async function verifyMasterPassword(page: Page, promptKey: string): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: textOf(promptKey) });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).fill(MASTER_PASSWORD);
  await footerPrimary(dialog).click();
  await expect(dialog).toBeHidden();
}

/**
 * 读 `storage.local` 里的非敏感配置项
 *
 * 只用于设置类键名（有效期、收藏上限、开关配置等）。密码与回收站这类密文键请走
 * 计数类断言，别把整份数据带回测试进程——它会出现在失败输出与 trace 里。
 */
export async function readStoredConfig(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async storageKey => {
    const stored = (await chrome.storage.local.get(storageKey)) as Record<string, unknown>;
    return stored[storageKey] ?? null;
  }, key);
}

/**
 * 只取数组键的条数
 *
 * 密码列表、回收站、密码历史在库里都是密文，断言「有几条」就足够说明问题，
 * 把整份数据带回测试进程只会让它出现在失败输出与 trace 里。
 */
export async function storedArrayCount(page: Page, key: string): Promise<number> {
  return page.evaluate(async storageKey => {
    const stored = (await chrome.storage.local.get(storageKey)) as Record<string, unknown>;
    return Array.isArray(stored[storageKey]) ? (stored[storageKey] as unknown[]).length : 0;
  }, key);
}

/**
 * 明文是否真的没有落盘（at-rest 密文不变量）
 *
 * 判定在扩展页面上下文里完成，只回布尔值：把整份密文带回 Node 会进 trace 与断言产物，
 * 而这条断言要证的恰恰是「原文不在里面」，无需暴露密文本身。
 */
export async function leaksPlaintext(page: Page, storageKey: string, plaintext: string): Promise<boolean> {
  return page.evaluate(async args => JSON.stringify(await chrome.storage.local.get(args.key)).includes(args.needle), {
    key: storageKey,
    needle: plaintext,
  });
}

/** 从扩展页面上下文直读 storage.local（站点规则是明文元数据，无需解密） */
export async function readSiteRules(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const key = 'site_rules';
    const stored = (await chrome.storage.local.get(key)) as Record<string, unknown>;
    return (stored[key] as Record<string, unknown>) ?? {};
  });
}

/** 以内容脚本同款消息形状写入规则，验证的是真实存储形态而非测试专用后门 */
export async function seedSiteRule(
  page: Page,
  rule: { domain: string; username: string; password: string; penetrateShadow?: boolean },
): Promise<void> {
  await page.evaluate(async payload => {
    const key = 'site_rules';
    const stored = ((await chrome.storage.local.get(key)) as Record<string, Record<string, unknown>>)[key] ?? {};
    stored[payload.domain] = {
      domain: payload.domain,
      customSelectors: { username: payload.username, password: payload.password },
      penetrateShadow: payload.penetrateShadow ?? true,
    };
    await chrome.storage.local.set({ [key]: stored });
  }, rule);
}

/**
 * 向指定 URL 前缀的标签页里的内容脚本发 PING，读回它「检测到的字段数」
 *
 * 这是内容脚本消费端唯一稳定的观测口：不依赖注入 UI 的时序，只断言判定结果。
 */
export async function pingDetectedFields(page: Page, urlPrefix: string): Promise<Record<string, number>> {
  return page.evaluate(async prefix => {
    const tabs = await chrome.tabs.query({});
    const matching = tabs.filter(tab => (tab.url ?? '').startsWith(prefix));
    const target = matching[matching.length - 1];
    if (!target?.id) throw new Error(`未找到 ${prefix} 对应的标签页`);
    const response = (await chrome.tabs.sendMessage(target.id, { type: 'PING' })) as {
      fieldsDetected: Record<string, number>;
    };
    return response.fieldsDetected;
  }, urlPrefix);
}

/**
 * 打开「假站点 + 侧边栏」组合，返回两个页面句柄
 *
 * 侧边栏只能用 `chrome-extension://<id>/sidepanel.html` 以标签页形态打开：
 * 真实的停靠面板由 `chrome.sidePanel.open()` 创建，而该 API 只接受用户手势链上的调用，
 * Playwright 无法点击浏览器工具栏，实测内容脚本 `SHOW_SIDEPANEL` 路径在自动化环境下
 * 也不会产出可被 CDP 枚举的面板目标。因此这里用标签页替代——面板里的 Vue 应用、
 * 数据竞速、过滤/填充逻辑全部是同一份代码，只有「停靠窗口」这层外壳不同。
 *
 * 标签页形态有个必须处理的差异：面板自身成为「活动标签页」时，`currentDomain` 与
 * 填充目标都取自 `tabs.query({active:true,currentWindow:true})`，会指向面板自己
 * （域名变成扩展 ID，填充必然失败）。所以要把站点页放回前台，
 * 让 `onActivated → updateCurrentDomain` 把上下文纠正回目标站点，与停靠态一致。
 *
 * 轮询而不是「点一次就走」：`.current-url` 属于头部，而头部要等侧边栏首屏
 * （会话校验 + 解密）完成才挂载——它在 DOM 里出现之前，任何断言都只能拿到超时。
 * 探针量到的两个极端：无已解锁会话的前置下首次采样（+1.2s）即就绪；带已解锁会话
 * 且机器被抢占时拖到 +31s。两者差的不只是 CPU，没有逐项隔离，所以这里只承诺
 * 「等到挂载为止」，不承诺具体耗时。反复 `bringToFront` 顺带覆盖了
 * 「面板初始化查询早于站点重新成为活动标签页」这个标签页形态独有的窗口。
 *
 * 30s 预算的口径：清掉上一轮遗留进程后，`sidepanel.spec.ts` 6 条全绿，单条 16.5-49.5s；
 * 而机器被抢占时首屏能拖到 31s 并让这里超时——那种红灯先怀疑环境，
 * 复跑前确认没有遗留的浏览器 / runner 进程在抢 CPU（见 e2e/README.md）。
 */
export async function openSidepanelOnSite(
  extContext: BrowserContext,
  extensionId: string,
  pageHtml: string = LOGIN_PAGE_HTML,
  origin: string = E2E_PAGE_ORIGIN,
): Promise<{ site: Page; panel: Page }> {
  const site = await extContext.newPage();
  await site.route('**/*', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml }),
  );
  await site.goto(`${origin}/login`);

  const panel = await extContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' });

  const currentUrl = panel.locator('.current-url');
  const hostname = new URL(origin).hostname;
  // 返回读到的文本而非布尔值：失败输出要能区分「首屏还没挂载（<未挂载>）」和
  // 「激活没落到位（拿到扩展 ID 之类的其它域名）」，否则这条夹具红只能靠加探针重跑定位。
  // 面板页被关闭是第三种情况，必须原样抛出——吞成「<未挂载>」会把人引向错误的排查方向。
  await expect
    .poll(
      async () => {
        if (panel.isClosed()) throw new Error('面板页已被关闭');
        await site.bringToFront();
        return currentUrl.textContent({ timeout: 2_000 }).catch(() => '<未挂载>');
      },
      { message: `面板首屏没等到站点域名 ${hostname}`, timeout: 30_000 },
    )
    .toContain(hostname);
  // 骨架屏是 `position:fixed; inset:0` 的兄弟节点，没淡出干净就会吃掉整页点击
  await expect(panel.locator('#app-loading')).toHaveCount(0);

  return { site, panel };
}

// ==================== 管理页公共装置 ====================
// 以下选择器在多个 spec 里各写一份，改一处就得全仓搜一遍；统一收在这里，
// 定位口径（为何用 footer 主按钮、为何按文案过滤 alert）见各函数注释。

/** 弹窗 footer 的主按钮（保存 / 更新 / 确认），避开与「保存设置」等文案互串的名字匹配 */
export const footerPrimary = (dialog: Locator) => dialog.locator('.el-dialog__footer .el-button--primary');

/** 按文案定位提示条（ElMessage 与 el-alert 同为 role=alert，靠文案区分） */
export const toast = (page: Page, key: string, pattern?: RegExp) =>
  page.getByRole('alert').filter({ hasText: pattern ?? textOf(key) });

/** 管理页列表行：`row-key` 与 `row-class-name` 都是条目 id，按用户名文本定位即唯一 */
export const rowOf = (page: Page, username: string) => page.locator('tr.el-table__row', { hasText: username });

/** 管理页全部列表行 */
export const allRows = (page: Page) => page.locator('tr.el-table__row');

/**
 * 展开 HeaderBar 的某个下拉菜单（「数据管理」/「安全设置」）
 *
 * Element Plus 的 popper 懒渲染，未展开时菜单项根本不在 DOM 里，
 * 因此以「首个 menuitem 可见」为展开信号，而不是给固定等待时长。
 */
export async function openHeaderMenu(page: Page, menuKey: string): Promise<void> {
  await page.getByRole('button', { name: textOf(menuKey) }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
}

/** 选中下拉菜单里的某条命令（menuitem 命中后菜单自动收起） */
export async function runHeaderCommand(page: Page, menuKey: string, itemKey: string): Promise<void> {
  await openHeaderMenu(page, menuKey);
  await page.getByRole('menuitem', { name: textOf(itemKey) }).click();
}

/**
 * 用下拉命令打开弹窗，标题与菜单项同源时可直接复用 itemKey
 *
 * 标题不同的入口（如「导入数据」打开的是 `options.import.title`）请改用
 * {@link runHeaderCommand} 后自行按标题定位，别在这里塞映射表。
 */
export async function openHeaderDialog(page: Page, menuKey: string, itemKey: string): Promise<Locator> {
  await runHeaderCommand(page, menuKey, itemKey);
  const dialog = page.getByRole('dialog').filter({ hasText: textOf(itemKey) });
  await expect(dialog).toBeVisible();
  return dialog;
}
