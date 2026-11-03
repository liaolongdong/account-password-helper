# 深度代码评审与安全评审 —— 2026-11-01（feature-dev @ c47b37b）

> 范围：`main...c47b37b` 的 23 个提交（227 文件 / +4143 −662），以及与之直接相邻的存量模块。
> **不含**工作区里正在进行中的并行改动（59 个已修改文件）；本轮结论一律对应已提交状态 c47b37b。
> 评审在独立 worktree（HEAD 检出 + 软链 `node_modules`）内完成，行号与读数均取自该隔离副本。

---

## 一、门禁底座（先给证据，再谈问题）

在干净 HEAD 上跑通 CI 的全部门禁口径：

| 检查                                      | 结果                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `pnpm typecheck`                          | 通过（新 worktree 需先 `wxt prepare`，否则 `#imports` 类型缺失假红） |
| `pnpm lint` / `pnpm lint:style`           | 通过                                                                 |
| `pnpm build`                              | 通过                                                                 |
| `pnpm test:run`                           | **320 文件 / 4644 通过 / 10 跳过**（与文档 4654/320 口径一致）       |
| `pnpm exec vitest run tests/architecture` | 通过                                                                 |
| e2e / 真机侧边栏八场景 / Windows          | **未执行**：本报告的性能量级凡属推算均已标注，不作为达标证据         |

安全底座逐项查证通过，**未发现可被网页利用的高危漏洞**：

- PBKDF2-SHA256 600,000 轮全仓单一真源（`utils/cryptoParams.ts`），随机 12B IV + AES-256-GCM，密文格式未变；
- CryptoKey 句柄不可导出、有容量上界、`clearSession` 时清空（`utils/encryption.ts`）；
- 明文缓存的清理不依赖消息送达：SW 侧 `storage.onChanged` 见会话键删除即重置内存镜像并失效缓存（`backgroundServices.ts` 会话分支），因此 `useSessionLock` 里那条「通知 background 失败即忽略」并不构成明文滞留；
- 注入 UI 的全部插值走 `escapeHtml`（含 `"` `'`）与 `highlightHtml`，`favicon` 的 dataURL 还额外校验 `data:image/` 前缀；`v-html`/`eval`/`new Function` 零命中；
- 网络出口只有更新检查（CWS + GitHub Releases）与本地 `_favicon/` 读取，凭据数据不出本机；
- manifest 12 项权限全部有真实调用点，`web_accessible_resources` 未声明；
- i18n：`utils/i18n/locales/{zh-CN,en}` 各 1358 键零差异，`public/_locales` 各 6 键零差异；运行时代码零 `console` 直调、零 `@ts-ignore`。

---

## 二、发现与处置

| 编号 | 严重度           | 标题                                        | 本轮状态                     |
| ---- | ---------------- | ------------------------------------------- | ---------------------------- |
| F1   | 高（页面性能）   | MutationObserver 回调按记录物化整棵子树文本 | **已修 + 已锁**              |
| F2   | 中（数据完整性） | 提醒表整包读改写未走提交锁                  | 由并行会话实现，本轮不重复做 |
| F3   | 中（可验证性）   | 严格 sender 门控使 5 条生产热路径进不了 e2e | 待 `messageRouter.ts` 落地后 |
| F4   | 高（性能天花板） | 2000 条写侧 263 ms + 扇出 211~245 ms        | E1 设计稿已就绪，未拍板      |
| F5   | 低               | 两处口径（静默 catch / eslint-disable）     | 核查后判定为**非缺陷**       |

### F1 已修：观察器回调的文本物化与重复选择器查询

**缺陷事实**（`entrypoints/content/FormDetector.ts` 原 357-453 行）。观察器以
`childList + subtree + attributes(class,style,placeholder)` 挂在 `document.body`，而可取消的
debounce 只包住了 `detectForms`，**回调本体对每条记录同步执行**：

- 属性分支对 `mutation.target` 取 `textContent`（外层容器抖动时等于把整棵子树拼成一个字符串）；
- 按钮分支先取 `innerText`（强制布局），且与自己的注释相悖——同文件属性分支写明「`innerText`
  只作兜底：它会对整棵子树强制布局，因此排在 `textContent` 之后短路」；
