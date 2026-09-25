---
title: 同一站点的账号该出现在哪些子域：跨子域名匹配三档的实现与踩坑
description: 精确 host 匹配是多环境隔离的立身之本，但真实登录常常横跨一整个子域家族。本文拆开跨子域名匹配三档的分层判据、主域名相等这条不能切的安全边界，以及 Chrome 把通配符编码成 %2A、让全部单元测试集体失声的那次真机踩坑。
tags: Chrome扩展,密码管理器,域名匹配,多环境测试,前端开发
date: 2026-09-22
author: liaolongdong
image: imgs/blog-cover-05-cross-subdomain-matching.png
---

# 同一站点的账号该出现在哪些子域：跨子域名匹配三档的实现与踩坑

![跨子域名匹配三档的实现与踩坑](imgs/blog-cover-05-cross-subdomain-matching.png)

自 2026-07 把匹配口径收敛成「精确 host 相等」以来，这条规则一直是这个扩展的多环境隔离底座：`fat.example.com` 的页面上不会看到 `uat.example.com` 或 `example.com` 的账号。它同时是最容易被用户碰到的一面墙——同一主域名下的账号，在别的子域里就是不出来。

这篇讲三档放宽的实现取舍，以及一个只有真浏览器能抓到的 bug。

## 精确匹配是对的默认，但登录不总是按域名边界发生

先说清楚：精确匹配不该被当成保守主义，它是**唯一能同时挡住两类事故**的默认值——`fat.example.com` 拿不到 `example.com` 的凭据，钓鱼站也拿不到任何长得像的东西。任何放宽都必须由用户显式选择，这条没得谈。

问题在于真实的登录链路本来就不以 hostname 为边界：

- 公司 SSO 在 `login.corp.example.com`，业务系统在 `app.example.com`，账号只有一条；
- QA 控制台在 `test-api.example.com`，而条目是按团队 wiki 上的地址录的，写的是 `api.example.com`；
- 子域数量多的站点（`mail` / `music` / `news` 这类）压根没人逐个子域存一遍，用户在网址字段手写了 `*.qq.com` 这种通配形态——这个写法以前是无效的：它既匹配不上任何 host，也会在导航时被补成 `https://*.qq.com/` 这种必然解析失败的主机名；
- 只在 apex 存过一条（`qq.com`），到了 `mail.qq.com` 就查无此人。

失败模式很清楚，但要给它一个不被滥用的解法，得先把「放宽」拆成不同强度的几档，而不是一刀切开子域匹配。

## 三档：off / wildcard / sameMainDomain

档位设置在密码管理页头部的「跨子域名匹配」弹窗里（`components/options/DomainMatchSettingDialog.vue`），三档是包含关系：

| 档位 | 标签 | 语义 |
| --- | --- | --- |
| `off`（默认） | 仅精确匹配 | 只看完整 hostname 相等的条目，网址为空的通用条目照常展示 |
| `wildcard` | 精确匹配 + 通配条目 | 额外纳入用户把网址写成 `*.qq.com` 的条目，适用范围由本人逐条声明 |
| `sameMainDomain` | 同主域名（更宽松） | 当前 hostname 没有自己的条目时，依次兜底主域名条目（`qq.com`）与同主域其他子域（`music.qq.com`），并在列表里标出来源 |

`sameMainDomain` 的选中项下面刻意展开一行只读警示：`fat.example.com` 与 `uat.example.com` 同属 `example.com`，开启后测试环境账号会一起出现，需要隔离请改用通配档。这是这一档唯一的新增风险，也是它排在最后的原因——`wildcard` 的放宽强度由用户逐条控制，`sameMainDomain` 是一次性对全站生效。

落盘只有 `domain_match_config` 一个键、值只有一个枚举，不含域名也不含账号，所以它走明文 `storage.local`，不进加密快照、不参与备份格式；缺键、读失败、值非法一律回落 `off`。侧边栏与内联下拉**不加重复开关**：同一份配置在三处出现，只是给后来者制造三个真源。

