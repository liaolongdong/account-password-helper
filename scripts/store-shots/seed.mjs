/**
 * 注入商店截图用的占位演示数据：设置主密码 + CSV 批量导入示例账号 + 收藏指定条目 + 轮换指定条目密码。
 *
 *   node seed.mjs <path-to-.output/chrome-mv3> [zh|en] [demo.csv]
 *
 * 前置：Chrome 已带 --remote-debugging-port=9333 启动且扩展已加载，见同目录 README.md。
 * 需在**全新 profile** 上运行（首次设置主密码状态）；英文页要求英文占位标签，
 * 所以中英两套必须各用一个全新 profile 分别 seed。
 *
 * 不传 demo.csv 时用内联的 example.com 占位账号，不含任何真实凭据；
 * 收藏步骤按用户名定位行（见 FAVORITE_USERS），置顶效果才会在截图里看得出来。
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extUrl, attachTo, metrics, initExtension, newTab, evalIn } from './shot.mjs';

const EXT_DIR = process.argv[2];
const LANG = process.argv[3] || 'zh';
/** 自备演示 CSV（可选）：传入后跳过内联占位数据，用于「用真实导出样本拍截图」。 */
const CSV_PATH = process.argv[4];
const MASTER_PASSWORD = 'Demo!Pass2026';

/**
 * 要收藏的条目用户名（逗号分隔，可用 SHOT_FAVORITE_USERS 覆盖）。
 *
 * 按用户名定位而不是按行下标：点完第一个收藏后列表会重排（收藏置顶），下标不再稳定。
 * 刻意避开带 TOTP 的 ops：它的卡片多两个操作图标，把标签挤成「运…」「重…」，
 * 商店截图里像渲染故障。换成自备 CSV 时记得传对应用户名，否则这里会报「row not found」。
 */
const FAVORITE_USERS = (process.env.SHOT_FAVORITE_USERS || 'qa-bot@example.com,designer@example.com')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

/**
 * 要改两次密码的条目用户名（逗号分隔，可用 SHOT_HISTORY_USERS 覆盖）。
 *
 * 「条目详情」抽屉的修改历史小节是 `v-if="historyList.length > 0"`，
 * 只导入不修改的话这一节根本不渲染，截图里就看不到这个功能。改两次留两条历史。
 */
const HISTORY_USERS = (process.env.SHOT_HISTORY_USERS || 'ops@example.com')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

/** 轮换用的新密码（依次套用，需与 CSV 里的原密码不同才会产生历史记录）。 */
const ROTATED_PASSWORDS = ['Demo!Rotated2026a', 'Demo!Rotated2026b'];

/**
 * 要移入回收站的条目用户名（逗号分隔，可用 SHOT_TRASH_USERS 覆盖）。
 *
 * 「回收站」截图展示的是「删除后 30 天内可恢复」，空回收站没有内容可拍。
 * 刻意选文档类条目（intern@example.com）：它不在任何一张截图的重点位置，
 * 删掉不会让多环境 / TOTP / 体检那几个画面少掉关键行。
 */
const TRASH_USERS = (process.env.SHOT_TRASH_USERS || 'intern@example.com')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

if (!EXT_DIR || !['zh', 'en'].includes(LANG)) {
  console.error('usage: node seed.mjs <path-to-.output/chrome-mv3> [zh|en] [demo.csv]');
  process.exit(1);
}

/**
 * 占位演示账号：覆盖多环境（开发/预发/生产）+ 各类标签，并故意留两类可展示项——
 * `abcd1234`（常见泄露密码）与 design/wiki 两条共用同一密码（密码复用），
 * 让安全体检截图有真实发现项。全部 example.com，不含任何真实凭据。
 *
 * 标签列里的逗号用引号包住（`"生产,重要"`）以演示多标签：`parseCSVLine` 支持带引号
 * 字段，导入后按逗号切两个标签。中英文两套必须同序同量，这样两个商店页演示的是
 * 同一批账号（收藏按用户名选中，见 FAVORITE_USERS）。
 *
 * 表头保持 native 格式（导入向导按自动检测识别），只把**标签与备注**按语言切换，
 * 因为这两列会直接出现在截图里。内联在脚本里而不是单独的 .csv，
 * 避免引入 prettier 无法解析的文件类型。
 */
