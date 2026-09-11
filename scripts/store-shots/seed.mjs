/**
 * 注入商店截图用的占位演示数据：设置主密码 + 通过 CSV 批量导入 8 条示例账号。
 *
 *   node seed.mjs <path-to-.output/chrome-mv3> [zh|en]
 *
 * 前置：Chrome 已带 --remote-debugging-port=9333 启动且扩展已加载，见同目录 README.md。
 * 需在**全新 profile** 上运行（首次设置主密码状态）；英文页要求英文占位标签，
 * 所以中英两套必须各用一个全新 profile 分别 seed。
 *
 * 演示数据全部是 example.com 占位账号，不含任何真实凭据。
 */
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extUrl, attachTo, metrics, initExtension, newTab, evalIn } from './shot.mjs';

const EXT_DIR = process.argv[2];
const LANG = process.argv[3] || 'zh';
const MASTER_PASSWORD = 'Demo!Pass2026';

if (!EXT_DIR || !['zh', 'en'].includes(LANG)) {
  console.error('usage: node seed.mjs <path-to-.output/chrome-mv3> [zh|en]');
  process.exit(1);
}

/**
 * 占位演示账号：覆盖多环境（开发/预发/生产）+ 各类标签，并故意留一条
 * 常见泄露密码（`abcd1234`）让安全体检有可展示的发现项。全部 example.com。
 *
 * 表头保持 native 格式（导入向导按自动检测识别），只把**标签与备注**按语言切换，
 * 因为这两列会直接出现在截图里。内联在脚本里而不是单独的 .csv，
 * 避免引入 prettier 无法解析的文件类型。
 */
const DEMO_CSV_ZH = `用户名(必填),密码,网址,标签,备注,两步验证
demo-admin@example.com,Demo!Dev2026x,https://dev-admin.example.com,开发,开发环境后台（演示数据）
demo-admin@example.com,Demo!Stage2026x,https://staging-admin.example.com,预发,预发环境后台（演示数据）
demo-admin@example.com,Demo!Prod2026x,https://admin.example.com,生产,生产环境后台（演示数据）
qa-bot@example.com,Demo!Qa2026x,https://qa.example.com,测试,回归测试账号（演示数据）
ops@example.com,Demo!Ops2026x,https://console.example.com,运维,云控制台（演示数据）,JBSWY3DPEHPK3PXP
designer@example.com,Demo!Design2026x,https://design.example.com,设计,设计协作（演示数据）
intern@example.com,Demo!Wiki2026x,https://wiki.example.com,文档,内部文档（演示数据）
dev@example.com,abcd1234,https://sandbox.example.com,沙箱,沙箱试用账号（演示数据）
`;

const DEMO_CSV_EN = `用户名(必填),密码,网址,标签,备注,两步验证
demo-admin@example.com,Demo!Dev2026x,https://dev-admin.example.com,Dev,Development admin console (demo data)
demo-admin@example.com,Demo!Stage2026x,https://staging-admin.example.com,Staging,Staging admin console (demo data)
demo-admin@example.com,Demo!Prod2026x,https://admin.example.com,Prod,Production admin console (demo data)
qa-bot@example.com,Demo!Qa2026x,https://qa.example.com,QA,Regression test account (demo data)
ops@example.com,Demo!Ops2026x,https://console.example.com,Ops,Cloud console (demo data),JBSWY3DPEHPK3PXP
designer@example.com,Demo!Design2026x,https://design.example.com,Design,Design collaboration (demo data)
intern@example.com,Demo!Wiki2026x,https://wiki.example.com,Docs,Internal docs (demo data)
dev@example.com,abcd1234,https://sandbox.example.com,Sandbox,Sandbox trial account (demo data)
`;

const DEMO_CSV = LANG === 'en' ? DEMO_CSV_EN : DEMO_CSV_ZH;

/**
 * 页面入口文案（中英不同）。
 *
 * 不能靠「点第一个主按钮」提交：Element Plus 会把抽屉/下拉的隐藏节点留在 DOM 里，
 * 其中也含 el-button--primary（实测首启页就有抽屉的「编辑」主按钮），按类名取会点错。
 * 因此统一按文案定位。
 */