## 一个判据，两处填充路径

放宽的全部判断收在 `utils/domain.ts` 的一个纯函数里：

```ts
resolveMatchTier(currentHost, storedUrl, mode) → MatchTier | -1
```

返回值即排序权重：0 精确 host、1 通配条目、2 同主域 apex、3 同主域其他子域、4 网址为空的通用条目，`-1` 不匹配。`off` 档下只可能返回 0、4 或 -1，短路在精确比较分支里，不会额外去解析主域名——这条约束是靠基准守着的，见下文。判定「是不是跨子域命中」则是同一文件里的 `isCrossSubdomainTier`（即 tier 1~3）。

消费方是两个填充路径加一圈呈现：

- **侧边栏**：`utils/passwordFilter.ts` 决定本站可见集，`utils/passwordSort.ts` 决定顺序；「跨子域」徽章的唯一事实来源是 `entrypoints/sidepanel/App.vue` 里一个算好的 ID 集合，行组件只查表，不在每行重复解析域名；
- **内联下拉**：数据经后台 `getMatchingAccounts` 返回，条目元数据里多带一个 `tier`（纯数字，不含敏感字段），content script 据此决定要不要在副信息槽放「跨子域」来源 chip，自己不再做任何域名判断——「content 只收结论」这条既有边界不放宽；
- **一键填充与右键菜单**共用 `sortMatchesForDomain`（`entrypoints/background/quickFillHandler.ts`、`contextMenuManager.ts`），透传档位后自动继承同一顺序，首条即结果；
- **Popup 的「当前页面匹配 N 条」计数**（`composables/usePopupInit.ts`）、**空态的「同主域还有 N 条」引导计数**（`countSameMainDomainCandidates`）、**自动保存弹窗的更新去向提示**（`utils/storage/autoSaveManager.ts`）也读同一个判据。Popup 那个数字刻意继续排除空 URL 条目——它表达的是「这个站已经有几个账号」，不限站点的通用账号不该算进去，因此它与侧边栏的可见集是有意不同的两个口径；`localhost` 也照旧走精确 host。

这件事的价值不在少写几行，而在于「一条该不该出现在这个站点」永远只有一个答案。历史上这类功能最典型的烂法，是列表一份判断、填充一份判断，最后长出「下拉里能看到、点了没反应」和「侧边栏标了来源、内联下拉不标」两种自相矛盾。档位是条目的属性，不是每屏各算一遍的启发式。

## 不能切的那条边界：主域名相等，不是 endsWith

通配命中这一步，最自然的写法是 `hostname.endsWith('.qq.com')`，更省事的人会写 `hostname.endsWith('qq.com')`。第二种写法在演示里完全正常——演示环境没人会去 `evil-qq.com` 登录。它在生产里是凭据收集器：`evil-qq.com`、`myqq.com` 都以 `qq.com` 结尾，一条 `*.qq.com` 的条目会被端上这些页面，而用户是主动把密码敲进去的。

第一种写法看起来严谨得多，但它仍然是错的，错在另外的地方：它把「哪些后缀算同一家」交给了字符串比较，于是 `getMainDomain` 已经处理过的全部规则它都不继承——两段式 ccTLD（`example.com.cn`、`co.uk` 的主域名是三段）、未收录国家码的启发式、IP 与 `localhost` 原样返回的语义；要接住 apex 条目（`qq.com` 本身）还得再加一条特判，特判又会和另一处判断漂移。

最终实现只复用一条既有的可信边界：**主域名相等**。

```
storedHost 以 `*.` 开头 → base = 剥掉 `*.`
命中 ⟺ getMainDomain(currentHost) === getMainDomain(base)
```

同一个 `getMainDomain` 也用于跨域 iframe 的委托闸门，两处同口径意味着只有一份实现会被修 bug。顺带一个方向性的细节：`getMainDomain` 的启发式分支只会把主域名判得更**具体**（三段而非两段），也就是说它在任何输入下都只收窄匹配、不会新增匹配——这正是密码学之外的另一类「失败要朝安全侧倒」。

