# 同作者产品图标（互链卡用）

本目录存放**另外两个同作者扩展的官方图标副本**，只供落地页 `index.html` / `en.html` 的「作者的其他插件」互链卡使用。两份都是 `cp` 原样复制，几何、配色、`viewBox` 一个字节都没改，文件头各带一段出处注释。

| 文件                           | 产品                 | 来源路径（兄弟仓） | 源提交    | 图形 md5                           |
| ------------------------------ | -------------------- | ------------------ | --------- | ---------------------------------- |
| `brand-transfer-any-file.svg`  | 文件格式任意转换助手 | `assets/icon.svg`  | `48ca1cc` | `434f8e62d0878cb9705d02c8a9104e55` |
| `brand-cross-origin-proxy.svg` | 跨域代理助手         | `public/icon.svg`  | `5a13282` | `5dfb020fcf3ef57d6f9de3f501a627ec` |

md5 取的是**去掉文件头注释之后**的图形部分，便于和源文件直接比对：

```bash
n=$(grep -n '^<svg' brand-transfer-any-file.svg | cut -d: -f1)
tail -n +"$n" brand-transfer-any-file.svg | md5 -q
```

## 许可与署名

两个源仓库均为 **MIT License**（`Copyright (c) liaolongdong` / `Copyright (c) 2026 liaolongdong`），与本源同属一位作者。MIT 允许复制、修改与再分发，条件是保留版权声明与许可声明；本目录以「文件头出处注释 + 本 README」的形式履行署名，源仓库的完整 `LICENSE` 文本随各仓库自身分发。

## 为什么是副本而不是热链

- 互链卡的图标职责是**品牌识别**，必须是对方的真图标；自绘图形（哪怕是同一种几何）会读成装饰，且颜色与两个产品的真实主色都不符。
- 热链 `liaolongdong.github.io/...` 或商店 CDN 等于给落地页加一个外部请求与一条会烂的依赖；Pages 与商店的 URL 都不是我们的契约。
- 两份 SVG 合计不到 2 KB，且**不进扩展构建闭包**：`assets/` 只有被 `import` 时才经打包器，WXT 的扩展产物取的是 `public/icon/`（见 `wxt.config.ts` 与 `pnpm icons:build`）。

## 引用方式与两条硬约束

页面里以 `<img src="./assets/icons/brands/xxx.svg" alt="" width="48" height="48" />` 引用，包在 `<div class="more-icon more-icon--taf|cop">` 里。

1. **只能 `<img>`，不能内联**：`brand-transfer-any-file.svg` 内部有 `<linearGradient id="bg">`，内联进 7500 行的 `index.html` 就是往同一张 id 表里塞一个通用名，随时与页面或脚本生成的节点撞车。
2. **`alt=""` 且外层 `aria-hidden="true"`**：卡片标题已经是产品名，图标重复朗读一次没有信息量。

包装层保留 `position: relative` 与 `color`，是因为图标悬停时的水波纹环（`.more-icon::before/::after`，见 `index.html` 的动效层）用 `currentcolor` 描边，且 `<img>` 是替换元素、不生成伪元素——环必须挂在包装 `div` 上。

## 换图标时怎么同步

源仓库改图标后，重新 `cp` 覆盖本目录对应文件，并同步三处：文件头的 `commit` 与 md5、上表的 md5、`index.html` 里该变体的 `--tile-radius` 与 `color`（两枚品牌块的圆角不同：COP `rx=16`、TAF `rx=28`，在 48px 档分别是 6px 与 10.5px，波纹环要跟各自真实的圆角走，否则环会浮在 tile 外面）。
