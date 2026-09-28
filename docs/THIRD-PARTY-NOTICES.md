# Third-Party Notices / 第三方声明

## Copyright and License Statement / 版权与协议声明

Account Password Helper - Chrome extension for account password management,
auto-fill and auto-login.

Copyright (C) 2024-present Better(liaolongdong)

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, **version 3 of the License only**. This program is distributed in
the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
the [LICENSE](../LICENSE) file for the full GNU GPL-3.0 text.

本项目为自由软件：可在 GNU 自由软件基金会发布的 GNU 通用公共许可证**第 3 版
（仅限 v3，不含"或更高版本"）**的条款下重新分发和/或修改。本项目分发时不带任何
明示或暗示的担保。完整协议文本见 [LICENSE](../LICENSE) 文件。

Third-party components bundled with this program are listed, together with
their respective licenses, in the sections below.

本项目发布产物中打包的第三方组件及其许可证见下文各节。

## Trademark Notice / 商标声明

The name "Account Password Helper"（账号密码管理助手）, its logos, icons and
other brand assets are trademarks of Better(liaolongdong). They are **NOT**
licensed under the GNU GPL-3.0 or any other open source license of this
project. Derivative works must not use these names or assets to endorse or
promote their products without prior written permission.

插件名称 "Account Password Helper"（账号密码管理助手）、logo、图标及其他品牌
素材为 Better(liaolongdong) 的商标，**不包含**在本项目的 GNU GPL-3.0 或其他任何
开源协议的授权范围内。衍生作品未经书面授权，不得使用该名称与品牌素材为其产品
背书或进行宣传。

## Bundled Runtime Dependencies / 打包的运行时依赖

The distributed extension bundles the following third-party libraries. Their
licenses are reproduced below as required.

本插件发布产物中打包了以下第三方库，并按各许可证要求附上归属声明。

| Package                 | Version | License    | Repository                                         |
| ----------------------- | ------- | ---------- | -------------------------------------------------- |
| vue                     | ^3.5.41 | MIT        | https://github.com/vuejs/core                      |
| element-plus            | ^2.14.4 | MIT        | https://github.com/element-plus/element-plus       |
| @element-plus/icons-vue | ^2.3.2  | MIT        | https://github.com/element-plus/element-plus-icons |
| pinyin-match            | ^1.2.10 | MIT        | https://github.com/xmflswood/pinyin-match          |
| jsqr                    | ^1.4.0  | Apache-2.0 | https://github.com/cozmo/jsQR                      |

`pinyin-match` powers the Chinese search in the manager page and the side panel;
it is loaded on demand and ships as its own lazily-imported chunk.

Element Plus pulls in a transitive dependency graph. Components are imported
on demand, so only part of that graph reaches the bundle; the packages below
were observed in the built extension and are listed here as required by their
licenses.

| Package            | License      | Repository                                  |
| ------------------ | ------------ | ------------------------------------------- |
| lodash-es          | MIT          | https://github.com/lodash/lodash            |
| lodash-unified     | MIT          | — (no repository declared)                  |
| async-validator    | MIT          | https://github.com/yiminghe/async-validator |
| @popperjs/core     | MIT          | https://github.com/popperjs/popper-core     |
| normalize-wheel-es | BSD-3-Clause | https://github.com/sxzz/normalize-wheel-es  |

`lodash-unified` declares MIT in its package metadata but ships no license file,
so it is credited from that metadata alone.

Note that `normalize-wheel-es` is **BSD-3-Clause**, not MIT: beyond the
permission grant it carries the non-endorsement clause reproduced below.

### MIT License (vue, element-plus, @element-plus/icons-vue, pinyin-match, lodash-es, lodash-unified, async-validator, @popperjs/core)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Copyright holders, as stated in each package's own license file: Vue.js core
team and Element Plus team (see their repositories); `pinyin-match` —
"Copyright (c) 2020 All contributors to pinyin-match"; `async-validator` —
"Copyright (c) 2014-present yiminghe"; `@popperjs/core` — "Copyright (c) 2019
Federico Zivolo"; `lodash-es` — "Copyright OpenJS Foundation and other
contributors <https://openjsf.org/>", which additionally notes it is based on
Underscore.js (Copyright Jeremy Ashkenas, DocumentCloud and Investigative
Reporters & Editors).

