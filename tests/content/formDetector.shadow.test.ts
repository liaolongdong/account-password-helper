/** @vitest-environment jsdom */

/**
 * FormDetector 与 Shadow DOM 的实际边界（回归基线）
 *
 * 本文件按可观察行为重写。旧版 4 个用例只断言私有方法「被调用过」或 `length >= 0`
 * 这类恒真式（并以「jsdom 对 Shadow DOM 支持有限」为由放弃真断言），无论实现是否存在
 * 都会通过——而那套「递归遍历 open shadow DOM 收集字段」的启发式几乎收不到任何字段：
 * BFS 只以 `document.body` 为种子，且只在已访问节点带 open shadowRoot 时才继续入队，
 * 主树的 light DOM 子节点从不入队，因此宿主嵌在主树内（真实页面的普遍形态）时命中数为 0
 * （实测：HEAD 版在「宿主嵌主树」夹具下收 0 个字段，只有影子树直挂 `document.body`、
 * 且 input 是其直接子节点时才收得到）。假测试正是它长期隐身的原因。
 *
 * 现在钉住四条事实：
 * 1. 启发式检测走 `document.querySelectorAll`，不跨 shadow 边界：open / closed
 *    影子树里的登录框都不会被自动识别，自动识别的范围只有文档主树
 *    （含影子树直挂 `document.body` 这一被删启发式唯一可达的极端形态）；
 * 2. 跨边界的唯一通道是站点规则自定义选择器（查询根 = document + 所有 open shadowRoot），
 *    嵌套一层的 open 影子树也能被显式选择器命中；
 * 3. closed 影子树对扩展不可见（`el.shadowRoot` 为 null），即使配置了选择器也拿不到；
 * 4. 穿透开关（全局配置或该站点规则任一关闭）会把查询根收回到文档主树：选择器仍在
 *    light DOM 生效，但不再跨进 open 影子树——开关语义与选项页文案一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import * as domUtils from '@/entrypoints/content/domUtils';
import type { SiteRule } from '@/utils/storage/siteRules';

/** 内容脚本用 `document.domain || location.hostname` 取域，测试按同一形态布键 */
const DOMAIN = document.domain || window.location.hostname || '';

/** 与既有 FormDetector 测试一致的默认配置 */
const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  visible: true,
  position: 'right',
  offsetY: 0,
  opacity: 0.9,
  autoShowSidepanel: false,
  autoTriggerLogin: false,
  passwordVisibilityToggle: false,
  fillMode: 'inline',
  theme: 'sky',
  penetrateShadow: true,
  ...overrides,
});

/**
 * 安装密闭的 chrome 全局桩
 *
 * `loadConfig` 与 `loadSiteRule` 都走 `chrome.storage.local.get`，但请求的键不同，
 * 因此按 key 分支返回，避免站点规则读取拿到配置对象。
 */
const installChromeMock = (config: Record<string, unknown>, rules: Record<string, SiteRule>) => {
  (globalThis as any).chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue({ data: null }),
      getURL: vi.fn((path: string) => `chrome-extension://test-extension/${path}`),
    },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: {
        get: vi.fn(async (key: string) => {
          if (key === STORAGE_KEYS.SITE_RULES) return { [STORAGE_KEYS.SITE_RULES]: rules };
          return { [STORAGE_KEYS.FLOATING_BUTTON_CONFIG]: config };
        }),
        set: vi.fn(async () => {}),
      },
      session: { get: vi.fn(async () => ({})) },
    },
  };
};

/** 让 loadConfig / loadSiteRule 的异步续体落地 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** 在宿主元素上开一个影子树并写入给定 HTML */
const attachShadowTree = (host: Element, mode: 'open' | 'closed', html: string): ShadowRoot => {
  const root = host.attachShadow({ mode });
  root.innerHTML = html;
  return root;
};

/**
 * 换一个全新的 `<body>`
 *
 * `attachShadow` 每个元素只能调一次，且 `innerHTML = ''` 摘不掉已挂上的影子树，
 * 因此需要给 `document.body` 换元素，避免「直挂 body」那条用例污染相邻用例。
 */
