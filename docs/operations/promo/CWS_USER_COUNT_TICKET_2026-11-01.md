# 商店用户数不展示：工单草稿 + 后台核对清单（2026-11-01）

> ✅ **2026-11-02 结案更新：计数已恢复，现值 53 用户——本工单降级为「不必提交」。**
> 实测三处一致：详情页 `div.F9iKBc` 文本为「扩展程序工具**53 用户**」（`?hl=zh`）、shields `chrome-web-store/users` 连续三次读到 **53**、同批对照 AdBlock 读到 `65M`（说明这一路一直是通的，此前的 `not found` 就是**同一件事的另一面**：Google 挂起复核时把展示位整块撤下，抓取方自然读不到）。
> **定案（2026-11-02 三次订正：前两版结论都被硬数据证伪）**：后台「安装次数」30 天合计 **135**（日值 0–8，10-31 最高 25）、「卸载次数」30 天合计 **16**（日值 0–3，10-30 为 0）——**周活从 130 冲到 15,190 再塌回 53 的全程，商店安装量一条线都没动**。因此：①「装机本就约 1.5 万」不成立——按 135/月的速率不可能攒出 1.5 万个「当周活跃」的已装 profile；②「一波装了不用的安装随实验结束消失」也不成立——既没有安装尖峰，也没有卸载尖峰。
> **唯一站得住的解释**：那 15,190 个「活跃」**不是从商店安装进来的**，而是被批量装载进浏览器的扩展实例。两条典型路径：**企业策略／MDM 强制安装**（force-install 的扩展在每次浏览器会话自动运行，每个 profile 每周都被记为活跃；策略一撤，整批同时退出 7 天窗口）或 **Chrome 侧的实验性自动装载**。两者共同点正是「**不产生商店安装次数，但产生活跃 profile**」，与「整批进、整批出、期间安装量平直」的形状完全吻合。
> **15,190 的形状反推（把「窗口读数」还原成「事件」）**：周活是滚动 7 天窗口，曲线 10-13 起爬、10-22 见顶、10-23 平台、之后约 8 天滑回基线 → 底层事件本身约持续 **10-13～10-24 十二天**，日均 **15,190 ÷ 7 ≈ 2,170 个 profile 在跑这个扩展**。同期商店安装量 0–8/天、卸载 0–3/天，十二天满打满算不足 100 次安装——**与 2,170/天 差两个数量级**，所以这批 profile 要么早已装好、要么根本没经过商店。真实问题不是「某天突然 1.5 万」，而是「连续 12 天、每天约 2,170 个浏览器实例被批量记为活跃，然后整批停止」。
> **两类候选原因（缺两条证据，暂不能二选一）**：① **组织级批量装载**——企业策略／MDM 推送、镜像预装、或自动化／QA 的 profile 池（不进商店安装统计，但扩展会在每次浏览器会话自动运行，于是每个 profile 每周都被记活跃；项目结束整批退出窗口）；② **Google 侧的实验或统计事件**——Chrome 自动装载实验，或「每周用户数」在 GA4 口径迁移期按实例重复计数。**定案判据**：「展示次数」在 10-13～10-24 暴涨 → 偏向 ②；平直 → 偏向 ①；地区／语言分布高度集中 → ①，分散全球 → ②。
> **⚠️ 自我降温一处**：上一版写「10-31 安装 25 是全月最高、恰在公开计数恢复之后，不是巧合」——这句因果推断**过强**。10-30 与 10-31 合计 43 次，是 10-02～10-29 日均 3.29 的 **13 倍**，同样属于「偏离基线的突发」，**完全可能是同一类批量装载走商店渠道**（例如某团队在部署）。判据：看 11-01～11-07 安装是否回到个位数、以及这批安装之后的周活有没有留住。**在拿到这两条之前，不得把 43 次当「转化恢复」写进任何表面。**
> **真实基线（可对外引用的唯一口径）**：装机速率约 **135/月**、卸载约 **16/月**（净 +119/月）、周活 **50–140**；商店公开数即周活跃（2026-11-02 读数 53）。**禁止**把 15,190 当装机或当增长引用；**禁止**把 53 写成「53 人装了」。附带一条正向观察：10-31 安装次数 25 是全月最高、卸载 0，恰好落在公开计数恢复之后的那几天——**详情页有数字与转化回来同时发生，不是巧合**。
> **后台 CSV 精算（2026-11-02，安装/卸载两份导出，覆盖 10-02～10-31）**：安装合计 **135**（日均 4.50、中位 3、最大 25）、卸载合计 **16**（日均 0.55、最大 3）、净增 **+119**、卸载/安装 **11.9%**；10-02～10-29 为 92（日均 3.29），**10-30 与 10-31 两天 43 占全月 31.9%**。**最要紧的一条**：10-25～10-31 那一周新装 **57**，而同周周活 **53** —— **周活几乎全部由当周新装构成，存量装机基本静默**（老用户活跃约在个位到十几）。**三层口径**：① 对外可引用的「用户数」= 周活跃 **50–140**；② 装机存量**未测**，按 10 月速率外推大致 **几百～1,500、最可能 500–1,000**（假设历史速率与 10 月同量级，属外推非测量）；③ 真正每天在用的人 = **每周几十**。要把②变成测量：把后台时间范围切到最长再导出安装/卸载 CSV，累加相减即得。
> **因此下面这份工单不要再提交**：没有处罚痕迹（在架状态正常、商店搜索仍排第一、评分正常、无违规提示），而正文里「10 月从数百增长到约 1.5 万」现在已有官方反证。**唯一保留的用途**：若后台「安装量和卸载量」「展示次数」两张图指向非自然安装（安装量与周活同步暴涨、卸载量同窗口异常高、地区高度集中），再用它自证。
> **对外可引用的数字只有一个：53 用户（2026-11-02 商店公开读数）。** 15,190 是周活指标峰值，禁止当装机量引用。

