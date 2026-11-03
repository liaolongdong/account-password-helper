/**
 * 本地开发环境绑定的接线守卫
 *
 * 绑定做的事是「让另一个主机的凭证出现在这一页并可被填充」，这是本项目里唯一一条
 * **由用户点选产生的匹配放宽**，因此它的四条边界必须由机械断言钉住，而不是靠 UI 自觉：
 *
 * 1. 门禁在纯函数层：只有环回页面能绑定，公网页面传入绑定一律失效；
 * 2. 六个消费面（侧边栏列表 / 排序 / 徽章 / 内联下拉 / 一键填充与右键菜单 / Popup 计数）
 *    必须读到同一份绑定，少接一处就重现「两个入口结论相反」那类历史缺陷；
 * 3. 线上确认由后台判定：界面少写一次确认逻辑也不能放行；
 * 4. 绑定只落 `chrome.storage.session`：落盘会让一次联调的授权活过浏览器重启。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const DOMAIN_SRC = read('utils/domain.ts');
const FILTER_SRC = read('utils/passwordFilter.ts');
const SORT_SRC = read('utils/passwordSort.ts');
const SIDEPANEL_SRC = read('entrypoints/sidepanel/App.vue');
const POPUP_SRC = read('composables/usePopupInit.ts');
const CACHE_SRC = read('entrypoints/background/passwordCache.ts');
const ROUTER_SRC = read('entrypoints/background/messageRouter.ts');
const BINDING_SRC = read('entrypoints/background/environmentBinding.ts');
const ENVELOPE_SRC = read('utils/types.ts');

/** 抽取一个函数体（顶层 `export function 名字(...) { ... }`，到首个行首 `}` 为止） */
function fnBody(src: string, name: string): string {
  const matched = new RegExp(`export function ${name}\\(([\\s\\S]*?)\\n}`).exec(src)?.[1] ?? '';
  expect(matched, `未能从源码定位 ${name}，本条判据成了空转`).not.toBe('');
  return matched;
}

describe('环境绑定门禁（纯函数层）', () => {
  it('只有环回主机能绑定，判据写在 effectiveEnvHost 里', () => {
    const body = fnBody(DOMAIN_SRC, 'effectiveEnvHost');
    expect(body, '环回门禁从纯函数层消失：公网页面也能把别的主机绑进来').toContain('isLoopbackHost(');
    expect(body, '不再拦住「把本机绑给自己」').toContain('canonicalSiteHost(');
  });

  it('并集层的两条轴都走同一个端点判据', () => {
    const body = fnBody(DOMAIN_SRC, 'matchesSiteWithEnv');
    expect(body, '并集层不再经过 effectiveEnvHost，环回门禁被绕过').toContain('effectiveEnvHost(');
    expect(body, '并集层不再调用 matchesSiteEndpoint，主机门或端口门失守').toContain('matchesSiteEndpoint(');
    // 绑定轴刻意不比端口：它拿的是 null 端口上下文，写死这一点防止有人「顺手」传 page
    expect(
      /matchesSiteEndpoint\([^)]*,\s*bound,\s*null,/.test(body),
      '绑定轴开始用本页端口判端口：远端环境的账号会被本地 dev server 端口卡掉',
    ).toBe(true);
  });

  it('徽章判据与放开门禁同源', () => {
    const body = fnBody(DOMAIN_SRC, 'isAdmittedByEnvOnly');
    expect(body, '徽章判据不再依赖 effectiveEnvHost：公网页面也可能标出环境徽章').toContain('effectiveEnvHost(');
    expect(body, '徽章判据不再排除「真实端点已放行」的条目：本机条目会被标成远端环境').toContain(
      'matchesSiteEndpoint(',
    );
  });
});

describe('环境绑定接线（六个消费面）', () => {
  it('侧边栏把绑定同时用于可见集、排序与徽章', () => {
    for (const needle of ['envHost: boundEnvHost.value', 'siteRankWithEnv(', 'isAdmittedByEnvOnly(']) {
      expect(SIDEPANEL_SRC, `侧边栏缺少接线 ${needle}`).toContain(needle);
    }
  });

  it('范围过滤与内联下拉/一键填充都收同一个必传的绑定参数', () => {
    expect(FILTER_SRC, 'ScopeContext 不再有 envHost 字段：绑定只能被部分入口读到').toContain('envHost: string | null');
    expect(FILTER_SRC, 'matchesSiteScope 不再传绑定').toContain('ctx.envHost');
    expect(SORT_SRC, 'filterAndSortEntriesForDomain 的绑定参数被改成可选：漏传会静默失效').toContain(
      'envHost: string | null',
    );
  });

  it('后台取数与 Popup 计数各自读同一份绑定', () => {
    expect(CACHE_SRC, '内联下拉/一键填充不再读取绑定：三个入口会给出不同的可填充集合').toContain('getEnvBinding(');
    expect(POPUP_SRC, 'Popup 计数不再经并集判据，会与侧边栏列表数目相反').toContain('matchesSiteWithEnv(');
    expect(POPUP_SRC, 'Popup 不再向后台取绑定，本站计数会比侧边栏少一整环境').toContain('MessageType.GET_ENV_BINDING');
  });

  it('内容脚本侧的来源标签只由后台下发的主机驱动', () => {
    expect(CACHE_SRC, '后台不再判定「仅由绑定带入」，下拉里的来源标签会失准').toContain('isAdmittedByEnvOnly(');
    expect(ENVELOPE_SRC, 'MatchingAccountMeta 不再有 envHost 字段').toContain('envHost?: string');
  });
});

