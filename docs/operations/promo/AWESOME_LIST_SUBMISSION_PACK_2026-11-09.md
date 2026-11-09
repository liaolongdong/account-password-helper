# awesome 列表与目录投稿包（2026-11-09 核验）

> **这一步必须由人来执行，不能由 AI agent 执行。** 原因不是流程保守，而是目标清单把这条写进了规则原文——见下一节。本文件给的是**核验过的事实与准入规则**，不是一段可以直接粘贴的成稿：条目文案与 PR 正文要由维护者本人写，一是规则要求，二是那些清单会按「是否为机器生成」处置，照抄本文件的句子反而会被关。

## 1. 决定性约束：目标清单明文禁止 agent 提交

`awesome-selfhosted/awesome-selfhosted-data` 的 `CONTRIBUTING.md`（经 `api.github.com` 取原文核验，2026-11-09）：

- 开头即有独立段落 `AI AGENTS:`；
- 要求勾选确认框的那一条写明：_Check the "The submission was done by a human, not a machine/LLM" box … **An agent cannot make it truthfully.**_
- 末段：_Machine/LLM-generated contributions are not allowed and **will result in a ban.**_

其余清单的同类条款：

| 清单                      | 条款                                                                                                    | 对我们的后果                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Lissy93/awesome-privacy   | 要求人类撰写内容；大量使用 AI 须**主动披露**                                                            | 可以由人写、并在 PR 里披露工具参与       |
| pluja/awesome-privacy     | _It is not a place to promote projects_；未声明的自我提交直接关闭；机器生成的一句话推荐「不经评审」即关 | 必须声明 affiliation，且文案不能是营销句 |
| awesome-selfhosted(-data) | 除 AI 禁令外，范围限定「self-hosted network services」                                                  | **双重不适配，放弃**                     |

**所以：本波不产出任何对外 PR。** 下面第 2 节给出值得投入的目标与其硬性规则，第 3 节给出可直接引用的产品事实，第 4 节给出禁写项。

## 2. 值得投入的目标（按性价比排序）

| 排名 | 目标                                                                          | 活跃度核验                                                                                                                         | 适配判断                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | **Lissy93/awesome-privacy**（≈10.1k★，0 open PR，2026-10-31 有推送）          | 有 `Password Managers` 分区，已收 Bitwarden / KeePass / LessPass / ProtonPass；`alternativeTo` 支持写 LastPass/1Password/Dashlane  | **适配**。规则：只改 `awesome-privacy.yml`（README 是生成物）；PR 标题 `Adds [name] to [section]`；一 PR 一条目；描述 50–250 字符、_must not read like an advert_、**必须写缺点**；须声明 affiliation（自我提交明确允许）；须走完 PR 模板全部勾选；14 天内回应评审 |
| 2    | **vuejs/awesome-vue**（≈73.5k★，2026-11-03 有推送，约 66 open PR 但数日内合） | `Projects Using Vue.js → Open Source` 收 Vue 写的浏览器扩展（FavBox 的条目描述就是「local-first browser extension… Vue 3, Vite」） | **适配，但有一处要先补**。规则见下方 ⚠️                                                                                                                                                                                                                            |
| 3    | xyNNN/awesome-chrome（128★，2026-11-09 有推送，日批合并）                     | 无密码管理器分区；`Security & Trust` 只收「评估扩展安全性」的工具，LastPass 挂在 Productivity 下                                   | **边缘**：最容易合，但曝光价值接近于零，可不做                                                                                                                                                                                                                     |

**明确放弃**：sindre/awesome（是「清单的清单」，我们不是清单）、sbilly/awesome-security（≈354 open PR，积压即死路）、themeselection/best-chrome-extensions（≈102 open PR）、awesome-selfhosted（范围 + AI 双重不适配）、gs00s/awesome-vue-3（2026-08-01 后未合入）、各类 `awesome-password-managers`（已停更或 0–3★）。另：**不存在**一个仍在维护的「密码管理器专用」awesome 清单。

⚠️ **awesome-vue 的前置缺口**：它要求条目链接指向 **GitHub 仓库**（不是商店或演示页），且**仓库 README 里要有 CONTRIBUTING 段落、有截图/演示**。我们的贡献指南在 `docs/CONTRIBUTING.md`，README 只在「参与贡献」一节链接过去（`README.md:488`）——**这条是否满足需要人工判断**，不满足则先在 README 补一节再投。它对 AI/agent 项目另有更严门槛：≥3 个 release 且首末间隔 ≥1 个月。我们实测 **54 个 release，2026-05-24 → 2026-11-04**，这条过。