const DEMO_CSV_ZH = `用户名(必填),密码,网址,标签,备注,两步验证
demo-admin@example.com,Demo!Dev2026x,https://dev-admin.example.com,开发,开发环境后台（演示数据）
demo-admin@example.com,Demo!Stage2026x,https://staging-admin.example.com,预发,预发环境后台（演示数据）
demo-admin@example.com,Demo!Prod2026x,https://admin.example.com,"生产,重要",生产环境后台（演示数据）
auditor@example.com,Demo!Audit2026x,https://admin.example.com,"生产,审计",生产环境只读账号（演示数据）
support@example.com,Demo!Support2026x,https://admin.example.com,"生产,客服",生产环境客服工单账号（演示数据）
qa-bot@example.com,Demo!Qa2026x,https://qa.example.com,测试,回归测试账号（演示数据）
ops@example.com,Demo!Ops2026x,https://console.example.com,"运维,重要",云控制台（演示数据）,JBSWY3DPEHPK3PXP
designer@example.com,Demo!Share2026x,https://design.example.com,"设计,协作",设计协作（演示数据）
intern@example.com,Demo!Share2026x,https://wiki.example.com,文档,内部文档（演示数据）
dev@example.com,abcd1234,https://sandbox.example.com,沙箱,沙箱试用账号（演示数据）
`;

const DEMO_CSV_EN = `用户名(必填),密码,网址,标签,备注,两步验证
demo-admin@example.com,Demo!Dev2026x,https://dev-admin.example.com,Dev,Development admin console (demo data)
demo-admin@example.com,Demo!Stage2026x,https://staging-admin.example.com,Staging,Staging admin console (demo data)
demo-admin@example.com,Demo!Prod2026x,https://admin.example.com,"Prod,Critical",Production admin console (demo data)
auditor@example.com,Demo!Audit2026x,https://admin.example.com,"Prod,Audit",Read-only production account (demo data)
support@example.com,Demo!Support2026x,https://admin.example.com,"Prod,Support",Production support desk account (demo data)
qa-bot@example.com,Demo!Qa2026x,https://qa.example.com,QA,Regression test account (demo data)
ops@example.com,Demo!Ops2026x,https://console.example.com,"Ops,Critical",Cloud console (demo data),JBSWY3DPEHPK3PXP
designer@example.com,Demo!Share2026x,https://design.example.com,"Design,Collab",Design collaboration (demo data)
intern@example.com,Demo!Share2026x,https://wiki.example.com,Docs,Internal docs (demo data)
dev@example.com,abcd1234,https://sandbox.example.com,Sandbox,Sandbox trial account (demo data)
`;

const DEMO_CSV = CSV_PATH ? readFileSync(resolve(CSV_PATH), 'utf8') : LANG === 'en' ? DEMO_CSV_EN : DEMO_CSV_ZH;

/**
 * 页面入口文案（中英不同）。
 *
 * 不能靠「点第一个主按钮」提交：Element Plus 会把抽屉/下拉的隐藏节点留在 DOM 里，
 * 其中也含 el-button--primary（实测首启页就有抽屉的「编辑」主按钮），按类名取会点错。
 * 因此统一按文案定位。
 */
