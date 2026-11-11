import {
  MessageType,
  type DelegatedSavePromptData,
  type DelegatedSavePromptResponse,
  type SavePromptDecision,
} from '@/utils/types';
import { authorizeSenderDocument, isAuthorizedDocumentCurrent } from '@/utils/frameFill';
import { isSameMainDomain, normalizeToHostAndPort } from '@/utils/domain';
import { isSessionValid, SESSION_STORAGE_KEYS } from '@/utils/sessionManager-storage';
import { SESSION_MEMORY_KEYS } from '@/utils/storageKeys';
import { ensureCredentialAccessAfterStartupRelock } from './passwordCache';
import type { PendingSaveDelegation } from './savePromptDelegation.type';

const TTL_MS = 30_000;
// 传输上限刻意宽于表单限制，兼容历史长标签/备注；这里只约束消息，不改变落盘规则。
const TEXT_LIMIT = 100_000;
const pending = new Map<string, PendingSaveDelegation>();
let epoch = 0;
let listening = false;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= TEXT_LIMIT;

/** runtime 边界校验，不能把类型断言当作可信载荷。 */
function isPrompt(value: unknown): value is DelegatedSavePromptData {
  if (!isRecord(value) || !['username', 'password', 'url', 'tag', 'remark'].every(key => isText(value[key])))
    return false;
  if (
    !value.username ||
    // 空口令只在「账号 + 验证码」委托里合法（iframe 内的登录页本来就没有密码框）。
    // 必须显式声明该位，未声明/非布尔真值一律按缺字段拒收。
    (!value.password && value.mobileLogin !== true) ||
    // 反向同理：声明了「这次登录没有口令」却带着非空口令，两者不同源，边界处直接拒收。
    // 出口侧（`handleSave`）与落盘侧（`autoSavePassword`）已各自钉住这条不变量，这里是第三道。
    (value.password !== '' && value.mobileLogin === true) ||
    !value.url ||
    (value.mode !== undefined && value.mode !== 'save' && value.mode !== 'update')
  )
    return false;
  if (
    value.risk !== undefined &&
    (!isRecord(value.risk) ||
      typeof value.risk.weak !== 'boolean' ||
      !Number.isInteger(value.risk.reusedCount) ||
      (value.risk.reusedCount as number) < 0 ||
      (value.risk.reusedCount as number) > 9999)
  )
    return false;
  if (
    value.targetNote !== undefined &&
    (!isRecord(value.targetNote) ||
      !['updateOtherHost', 'willCreate'].includes(String(value.targetNote.kind)) ||
      !isText(value.targetNote.url))
  )
    return false;
  return true;
}

function isDecision(value: unknown): value is SavePromptDecision {
  if (!isRecord(value)) return false;
  if (value.action === 'dismiss' || value.action === 'neverAsk') return true;
  return (
    value.action === 'save' &&
    isRecord(value.editedData) &&
    isText(value.editedData.tag) &&
    isText(value.editedData.remark) &&
    typeof value.editedData.tagEdited === 'boolean' &&
    typeof value.editedData.remarkEdited === 'boolean'
  );
}

/** 删除授权先于回执；取消只发给旧顶层 documentId，不干扰导航后的文档。 */
function finish(record: PendingSaveDelegation, response: DelegatedSavePromptResponse): void {
  if (pending.get(record.requestId) !== record) return;
  pending.delete(record.requestId);
  clearTimeout(record.timer);
  record.resolve(response);
  void chrome.tabs
    .sendMessage(
      record.source.tabId,
      {
        type: MessageType.CANCEL_DELEGATED_SAVE_PROMPT,
        data: { requestId: record.requestId },
      },
      { documentId: record.source.topDocumentId },
    )
    .catch(() => {});
}

/** 手动锁定同步撤销，storage 事件覆盖闲时锁定、重认证及换钥。 */
export function cancelSavePromptDelegations(): void {
  epoch++;
  for (const record of pending.values()) finish(record, { success: false });
}

function listenForInvalidation(): void {
  if (listening) return;
  listening = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      (area === 'local' &&
        (changes[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY] || changes[SESSION_STORAGE_KEYS.PASSWORD_EXPIRY])) ||
      (area === 'session' && (changes[SESSION_MEMORY_KEYS.SESSION_LOCK_STATE] || changes[SESSION_MEMORY_KEYS.DATA_KEY]))
    ) {
      cancelSavePromptDelegations();
    }
  });
  chrome.webNavigation.onCommitted.addListener(details => {
    for (const record of pending.values()) {
      if (
        details.tabId === record.source.tabId &&
        (details.frameId === 0 || details.frameId === record.source.frameId)
      ) {
        finish(record, { success: false });
      }
    }
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    for (const record of pending.values()) {
      if (record.source.tabId === tabId) finish(record, { success: false });
    }
  });
}

async function currentWrappedKey(): Promise<string | null> {
  const stored = await chrome.storage.local.get(SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY);
  const wrapped = stored[SESSION_STORAGE_KEYS.WRAPPED_DATA_KEY];
  return typeof wrapped === 'string' && wrapped ? wrapped : null;
}

