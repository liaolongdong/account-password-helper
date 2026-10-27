# 商店 Dashboard 提交单（2026-10-27）

这一页只做一件事：**把仓库里已经写好、但线上还没有的商店文案送上去**。当前在架是 v3.18.0，而说明正文上一次人工替换远早于此——文案的收益没兑现，不是因为写得不好，是因为没粘。

完整流程与排查口径看 [CWS_PUBLISHING_GUIDE.md](../../store/CWS_PUBLISHING_GUIDE.md)，本文只列本轮要动的字段。

## 动哪四个，不动哪四个

| 字段                                      | 本轮          | 理由                                                                                              |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| 说明（中文标签页）                        | ✅ 替换       | 二十二修订重写了首段（把差异化顶进折叠线），二十一修订收口了英文                                  |
| Description（English 标签页）             | ✅ 替换       | 补了个人信息库右键召唤与回程口径，删了两条与功能全览重复的问答                                    |
| 权限合理性说明 → `contextMenus`           | ✅ 替换       | 右键菜单多了一项「从个人信息库选择」，权限用途必须与实际行为一致                                  |
| 截图（中文页 + English 页各一套）         | ⏳ 待工单完成 | 见 [商店截图待补场景工单](../../reports/STORE_SHOTS_NEW_SCENES_2026-10-27.md)                     |
| 名称 Name（中 30 / 英 42 字符）           | ❌ 不动       | 排序第一权重，历史被拒点在堆砌；补满 45 属另一条决策（本轮用户已选「零风险落地」）                |
| 摘要 Summary（中 131 / 英 130，上限 132） | ❌ 不动       | 已用满，且必须与 `public/_locales/*/messages.json` 逐字一致，动它要重跑 `pnpm build` 并重新上传包 |
| 类别 / 语言 / 隐私政策 URL / 分发可见性   | ❌ 不动       | 无变化                                                                                            |
| Featured 提名                             | ❌ 别碰       | 表单 6 个月一次机会，按手册要等本次改稿过审之后                                                   |

## 第 0 步：粘贴前自检（必须先看输出再复制）

````bash
cd /Users/liaolongdong/code/chrome-plugins/account-password-helper
python3 - <<'PY'
import ast, json, re
doc = open('docs/store/CWS_FILL_CONTENT.md', encoding='utf-8').read()
seg = doc.split('## 第二步')[1].split('## 第三步')[0]
blocks = re.findall(r'```\n(.*?)```', seg, re.S)
# 禁词表只在 CWS_PUBLISHING_GUIDE.md「快速校验命令」里存一份，此处按行取出后 literal_eval，
# 避免同一张表在两处各写一遍、各自漂移（也把敏感字面量留在唯一真源里）。
guide = open('docs/store/CWS_PUBLISHING_GUIDE.md', encoding='utf-8').read()
hit = re.search(r'^banned = (\(.*\))$', guide, re.M)
if not hit:
    raise SystemExit('没在指南里取到 banned 表——请直接照指南那段命令跑')
banned = ast.literal_eval(hit.group(1))
bad = {i: [k for k in banned if k in b] for i, b in enumerate(blocks) if any(k in b for k in banned)}
print('paste blocks:', len(blocks), '| banned hits:', bad or 'none')
for idx, lang in ((2, 'zh'), (5, 'en')):
    ls = [l.strip() for l in blocks[idx].splitlines() if len(l.strip()) > 20]
    dup = {l: ls.count(l) for l in set(ls) if ls.count(l) > 1}
    print(f'{lang}: {len(blocks[idx].strip())} chars | duplicate lines:', dup or 'none')
for path in ('public/_locales/zh_CN/messages.json', 'public/_locales/en/messages.json'):
    d = json.load(open(path, encoding='utf-8'))
    for key in ('extensionName', 'extensionDescription'):
        m = d[key]['message']
        print(path.split('/')[1], key, len(m), 'chars | matches a paste block:', any(m == b.strip() for b in blocks))