- 同一选择器在「是否存在」与「取值」上各查一遍，一个新增元素最多 8 次子树遍历。

**可证伪读数**（新增 `tests/content/formDetector.mutationCost.test.ts`，改前红、改后绿）：
50 条 class 变更 → **50 次**子树文本物化；200 个候选元素 → **200 次**；单个含按钮的新增元素 →
`row::button` **重复查询 1 次**。这些都是每条记录同步发生在宿主页面主线程上的成本，
与 AGENTS.md「Content script 的 DOM 扫描和批量更新应限流、分批或复用缓存」「MutationObserver
必须缩小观察范围」直接冲突。绝对毫秒数仍需真机 Performance 录制确认（本轮未测）。

**改法**：回调阶段只做「登记候选 + 廉价判定」，文本判定下沉到去抖到期后的一次任务
（`runMutationDetection`），候选按元素去重并设 `MUTATION_TEXT_TARGET_CAP = 32` 上界；
每个按钮选择器每元素只查一次（原来在「是否存在」与「取值」上各查一遍）。
观察范围、关键词口径、去抖时长（`shortDelayTime` 500ms）与触发条件不变；按钮文本
**逐字保留** `innerText || textContent` 的既有顺序——中途曾改为 `textContent` 优先，评审指出
`LoginFormAnalyzer` 判定按钮文案的三处（:61/:142/:174）都是 `innerText` 优先，改了会出现
「突发判定认不出的按钮，`detectForms` 的扫描却能认出」的口径分裂，故按原顺序回退，
强制布局的成本改由候选上限与「一次突发只判一次」兜住。

**顺带堵住的一个泄漏**：去抖是可取消的尾部去抖，持续抖动会一路重置计时器，而候选集合只在到期任务里清空——
「把判定下沉到去抖之后」这个设计本身就会让集合按记录数增长并与页面同寿命。因此登记处即设上界。
溢出的处理口径值得记一笔：**只丢候选，不放宽触发条件**。中间版本曾把「本轮改属性的元素够多」
当成重扫理由，那会让动画密集的页面每隔一个去抖窗口做一次全页 `detectForms`，等于把省下的成本还回去；
最终的用例把这条钉住（200 条无登录字样的属性记录 → 集合 ≤32、文本读取 ≤32、不触发重扫）。

**行为差异（如实交代，两条）**：

1. 判定所用的文本从「记录发生时刻」改为「去抖到期时刻」读取。若某元素文本在 500ms 窗口内
   变成登录字样又改回去，改前会重扫、改后不会——这属于中间态而非终态，且同批记录里的字段
   出现分支（不依赖文本、必重扫）与站点规则变更、消息驱动扫描仍会各自触发 `detectForms`。
2. 候选超过 32 时丢弃后续候选，**不**转为强制重扫。残余漏检面被压到很窄：要求「纯 class/文本
   切换登录方式、同批不插入任何输入框或按钮、且同一突发内改属性的不同元素超过 32 个」三者同时
   成立；强制重扫的替代方案会在动画密集页把全页 `detectForms` 变成长期每 500ms 一次，代价更大。
   该取舍写在 `MUTATION_TEXT_TARGET_CAP` 与 `addMutationCandidate` 的注释里，用例第 2 条锁住口径。

**回归验证**：`formDetector.mutationCost` 8 例（3 例成本不变量在改前必红：50 条属性记录 →
50 次文本物化、200 条 → 候选集合 200 个、单元素 `row::button` 重复查询）+ 既有 7 个 FormDetector
套件 + 整个 `tests/content/` 目录 **44 文件 / 828 例全绿**；干净 HEAD 叠加本补丁后 CI 口径全绿
（typecheck / lint / lint:style / 321 文件 4660 例 / build / architecture / prettier）。
**未做真机 Performance 录制**，因此「省下多少毫秒」没有读数，本轮只对次数下了界。

### F2 已由并行会话实现（本轮不重复动）

`utils/storage/reminderManager.ts` 的整包读改写在 c47b37b 上仍未纳入提交锁，而本分支已把回收站/身份库
整包写接进 `withVaultCommit`（`utils/storage/trashManager.ts`），两条写路径交叉时会丢更新：
Options 侧「设置提醒」（`components/options/PasswordHealthDialog.vue`）与 SW 侧回收站清空/TTL 清理触发的
`removeReminders` 交错，后果是新提醒静默消失或已删条目的提醒复活并按期弹通知。

