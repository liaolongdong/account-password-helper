# 商店 Dashboard 提交单（2026-11-05）

取代 [2026-10-27 那一版](./CWS_DASHBOARD_SUBMIT_SHEET_2026-10-27.md)（那份的前提是「在架 v3.18.0、截图工单未完成」，两条都已不成立）。

这一页同样只做一件事：**把仓库里已经写好、但线上还没有的东西送上去**。文案的唯一真源仍是 [CWS_FILL_CONTENT.md](../../store/CWS_FILL_CONTENT.md)「第二步」，本文**不复制正文**——上一版手册另存一份可粘贴副本，两处长期漂移，最后导致 3.8.0 草稿被判 keyword stuffing。

## 本轮实测到的线上事实

| 项                  | 今日读数                                                                | 取数方式                                                                                                              |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 商店在架版本        | **v3.22.0**                                                             | `curl --http1.1 https://img.shields.io/chrome-web-store/v/fgimkdodpjfkddmildjieojpfakpanli.json` → `message: v3.22.0` |
| 本地 `package.json` | **3.22.0**（tag v3.22.0 落在 2026-11-04）                               | `node -p "require('./package.json').version"`                                                                         |
| 说明正文            | 中文 **6744** 码点 / 英文 **15913** 码点（上限 16000，英文只剩 **87**） | 下面「第 0 步」那段 python                                                                                            |
| 评分                | 5.0，**3 条评价**                                                       | 商店详情页                                                                                                            |
| 公开用户数          | **53**（= 后台「一段时间内的每周用户数」，是周活不是装机）              | 详情页 `div.F9iKBc` + 后台同日读数，见 [用户数工单](./CWS_USER_COUNT_TICKET_2026-11-01.md) 结案块                     |

## 动哪几项，不动哪几项

| 字段                                      | 本轮              | 理由                                                                                      |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| 说明 / Description                        | **❌ 不动**       | 见下方「为什么这轮不改说明正文」                                                          |
| 名称 Name（中 30 / 英 42）                | ❌ 不动           | 排序第一权重，历史被拒点在堆砌；动它要重新出包上传                                        |
| 摘要 Summary（中 131 / 英 130，上限 132） | ❌ 不动           | 已用满，且必须与 `public/_locales/*/messages.json` 逐字一致，动它要 `pnpm build` 重传 zip |
| 权限合理性说明                            | ❌ 不动           | 12 项权限 + `<all_urls>` 与 `wxt.config.ts` 逐项核对过，无增减                            |
| **截图**                                  | ⚠️ **先重截再传** | 见「截图那一格现在有个新坑」                                                              |
| 类别 / 语言 / 隐私政策 URL / 分发可见性   | ❌ 不动           | 无变化                                                                                    |
| Featured 提名                             | ❌ 别碰           | 表单 6 个月一次机会；且它要求列表先无违规记录                                             |

## 为什么这轮不改说明正文

三个理由，按分量排：

1. **没有归因数据。** `?ref=` 是否真出现在后台「安装来源」里仍未被自证（需要 Dashboard 权限）。改文案而不看得到哪一段在付费，等于在没有仪表的飞机上转方向盘。
2. **英文预算只剩 87 码点。** 任何英文新增都必须先等量删减，而 2026-10-27 那轮删掉的正是与【功能全览】重复的两条问答——再删就要动事实覆盖面。中文虽有约 9,200 码点余量，但首段折叠线已在 10-27 重写过（104 → 267 码点），现存的【功能全览】也已覆盖站点规则、跨子域三档、端口隔离、localhost 环境绑定、键盘全流程。
3. **历史代价。** 上一轮被判违规的就是「同一卖点在多节各抄一遍」。当前口径是「一个卖点只在一节展开」，重写很容易把这个不变量碰坏。

**下一轮什么时候该动它**：拿到一次 Dashboard 的「展示次数 / 详情页访问 / 安装量」读数，或 `?ref=` 归因被确认有效之后。在那之前，正文的每一处改动都应该能被指回一段数据，而不是指回一次审美判断。

## 第 0 步：粘贴前自检（必须先看到输出再复制）

````bash
cd /Users/liaolongdong/code/chrome-plugins/account-password-helper
python3 - <<'PY'
import re
doc = open('docs/store/CWS_FILL_CONTENT.md', encoding='utf-8').read()
seg = doc.split('## 第二步')[1].split('## 第三步')[0]
blocks = [b.strip() for b in re.findall(r'```\n(.*?)```', seg, re.S)]
print('paste blocks:', len(blocks))
for i, b in enumerate(blocks):
    print(f'  blocks[{i}] = {len(b)} code points')
PY
````

期望 `paste blocks: 6`。四个 `_locales` 值与中英名称/摘要逐字一致这条由 `tests/architecture/manifestLocaleBudget.test.ts` 在 CI 里守；禁词与跨小节重复行按 [CWS_PUBLISHING_GUIDE.md](../../store/CWS_PUBLISHING_GUIDE.md)「第五步 → 快速校验命令」那段跑，期望 `banned hits: none`、`duplicate lines: none`。

⚠️ 长度只认这段 python 的 `len()`（Unicode 码点）。`node` 的 `String.length` 会因为 emoji 偏高，历史上就是靠它误判过余量。

## 截图那一格现在有个新坑

`assets/cws-store/` 的 32 张母版（中英各 16）是 **2026-10-27 用 manifest 3.20.0 整批重拍**的，画面里的版本徽章就是 **v3.20.0**；而今天在架是 **v3.22.0**。

**图片里的文字同属商店元数据**，「截图版本与在架版本不符」是已知的驳回点与信任损耗点。所以：

- 本轮若只改文字类元数据 → 不传图，坑不触发；
- 一旦要传图 → 先 `pnpm build` 出 3.22.0 的包，按 [CWS_FILL_CONTENT.md](../../store/CWS_FILL_CONTENT.md)「屏幕截图」一节重跑 `scripts/store-shots/` 三件套（`capture` → `export-upload`），把徽章带到 3.22.0，再上传。别拿 10-27 那批直接传。

5 张槽的取舍与理由**已经在 `CWS_FILL_CONTENT.md:451` 写定**（`1 / 2 / 3 / 9 / 15`，回退方案是把 `15` 换回 `4`），此处不再重复一遍。

## 提交动作（由本人点，我不代提）

1. Dashboard → 该扩展 → 商品详情，中文页与 English 页分别核对。
2. 若确有文字改动要上：从 `CWS_FILL_CONTENT.md`「第二步」整段复制对应块粘贴，名称与摘要不动。
3. 隐私标签页：权限逐项说明取「第五步 → 权限合理性说明」，隐私政策 URL 与官网一致。
4. 提交审核后**记下当天基线**：展示次数 / 详情页访问次数 / 安装量 / 安装来源里有没有 `ghreadme`、`aphsite`、`blog`、`llms` 这几个 ref。
5. 若被拒，把驳回原文一字不改地补进 [CWS_PUBLISHING_GUIDE.md](../../store/CWS_PUBLISHING_GUIDE.md)「第四步 → 常见驳回原因」，再决定改法。
