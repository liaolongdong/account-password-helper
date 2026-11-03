import type { AuthorizedFillDocument, DelegatedSavePromptResponse } from '@/utils/types';

/** 仅易失内存中的一次性授权；不存凭据或可恢复持久化状态。 */
export interface PendingSaveDelegation {
  source: AuthorizedFillDocument;
  requestId: string;
  wrappedKey: string;
  epoch: number;
  expiresAt: number;
  deciding: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: DelegatedSavePromptResponse) => void;
}