## 3. 可直接引用的产品事实（逐条对过源码，2026-11-09）

写条目时只说这些，不要加形容词：

- GPL-3.0-only 开源，Chrome Manifest V3 扩展，**本地优先**：无云端、无账号、无订阅、无同步服务器。
- 主密码经 **PBKDF2-SHA256 600,000 次迭代**派生密钥（`utils/cryptoParams.ts:25`）；账号 / 密码 / 网址 / 备注 / TOTP **五个敏感字段逐字段 AES-256-GCM** 加密后写入 `chrome.storage.local`（`utils/encryption.ts:271-279`）。
- 内置 **TOTP**（RFC 6238）本地生成；**离线**安全体检（复用 / 弱密码 / 命中泄露字典 / 长期未更新四维加权，全程不联网，字典为本机 top-1000）。
- 差异化能力：**精确域名匹配**隔离 dev/test/staging/prod；一键登录（填充 + 勾选协议 + 点提交）；站点规则兜底 Web Components 登录页；加密 `.aph` 备份；独立加密的个人信息库。
- 中英文双语界面；**346 个测试文件 / 5130 个用例**（2026-11-09 串行实测）。
- 首次提交 2025-09-25；首个正式 release `v1.0.0` 2026-05-24。

**必须写进去的缺点**（Lissy93 硬性要求，且如实）：只在浏览器内工作，**没有移动端、没有跨设备同步**；**没有独立第三方安全审计**（全仓从未声称过，核验于 2026-11-09）；忘记主密码默认无法找回（事先登记离线恢复密钥的除外）。

## 4. 禁写项（对齐产品事实与商店红线）

- 不写用户数 / 安装量 / 评分 / star 数。商店用户数在 item 级被抑制展示，取数本身不可靠（见 [CWS_USER_COUNT_TICKET_2026-11-01.md](./CWS_USER_COUNT_TICKET_2026-11-01.md)）。
- 不写 best / #1 / fastest / most secure / 最安全 等绝对化表述——既违反我们自己的商店红线，也违反两个清单的「不得像广告」。
- 不声称经过审计；不把许可证、平台、技术栈堆进描述字段（那些是 YAML 字段的位置）。
- 一个 PR 只提一个条目。
- **不代勾选任何「本提交由人类完成」的确认框**，也不写等价声明。

## 5. 非 PR 渠道（无评审门槛，但仍须人来发）

| 渠道                     | 机制                                                         | 费用                         | 备注                                                                    |
| ------------------------ | ------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| AlternativeTo            | 登录后网页表单「Add software / Suggest alternative」         | 免费（付费置顶可选）         | 众包无编辑闸门，已存在 1Password/LastPass 替代品页                      |
| Privacy Guides           | `discuss.privacyguides.net` 的 **Tool Suggestions** 分区发帖 | 免费                         | 社区 + 编辑评审，对「什么算开源」有明确讨论                             |
| opensourcealternative.to | `/submit` 表单                                               | 免费排队，或 $29 48 小时评审 | 标准写的是「self-hosted alternative」，我们大概率被判不适配，**低优先** |

## 6. 待维护者执行

- [ ] 判断 README 是否满足 awesome-vue 的「含 CONTRIBUTING 段 + 截图」要求；不满足先补。
- [ ] 由本人撰写 Lissy93 的 YAML 条目与 PR 正文（标题 `Adds Account Password Helper to Password Managers`），并按其规则披露 AI 参与情况。
- [ ] 由本人撰写 pluja/awesome-privacy 条目（一句话、无营销词、`npm run validate` 过），并声明 affiliation。
- [ ] AlternativeTo / Privacy Guides 两条按上表机制由本人发起。
- [ ] 新渠道若带商店链接，`?ref=` 取值先在[执行手册的 ref 登记表](../账号密码管理助手曝光提升执行手册.md)追加一行（≤12 字符、小写、上线后不复用）。2026-11-09 实测清点：**已上线面**用到 `blog` `aphsite` `ghreadme` `llms` `aphcmp` `psite` `aphprice` `aphauth`；**仅存在于内部草稿**（投稿包 / 微博 / 公众号 / Reddit 草稿）的有 `weibo` `wechat` `reddit` `awesome` `hn` `ph` `v2ex`，以及执行手册与台账里的占位示例 `xxx`。草稿里的取值在真正上线前不算已占用，但也不应在未登记的情况下直接发出去。