> 🎯 **这份文件解决一件事**：详情页一度不展示用户数（后台照常）。**增量的性质已定案**（见顶部三次订正：那 1.5 万不是真人，是批量装载记入的活跃）。下面保留的是**可直接粘贴的工单正文（中英双语，现已不必提交）**与**后台核对清单（判据仍有效，供下次复用）**。
>
> ⚠️ **提交动作不在本仓库能力范围**：工单需要登录开发者信息中心，本文只出文本与判据，不做任何外部写。

## 一、现象与已确认边界（2026-11-01 实测）

| #   | 事实                                                                                                                    | 取数方法（可复算）                                                                                                                                                                                                                                                                                                    | 判据意义                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 本 item 详情页**没有用户数那一行**，中文 / `?hl=en` / `?hl=ja` 三语言一致                                               | 浏览器打开详情页，看「分类链接」与「Add to Chrome」之间那一格（DOM 里是 `div.F9iKBc` 的文本节点）                                                                                                                                                                                                                     | 不是区域或语言灰度，是 item 级                                                                                                                                                                                                               |
| 2   | 同页评分行正常显示「5.0（3 个评分）」                                                                                   | 同上                                                                                                                                                                                                                                                                                                                  | 不是「整个数据块被撤」，只有计数这一个字段缺席                                                                                                                                                                                               |
| 3   | 对照组正常：同账号 Transfer Any File 显示 `4 users`、Cross-Origin Proxy 显示 `8 users`；AdBlock 显示 `65,000,000 users` | 三条详情页各取 `div.F9iKBc` 文本                                                                                                                                                                                                                                                                                      | **排除**「体量太小不显示」「账号级处罚」「商店全站改版」                                                                                                                                                                                     |
| 4   | 商店搜索结果卡片**对所有 item 都不显示用户数**                                                                          | 商店搜索页整页文本计数，命中 0 处                                                                                                                                                                                                                                                                                     | 从搜索页「找不到自己有多少用户」是设计如此，与本 item 无关                                                                                                                                                                                   |
| 5   | 本 item 在商店搜「账号密码管理助手」**排第一**                                                                          | `https://chromewebstore.google.com/search/账号密码管理助手` 首屏结果里的 item id 比对                                                                                                                                                                                                                                 | 索引没丢、没被下架，只是计数这一个展示位被收起                                                                                                                                                                                               |
| 6   | shields 的 `chrome-web-store/users` **读数不稳定，不能当判据**                                                          | 同一条 URL 反复请求：AdBlock 三次里出现一次 `65M`、两次 `not found`；本 item 四次全 `not found`；TAF 四次全 `not found`——而 TAF 在浏览器里明确显示 `4 users`。同 item 的 `v` / `rating` / `rating-count` 三枚每次都能出数                                                                                             | 徽章 `not found` **既不能证明**商店没数据，**也不能证明**商店抑制了展示；判据只用第二节第 1 行的详情页 DOM 取法。**本 item 反复读到 `not found` 与详情页无数字同向，但同账号 TAF「页面有数字、徽章读不到」是反向证据，说明这一路本身不可信** |
| 7   | 自有表面在十月几乎没带量                                                                                                | GitHub API：近 14 天 `traffic/views` = 210 次浏览 / 39 位独立访客；`traffic/popular/referrers` 最大一项是 github.com 自己（21 次）；star 13（10-23）→ 14（11-01）；十月各 release 的 zip 下载合计约 30 次                                                                                                             | **排除**「我们自己推起来的」——增量不在我们的任何表面上                                                                                                                                                                                       |
| 8   | 第三方统计侧同期被整体抬起                                                                                              | chrome-stats 本 item 页读数（11-01 抓取，页面自标 `Data as of 2026-10-28`）：`USERS 10,000 ▲4.00K`、`RANKING #9,820 ▲3,449`、`VERSION 3.20.0`                                                                                                                                                                         | 用户数与总榜排名同向陡增，形状符合「商店内部分发（搜索位次 / 推荐位）抬量」；但**它不能证明增量是真安装**——见第 9 行的口径修正                                                                                                               |
| 9   | **后台那个 15,190 是「每周用户数」（WAU），不是装机量**                                                                 | 开发者信息中心 → Google Analytics → 用户数（2026-11-01 由用户提供截图，数据序列止于 10-28）：指标名原文「一段时间内的每周用户数」；2026-10-22 峰值 **15,190**，当前大数 **4,102**（▲2,992.51%，反推上一期基线约 133）；曲线 10-13 起爬升、10-23 见顶后连续下滑，**最右端塌陷是滚动 7 天窗口未闭合，不是「掉到 500」** | **单位纠正**：第 8 行 chrome-stats 的 10,000 与这里的 15,190 不是同一个口径（前者是商店公开的 total users 档位，后者是周活跃）。**「10 月装机涨到 1.5 万」这个说法作废**                                                                     |

