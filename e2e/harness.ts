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
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test';
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
        '② macOS 13 不在 Playwright 的 chromium 分发矩阵内，需在 macOS 14+ 或 CI 上 ' +
        '`pnpm exec playwright install chromium`；③ 用 E2E_HEADLESS=0 观察窗口里的实际报错。',
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
 */
export async function onboardAndUnlock(page: Page): Promise<void> {
  const setupSubmit = page.getByRole('button', { name: textOf('auth.setupSubmit') });
  const verifySubmit = page.getByRole('button', { name: textOf('auth.verifySubmit') });
  const passwordInput = page.getByPlaceholder(textOf('auth.setupPasswordPlaceholder')).first();
  const confirmInput = page.getByPlaceholder(textOf('auth.confirmPasswordPlaceholder')).first();
  const verifyInput = page.getByPlaceholder(textOf('auth.verifyPasswordPlaceholder')).first();

  if (await setupSubmit.isVisible().catch(() => false)) {
    await passwordInput.fill(MASTER_PASSWORD);
    await confirmInput.fill(MASTER_PASSWORD);
    await setupSubmit.click();
    await expect(page.locator('.header-title h1')).toBeVisible({ timeout: 30_000 });
    return;
  }

  if (await verifySubmit.isVisible().catch(() => false)) {
    await verifyInput.fill(MASTER_PASSWORD);
    await verifySubmit.click();
    await expect(page.locator('.header-title h1')).toBeVisible({ timeout: 30_000 });
  }
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