/** 发起方的 runtime 响应通道天然绑定原文档；不以 tabs/frameId 向来源回传编辑数据。 */
export async function delegateSavePrompt(
  data: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<DelegatedSavePromptResponse> {
  try {
    listenForInvalidation();
    const requestEpoch = epoch;
    if (!isPrompt(data)) return { success: false };
    // 自报 url 是 `location.host` 形态（无 scheme），sender.url 是完整 URL；
    // 统一归一为主机+端口后比较注册主体，与既有跨帧委托同一口径。
    if (
      !sender.url ||
      !isSameMainDomain(`https://${normalizeToHostAndPort(data.url)}`, `https://${normalizeToHostAndPort(sender.url)}`)
    ) {
      return { success: false };
    }
    const source = await authorizeSenderDocument(sender);
    if (!source || source.frameId === 0) return { success: false };
    if (!(await ensureCredentialAccessAfterStartupRelock()) || !(await isSessionValid({ skipConsistencyCheck: true })))
      return { success: false };
    const wrappedKey = await currentWrappedKey();
    if (!wrappedKey || !(await isAuthorizedDocumentCurrent(source.tabId, source)) || requestEpoch !== epoch)
      return { success: false };

    // 顶层只有一个弹窗：替代时先结算旧来源，避免留下一条仍可消费的幽灵授权。
    for (const old of pending.values()) {
      if (old.source.tabId === source.tabId) finish(old, { success: false });
    }
    const requestId = crypto.randomUUID();
    return new Promise<DelegatedSavePromptResponse>(resolve => {
      const record: PendingSaveDelegation = {
        source,
        requestId,
        wrappedKey,
        epoch: requestEpoch,
        expiresAt: Date.now() + TTL_MS,
        deciding: false,
        resolve,
        timer: setTimeout(() => finish(record, { success: false }), TTL_MS),
      };
      pending.set(requestId, record);
      // 只选出展示字段，丢弃消息上夹带的任意扩展属性。
      const prompt: DelegatedSavePromptData = {
        username: data.username,
        password: data.password,
        url: data.url,
        tag: data.tag,
        remark: data.remark,
        // 逐字段重建会把没列出的位静默丢掉，而顶层 frame 的弹窗正是拿这一位决定
        // 「密码那一行该渲染成点，还是渲染成『验证码不保存』的说明」。
        ...(data.mobileLogin === true ? { mobileLogin: true } : {}),
        ...(data.mode !== undefined ? { mode: data.mode } : {}),
        ...(data.risk ? { risk: { weak: data.risk.weak, reusedCount: data.risk.reusedCount } } : {}),
        ...(data.targetNote ? { targetNote: { kind: data.targetNote.kind, url: data.targetNote.url } } : {}),
      };
      void (async () => {
        try {
          const response = await chrome.tabs.sendMessage(
            source.tabId,
            {
              type: MessageType.SHOW_DELEGATED_SAVE_PROMPT,
              data: { requestId, prompt },
            },
            { documentId: source.topDocumentId },
          );
          if (!response?.success) finish(record, { success: false });
        } catch {
          finish(record, { success: false });
        }
      })();
    });
  } catch {
    return { success: false };
  }
}

/** 可信顶层回执经会话与两端文档复核后，仅消费一次。SW 回收丢失 map 时默认拒绝。 */
export async function decideSavePrompt(
  data: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<{ success: boolean }> {
  if (!isRecord(data) || typeof data.requestId !== 'string' || !isDecision(data.decision)) return { success: false };
  const record = pending.get(data.requestId);
  if (
    !record ||
    record.deciding ||
    sender.id !== chrome.runtime.id ||
    sender.tab?.id !== record.source.tabId ||
    sender.frameId !== 0 ||
    sender.documentId !== record.source.topDocumentId
  )
    return { success: false };
  record.deciding = true;
  try {
    if (
      Date.now() >= record.expiresAt ||
      !(await ensureCredentialAccessAfterStartupRelock()) ||
      !(await isSessionValid({ skipConsistencyCheck: true })) ||
      (await currentWrappedKey()) !== record.wrappedKey ||
      !(await isAuthorizedDocumentCurrent(record.source.tabId, record.source)) ||
      record.epoch !== epoch ||
      pending.get(record.requestId) !== record ||
      Date.now() >= record.expiresAt
    ) {
      finish(record, { success: false });
      return { success: false };
    }
    const decision: SavePromptDecision =
      data.decision.action === 'save'
        ? {
            action: 'save',
            editedData: {
              tag: data.decision.editedData.tag,
              remark: data.decision.editedData.remark,
              tagEdited: data.decision.editedData.tagEdited,
              remarkEdited: data.decision.editedData.remarkEdited,
            },
          }
        : { action: data.decision.action };
    finish(record, { success: true, decision });
    return { success: true };
  } catch {
    finish(record, { success: false });
    return { success: false };
  }
}