const LABELS = {
  zh: { setup: '设置主密码并开始使用', import: '导入数据', confirm: '确认导入' },
  en: {
    setup: 'Set master password and start',
    import: 'Import data',
    // 确认按钮带条数后缀，如「Import (8 entries)」，故只用前缀
    confirm: 'Import (',
  },
};
const L = LABELS[LANG];

/** 按精确文案点击叶子节点（向上回溯到可点击祖先）。「导入数据」是卡片（div）而非 button。 */
const clickExact = label => `(() => {
  const wanted = ${JSON.stringify(label)};
  const isVisible = (n) =>
    !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const matches = [...document.querySelectorAll('body *')].filter(
    (n) => n.children.length === 0 && (n.textContent || '').trim() === wanted
  );
  // 同一个文案可能同时存在于隐藏的下拉菜单项里，优先取可见的那个
  const leaf = matches.find(isVisible) || matches[0];
  if (!leaf) return 'label not found: ' + wanted;
  let el = leaf;
  while (
    el &&
    el !== document.body &&
    el.tagName !== 'BUTTON' &&
    el.tagName !== 'A'
  ) {
    el = el.parentElement;
  }
  const target = el && el !== document.body ? el : leaf;
  target.click();
  return 'clicked ' + target.tagName;
})()`;

/** 按文案前缀点击按钮（确认导入按钮带条数，如「确认导入（8 条）」）。 */
const clickPrefix = prefix => `(() => {
  const wanted = ${JSON.stringify(prefix)};
  const isVisible = (n) =>
    !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const btns = [...document.querySelectorAll('button')].filter((x) =>
    (x.innerText || '').includes(wanted)
  );
  const b = btns.find(isVisible) || btns[0];
  if (!b) return 'button not found: ' + wanted;
  b.click();
  return 'clicked button';
})()`;

const wait = ms => new Promise(r => setTimeout(r, ms));

await initExtension(EXT_DIR);
const t = await newTab(extUrl('options.html'));
const { s } = await attachTo(x => x.id === t.id);
await metrics(s, 1280, 800);
await wait(3000);

// 先把界面语言切到目标语言：英文跑批时若页面仍是默认中文，下方标签匹配会落空。
// 与偏好设置面板里的「中文 / English」开关等效（见 utils/i18n/index.ts 的双写）。
const locale = LANG === 'en' ? 'en' : 'zh-CN';
await evalIn(
  s,
  `(async () => {
    localStorage.setItem('app_locale', ${JSON.stringify(locale)});
    await chrome.storage.local.set({ app_locale: ${JSON.stringify(locale)} });
    return 'locale set';
  })()`,
);
await s.send('Page.reload', { ignoreCache: true });
await wait(3500);

// 首启判定用结构而非文案：两个主密码输入框即首次设置状态
const firstRun = await evalIn(s, `document.querySelectorAll('input[type=password]').length >= 2`);

if (firstRun) {
  await evalIn(
    s,
    `(() => {
      const els = [...document.querySelectorAll('input[type=password]')];
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(els[0]), 'value');
      for (const el of els) {
        d.set.call(el, ${JSON.stringify(MASTER_PASSWORD)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      return 'filled';
    })()`,
  );
  await wait(1200);
  console.log('set master password:', await evalIn(s, clickExact(L.setup)));
  await wait(5000);
} else {
  console.log('master password already set, skipping setup');
}

console.log('open import:', await evalIn(s, clickExact(L.import)));
await wait(2000);

const doc = await s.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await s.send('DOM.querySelector', {
  nodeId: doc.root.nodeId,
  selector: 'input.el-upload__input',
});
if (!nodeId) throw new Error('import dialog file input not found');
const csvPath = resolve(tmpdir(), 'aph-store-shots-demo-accounts.csv');
writeFileSync(csvPath, DEMO_CSV, 'utf8');
await s.send('DOM.setFileInputFiles', { nodeId, files: [csvPath] });
await wait(3000);
console.log('confirm import:', await evalIn(s, clickPrefix(L.confirm)));
await wait(4000);
console.log('seeded rows:', await evalIn(s, `document.querySelectorAll('.el-table__row').length`));
s.close();