工作区内的并行改动已实现同一方案且更严：独立租约 `aph-password-reminder-commit`（与 vault 提交锁不同名，
避免同锁嵌套），并把写入侧读取改为 fail-closed。**本轮不重复改这个文件**，交由该会话落地。

### F3 待处理：严格门控带来的端到端盲区

`isTrustedInternalSender` 要求 `sender.tab === undefined`。先按「真机侧边栏带 `sender.tab`」推演过一遍，
该假设被 `docs/store/CWS_FILL_CONTENT.md` 证伪——真侧边栏满足门控，是自动化流水线只能把
`sidepanel.html` 开成标签页才被拒。问题因此从「线上坏」变成「线上对但没人验过」：
`GET_INITIAL_DATA`（秒开热路径）、`UPDATE_PASSWORD_METADATA`（填充后元数据落盘）、`QUICK_ADD_PASSWORD`、
`SET_PENDING_TOTP`、`INVALIDATE_PASSWORD_CACHE` 五条在 e2e 里结构性不可达，仓库自己的评审报告也已承认
「元数据 flush 在 e2e 中不会落盘」。单测所用合成 sender 与门控假设同源，属循环论证。

**建议方案**：这五条改用 `isExtensionPageSender`（`sender.id` + `sender.url` 属本扩展页面）。
安全性不降的前提已核实：构建产物 manifest 未声明 `web_accessible_resources`，网页拿不到
`chrome-extension://` 脚本上下文，内容脚本 `sender.url` 是站点地址仍被拒。落地时应同步加一条
架构门禁：「构建 manifest 一旦出现 `web_accessible_resources`，除非同时收紧这五处门控，否则判红」，
把这条隐含前提变成有牙齿的检查。

**本轮未做的原因**：`entrypoints/background/messageRouter.ts` 正被并行会话改写（sender 文档身份绑定），
此时改同一处门控会与之冲突。留作该改动落地后的下一步。

### F4 未拍板：E1 键分片

不是新发现，但仍是唯一能拿下 2000 条体验指标的杠杆，数字来自仓库自有实测
（`docs/reports/PERF_E1_KEY_SHARDING_DESIGN.md`）：保存 1 条 = 整包 IO 263.1 ms + 扇出投递 211~245 ms；
AGENTS.md 首屏三段 SLA 中 `preRowMs` 与 `blockingMs` 两档长期红。渲染侧已收口
（`useListRenderWindow` 空闲上限 100 行 + 触底续放），**继续抠渲染或搜索是零收益**，成本全在数据层。

两条执行约束：① 索引键写必须收窄到「id 集合真的变了」，否则实测 11.4 ms = 14× 而非 150×（设计稿 §5.1 已修正）；
② 先补 M-4（Windows 慢盘/杀软放大倍数）再决定是否推广到回收站/历史/身份——这是设计稿里唯一未测且影响决策的格子。

涉及存储结构迁移，按项目规则须用户明确拍板后另行开工，不随本轮改动执行。

### F5 核查后判定为非缺陷

- `trashManager.ts` 对 `pauseReminders/removeReminders` 的 `.catch(() => {})`：`pauseReminders` 头注已写明
  「失败只记日志、不阻断删除流程」并论证了取舍；且并行会话正在改写提醒域的读写语义，此处应随其一并复核，不单独动。
- `components/options/ValiditySettingDialog.vue` 的 `vue/no-mutating-props` 豁免：属刻意设计（表单对象由父级持有
  并按引用双向绑定），且已登记在 `tests/architecture/lintBypassInventory.test.ts` 的豁免清单里受门禁追踪。

---

## 三、本轮改动清单

| 文件                                              | 内容                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `entrypoints/content/FormDetector.ts`             | 观察器回调改为登记候选 + 去抖后统一判定；文本兜底顺序纠正；选择器去重复查询；`destroy()` 清空候选集合 |
| `tests/content/formDetector.mutationCost.test.ts` | 新增 6 例：3 例成本不变量（改前必红）、3 例检测语义锁定                                               |
