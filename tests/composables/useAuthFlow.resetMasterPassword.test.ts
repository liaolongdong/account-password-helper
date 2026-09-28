/**
 * B7 重置入口收口：source-shape 守卫
 *
 * 背景：`useAuthFlow.resetMasterPassword` 曾经仅调用 `StorageUtils.clearAllData()`
 * （只 `local.clear()`），未销毁当前上下文的 `sessionDataKey` 内存镜像、
 * `chrome.storage.session` 的 `DATA_KEY` / `SESSION_LOCK_STATE` 镜像，也未通知
 * background 使 `passwordCache` / `_sessionValidCache` 失效——旧数据密钥与「假解锁」
 * 镜像会驻留至浏览器重启，SW 的 5 秒 TTL 缓存期间仍会返回过期 true。
 *
 * 修复：重置流程改为 `lockSession() → clearAllData() → onSessionExpired 回调`。
 * 其中 `lockSession()`（见 `tests/utils/sessionLock.test.ts`）统一负责
 * `clearSession + INVALIDATE_PASSWORD_CACHE 广播`，与手动锁定
 * （`useSessionTimer.handleClearSession`）、自动过期（`sessionManager.handleSessionExpired`）共用。
 *
 * 这里只锁死重置入口的关键序列；广播 / catch / 顺序等对编排本身的断言放在
 * sessionLock.test.ts，避免重复且能独立演进。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = readFileSync(path.resolve(__dirname, '../../composables/useAuthFlow.ts'), 'utf8');

/** 抓取 resetMasterPassword 函数体（从函数头到顶层闭合 `};`） */
function extractResetBody(src: string): string {
  const start = src.indexOf('const resetMasterPassword =');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n  };', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

const body = extractResetBody(SRC);

describe('B7 重置主密码流程源码形状', () => {
  it('经 lockSession() 收口，且在 clearAllData 之前调用（会话密钥先于磁盘清空销毁）', () => {
    const lockIdx = body.indexOf('lockSession()');
    const clearAllIdx = body.indexOf('StorageUtils.clearAllData()');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(clearAllIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(clearAllIdx);
  });

  it('onSessionExpired 回调被触发，向其它上下文广播会话过期', () => {
    expect(body).toMatch(/options\.onSessionExpired\?\.\(\)/);
  });
});