const resetBody = (): void => {
  document.body.remove();
  document.documentElement.appendChild(document.createElement('body'));
};

describe('FormDetector 的 Shadow DOM 边界', () => {
  let detector: FormDetector;

  /** 影子树内登录框 + 主树容器，主树本身没有任何输入框 */
  const buildShadowOnlyDom = (): { host: HTMLElement; openRoot: ShadowRoot } => {
    document.body.innerHTML = '<div id="main"></div>';
    const host = document.createElement('div');
    host.id = 'shadow-host';
    document.getElementById('main')!.appendChild(host);
    const openRoot = attachShadowTree(
      host,
      'open',
      '<input id="shadow-user" type="text" name="username"><input id="shadow-pwd" type="password" name="password">',
    );
    return { host, openRoot };
  };

  const createDetector = async (): Promise<FormDetector> => {
    const instance = new FormDetector();
    vi.spyOn(instance as any, 'syncInlineTriggerWithActiveElement').mockImplementation(() => {});
    vi.spyOn(instance as any, 'maybeTriggerTotpHandoff').mockImplementation(() => {});
    await settle();
    return instance;
  };

  beforeEach(() => {
    vi.spyOn(domUtils, 'isElementVisible').mockImplementation(() => true);
    vi.spyOn(domUtils, 'isDetectableCheckbox').mockImplementation(() => true);
  });

  afterEach(() => {
    detector?.destroy();
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
    resetBody();
  });

  it('open 影子树内的登录框不会被启发式识别', async () => {
    buildShadowOnlyDom();
    installChromeMock(makeConfig(), {});
    detector = await createDetector();

    (detector as any).detectForms();
    const view = detector as any;

    // 文档主树没有输入框，影子树内的两个 input 一个都不该被收进来看（范围口径见文件头）
    expect(view.passwordFields).toHaveLength(0);
    expect(view.usernameFields).toHaveLength(0);
    expect(view.mobileFields).toHaveLength(0);
  });

  it('closed 影子树内的登录框同样不可见', async () => {
    document.body.innerHTML = '<div id="main"></div>';
    const host = document.createElement('div');
    document.getElementById('main')!.appendChild(host);
    attachShadowTree(host, 'closed', '<input id="closed-user" type="text"><input id="closed-pwd" type="password">');
    installChromeMock(makeConfig(), {});
    detector = await createDetector();

    (detector as any).detectForms();

    expect((detector as any).passwordFields).toHaveLength(0);
    expect((detector as any).usernameFields).toHaveLength(0);
  });

  it('自定义选择器可命中 open 影子树内的字段（跨边界的唯一通道）', async () => {
    const { openRoot } = buildShadowOnlyDom();
    installChromeMock(makeConfig(), {
      [DOMAIN]: {
        domain: DOMAIN,
        customSelectors: { username: '#shadow-user', password: '#shadow-pwd' },
      },
    });
    detector = await createDetector();

    (detector as any).detectForms();
    const view = detector as any;

    // 前置确认：桩环境确实把 input 放进了可查询的 open 影子树，避免测试再次「空跑」
    expect(openRoot.querySelectorAll('input')).toHaveLength(2);
    expect(view.usernameFields).toHaveLength(1);
    expect(view.passwordFields).toHaveLength(1);
    expect(view.getFieldType(view.usernameFields[0])).toBe('username');
    expect(view.getFieldType(view.passwordFields[0])).toBe('password');
  });

  it('自定义选择器可命中嵌套一层的 open 影子树', async () => {
    document.body.innerHTML = '<div id="main"></div>';
    const outer = document.createElement('div');
    outer.id = 'outer-host';
    document.getElementById('main')!.appendChild(outer);
    const outerRoot = attachShadowTree(outer, 'open', '<div id="inner-host"></div>');
    const inner = outerRoot.querySelector('#inner-host')!;
    attachShadowTree(inner, 'open', '<input id="deep-pwd" type="password">');

    installChromeMock(makeConfig(), {
      [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '', password: '#deep-pwd' } },
    });
    detector = await createDetector();

    (detector as any).detectForms();
    const view = detector as any;

    expect(view.passwordFields).toHaveLength(1);
    expect(view.passwordFields[0].id).toBe('deep-pwd');
  });

  it('closed 影子树即便配置了选择器也无法命中', async () => {
    document.body.innerHTML = '<div id="main"></div>';
    const host = document.createElement('div');
    host.id = 'closed-host';
    document.getElementById('main')!.appendChild(host);
    attachShadowTree(host, 'closed', '<input id="closed-pwd" type="password">');

    installChromeMock(makeConfig(), {
      [DOMAIN]: { domain: DOMAIN, customSelectors: { username: '', password: '#closed-pwd' } },
    });
    detector = await createDetector();

    (detector as any).detectForms();

    expect((detector as any).passwordFields).toHaveLength(0);
  });

  it('影子树直挂 document.body 时，启发式同样不跨边界，但选择器可以', async () => {
    // 这是被删掉的「递归遍历 open shadow DOM 收集字段」启发式唯一能命中的形态
    // （影子根的直接子节点恰为登录输入框）。删它之前实测也只有这里能收到字段，
    // 宿主嵌在主树内的真实页面一律收 0；本用例把这次刻意收窄的范围钉住，
    // 同时证明跨边界能力仍由自定义选择器承担（查询根 BFS 会走到 body 的 shadowRoot）。
    resetBody();
    document.body.attachShadow({ mode: 'open' }).innerHTML =
      '<input id="body-shadow-user" type="text"><input id="body-shadow-pwd" type="password">';
    installChromeMock(makeConfig(), {});
    detector = await createDetector();

    (detector as any).detectForms();

    expect((detector as any).passwordFields).toHaveLength(0);
    expect((detector as any).usernameFields).toHaveLength(0);

    detector.destroy();
    installChromeMock(makeConfig(), {
      [DOMAIN]: {
        domain: DOMAIN,
        customSelectors: { username: '#body-shadow-user', password: '#body-shadow-pwd' },
      },
    });
    detector = await createDetector();
    (detector as any).detectForms();

    expect((detector as any).passwordFields).toHaveLength(1);
    expect((detector as any).usernameFields).toHaveLength(1);
  });

  it('关闭穿透开关后，选择器只在主树生效，不再跨进 open 影子树', async () => {
    const { openRoot } = buildShadowOnlyDom();
    // 主树里放一个「启发式认不出、只有选择器能命中」的输入框，
    // 证明关闭开关收掉的是跨边界查询，而不是选择器本身
    openRoot.host.insertAdjacentHTML('beforebegin', '<input id="light-user" type="text">');
    installChromeMock(makeConfig({ penetrateShadow: false }), {
      [DOMAIN]: {
        domain: DOMAIN,
        customSelectors: { username: '#light-user', password: '#shadow-pwd' },
      },
    });
    detector = await createDetector();

    (detector as any).detectForms();
    const view = detector as any;

    expect(view.usernameFields).toHaveLength(1);
    expect(view.usernameFields[0].id).toBe('light-user');
    // 影子树内的密码框因开关关闭而不再被查询到
    expect(view.passwordFields).toHaveLength(0);
  });

  it('站点规则单独关闭穿透时同样只影响该站点的跨边界查询', async () => {
    const { openRoot } = buildShadowOnlyDom();
    openRoot.host.insertAdjacentHTML('beforebegin', '<input id="light-user" type="text">');
    installChromeMock(makeConfig(), {
      [DOMAIN]: {
        domain: DOMAIN,
        penetrateShadow: false,
        customSelectors: { username: '#light-user', password: '#shadow-pwd' },
      },
    });
    detector = await createDetector();

    (detector as any).detectForms();

    expect((detector as any).usernameFields[0].id).toBe('light-user');
    expect((detector as any).passwordFields).toHaveLength(0);
  });
});