### Apache License 2.0 (jsqr)

jsQR is licensed under the Apache License, Version 2.0 (the "License"); you
may not use it except in compliance with the License. You may obtain a copy of
the License at:

> http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.

Copyright (c) the jsQR contributors (https://github.com/cozmo/jsQR). The
complete Apache-2.0 license text is included with the jsQR package
(`node_modules/jsqr/LICENSE`) and is also available at the URL above.

jsQR 基于 Apache License 2.0 协议授权，完整协议文本随 jsQR 包附带
（`node_modules/jsqr/LICENSE`），亦可通过上方链接获取。

### BSD 3-Clause License (normalize-wheel-es)

The license file shipped with `normalize-wheel-es` is the BSD License for
**FixedDataTable software**, `Copyright (c) 2015, Facebook, Inc. All rights
reserved.` Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- Neither the name Facebook nor the names of its contributors may be used to
  endorse or promote products derived from this software without specific
  prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

`normalize-wheel-es`（Wheel 事件归一化）采用 BSD 3-Clause 协议，其许可证文件
保留了 Facebook FixedDataTable 的版权声明（Copyright (c) 2015, Facebook, Inc.）。
分发时必须同时保留源代码版权声明、条件列表与免责条款；二进制形式需在文档或随附
材料中复现上述内容；且不得使用 Facebook 或贡献者的名义为衍生产品背书。

## Bundled Data Files / 打包的数据文件

Beyond code, the extension ships two non-code data assets. Both are static JSON
read at runtime; neither contacts a server.

| File                               | Purpose                                                                                       | Source                                                                                  | License                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------- |
| `utils/data/top1000.json`          | Offline breached-password dictionary used by the strength meter and the security health check | Derived from the public SecLists project (<https://github.com/danielmiessler/SecLists>) | MIT (SecLists)            |
| `utils/data/passphrase-words.json` | Built-in word list for the passphrase generator (3,080 lowercase words)                       | Shipped in this repository; no upstream source recorded                                 | Unstated — see note below |

`utils/data/top1000.json` 是离线弱口令字典，供密码强度判定与安全体检使用，源自公开
SecLists 项目（MIT 协议）。`utils/data/passphrase-words.json` 是助记词生成器的内置
词库（3,080 个小写英文单词）。该词库目前没有任何上游来源记录，若实际整理自外部词表，
需由维护者在此处补充来源与许可证后再对外分发。

## Compatibility / 兼容性说明

- MIT-licensed dependencies are compatible with GNU GPL-3.0.
- Apache-2.0 (jsQR) is one-way compatible with GNU GPL-3.0, so bundling it in
  this GPL-3.0 project is permitted, provided the attribution above is kept.
- BSD-3-Clause (normalize-wheel-es) is compatible with GNU GPL-3.0; the third
  clause only restricts using the Facebook or contributor names as an
  endorsement, which this project does not do.
- Data files: `top1000.json` derives from SecLists (MIT), compatible with GNU
  GPL-3.0 provided the attribution is kept. The license of
  `passphrase-words.json` is not recorded in this repository and must be
  confirmed before redistribution.
- MIT 协议的依赖与 GNU GPL-3.0 兼容；Apache-2.0（jsQR）与 GNU GPL-3.0
  单向兼容，在保留上述归属声明的前提下允许在本 GPL-3.0 项目中打包分发。
- BSD-3-Clause（normalize-wheel-es）与 GNU GPL-3.0 兼容，其第三条仅限制以
  Facebook 或贡献者名义为本项目背书，本项目未使用该等背书。
- 数据文件：`top1000.json` 源自 SecLists（MIT），保留归属声明后与 GNU GPL-3.0
  兼容；`passphrase-words.json` 的许可证在仓库中尚无记录，对外分发前需先确认。
