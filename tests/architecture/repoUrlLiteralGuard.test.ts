/**
 * 仓库 GitHub 地址单一真源守卫
 *
 * `utils/urls.ts` 把仓库地址收成 `REPO_GITHUB_URL`，其文件头写明这么做的理由是
 * 「避免同一地址在多处硬编码后各自漂移」。但侧边栏头部的 GitHub 按钮并没有消费该常量，
 * 而是在 `entrypoints/sidepanel/App.vue` 里又写了一遍同一条 URL —— 漂移已经发生，
 * 只是两侧当前恰好相同。
 *
 * 为什么不用「改成引用常量」来修 —— 三条都可从源码复算，不依赖任何一次构建产物：
 * 1. `utils/urls.ts` 被 popup / options / sidepanel / background 四个入口侧的模块共同引用
 *    （`popup/App.vue`、`options/{GuideView,HeaderBar,MasterPasswordSetupView,OnboardingTour}.vue`、
 *    `sidepanel/HelpDialog.vue`、`useVersionUpdate`、`shortcutCommands`、`updateChecker`），
 *    跨入口共享必然被 Rolldown 拆成独立 chunk；
 * 2. 侧边栏一侧唯一的消费者 `HelpDialog` 是 `defineAsyncComponent`（`sidepanel/App.vue:187`），
 *    所以这个 chunk 落在**按需**闭包、不在首屏 eager 闭包里；
 * 3. `sidepanelClosure.test.ts` 的 `EAGER_ALLOW_LIST['sidepanel.html']` 共 30 个基名、次数合计 33，
 *    而 `total` 预算也正是 33 —— **余量为 0**，且基名清单里没有 `urls`。
 * 于是让入口静态引用 `REPO_GITHUB_URL`，等于往零余量的首屏塞进一个未登记基名的 eager 文件，
 * 那条守卫必红，只能靠放宽 `total` 才能变绿。为消灭一处字面量重复而调松一条守着秒开 SLA 的
 * 产物预算，方向反了。所以这里改为**逐字钉住**这处例外：字面量必须仍与常量相同，
 * 且只允许出现在登记表里的那些文件。
 *
 * 四个漂移方向都会变红（均已用变异逐个验证过）：
 * - 地址改了（仓库改名/迁移）却漏改字面量 → 字面量不再等于任一常量；
 * - 别处新增了第三份硬编码 → 出现未登记文件；
 * - 例外被真正修掉（改用常量）→ 登记表出现失效条目，必须同步删除该行；
 * - 扫描器自己失配（正则/目录改名导致零命中）→ 上面第一条会**假绿**，
 *   由「登记表里的每个文件都真被扫到」这条正向对照兜住。
 */
import { describe, it, expect } from 'vitest';
import { REPO_GITHUB_URL, GITHUB_RELEASES_API_URL, GITHUB_RELEASES_PAGE_URL } from '@/utils/urls';
import { listSourceFiles, readSource } from '../helpers/architectureScan';

/** 扫描范围：会被打包进扩展产物的运行时代码（与 storageKeyLiteralGuard 同口径） */
const SCANNED_DIRS = ['composables', 'components', 'entrypoints', 'utils'];

/** 常量定义处本身当然允许出现这些字符串，不参与扫描 */
const DEFINITION_FILE = 'utils/urls.ts';

/** 被允许以字面量形态存在的文件（登记表必须与实际命中集合完全相等，见文件头） */
const TOLERATED_FILES = ['entrypoints/sidepanel/App.vue'];

/**
 * 引号包裹的 GitHub 地址字面量（含 api 子域）
 *
 * 三种定界符都认：单引号、双引号、反引号模板串。反引号那种（如
 * `` `https://github.com/${owner}/${repo}` ``）拼不出任何常量的值，正是要抓的新增硬编码。
 *
 * 只认「有定界符包裹」的形态：注释与文档里裸写的 `github.com` 一律是自然语言举例
 * （如自动保存黑名单的域名示例），把它算成违规会逼着人改注释而不是修真实耦合。
 * 内容类同时排除三种定界符——URL 里本就不会出现引号或反引号，这样换取「不会跨定界符误吞」。
 */
const QUOTED_GITHUB_URL = /(['"`])(https:\/\/(?:api\.)?github\.com\/[^'"`]+)\1/g;

/** 允许出现的地址全集：只能取自 `utils/urls.ts` 的常量 */
const KNOWN_URLS = new Set<string>([REPO_GITHUB_URL, GITHUB_RELEASES_API_URL, GITHUB_RELEASES_PAGE_URL]);

interface LiteralHit {
  file: string;
  url: string;
}

/** 扫描运行时代码，收集所有引号包裹的 GitHub 地址字面量 */
function collectGithubUrlLiterals(): LiteralHit[] {
  const hits: LiteralHit[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of listSourceFiles(dir)) {
      if (file === DEFINITION_FILE) continue;
      const source = readSource(file);
      QUOTED_GITHUB_URL.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = QUOTED_GITHUB_URL.exec(source)) !== null) {
        hits.push({ file, url: match[2] });
      }
    }
  }
  return hits;
}

describe('仓库 GitHub 地址单一真源', () => {
  const hits = collectGithubUrlLiterals();
  const filesWithLiteral = [...new Set(hits.map(hit => hit.file))].sort();

  it('扫描面确实读到了源文件（守卫不得静默空跑）', () => {
    // 逐目录断言而非只看总数：`listSourceFiles` 对不存在的目录返回 []，
    // 只断言总数的话，任一目录被改名/挪走都会被其余目录的文件数掩盖成假绿。
    const emptyDirs = SCANNED_DIRS.filter(dir => listSourceFiles(dir).length === 0);
    expect(emptyDirs).toEqual([]);
    // 定义处确实存在且确实定义了常量，避免目录改名后整条守卫空转
    expect(readSource(DEFINITION_FILE)).toContain(REPO_GITHUB_URL);
  });

  it('登记表里的每个文件都真被扫到（正向对照，防扫描器失配造成的假绿）', () => {
    // 只断言「登记 ⊆ 命中」而不是「登记表非空」：例外被真正修掉后登记表应当清空，
    // 那时本条与下一条都自然通过——守卫不该因为代码变好而变红。
    // 反过来，若正则失配或目录改名导致 hits 为空，登记表非空就会在这里暴露。
    const missing = TOLERATED_FILES.filter(file => !filesWithLiteral.includes(file));
    expect(missing).toEqual([]);
  });

  it('每处字面量都与 utils/urls.ts 的常量逐字相同', () => {
    const drifted = hits.filter(hit => !KNOWN_URLS.has(hit.url));
    expect(drifted).toEqual([]);
  });

  it('字面量只出现在登记表里的文件（登记表不得留失效条目）', () => {
    expect(filesWithLiteral).toEqual([...TOLERATED_FILES].sort());
  });
});