describe('环境绑定的写入边界', () => {
  it('读写消息只接受扩展自身页面', () => {
    const block = /case MessageType\.GET_ENV_BINDING:[\s\S]*?case MessageType\.FILL_BY_ID:/.exec(ROUTER_SRC)?.[0] ?? '';
    expect(block, '未抽取到环境绑定消息的 case 块，本条判据成了空转').not.toBe('');
    expect(block, '环境绑定消息未过扩展页门禁：宿主页面可自行放宽本站范围').toContain('isExtensionPageSender(sender)');
    // 牙齿：把门禁那一行删掉后，上一条必须抓不到——否则这条判据在替一段死代码背书
    expect(
      block.includes('isExtensionPageSender(sender)') &&
        !block
          .replace(/\n\s*if \(!isExtensionPageSender\(sender\)\) \{[\s\S]*?\n\s*\}\n/, '\n')
          .includes('isExtensionPageSender(sender)'),
      '扩展页门禁判据没有牙齿',
    ).toBe(true);
    // 反向钉子：侧边栏的 sender 带着 tab（真机 e2e 实测），这里不允许退回 sender.tab === undefined 那条闸门
    // （只拦**调用**，源码里解释这一选择的那句注释提到函数名是允许的）
    expect(block, '环境绑定又调用回 isTrustedInternalSender：侧边栏会被自己拒掉').not.toContain(
      '!isTrustedInternalSender(sender)',
    );
  });

  it('线上确认由后台判定，界面不自证', () => {
    expect(BINDING_SRC, '后台不再判线上确认：确认逻辑退化成 UI 自觉').toContain('requiresEnvConfirmation(');
    expect(BINDING_SRC, '确认被拒时不再回 needsAck，前端就无从发起确认').toContain('needsAck: true');
    expect(SIDEPANEL_SRC, '侧边栏自己判定了「是否需要确认」，绕过后台门禁').not.toContain('requiresEnvConfirmation');
  });

  it('绑定只存 storage.session，且主机门禁在写入层重复一次', () => {
    expect(BINDING_SRC, '绑定改用 storage.session 之外的存储：一次联调的授权会活过浏览器重启').not.toContain(
      'chrome.storage.local',
    );
    expect(BINDING_SRC, '绑定不再过 SESSION_MEMORY_KEYS').toContain('SESSION_MEMORY_KEYS.ENV_BINDINGS');
    expect(BINDING_SRC, '写入层不再有环回门禁：越权调用可直接把公网页面绑定').toContain('isLoopbackHost(host)');
    expect(BINDING_SRC, '写入层不再拒绝「把本机绑给自己」').toContain('!isLoopbackHost(envHost)');
  });

  it('新消息类型登记进判别联合', () => {
    for (const needle of ['GET_ENV_BINDING = ', 'SET_ENV_BINDING = ']) {
      expect(ENVELOPE_SRC, `MessageType 缺少 ${needle.trim()}`).toContain(needle);
    }
    for (const needle of ['MessageType.GET_ENV_BINDING;', 'MessageType.SET_ENV_BINDING;']) {
      expect(ROUTER_SRC, `RuntimeMessage 联合或路由未接入 ${needle}`).toContain(needle.replace(';', ''));
    }
  });
});

