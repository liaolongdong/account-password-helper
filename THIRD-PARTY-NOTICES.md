# Third-Party Notices / 第三方声明

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
| vue                     | ^3.5.33 | MIT        | https://github.com/vuejs/core                      |
| element-plus            | ^2.13.7 | MIT        | https://github.com/element-plus/element-plus       |
| @element-plus/icons-vue | ^2.3.1  | MIT        | https://github.com/element-plus/element-plus-icons |
| jsqr                    | ^1.4.0  | Apache-2.0 | https://github.com/cozmo/jsQR                      |

### MIT License (vue, element-plus, @element-plus/icons-vue)

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

Copyright holders: Vue.js core team / Element Plus team. See each repository
for the full copyright notice.

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

## Compatibility / 兼容性说明

- MIT-licensed dependencies are compatible with GNU GPL-3.0.
- Apache-2.0 (jsQR) is one-way compatible with GNU GPL-3.0, so bundling it in
  this GPL-3.0 project is permitted, provided the attribution above is kept.
- MIT 协议的依赖与 GNU GPL-3.0 兼容；Apache-2.0（jsQR）与 GNU GPL-3.0
  单向兼容，在保留上述归属声明的前提下允许在本 GPL-3.0 项目中打包分发。