PY
````

期望读数（2026-10-27 本轮实测，长度会随后续改动漂，以实时输出为准）：

```
paste blocks: 6 | banned hits: none
zh: 6744 chars | duplicate lines: none
en: 15913 chars | duplicate lines: none      ← 上限 16,000，只剩约 90 码点
_locales zh_CN extensionName 30 chars | matches a paste block: True
_locales zh_CN extensionDescription 131 chars | matches a paste block: True
_locales en extensionName 42 chars | matches a paste block: True
_locales en extensionDescription 130 chars | matches a paste block: True
```

**任何一项不符就停下来**：`banned hits` 非零说明混进了竞品名或绝对化表述（3.8.0 就是被这句打回的）；`duplicate lines` 非零说明同一句话在两个小节各抄了一遍，那正是「过多关键字」的结构特征；`en > 16000` 会被商店直接拒收。

## 第 1–5 步

1. [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → 本扩展 → **商品详情**。
2. **中文标签页**：把 [CWS_FILL_CONTENT.md](../../store/CWS_FILL_CONTENT.md)「第二步 → 说明 (Description)」里**中文那个代码块**整段选中，粘进「说明」框（连表情符号一起，不要挑行、不要重排）。
3. **English (United States) 标签页**：同小节的**英文代码块**整段替换 Description。
4. **隐私惯例 / 权限逐项说明**：`contextMenus` 一栏换成第五步「权限合理性说明」里的新文本（已含「从个人信息库选择」与它的边界：只跳转、不读字段内容、不回填页面）。
5. 名称、摘要两栏**只核对不改**：应与 `public/_locales/{zh_CN,en}/messages.json` 的 `extensionName` / `extensionDescription` 逐字一致（自检脚本最后一组 True 就是这个意思）。不一致时**以 messages.json 为准**，并停下——那说明包内 manifest 与商店列表漂移了，先查是谁改错了。
6. 提交审核，然后在 [CWS_PUBLISHING_GUIDE.md](../../store/CWS_PUBLISHING_GUIDE.md)「第四步 → 常见驳回原因」追加一行：本次提交日期 + 通过/驳回原文。

## 🔻 被拒时的三档回退（按顺序，一次只动一个变量）

| 档  | 触发条件                                | 动作                                                                                                                                                                      |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 驳回点名 emoji / 「excessive metadata」 | **只删每行前导 emoji**，分行与全部文字一字不动，重交（十四修订留过这条底）                                                                                                |
| 2   | 驳回点名某句关键字堆砌                  | 只按被引用的那句话改，改完立刻重跑第 0 步自检；不要顺手收缩整节                                                                                                           |
| 3   | 驳回点名摘要里的功能清单                | 中文按「密码强度检测 → 安全体检 → 密码生成器 → 显隐切换 → 多环境隔离 → 迁移导入 → 中英双语」逆序删到 80 字符左右；摘要改动**必须同步两个 `_locales` 并重跑 `pnpm build`** |

## 提审之后：这两件事才决定安装量能不能真的动

1. **评价**：线上只有 3 条评价。产品内的评价引导已合规（保存的密码多于 1 条、成功填充过一次、首次填充 7 天后才问一次），商店外要在导流帖与 README 里放直达 `/reviews` 的链接。目标写死：**30 天内 3 → 10 条真实评价**。不刷、不用激励换（政策红线，也是口碑的死刑）。
2. **归因核对**：发版次日在 Dashboard「项目指标 → 安装来源」里找 `aphsite` / `ghreadme` / `hn` 这些 ref 值。**找到 = 归因成立**，此后按渠道倾斜资源；**找不到 = `?ref=` 写法无效**，按 [执行手册第六节](../账号密码管理助手曝光提升执行手册.md) 的登记表回退并在原处记一句结论——那一节已经写明这一步本轮无法自证，需要后台权限。
