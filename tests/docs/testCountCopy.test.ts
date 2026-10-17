/**
 * 「N 项自动化测试 / 分布在 M 个测试文件」的对外口径守卫
 *
 * 这两个数字在 31 个文件、48 个落点被写死：README 中英、`llms.txt`、落地页中英的指标位、
 * 产品站的统计卡与页脚、微博/公众号的事实基线行、五篇博客的中英源文与 `pnpm gen:blog` 生成的
 * HTML、两张封面 SVG 与 `imgs/blog-covers/outline.md`。2026-10-13 一天之内它错了两次：先按
 * 合并前的树刷成 2786，合并后重测刷成 2847，而 2847 来自一次**负载争用的并行跑**（当时只收集到
 * 215 个文件，新增的守卫没被算进去），真实读数是 216 文件 / 2868 例——35 处落点当时齐刷刷写着
 * 同一个错数，因为博客 HTML 与封面 PNG 都是从那个错数派生的。（本守卫自己入树后，同一棵树的重测
 * 读数是 217 文件 / 2873 例；2026-10-14 同分支又并进 `siteRuleFieldTipAlignment`（+1 文件 / +3 例）
 * 和命令面板条数守卫补的 2 例，串行重测漂到 218 文件 / 2878 例；同日 PR #131 合入 main 之后，
 * 另一批（PR #133 的 `tests/scripts/buildWebAssets.test.ts`，+1 文件 / +10 例）继续前进，
 * 在合并后的树上串行重测漂到 219 文件 / 2888 例；2026-10-15 波次 2（缺陷修复 + 动效 +
 * 就绪门 + 图标状态 + 秒开带）新增 11 个测试文件并改动 6 个，串行重测漂到 230 文件 / 2994 例；
 * 2026-10-16 缺陷复查收口（填错框 / 写后复检 / 后台判死补提示 / 注入 UI 事件隔离 / 总闸回灌 /
 * 回执档位，`b2490bd..cf310a2` 共 15 笔）新增 8 个测试文件并改动 5 个，同一棵树串行重测漂到 238 文件 /
 * 3058 例；同日页面个人信息字段提示（`piiClassifier` 分层判定 + 召唤式气泡 + `OPEN_OPTIONS_AND_IDENTITY`）
 * 新增 6 个测试文件并改动 3 个，工作树串行重测漂到 **244 文件 / 3165 例**，即下面这些落点当前应有的值——
 * 这三笔增量的可对账来源分别是 `git diff --name-status 698bcae..HEAD -- tests/`（A 那 11 行即 +11 文件）、
 * `git diff --name-status b2490bd..HEAD -- tests/`（A 那 8 行即 +8 文件），以及本轮的 6 个未跟踪新文件
 * （`piiClassifier` 46 例 / `identityHint` 17 / `identityHintRoles` 14 / `formDetector.identityHint` 11 /
 * `useRuntimeMessageHandler.identityVault` 8 / `identityHintWiring` 5 = +101）加存量 3 个文件的 +6
 * （`senderValidation` 53 → 56、`settingsPanelView.updateConfigSwitch` 4 → 6、`configManager.fillmode` 6 → 7），
 * 101 + 6 恰等于 3165 − 3058。
 * 2026-10-17 这一轮要额外记一件事：`435ba0c..87b2ecb` 共 7 笔，其中 5 笔动了 `tests/`（回收站 + 填充评审 +
 * 字段分档等），落进仓库时没带对外数字，所以 3165 在 HEAD 上就已经过期了——漂 +45 例 / +1 文件（HEAD 侧
 * 推算 3210 / 245，靠两侧各跑一次 `--reporter=json` 取变更文件的 `assertionResults.length` 差值闭合，
 * 不按提交归因例数：`435ba0c` 侧那 9 个改动的文件共 99，HEAD 侧同样 9 个共 130，加唯一的新文件
 * `identityTrashManager` 14＝HEAD 侧 10 个共 144）。本波（遮蔽框结构性排除 + 让位判据改
 * `shouldShowSidePanel` + 真机 e2e 八条）再加 4 例（`piiClassifier` 65 → 67、`formDetector.identityHint` 11 → 13），
 * 与上节同构的隔离树串行重测定稿 **245 文件 / 3214 例、0 skipped**（那是那一轮刷数时 48 处落点的值）。
 * 再往下一轮（同页演示台账本 + 姓名值预填检索词）在工作树上串行重测漂到 **247 文件 / 3251 例、0 skipped**，
 * 净差 +37 例 / +2 文件按文件逐项闭合：新文件 `piiClassifier.demoPage` 5、`piiClassifier.selfNameValue` 12，
 * 改动的五个文件 `piiClassifier` 67 → 73、`identityHint` 17 → 22、`senderValidation` 56 → 59、
 * `useRuntimeMessageHandler.identityVault` 8 → 11、`identityHintWiring` 5 → 8（两侧读数各取一次
 * `vitest run --reporter=json` 的 `assertionResults.length`，HEAD 侧在 detached worktree 里跑，5 个旧文件 Σ=153，
 * 工作树侧同样 5 个 Σ=173，加两个新文件 17 = 190，190 − 153 = 37）。
 * 2026-10-17 最后一轮（形状补漏 + 只读门 + 让位收窄 + 卡类三档，同日还并进了一笔深链改判）在 `fc1d743` 的
 * 隔离树串行重测漂到 **247 文件 / 3281 例、0 skipped（312.17s）**，即下面这些落点当前应有的值。文件数不变
 * （本轮没新增测试文件），+30 例按这轮动过的 9 个测试文件闭合：`piiClassifier` 73 → 107（+34）、
 * `formDetector.identityHint` 13 → 18（+5），反向三处 −11 全在深链改判那条线上（`senderValidation` 59 → 58、
 * `useRuntimeMessageHandler.identityVault` 11 → 5、`identityHintRoles` 14 → 12——角色→类别映射函数失去唯一
 * 消费者，相关用例随之下线）；两侧各跑一次 `vitest run --no-file-parallelism --reporter=json` 取这 9 个文件的
 * `assertionResults.length`，base 侧 Σ=217、HEAD 侧 Σ=247（这 247 是 9 个文件的例数，与全仓 247 个测试文件
 * 只是数字撞上了），247 − 217 = 30 恰等于 3281 − 3251，残差为零。
 * 2026-10-17 再下一轮（覆盖面账本 + 机构证照号抬到全层 + 演示台五类场景）新增 1 个测试文件
 * `piiClassifier.coverage.test.ts`，全量重测漂到 **248 文件 / 3437 例、0 failed（132.77s，默认形状）**。
 * 这一轮账极好对：+1 文件 / +156 例全落在那张新表里，其余文件一个没动（`piiClassifier` 107、
 * `formDetector.identityHint` 18、`identityHintRoles` 12 与上一行同读数），3281 + 156 = 3437 直接闭合。
 * 中途它先是 3436：覆盖面账本第一版收 155 条，收口时把「法定代表人统一社会信用代码仍不出提示」补成
 * 第 156 条（那是词典 `idNumber` 档与第 3.5 层人主体豁免撞出的错提示，删掉词典里那条短语才判得对），
 * 于是这 48 处落点跟着再走一格——产品站那两处是千分位形态 `3,437`，派生的 12 页博客 HTML、`en.html`
 * 与两张封面 PNG 由 `gen:blog` / `gen:en` / `covers:render` 重跑跟上。
 * 2026-10-17 再下一轮（总开关评估 → 关闸那一下收起屏上那枚气泡）没新增测试文件，只在
 * `formDetector.identityHint` 加了一条带两把负对照的用例（18 → 19），同一棵隔离树（detached worktree，
 * 与提交同构）`vitest run --no-file-parallelism` 串行重测定稿 **248 文件 / 3438 例、0 skipped（142.24s）**；
 * 账是 +1 = 3438 − 3437 直接闭合，13 个文件数落点因此原地不动，35 个用例数落点各走一格
 * （产品站两处仍是千分位 `3,438`），派生物照旧走 `gen:blog`（12 页）→ `gen:en`（256/256 与 16/16、
 * FAQ DOM 42 三条计数不变）→ `covers:render`（只有 04/05 两张 PNG 变）。
 * 同一轮 `piiClassifier.demoPage.test.ts` 的整页扫描从 100 行涨到 126 行，五个 `it` 各扫一遍，
 * 第一条在满负载的全量跑里撞上 5s 默认超时（那一次读数 248 / 3436、1 failed，红的是量具不是判定）；
 * 改成 `beforeAll` 扫一次、五条共用，并把钩子超时写到 30s，才是它该有的形状。
 * 2026-10-17 再下一轮（「难记的号码」缺口勘察 → 词典补漏 + 四条误报收窄）也没新增测试文件，
 * +54 例全部落在覆盖面账本 `piiClassifier.coverage.test.ts`（156 → 210），其余 247 个文件一条没动；
 * 同一轮演示台夹具加 10 行（整页受检字段 126 → 136），但它吃的是 `piiClassifier.demoPage.test.ts`
 * 那 5 条现成用例，例数不因夹具涨而变。工作树串行重测（`--no-file-parallelism --reporter=json`，
 * 248 个文件全部收集）读数 **248 文件 / 3492 例、0 failed、0 pending**，3438 + 54 = 3492 直接闭合；
 * 同一轮把七道门禁跑在与会提交那棵树同构的 detached worktree 上，串行全量还是 248 / 3492、0 skipped，
 * 所以这个数不是在改动堆里量出来的那一份；
 * 13 个文件数落点原地不动，35 个用例数落点各从 `3438` 走到 `3492`（产品站两处仍是千分位 `3,492`），
 * 派生物照旧走 `gen:blog`（12 页）→ `gen:en`（256/256 与 16/16、FAQ DOM 42 三条计数不变）→
 * `covers:render`（04/05 两张 PNG 变）。
 * 顺带一条量具教训：`vitest run <a> <b> <c>` 在 zsh 里传 `$FILES` 变量会被当成**一个**参数（zsh 不默认
 * 分割未引号变量），收集到 0 文件、`--reporter=json` 照样吐出结构完整的空报告且 exit=1——
 * 「Σ=0」是量具没跑，不是「这些文件没有用例」。本轮第二次踩中同一条（先例就写在上面这段里），
 * 所以判据只认形状：`numTotalTests: 0` + `success: false` + exit 非 0 ＝ 量具没跑，先看命令再看数。
 * 它本身就是「加一个测试文件数字就漂」的现场例证，也是「分支上数对了 ≠ 合并后还对」的例证。）
 *
 * **判据边界（不要高估这条守卫的能力）**：用例数与文件数都没有可以在单测内推导的真源——
 * 只有真跑一次全量才知道。所以这里只做三件事：
 * 1. 48 处必须两两同值（漏改任一处、中英只改一侧、源文改了没重跑 `gen:blog` / `gen:en` /
 *    `covers:render` 导致派生物滞后，都会红）；
 * 2. 形状与比例自检（用例数四位数起、且不少于文件数，防把文件数当用例数抄）；
 * 3. 取数非空且落点数等于登记数（锚点失配会静默空跑，这条把「扫到了吗」也记账）。
 * **全体一致地写错它拦不住**（本次的 2847 就是），所以每合一批代码仍须当场重跑全量取真数再刷，
 * 顺序与判据见 `docs/operations/exposure-status.md`。
 *
 * 另注：这里刻意**不**拿 `tests/` 下 `.test.ts` 的实际个数当判据。若那样写，任何新增一个测试文件
 * 的 PR（含贡献者 PR）都会因为 13 处文案未同步而 CI 红，而用例数本来就只能靠重跑同步——把一个
 * 拦不住的滞后换成另一个更烦人的硬闸，不划算。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

/** 一处对外文案：文件 + 捕获用例数的正则 + 捕获文件数的正则（该落点没写文件数时为 undefined） */
interface CopySite {
  file: string;
  label: string;
  cases: RegExp;
  files?: RegExp;
}