describe('环境芯片与选择条的渲染契约（源码结构守卫）', () => {
  const HEADER_SRC = read('components/sidepanel/SidepanelHeader.vue');
  const BAR_SRC = read('components/sidepanel/EnvPickerBar.vue');

  it('芯片只在有候选时出现，且线上态用警示类名', () => {
    const chip = /<button\n\s+v-if="envOptions\.length"[\s\S]*?>/.exec(HEADER_SRC)?.[0] ?? '';
    expect(chip, '未定位到环境芯片按钮，本条判据成了空转').not.toBe('');
    expect(chip, '芯片不再随候选集为空而消失：公网页面会多出一颗点了没反应的按钮').toContain(
      'v-if="envOptions.length"',
    );
    expect(chip, '芯片不再表达绑定态').toContain("'env-pill--active': !!envActiveHost");
    expect(chip, '线上环境不再有警示色强调').toContain("'env-pill--danger': envIsProduction");
    expect(chip, '芯片不再可展开（缺 aria-expanded）').toContain(':aria-expanded="envPickerOpen"');
  });

  it('警示色只由 production 判定驱动，颜色不是唯一信号', () => {
    expect(HEADER_SRC, '芯片不再按当前候选的主机取属性').toContain(
      'props.envOptions.find(option => option.host === props.envActiveHost)',
    );
    expect(HEADER_SRC, '芯片的警示态不再取自候选集的 production 标记').toContain('activeEnvOption.value?.production');
    // 文案本身就写着 prod / 主机名：`envPillLabel` 取 label，色只是加强（AGENTS.md 可访问性）
    expect(HEADER_SRC, '芯片文案不再显示环境标签，只剩颜色传达状态').toContain('activeEnvOption.value?.label');
  });

  it('选择条每个候选一个按钮，且待确认时才渲染确认条', () => {
    expect(BAR_SRC.match(/v-for="option in options"/g), '候选按钮不再是同一份结构').toHaveLength(1);
    expect(BAR_SRC, '候选按钮不再上报所选主机').toContain('@click="emit(\'pick\', option.host)"');
    expect(BAR_SRC, '清除入口不再仅在绑定态出现').toContain('v-if="activeHost"');
    expect(BAR_SRC, '确认条不再挂在 pendingConfirmHost 上').toContain('v-if="pendingConfirmHost"');
    expect(BAR_SRC, '确认条缺 role=alertdialog：屏幕阅读器读不出这是一个待决定问题').toContain('role="alertdialog"');
  });

  it('选择条自己不挂全局监听，收起统一由父级判定', () => {
    // 芯片在选择条之外：条里监听全局按下会在同一次点击里「先关后开」，面板永远收不起来，
    // 还会顺手抹掉待确认的线上绑定。因此这件事只能在看得见两侧的父级里做。
    expect(BAR_SRC, '选择条又自己挂了全局监听：点芯片会先关后开').not.toContain('document.addEventListener');
    // 展开期间挂、收起即注销（同一个三元取 add/remove，成对得无法只留一半）
    expect(SIDEPANEL_SRC, '父级不再按展开态成对注册/注销文档监听').toContain(
      'const method = open ? document.addEventListener : document.removeEventListener;',
    );
    for (const type of ['mousedown', 'keydown']) {
      expect(SIDEPANEL_SRC, `展开时未注册 ${type}`).toContain(`method('${type}', handleEnv`);
    }
    expect(SIDEPANEL_SRC, '面板卸载时缺少 mousedown 兜底注销').toContain(
      "document.removeEventListener('mousedown', handleEnvOutsidePointer, true)",
    );
    expect(SIDEPANEL_SRC, '面板卸载时缺少 keydown 兜底注销').toContain(
      "document.removeEventListener('keydown', handleEnvEscape, true)",
    );
    expect(SIDEPANEL_SRC, '收起判定不再排除头部卡片：点芯片会同时触发关闭').toContain('headerCardRef.value?.contains');
    expect(SIDEPANEL_SRC, '收起判定不再排除选择条本身：点候选按钮会先把面板关掉').toContain('envBarEl.value?.contains');
  });

  it('异步绑定结果受端点指纹保护，迟到响应不得挂到另一页上', () => {
    // 切页面会让两次同步并发，冷启动那次反而更慢后落地；不作废就会把 A 端点的绑定
    // 显示成 B 端点的（跨端点凭证外显），而内联下拉按 B 取数、两边结论相反
    const stamps = SIDEPANEL_SRC.match(/if \(stamp !== envEndpointStamp\(\)\) return;/g) ?? [];
    expect(stamps.length, '端点指纹守卫少于两处（取数 + 写回各一处）').toBeGreaterThanOrEqual(2);
    expect(SIDEPANEL_SRC, '取数与写回没有共用同一份端点指纹').toContain('const stamp = envEndpointStamp();');
  });

  it('线上确认被拒时不得清空侧边栏已有的绑定', () => {
    const branch = /if \(response\.data\?\.needsAck\) \{([\s\S]*?)\n {4}\}/.exec(SIDEPANEL_SRC)?.[1] ?? '';
    expect(branch, '未定位到 needsAck 分支，本条判据成了空转').not.toBe('');
    expect(branch, '确认被拒时把界面绑定清空了：侧边栏收回、内联下拉与一键填充却还在带原环境').not.toContain(
      'envHost.value',
    );
    expect(branch, '确认被拒时没有保留确认目标').toContain('envPendingConfirm.value = target');
  });

  it('行内徽章同时受「仅绑定带入」与文案非空两个条件约束', () => {
    const ITEM_SRC = read('components/sidepanel/PasswordListItem.vue');
    const badge = /<el-tag\n\s+v-if="envBound && envLabel"[\s\S]*?<\/el-tag>/.exec(ITEM_SRC)?.[0] ?? '';
    expect(badge, '未定位到环境徽章，本条判据成了空转').not.toBe('');
    expect(badge, '徽章不再要求「仅由绑定带入」').toContain('envBound && envLabel');
    expect(badge, '徽章文案不再来自绑定标签').toContain("t('sidepanel.env.badge', { env: envLabel })");
  });
});
