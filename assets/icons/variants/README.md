# 扩展图标候选方案（钥匙主视觉系列）

统一采用**经典圆环头钥匙**作为主视觉骨架，在钥匙之上叠加不同功能寓意徽章，共 4 款候选。主题色遵循 Element Plus 浅蓝色体系。

## 设计骨架

- **钥匙几何**（4 款共用，保证品牌一致性）
  - 钥匙头：`cx=64, cy=46, r=20` 白色实心圆 + `r=8` 主蓝中心圆（构成环形视觉）
  - 钥匙杆：`x=59, y=62, w=10, h=48, rx=4` 白色圆角矩形
  - 钥匙齿：杆右侧两道（短齿 + 长齿，底齿最长），体现"功能性钥匙"辨识度
- **色板**（Element Plus 蓝）
  - 主蓝 `#409EFF`（背景 + 钥匙孔）
  - 深蓝 `#337ECC`（强调徽章 / 头像）
  - 浅蓝 `#79BBFF / #A0CFFF`（次级层次）
  - 白 `#FFFFFF`（钥匙主体 / 正文）
- **基底**：`128×128` viewBox + `rx=20` 圆角方块，与当前图标保持同系

## 候选一览

<table>
  <tr>
    <th width="25%">01 Key · Pure</th>
    <th width="25%">02 Key · Shield</th>
    <th width="25%">03 Key · Spark</th>
    <th width="25%">04 Key · Cards</th>
  </tr>
  <tr>
    <td align="center"><img src="./01-key-pure.svg" width="96" alt="Key Pure" /></td>
    <td align="center"><img src="./02-key-shield.svg" width="96" alt="Key Shield" /></td>
    <td align="center"><img src="./03-key-spark.svg" width="96" alt="Key Spark" /></td>
    <td align="center"><img src="./04-key-cards.svg" width="96" alt="Key Cards" /></td>
  </tr>
  <tr>
    <td>纯净基准款<br/>品牌识别最强</td>
    <td>钥匙头内嵌盾牌 + 勾号<br/>主密码保护 / 已验证</td>
    <td>右上深蓝闪电徽章<br/>一键自动填充</td>
    <td>左下账号卡叠放<br/>多账号归档管理</td>
  </tr>
</table>

## 语义对照

| 候选            | 叠加元素                             | 核心能力              | 适用场景                    |
| --------------- | ------------------------------------ | --------------------- | --------------------------- |
| 01 Key · Pure   | —（无徽章）                          | 品牌基准 / 通用识别   | 追求极简与最高辨识度        |
| 02 Key · Shield | 钥匙头内嵌主蓝盾牌 + 白色勾号        | 主密码保护 / 加密安全 | 突出"军工级加密 + 会话验证" |
| 03 Key · Spark  | 右上深蓝圆形徽章 + 白色闪电          | 自动填充 / 一键极速   | 突出"侧边栏一键填充"卖点    |
| 04 Key · Cards  | 左下两张叠放账号卡 + 头像圆 + 占位条 | 多账号归档 / 数据管理 | 突出"Excel 导入 + 账号集合" |

## 如何采用其中一款

1. 选定候选后，将其内容覆盖到 [../icon.svg](../icon.svg)
   ```bash
   cp assets/icons/variants/0X-key-xxx.svg assets/icons/icon.svg
   ```
2. 运行图标生成脚本，重新产出 5 档 PNG：
   ```bash
   npm run icons:build
   ```
   产物会写入 [public/icon/](../../../public/icon/) 的 `16/32/48/96/128.png`，WXT 会自动识别为 `manifest.icons` 与 `action.default_icon`。
3. 重新 `npm run build` 或 `npm run dev`，在 Chrome 扩展页确认图标更新。

## 备注

- 原图标仍保留在 [../icon.svg](../icon.svg)，本目录下的候选不会影响构建产物。
- 备份图标见 [../../icons_backup/icon.svg](../../icons_backup/icon.svg)。
- 若 16px 小尺寸下徽章略显拥挤，可只保留 **01 Key · Pure** 作为默认图标，其余 3 款作为营销物料/宣传图使用。