## Chrome 的 URL 解析器把 `*` 编码了

首跑真机 Playwright 的时候，`wildcard` 档什么都没放出来。

单测里 `resolveMatchTier('mail.qq.com', '*.qq.com', 'wildcard')` 返回 1，稳定通过。区别在于条目网址进入匹配函数之前要先过一遍 `normalizeToHostname`，而它内部用 `new URL()` 解析。`*` 不是合法的 host 码点：Chrome 给出 `%2A.qq.com`（且不会把 `%2A` 解回 `*`），Node.js 原样保留 `*`。于是真机上送到判据里的 storedHost 是 `%2A.qq.com`——不以 `*.` 开头，不进通配分支；`sameMainDomain` 档下它的主域名又恰好等于当前页的主域名，于是被错排到 tier 3「兄弟子域」，位置和徽章一起错。

结果就是：**单元测试全绿，真实浏览器里一个字符都没放宽。** 修法是显式还原通配标记（`utils/domain.ts` 的 `restoreWildcardMarker`），并且两个规范化入口都要补——`normalizeToHostname` 之外还有带端口的 `normalizeToHostAndPort`，它同样充当匹配键，只修一个等于修了半个。

这条 bug 的教训不是「要用真机测试」这种正确的废话，更具体一点：**测试运行时和线上运行时是两台 URL 解析器。** 只要判定逻辑的输入经过 URL / 路径 / 国际化之类的解析或规范化，Node 环境跑绿的等价性就只是必要条件。这条路径现在由 `e2e/cross-subdomain.spec.ts` 钉住——它经真实的档位弹窗改配置、观察已打开面板的列表与徽章变化，全程不重新验证主密码，那段 storage 监听 + 消息 + Vue 响应式的链路是单测的桩永远打不到的。

## 放宽刻意没碰的三件事

1. **自动保存判重一字未动。** 保存走的是 `utils/storage/autoSaveManager.ts` 里既有的 `findMatchingEntry`（同名 + host 相等或父子域，多条命中取最精确一条），不因档位而改变，否则「开启跨子域」就变成了「开启之后我的数据可能被写到别的站」——那是不可逆的。档位带来的只是两行只读提示：更新的是别的 host 上的同名账号时写清楚是哪个，同主域存在同名但没判重命中时说明这次会新增一条。另外 `utils/storage/passwordCrud.ts` 里按网址查询的函数保持精确 host 语义，并在 JSDoc 里明写「不走跨子域档位」，防止后来者把它误当放宽版的入口。
2. **`localhost` / `127.0.0.1` 始终按端口区分。** 本地多项目场景里 `:3000` 和 `:8080` 是两个应用，档位在这里毫无意义，所以这两条域名走 `matchesPortForLocalDev` 的端口过滤，判据完全不参与。
3. **切档不失效已解密的密码缓存。** 过滤发生在解密之后，档位只改变「哪些条目进入结果」，不改变任何密文。如果把它放进缓存失效键，每次调档都会删掉 `storage.session` 快照并触发全量解密回温，直接破坏有文档承诺的侧边栏秒开 SLA。这条边界由一个源码扫描测试钉住，理由很简单：它一旦被「顺手加进 relevantKeys」，功能上完全看不出来。

## 放宽到底花多少钱

数据来自项目自己的 Vitest 基准 `benchmarks/sidepanel-p0.bench.ts`（同一份多环境夹具内跨档比较，绝对值不与其他夹具互比）：

| 场景 | `off` | `sameMainDomain` |
| --- | --- | --- |
| 侧边栏本站管线，2000 条 | 5.9ms | 9.9ms |
| 侧边栏本站管线，600 条 | 1.6ms | 2.7ms |
| 「跨子域」徽章扫描（2000 条） | 零遍历（共享空集） | 约 2.9ms |
| 空态放宽计数（2000 条） | 5.6–5.7ms | 恒为 0（无可放宽空间） |

