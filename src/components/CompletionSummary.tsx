import React from 'react';
import { CheckCircle2, LockKeyhole } from 'lucide-react';

export interface CompletionSummaryQuote {
  chargedPoints?: number;
  nonEmptyBeads: number;
}

export interface CompletionSummaryProps {
  isEn: boolean;
  isUnlocked: boolean;
  isFreehand?: boolean;
  needsSupplement: boolean;
  nonEmptyBeads: number;
  quotedPoints: number | null;
  estimatedPoints: number | null;
  quoteStatus: 'idle' | 'loading' | 'error' | 'invalid';
  hasFormalLogin: boolean;
  onRetryQuote: () => void;
  completionStatus: string;
  onQuote: () => void;
  quote: CompletionSummaryQuote | null;
  onCancelQuote: () => void;
  onComplete: () => void;
  balance: string | null;
}

export const CompletionSummary: React.FC<CompletionSummaryProps> = ({
  isEn,
  isUnlocked,
  isFreehand = false,
  needsSupplement,
  nonEmptyBeads,
  quotedPoints,
  estimatedPoints,
  quoteStatus,
  hasFormalLogin,
  onRetryQuote,
  completionStatus,
  onQuote,
  quote,
  onCancelQuote,
  onComplete,
  balance,
}) => (
  <section
    className="completion-summary border-b border-purple-100 bg-gradient-to-br from-white to-purple-50/50 px-3 py-2"
    aria-label={isEn ? 'Pattern completion' : '图纸完成解锁'}
  >
    <div className="flex items-start gap-2">
      <div className={'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ' + (isUnlocked ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700')}>
        {isUnlocked ? <CheckCircle2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-xs lg:text-[11px] font-black text-purple-950">
              {isUnlocked
                ? isFreehand ? (isEn ? 'Freehand canvas' : '手工画板 · 免费使用') : (isEn ? 'Pattern unlocked' : '图纸已解锁')
                : needsSupplement
                  ? (isEn ? 'Top-up required' : '需要补差价')
                  : (isEn ? 'Draft pattern' : '草稿图纸')}
            </p>
            <p className="mt-0.5 text-xs lg:text-[10px] leading-4 text-slate-500">
              {isUnlocked
                ? (isEn ? 'Color details are ready; export permissions still apply.' : '色号统计已可用，导出仍按现有权限。')
                : (isEn ? 'Editing and cloud saving remain free.' : '编辑和云端保存仍然免费。')}
            </p>
          </div>
          {balance !== null && (
            <span className="shrink-0 text-xs lg:text-[10px] font-bold text-purple-600">
              {isEn ? 'Balance ' + balance : '积分 ' + balance}
            </span>
          )}
        </div>

        {!isFreehand && <div className="mt-0.5 text-xs lg:text-[11px] leading-4 text-purple-950" aria-label={isEn ? 'Credit quote' : '积分报价'} role="status" aria-live="polite">
          {!hasFormalLogin
            ? estimatedPoints !== null
              ? (isEn ? `Estimate: ${estimatedPoints} credits · sign in for approval` : `预估 ${estimatedPoints} 积分 · 登录核准`)
              : (isEn ? 'Sign in for an authoritative quote' : '登录后核准积分报价')
            : quoteStatus === 'error'
              ? (isEn ? 'Quote failed. No credits charged.' : '报价失败，未扣积分。')
              : quoteStatus === 'invalid'
                ? (isEn ? 'Quote expired after edits; recalculating…' : '报价已失效，正在重新核价…')
                : quoteStatus === 'loading'
                  ? (isEn ? 'Server quote pending…' : '服务端核价中…')
                  : quotedPoints !== null
                    ? (isEn
                      ? `${needsSupplement || isUnlocked ? 'Additional due' : 'Due now'}: ${quotedPoints} credits · server quote`
                      : `${needsSupplement || isUnlocked ? '追加需' : '本次需'} ${quotedPoints} 积分 · 服务端报价`)
                    : (isEn ? 'Add beads to request a quote' : '添加拼豆后自动核价')}
          {hasFormalLogin && quoteStatus === 'error' && (
              <button type="button" onClick={onRetryQuote} className="ml-1 min-h-8 rounded-lg px-2 font-bold text-purple-700 underline hover:bg-purple-100">
              {isEn ? 'Retry quote' : '重试报价'}
            </button>
          )}
        </div>}

        {!isFreehand && !isUnlocked && nonEmptyBeads > 0 && !quote && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onQuote}
              disabled={completionStatus === 'QUOTING' || completionStatus === 'COMPLETING' || (hasFormalLogin && (quotedPoints === null || quoteStatus !== 'idle'))}
              className="min-h-8 flex-1 rounded-lg bg-purple-600 px-2 text-xs lg:text-[11px] font-black text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-60"
            >
              {completionStatus === 'QUOTING'
                ? (isEn ? 'Calculating…' : '核价中…')
                : (isEn ? (needsSupplement ? 'Review top-up' : 'Review unlock') : (needsSupplement ? '查看补差确认' : '查看解锁确认'))}
            </button>
          </div>
        )}

        {quote && completionStatus === 'AWAITING_CONFIRMATION' && (
          <div className="mt-1.5 rounded-lg border border-indigo-100 bg-indigo-50 p-1.5">
            <p className="text-xs lg:text-[10px] leading-4 text-indigo-950">
              {isEn
                ? 'Confirm ' + (quotedPoints ?? '—') + ' credits for ' + quote.nonEmptyBeads + ' beads.'
                : '确认支付 ' + (quotedPoints ?? '—') + ' 积分，解锁 ' + quote.nonEmptyBeads + ' 颗豆子的图纸？'}
            </p>
            <div className="mt-1 flex justify-end gap-1">
              <button type="button" onClick={onCancelQuote} className="min-h-7 rounded-md px-2 text-xs lg:text-[10px] font-bold text-slate-600 hover:bg-white">
                {isEn ? 'Cancel' : '取消'}
              </button>
              <button type="button" onClick={onComplete} disabled={completionStatus === 'COMPLETING' || quotedPoints === null || quoteStatus !== 'idle'} className="min-h-7 rounded-md bg-indigo-600 px-2.5 text-xs lg:text-[10px] font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                {isEn ? 'Confirm & unlock' : '确认并解锁'}
              </button>
            </div>
          </div>
        )}
        {completionStatus === 'COMPLETING' && <p className="mt-1.5 text-xs lg:text-[11px] text-purple-700" role="status">{isEn ? 'Completing…' : '正在确认完成…'}</p>}
      </div>
    </div>
  </section>
);