/** 数字形态允许千分位（产品站用 `2,868`，其余表面用 `2868`），统一去逗号后比数值 */
function digits(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

const CASES = /(\d[\d,]{2,})\s*(?:项自动化测试|项测试兜底|个自动化用例)/g;
const CASES_EN = /(\d[\d,]{2,}) automated test(?:s| cases)/g;
const FILES_ZH = /分布在 (\d[\d,]{2,}) 个测试文件/g;
const FILES_EN = /across (\d[\d,]{2,}) test files/g;

const COPY_SITES: CopySite[] = [
  // —— README 与 llms.txt ——
  { file: 'README.md', label: 'README 首屏徽标行', cases: /🧪 ([\d,]{3,}) 项自动化测试/g },
  { file: 'README.en.md', label: 'README（英文）首屏徽标行', cases: /🧪 ([\d,]{3,}) automated tests/g },
  {
    file: 'llms.txt',
    label: 'llms.txt 质量行',
    cases: /(\d[\d,]{2,}) automated test cases/g,
    files: FILES_EN,
  },

  // —— 落地页与产品站 ——
  {
    file: 'index.html',
    label: '落地页指标位',
    cases: /<b>(\d+)<\/b>\s*<span data-i18n="metrics\.cases">/g,
  },
  {
    file: 'en.html',
    label: '英文落地页指标位（gen:en 产物）',
    cases: /<b>(\d+)<\/b>\s*<span data-i18n="metrics\.cases">/g,
  },
  {
    file: 'product-site/index.html',
    label: '产品站统计卡与页脚',
    cases: /<b>([\d,]{3,}) 项<\/b><span>自动化测试|· ([\d,]{3,}) tests ·/g,
  },

  // —— 待投递的运营成稿 ——
  {
    file: 'docs/operations/微博-账号密码管理助手.md',
    label: '微博事实基线与正文',
    cases: /(\d[\d,]{2,}) 项(?:自动化)?测试/g,
  },
  {
    file: 'docs/operations/公众号-账号密码管理助手.md',
    label: '公众号事实基线与正文',
    cases: CASES,
  },

  // —— 博客源文（五篇 × 中英）——
  {
    file: 'docs/blog/zh/01-local-first-password-manager.md',
    label: '博客 01 中文源文',
    cases: CASES,
  },
  {
    file: 'docs/blog/en/01-local-first-password-manager.md',
    label: '博客 01 英文源文',
    cases: CASES_EN,
  },
  {
    file: 'docs/blog/zh/02-mv3-sidepanel-sub-second-open.md',
    label: '博客 02 中文源文',
    cases: CASES,
    files: FILES_ZH,
  },
  {
    file: 'docs/blog/en/02-mv3-sidepanel-sub-second-open.md',
    label: '博客 02 英文源文',
    cases: CASES_EN,
    files: FILES_EN,
  },
  {
    file: 'docs/blog/zh/03-webcrypto-encryption-in-practice.md',
    label: '博客 03 中文源文',
    cases: CASES,
  },
  {
    file: 'docs/blog/en/03-webcrypto-encryption-in-practice.md',
    label: '博客 03 英文源文',
    cases: CASES_EN,
  },
  {
    file: 'docs/blog/zh/04-login-flow-details.md',
    label: '博客 04 中文源文',
    cases: CASES,
    files: FILES_ZH,
  },
  {
    file: 'docs/blog/en/04-login-flow-details.md',
    label: '博客 04 英文源文',
    cases: CASES_EN,
    files: FILES_EN,
  },
  {
    file: 'docs/blog/zh/05-cross-subdomain-matching.md',
    label: '博客 05 中文源文',
    cases: CASES,
    files: FILES_ZH,
  },
  {
    file: 'docs/blog/en/05-cross-subdomain-matching.md',
    label: '博客 05 英文源文',
    cases: CASES_EN,
    files: FILES_EN,
  },

  // —— `pnpm gen:blog` 的产物：源文改了没重跑生成链，这里就会红 ——
  {
    file: 'blog/01-local-first-password-manager.html',
    label: '博客 01 中文页（gen:blog 产物）',
    cases: CASES,
  },
  {
    file: 'blog/01-local-first-password-manager.en.html',
    label: '博客 01 英文页（gen:blog 产物）',
    cases: CASES_EN,
  },
  {
    file: 'blog/02-mv3-sidepanel-sub-second-open.html',
    label: '博客 02 中文页（gen:blog 产物）',
    cases: CASES,
    files: FILES_ZH,
  },
  {
    file: 'blog/02-mv3-sidepanel-sub-second-open.en.html',
    label: '博客 02 英文页（gen:blog 产物）',
    cases: CASES_EN,
    files: FILES_EN,
  },
  {
    file: 'blog/03-webcrypto-encryption-in-practice.html',
    label: '博客 03 中文页（gen:blog 产物）',
    cases: CASES,
  },
  {
    file: 'blog/03-webcrypto-encryption-in-practice.en.html',
    label: '博客 03 英文页（gen:blog 产物）',
    cases: CASES_EN,
  },
  {
    file: 'blog/04-login-flow-details.html',
    label: '博客 04 中文页（gen:blog 产物）',
    cases: CASES,
    files: FILES_ZH,
  },
  {
    file: 'blog/04-login-flow-details.en.html',
    label: '博客 04 英文页（gen:blog 产物）',
    cases: CASES_EN,
    files: FILES_EN,
  },
  {
    file: 'blog/05-cross-subdomain-matching.html',
    label: '博客 05 中文页（gen:blog 产物）',
    cases: CASES,
    files: FILES_ZH,
  },
  {
    file: 'blog/05-cross-subdomain-matching.en.html',
    label: '博客 05 英文页（gen:blog 产物）',
    cases: CASES_EN,
    files: FILES_EN,
  },

  // —— 封面（`covers:render` 的输入；PNG 是二进制，只能钉 SVG 源）——
  {
    file: 'imgs/blog-covers/outline.md',
    label: '封面文案大纲 04 与 05',
    cases: CASES,
  },
  {
    file: 'imgs/blog-covers/blog-cover-04-login-flow-details.svg',
    label: '封面 04 SVG',
    cases: CASES,
  },
  {
    file: 'imgs/blog-covers/blog-cover-05-cross-subdomain-matching.svg',
    label: '封面 05 SVG',
    cases: CASES,
  },
];

/**
 * 一条正则可能用多个分支各捕获一组（如产品站的 `m1`/`m2`），取每次匹配里非空的那个数字。
 * 入参正则一律带 `g`，`matchAll` 不推进 `lastIndex`，因此同一文件内多处同形数字都能数到。
 */
function numbersIn(source: string, pattern: RegExp): number[] {
  const found: number[] = [];
  for (const match of source.matchAll(pattern)) {
    const raw = match.slice(1).find(group => group !== undefined);
    if (raw !== undefined) found.push(digits(raw));
  }
  return found;
}

/** 扫出一个落点集里全部数字，并按「文件 : 标签 : 值」保留可定位的错值现场 */
function scan(pick: (site: CopySite) => RegExp | undefined): { value: number; where: string }[] {
  const hits: { value: number; where: string }[] = [];
  for (const site of COPY_SITES) {
    const pattern = pick(site);
    if (!pattern) continue;
    for (const value of numbersIn(readSource(site.file), pattern)) {
      hits.push({ value, where: `${site.file} · ${site.label}` });
    }
  }
  return hits;
}

describe('「N 项自动化测试」的对外口径', () => {
  const caseHits = scan(site => site.cases);
  const fileHits = scan(site => site.files);

  it('取数非空且落点数等于登记数（锚点失配会静默空跑，这条先自证扫到了）', () => {
    // 用例数 35 处：README 2 + llms 1 + 落地页 2 + 产品站 2 + 微博 2 + 公众号 2
    //              + 博客源文 10 + 博客产物 10 + 封面 3
    // 文件数 13 处：llms 1 + 博客源文 6（02/04/05 中英）+ 博客产物 6
    expect(caseHits.length).toBe(35);
    expect(fileHits.length).toBe(13);
  });

  it('35 个用例数落点写的是同一个数（漏改任一处、只改一侧语言、生成链没重跑都会红）', () => {
    const distinct = [...new Set(caseHits.map(h => h.value))];
    expect(
      distinct.map(
        v =>
          `${v}: ${caseHits
            .filter(h => h.value === v)
            .map(h => h.where)
            .join(' | ')}`,
      ),
      `对外用例数出现了 ${distinct.length} 个不同值`,
    ).toHaveLength(1);
  });

  it('13 个文件数落点写的是同一个数', () => {
    const distinct = [...new Set(fileHits.map(h => h.value))];
    expect(
      distinct.map(
        v =>
          `${v}: ${fileHits
            .filter(h => h.value === v)
            .map(h => h.where)
            .join(' | ')}`,
      ),
      `对外文件数出现了 ${distinct.length} 个不同值`,
    ).toHaveLength(1);
  });

  it('形状自检：用例数四位数起、文件数三位数起，且用例数明显多于文件数（防把两个数抄反）', () => {
    const cases = caseHits[0].value;
    const files = fileHits[0].value;
    expect(cases).toBeGreaterThanOrEqual(1000);
    expect(files).toBeGreaterThanOrEqual(100);
    // 当前实测约 13 条用例/文件；留足余量，只挡「数量级写歪」
    expect(cases).toBeGreaterThan(files * 2);
  });

  it('中英两侧的表述成对出现（只刷一种语言会留下另一种的旧数）', () => {
    const zhFiles = fileHits.filter(h => h.where.includes('中文')).map(h => h.value);
    const enFiles = fileHits.filter(h => /英文|en\b/.test(h.where)).map(h => h.value);
    expect(zhFiles.length).toBeGreaterThan(0);
    expect(enFiles.length).toBeGreaterThan(0);
    expect([...new Set([...zhFiles, ...enFiles])]).toEqual([fileHits[0].value]);
  });
});