内容脚本包体积从 217,062 字节涨到 217,080 字节，+18 B——判据是纯函数、被 tree-shaking 完整吸收，这是它该待的位置。

三点说明，避免这组数字被过度解读：第一，它们是 JS 取数层的耗时，不是端到端渲染时间，侧边栏列表早已做窗口化，首帧成本与档位无关；第二，徽章扫描和空态计数都是惰性求值，`off` 档默认路径不付这笔钱；第三，结论是**放宽档不需要任何性能改造**，最贵的一格是 9.9ms 级别的个位到两位数毫秒，而它换来的是「同站账号跨子域可见」。

## 测试面与门禁

今天仓库有 1337 个自动化用例、分布在 119 个测试文件。与这块直接相关的覆盖是：`resolveMatchTier` 的分层用例（`off` 档与迁移前精确口径一致、`wildcard` 只额外放行通配、`sameMainDomain` 的 1 → 2 → 3 序列、apex 页面自身、被编码成 `%2A` 的通配标记、两段式 ccTLD、IP 与非法输入降级、当前页无域名的短路），一条「前缀碰撞不被绕过」的安全回归（`evil-qq.com` / `notqq.com` / `mail.qq.com.evil.io` 对 `*.qq.com` 一律返回 -1），`filterAndSortEntriesForDomain` 在 `off` 档下「集合与顺序逐 id 一致」的等价性守卫与放宽档的优先级序列测试（通配排在 apex 之前、本地开发域名三档结果一致），内联下拉三档各带一枚来源 chip 的呈现测试，以及上面提到的那条 e2e。

比较特别的是 `tests/architecture/crossSubdomainTierWiring.test.ts`：它不测行为，扫源码。因为「四处消费方必须同口径」这种不变量，最容易的死法是某个新调用忘了传档位参数——而参数带 `off` 默认值时，类型检查和 ESLint 全程静默。真实形态就发生过一次：侧边栏整行点击走了档位感知的判定，键盘回车却吃了形参默认值，跨子域条目「点得到、回车打不开」。同一个文件还机械禁止运行时代码再手写 `tier >= 1 && tier <= 3` 这类区间比较，把区间的唯一定义处锁死在 `isCrossSubdomainTier` 里。这类「两处必须一致」的约束，靠自觉一定会漂移，靠扫描器不会。

## 如果你也碰到同样的问题

先在 `mail.qq.com` 上想想自己真正要的哪一种：只是想让某几条账号跨子域（`wildcard` 档 + 手写 `*.qq.com`），还是整个子域家族都要放开（`sameMainDomain` 档，注意它会把 `fat` / `uat` 一起带出来）。开关在密码管理页头部的「跨子域名匹配」里，改完立即生效，不需要重新解锁。

账号与密码数据仍按既有方式在本地加密存储，这次功能没有新增任何权限，也没有新增网络请求；扩展自身唯一的周期性请求，是每 6 小时一次的匿名版本检查。

源码与讨论：[GitHub 仓库](https://github.com/liaolongdong/account-password-helper)。已上架 [Chrome 应用商店](https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli)，完全免费，GPL-3.0 开源。

---

_本文涉及的关键文件：`utils/domain.ts`（`resolveMatchTier` / `isCrossSubdomainTier` / `getMainDomain` / `restoreWildcardMarker`）、`components/options/DomainMatchSettingDialog.vue`（档位弹窗）、`utils/passwordFilter.ts` 与 `utils/passwordSort.ts`（侧边栏可见集与排序）、`entrypoints/background/passwordCache.ts`（内联下拉与一键填充的取数）、`entrypoints/content/inlineDropdown/InlineFillDropdown.ts`（来源 chip）、`tests/architecture/crossSubdomainTierWiring.test.ts`（接线守卫）、`e2e/cross-subdomain.spec.ts`（真机回归）、`benchmarks/sidepanel-p0.bench.ts`（跨档基准）。_