const LABELS = {
  zh: {
    setup: '设置主密码并开始使用',
    import: '导入数据',
    confirm: '确认导入',
    favorite: '收藏（置顶显示）',
    unfavorite: '取消收藏',
    edit: '编辑',
    update: '更新',
    delete: '删除',
    moveToTrash: '移入回收站',
  },
  en: {
    setup: 'Set master password and start',
    import: 'Import data',
    // 确认按钮带条数后缀，如「Import (8 entries)」，故只用前缀
    confirm: 'Import (',
    favorite: 'Favorite (pinned to top)',
    unfavorite: 'Unfavorite',
    edit: 'Edit',
    update: 'Update',
    delete: 'Delete',
    moveToTrash: 'Move to Trash',
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

/** 按用户名定位行并点击其「收藏」按钮（用户名单元格只是 CSS 截断，textContent 仍是完整串）。 */
const favSel = `button[aria-label=${JSON.stringify(L.favorite)}]`;
const unfavSel = `button[aria-label=${JSON.stringify(L.unfavorite)}]`;
const clickFavorite = user => `(() => {
  const wanted = ${JSON.stringify(user)};
  const rows = [...document.querySelectorAll('.el-table__row')];
  const row = rows.find((r) => (r.textContent || '').includes(wanted));
  if (!row) return 'row not found: ' + wanted;
  const btn = row.querySelector(${JSON.stringify(favSel)});
  if (btn) {
    btn.click();
    return 'favorited ' + wanted;
  }
  if (row.querySelector(${JSON.stringify(unfavSel)})) return 'already favorited: ' + wanted;
  return 'favorite button not found in row: ' + wanted;
})()`;

const editSel = `button[aria-label=${JSON.stringify(L.edit)}]`;

/** 打开指定用户名所在行的编辑弹窗。 */
const openEdit = user => `(() => {
  const wanted = ${JSON.stringify(user)};
  const rows = [...document.querySelectorAll('.el-table__row')];
  const row = rows.find((r) => (r.textContent || '').includes(wanted));
  if (!row) return 'row not found: ' + wanted;
  const btn = row.querySelector(${JSON.stringify(editSel)});
  if (!btn) return 'edit button not found in row: ' + wanted;
  btn.click();
  return 'opened edit dialog for ' + wanted;
})()`;

/**
 * 在编辑弹窗里改密码并提交——只有真正改过密码的条目才有「修改历史」可拍。
 *
 * 必须限定在**可见**的 .el-dialog 内：Element Plus 关闭弹窗后会把节点留在 DOM 里，
 * 其中也含 el-button--primary（同 clickExact 的教训）。
 */
const changePassword = next => `(() => {
  const isVisible = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
  const dialog = [...document.querySelectorAll('.el-dialog')].filter(isVisible).pop();
  if (!dialog) return 'visible dialog not found';
  const el = [...dialog.querySelectorAll('input[type=password]')].find(isVisible);
  if (!el) return 'password input not found';
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  d.set.call(el, ${JSON.stringify(next)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const btn = [...dialog.querySelectorAll('button')]
    .filter(isVisible)
    .find((b) => (b.innerText || '').includes(${JSON.stringify(L.update)}));
  if (!btn) return 'update button not found';
  btn.click();
  return 'password rotated';
})()`;

const wait = ms => new Promise(r => setTimeout(r, ms));

const deleteSel = `button[aria-label=${JSON.stringify(L.delete)}]`;

/** 点开指定用户名所在行的删除按钮（弹出的是 ElMessageBox 确认框）。 */
const deleteRow = user => `(() => {
  const wanted = ${JSON.stringify(user)};
  const rows = [...document.querySelectorAll('.el-table__row')];
  const row = rows.find((r) => (r.textContent || '').includes(wanted));
  if (!row) return 'row not found: ' + wanted;
  const btn = row.querySelector(${JSON.stringify(deleteSel)});
  if (!btn) return 'delete button not found in row: ' + wanted;
  btn.click();
  return 'delete requested for ' + wanted;
})()`;

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
const csvPath = CSV_PATH ? resolve(CSV_PATH) : resolve(tmpdir(), 'aph-store-shots-demo-accounts.csv');
if (!CSV_PATH) writeFileSync(csvPath, DEMO_CSV, 'utf8');
await s.send('DOM.setFileInputFiles', { nodeId, files: [csvPath] });
await wait(3000);
console.log('confirm import:', await evalIn(s, clickPrefix(L.confirm)));
await wait(4000);
console.log('seeded rows:', await evalIn(s, `document.querySelectorAll('.el-table__row').length`));

// 收藏置顶：每点一次都要等列表重排 + 落盘，否则下一次按用户名找行会落在旧 DOM 上
for (const user of FAVORITE_USERS) {
  await wait(1500);
  console.log('favorite:', await evalIn(s, clickFavorite(user)));
}
await wait(2000);
// 收藏后按钮的 aria-label 会变成「取消收藏」，用它核对生效行数
console.log(
  'favorited rows:',
  await evalIn(s, `document.querySelectorAll(${JSON.stringify('.el-table__row ' + unfavSel)}).length`),
);

// 改两次密码制造历史：抽屉里的「修改历史」小节有记录才渲染
for (const user of HISTORY_USERS) {
  for (const pwd of ROTATED_PASSWORDS) {
    await wait(1500);
    console.log('history:', await evalIn(s, openEdit(user)));
    await wait(1800);
    console.log('history:', await evalIn(s, changePassword(pwd)));
    await wait(2200);
  }
}
console.log(
  'history records:',
  await evalIn(
    s,
    `(async () => {
      const r = await chrome.storage.local.get('password_change_history');
      return Array.isArray(r.password_change_history) ? r.password_change_history.length : 'missing';
    })()`,
  ),
);

// 移入回收站：确认框是 ElMessageBox，主按钮文案随语言（「移入回收站」/「Move to Trash」）
for (const user of TRASH_USERS) {
  await wait(1500);
  console.log('trash:', await evalIn(s, deleteRow(user)));
  await wait(1200);
  console.log('trash:', await evalIn(s, clickExact(L.moveToTrash)));
  await wait(2500);
}
console.log(
  'trash rows:',
  await evalIn(
    s,
    `(async () => {
      const r = await chrome.storage.local.get('account_passwords_trash');
      return Array.isArray(r.account_passwords_trash) ? r.account_passwords_trash.length : 'missing';
    })()`,
  ),
);
s.close();
