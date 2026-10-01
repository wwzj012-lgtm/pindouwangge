import React from 'react';
import { CheckCircle2, LockKeyhole } from 'lucide-react';

export interface CompletionSummaryQuote {
  chargedPoints?: number;
  nonEmptyBeads: number;
}

export interface CompletionSummaryProps {
  isEn: boolean;
  isUnlocked: boolean;
  needsSupplement: boolean;
  nonEmptyBeads: number;
  quotedPoints: number | null;
  estimatedPoints: number | null;
  quoteStatus: 'idle' | 'loading' | 'error';
  completionStatus: string;
  onQuote: () => void;
  quote: CompletionSummaryQuote | null;
  onCancelQuote: () => void;
  onComplete: () => void;
  balance: number | null;
}

export const CompletionSummary: React.FC<CompletionSummaryProps> = ({
  isEn,
  isUnlocked,
  needsSupplement,
  nonEmptyBeads,
  quotedPoints,
  estimatedPoints,
  completionStatus,
  onQuote,
  quote,
  onCancelQuote,
  onComplete,
  balance,
}) => (
  <section
    className="completion-summary border-b border-purple-100 bg-gradient-to-br from-white to-purple-50/50 px-3 py-3"
    aria-label={isEn ? 'Pattern completion' : '图纸完成解锁'}
  >
    <div className="flex items-start gap-2">
      <div className={'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ' + (isUnlocked ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700')}>
        {isUnlocked ? <CheckCircle2 className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-black text-purple-950">
              {isUnlocked
                ? (isEn ? 'Pattern unlocked' : '图纸已解锁')
                : needsSupplement
                  ? (isEn ? 'Top-up required' : '需要补差价')
                  : (isEn ? 'Draft pattern' : '草稿图纸')}
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
              {isUnlocked
                ? (isEn ? 'Color codes and exports are ready.' : '色号统计与导出已可用。')
                : (isEn ? 'Editing and cloud saving remain free.' : '编辑和云端保存仍然免费。')}
            </p>
          </div>
          {balance !== null && (
            <span className="shrink-0 text-[10px] font-bold text-purple-600">
              {isEn ? 'Balance ' + balance : '积分 ' + balance}
            </span>
          )}
        </div>

        {!isUnlocked && nonEmptyBeads > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onQuote}
              disabled={completionStatus === 'QUOTING' || completionStatus === 'COMPLETING'}
              className="min-h-9 flex-1 rounded-lg bg-purple-600 px-2 text-[11px] font-black text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-60"
            >
              {completionStatus === 'QUOTING'
                ? (isEn ? 'Calculating…' : '核价中…')
                : quotedPoints !== null
                  ? (isEn ? 'Unlock · ' + quotedPoints + ' credits' : '解锁 · ' + quotedPoints + ' 积分')
                  : (isEn ? 'Calculate unlock cost' : '计算解锁积分')}
            </button>
            <span className="shrink-0 text-[10px] font-semibold text-slate-500">
              {quotedPoints !== null
                ? (isEn ? 'server quote' : '服务端报价')
                : estimatedPoints !== null
                  ? (isEn ? '~' + estimatedPoints : '预计 ' + estimatedPoints)
                  : ''}
            </span>
          </div>
        )}

        {quote && completionStatus === 'AWAITING_CONFIRMATION' && (
          <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 p-2">
            <p className="text-[10px] leading-4 text-indigo-950">
              {isEn
                ? 'Confirm ' + (quote.chargedPoints ?? quotedPoints ?? 0) + ' credits for ' + quote.nonEmptyBeads + ' beads.'
                : '确认支付 ' + (quote.chargedPoints ?? quotedPoints ?? 0) + ' 积分，解锁 ' + quote.nonEmptyBeads + ' 颗豆子的图纸？'}
            </p>
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button type="button" onClick={onCancelQuote} className="min-h-8 rounded-md px-2 text-[10px] font-bold text-slate-600 hover:bg-white">
                {isEn ? 'Cancel' : '取消'}
              </button>
              <button type="button" onClick={onComplete} disabled={completionStatus === 'COMPLETING'} className="min-h-8 rounded-md bg-indigo-600 px-2.5 text-[10px] font-black text-white hover:bg-indigo-700">
                {isEn ? 'Confirm & unlock' : '确认并解锁'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  </section>
);
