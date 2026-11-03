/**
 * 保存确认与凭据投递不得走宿主页面消息通道（存量安全评审 S1/S6 的结构守卫）
 *
 * 历史形态：iframe 里的 `LoginAutoSave` 用 `window.top.postMessage` 把捕获到的凭据
 * （含后台预检查返回的库内标签/备注）委托给顶层 frame 渲染弹窗，用户操作结果再用
 * `postMessage` 回传。`targetOrigin` 与 `isSameMainDomain` 只把**投递目标**限定在同主域
 * 页面，挡不住两件事：① 顶层文档里的宿主脚本能监听并旁听这份明文载荷；② 它也能自造
 * 一条 `requestId` 匹配的「已点保存」回执，因为 `window.postMessage` 没有发送方身份
 * 凭据——`event.origin` 只说明来源页面，不说明来源是扩展还是页面自身脚本。
 * 结果 = 明文泄露 + 未经用户确认的凭据写入。提示委托（`SHOW_NOTIFICATION`）此前已因
 * 同一形状的问题收口过一次，本批把保存委托一并收进 `chrome.runtime`。
 *
 * 收口口径：内容脚本经 `MessageType.DELEGATE_SAVE_PROMPT` 请求后台，后台校验
 * 发送方归属（`sender.id` + `sender.tab` + `sender.documentId`）、同主域、会话与载荷形态，
 * 再用一次性 requestId 绑定「来源文档 + 顶层文档」定向投递；决定只沿原 runtime 请求通道
 * 返回。页面世界既看不到载荷，也发不出这条消息。
 *
 * 为什么钉结构而不是只跑行为用例：行为用例（`tests/background/messageRouter.saveDelegation.test.ts`
 * 等）能证明当前实现拒绝伪造，但「有人为了少改前端，重新在 content 侧加一个 window message
 * 分支」这种回退不会让任何行为用例变红——通道本身才是需要被钉死的那一层。
 */
import { describe, expect, it } from 'vitest';
import { listSourceFiles, readSource } from '@/tests/helpers/architectureScan';

/** 承载保存委托的两处内容脚本侧文件：委托方与被委托方的渲染入口 */
const CONTENT_FILES = ['entrypoints/content.ts', 'entrypoints/content/LoginAutoSave.ts'];

/** 不得再出现的宿主通道形状 */
const FORBIDDEN_PATTERNS = [
  // 监听宿主页面消息（旧委托入口）
  /addEventListener\(\s*['"]message['"]/g,
  // 向顶层 frame 广播消息（旧凭据出帧路径）
  /window\.top\s*[!.]*\.postMessage/g,
];

/**
 * 去掉注释只留代码。
 *
 * 判据针对「实际存在的通道」，注释里描述被废弃的旧形状（例如 messageRouter 解释为什么
 * 不接受 `window.postMessage`）是**在讲这条守卫的来由**，扫它会让守卫在文档变详细时假红。
 */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('保存确认通道的结构守卫', () => {
  for (const file of CONTENT_FILES) {
    it(`${file} 不使用宿主 window 消息通道`, () => {
      const source = stripComments(readSource(file));
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(source, `保存委托已改走 chrome.runtime，${file} 重新出现 ${pattern} 即通道回退`).not.toMatch(pattern);
      }
    });
  }

  it('全仓不再有 APH_* 形态的 window 消息类型常量', () => {
    // 枚举值是包内公开可得的字符串：留着就等于留着一份「怎么冒充扩展」的说明书
    const offenders = listSourceFiles('entrypoints')
      .concat(listSourceFiles('utils'))
      .filter(file => /['"]APH_[A-Z_]+['"]/.test(stripComments(readSource(file))));
    expect(offenders).toEqual([]);
  });

  it('后台侧的委托消息要求扩展内部 sender 且只回传给原请求通道', () => {
    const delegation = readSource('entrypoints/background/savePromptDelegation.ts');
    expect(delegation).toContain('sender.id !== chrome.runtime.id');
    expect(delegation).toContain('authorizeSenderDocument(sender)');
    expect(delegation).toContain('isAuthorizedDocumentCurrent');
    // 决定不回投 frameId：只沿发起方的 runtime 响应通道返回
    expect(delegation).not.toMatch(/tabs\.sendMessage\([^)]*frameId/);
  });
});