**结论口径（2026-11-01 二次修订）**：详情页计数被 item 级收起，最合理的解释是「短期陡增 + 使用率低」触发了商店的 authenticity 复核（社区长期一致的观察，Google 无公开文档说明；[2026-08-20 那篇官方更新](https://developer.chrome.com/blog/cws-review-updates-2026)只提到评分改侧重近期、停用「精选」徽章、发布限额纳入「质量与使用情况」，未提计数展示）。**后台数据不受影响**，两者是不同管道。**没有证据表明这是违规或 bug。**

拿到第 9 行这张图后，触发条件更具体了：10 月的形状是**一次性激活脉冲 + 两周内快速衰减**（基线约 130 → 峰值 15,190 → 当前 4,102 且窗口未闭合），这不是增长曲线。公开计数被收起与这轮脉冲同时发生，最省事的解释是 Google 侧认为这批读数此刻不可背书、正在重算。**但「脉冲从哪来」还没有判据**——见第二节改后的第一张图，那才是分叉点。

**仍未验完的一 fork**：Google 是「数据仍在某处、只是详情页不渲染」还是「整个公开字段撤下」——页面内 `fetch` 原始 HTML 时触发 403 反爬（连续多次请求后），未取到定论。第 8 行 chrome-stats 今天仍读到 10,000，倾向前者。

## 二、后台核对清单（2026-11-01 按截图重写，10 分钟）

入口：[开发者信息中心](https://chrome.google.com/webstore/devconsole) → 本 item → **Google Analytics** 下的三张图。用户数那张已经看过（脉冲形），下面两张才是分叉点。

1. **「安装量和卸载量」——这是最关键的一张。** 只看一件事：**10-13 到 10-22 这段时间，安装量有没有同步涨到万级。**
   - 安装量同步暴涨 → 是**真安装**，脉冲来自外部流量，接着看第 2 张定来源。
   - 安装量基本没动（仍在几百到一两千），而周用户数冲到 15,190 → **那 1.5 万不是 1.5 万个真人**，而是「活跃事件」被批量记入：Chrome 自动更新/平台升级会让已安装的扩展在短期内被反复记为活跃，企业策略推送、批量 profile 环境同理。这种情况下商店收起公开计数属于正常保护动作，**不需要我们自证**。
   - 卸载量在同一窗口异常高 → 与「装了不用即删」一致，指向低质量批量安装。
2. **「展示次数」——商店有没有给我们曝光。** 展示次数从平时的量级跳到几十万甚至百万级，说明商店确实把 item 推进了搜索位次或推荐位（第 8 行 chrome-stats 排名 ▲3,449 与此吻合）；展示次数基本平直而安装量暴涨，说明流量**不来自商店**，要往「别人替我们发了」或「批量安装」方向查。
3. **抄三个日期 × 三个指标**（安装量 / 卸载量 / 展示次数）：**10-13**（起爆日）、**10-22**（WAU 峰值日）、**10-26**（腰斩后）。三天的数一摆，四种解释（商店推荐位、第三方带量、口径脉冲、批量安装）里只剩一种能同时满足三张图的形状。

顺手记两笔：**地区/语言分布**是否突然集中到与中文产品不相关的地区（集中 = 批量或策略推送的强信号）；**安装来源**里 `?ref=` 值有没有出现——若几乎全是空来源或商店内部来源，「商店内部分发」就从推断变成实证。

> ⚠️ **不要把曲线最右端读成「掉到 500」。** 那是滚动 7 天窗口没走完造成的塌陷，当前可信的大数是左上的 **4,102**。同理，`▲2,992.51%` 是「与上一时间段相比」，反推上一期基线约 133，不是增长率。

> 🚫 **代理侧取数受阻记录（2026-11-01）**：本轮尝试用浏览器连接器**只读**打开开发者信息中心取这两张图，落到了 `accounts.google.com` 登录页——该 Chrome 配置文件未登录发布者账号。代理不代填凭据、不代提交工单，所以**安装量与卸载量、展示次数两项仍缺读**，本文件的定性停在「四种解释未分开」，工单正文里也刻意没有断言增量性质。**下次接手：先补这两张图，再决定工单提不提。**

## 三、工单正文（中文，可直接粘贴）

> **主题**：扩展详情页不展示用户数，请确认是否触发安装真实性复核（item: fgimkdodpjfkddmildjieojpfakpanli）
>
> 您好。
>
> 我们的扩展「账号密码管理助手」（ID: `fgimkdodpjfkddmildjieojpfakpanli`，在架版本 3.20.0）的商店详情页，自 2026 年 10 月下旬起不再展示用户数：中文、英文、日文三种语言界面下该位置均为空，而同页的评分（5.0，3 个评分）与版本信息正常显示。我们名下另外两条扩展（详情页分别显示 4 users 与 8 users）以及同类目其他扩展的详情页都正常展示用户数，因此这看起来是单条 item 的展示状态。开发者信息中心里的数据正常可见：Google Analytics 的「每周用户数」在 2026-10-22 达到 15,190 的峰值（此前基线约 130），随后两周内快速回落——我们理解这是周活跃指标，不是装机量。
>
> 我们能确认的是：同期我们**没有任何站外推广投放**——没有发布新的推广文章，没有购买安装量，没有自动化安装脚本。可核对的外部事实是：GitHub 仓库近 14 天仅 210 次浏览、39 位独立访客，来源里最大的一项是 github.com 自身（21 次），星标从 13 增至 14，十月 Releases 的 zip 下载合计约 30 次。我们还在核对同期的安装量与商店展示次数，用来区分「商店内部分发带来的真实安装」与「活跃口径被批量记入」；第三方统计显示同期本 item 总榜排名上升约 3,400 位。
>
> 想请贵方确认三件事：
>
> 1. 本 item 是否因安装量短期陡增触发了安装真实性（authentic usage / unusual install activity）复核，从而在详情页隐藏公开用户数？
> 2. 本 item 是否存在其他 item 级别的展示或分发限制（既非下架，也非区域限制）？开发者信息中心里我们没有看到任何提示。
> 3. 如需我们配合说明增长来源，希望我们提供哪些材料？我们可以在后台核对用户数日曲线、安装与卸载量、周活跃用户占比之后一并提交。
>
> 补充：本扩展是本地优先的密码管理器，不收集、不上传任何用户数据，唯一的出站请求是每 6 小时一次、不携带任何用户数据的匿名版本检查。
>
> 谢谢。

## 四、Ticket body (English, paste as-is)

> **Subject**: Extension listing hides the user count — please confirm whether an install-authenticity review is in progress (item: fgimkdodpjfkddmildjieojpfakpanli)
>
> Hello,
>
> Since late October 2026, the Chrome Web Store detail page for our extension "账号密码管理助手 / Account Password Helper" (ID: `fgimkdodpjfkddmildjieojpfakpanli`, live version 3.20.0) no longer shows the user count. The slot is empty on the Chinese, English and Japanese interfaces, while the same page still displays the rating (5.0, 3 ratings) and the version normally. Our two other extensions do show their counts on their own detail pages (4 users and 8 users respectively), as do other extensions in the same category, so this looks like an item-level display state. The Dashboard still reports data normally: under Google Analytics, the "weekly users" metric peaked at 15,190 on 2026-10-22 against a baseline of roughly 130, then fell back sharply within two weeks. We understand this is a weekly-active metric, not an install count.
>
> What we can rule out on our side: we ran **no off-store promotion during that period** — no new promotional articles, no paid installs, no automated install scripts. Verifiable external facts: the GitHub repository recorded 210 views and 39 unique visitors over the last 14 days, the largest referrer being github.com itself (21 views), stars moved from 13 to 14, and the Releases zip files were downloaded roughly 30 times across all of October. We are still cross-checking installs and store impressions for that window, to tell "real installs driven by store placement" apart from "a batch of activity events counted into the weekly metric"; third-party trackers show our overall ranking rising by about 3,400 places over the same window.
>
> We would like to ask three things:
>
> 1. Has this item entered an authentic-usage / unusual install activity review because of the rapid growth, and is that why the public user count is hidden on the detail page?
> 2. Is any other item-level display or distribution restriction applied (it is neither unlisted nor region-restricted, and we see no notice in the Dashboard)?
> 3. If you need us to account for the growth, what evidence would you like? We can supply the daily user-count curve, installs versus uninstalls, and the weekly-active-to-total ratio from the Dashboard.
>
> For context: this is a local-first password manager. It collects and uploads no user data; its only outbound request is an anonymous version check every six hours that carries no user data.
>
> Thank you.

## 五、提交入口与替代渠道

- **首选**：开发者信息中心 → 本 item → 页面底部「帮助 / 获取支持」（Help / Contact Chrome Web Store support），粘贴第三节或第四节。
- **替代**：`chromium-extensions` 邮件列表（公开留痕，Google 团队成员会看）；同一份内容即可，注意别在里面贴任何用户数据。
- **不要做的**：为了「让数字回来」去放宽任何权限、改包名重上架、或开新 item 规避——8 月 20 日之后「质量与使用情况」已进入发布商评级因子，而默认槽位是两个（我们名下三条 item），重复上架只会把评级做坏。

## 六、恢复判据与对外口径纪律

- **恢复判据（可判定，二选一即可）**：① 详情页 `div.F9iKBc` 里重新出现数字；② chrome-stats 该 item 页的 `USERS` 读数继续随后台同向更新。复测命令：浏览器打开 `https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli?hl=en`，看「Tools」与「Add to Chrome」之间那一格。
- **对外口径纪律**（本文第 6 行决定了它必须是硬的）：
  - **禁止**在任何表面引用 `img.shields.io/chrome-web-store/users/*` 作为数据源——同一 URL 的读数会在 `65M` 与 `not found` 之间跳（第一节第 6 行的复测），挂在页面上时它只是一块红，既证伪不了也证实不了任何事。中英 README 首屏那枚已于 2026-11-01 摘除；`v` / `rating` / `rating-count` 三枚实测每次都出数，保留。
  - **禁止**把后台用户数写成「商店显示 N 用户」。要用这个量级就写成「截至 YYYY-MM-DD，开发者信息中心读数约 N」，并在 [exposure-status.md](../exposure-status.md) 的现状基线里留下取数日期。
  - **单位纪律**：15,190 是**每周用户数峰值（2026-10-22）**，不是装机量、不是总用户。任何表面写「N 用户」时必须注明口径与日期；「10 月装机涨到 1.5 万」这类说法已作废，不得再出现。

## 七、关联文档

- 现状基线与本轮证据链回写：[exposure-status.md](../exposure-status.md)（「🆕 2026-11-01 商店详情页不展示用户数」一节 + 现状基线第 1026 行那条旧归因的订正）
- 商店发布红线与流程：[CWS_PUBLISHING_GUIDE.md](../../store/CWS_PUBLISHING_GUIDE.md)
- 上一轮商店操作单（同批背景）：[CWS_DASHBOARD_SUBMIT_SHEET_2026-10-27.md](./CWS_DASHBOARD_SUBMIT_SHEET_2026-10-27.md)
