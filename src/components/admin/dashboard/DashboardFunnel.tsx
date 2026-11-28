/**
 * C 区左：内容漏斗三步（创建 → 完成事件 → 社区发布）。
 *
 * - 第二步是**完成事件（含修订）**，不是去重图纸数：同一图纸每个 revision 上报一次，
 *   所以 completions 可能 > works（PRD §2.1 / 架构 R3）。
 * - 分母为 0 → 「本期无样本」；比率 >1 → 「—（口径不可比）」，**不钳位成 100%**。
 *   条形宽度只做视觉裁剪（min(100%, ratio)），文案仍如实显示口径不可比。
 * - 每步之间给「流失 N（占上一步 X%）」，末尾一句结论（按最大流失段动态生成）：
 *   把卡片填成有信息的高度，而不是留一块空白。
 */

import React from 'react';
import type { DashboardFunnel as FunnelData } from '../adminDashboardModel';
import { conversionIsIncomparable, conversionLabel, formatCount, funnelConclusion, funnelLosses } from '../adminDashboardModel';

interface Step { key: string; label: string; value: number; ratio: number | null; note?: string }

export function DashboardFunnel({ funnel }: { funnel: FunnelData | null }) {
  const works = funnel?.works ?? 0;
  const completions = funnel?.completions ?? 0;
  const posts = funnel?.posts ?? 0;
  const ratio = (value: number): number | null => (works > 0 ? value / works : null);
  const steps: Step[] = [
    { key: 'works', label: '图纸创建', value: works, ratio: works > 0 ? 1 : null },
    {
      key: 'completions',
      label: funnel?.completionsAreEvents ? '完成事件（含修订）' : '完成',
      value: completions,
      ratio: ratio(completions),
    },
    { key: 'posts', label: '社区发布', value: posts, ratio: ratio(posts), note: '排除已撤回' },
  ];
  const losses = funnelLosses(funnel);
  const overall = funnel?.overallRate ?? null;

  return <section className="admin-dash-panel" aria-labelledby="admin-dash-funnel-title" data-dashboard-funnel>
    <div className="admin-dash-panel-head">
      <div>
        <h2 id="admin-dash-funnel-title">内容漏斗</h2>
        <p className="admin-dash-scope">完成事件按 finalize 上报次数计（含修订），可能与图纸数不可比</p>
      </div>
    </div>
    <ol className="admin-dash-funnel">
      {steps.map((step, index) => {
        const width = step.ratio === null ? 0 : Math.min(100, Math.max(2, step.ratio * 100));
        const stepRate = index === 0 ? null : index === 1 ? funnel?.stepRate.toCompletion ?? null : funnel?.stepRate.toPublish ?? null;
        const previousValue = index === 0 ? 0 : index === 1 ? works : completions;
        const loss = index === 0 ? null : losses[index - 1] ?? null;
        return <li key={step.key} className="admin-dash-funnel-step" data-funnel-step={step.key}>
          <div className="admin-dash-funnel-meta">
            <span className="admin-dash-funnel-label">{step.label}{step.note ? <small>（{step.note}）</small> : null}</span>
            <strong data-funnel-value={step.key}>{formatCount(funnel ? step.value : null)}</strong>
          </div>
          <span className="admin-dash-funnel-track" aria-hidden="true">
            <i style={{ width: width + '%' }} data-tone={index === 0 ? 'primary' : index === 1 ? 'teal' : 'violet'} />
          </span>
          {/* 第一步没有「上一步」，不占一行：三步标签保持 创建 / 完成事件 / 发布 一致。 */}
          {index > 0 && <p className="admin-dash-funnel-rate">
            <span>上一步转化</span><b data-funnel-step-rate={step.key}
              data-tone={conversionIsIncomparable(stepRate) ? 'muted' : undefined}>
              {conversionLabel(stepRate, previousValue)}
            </b>
          </p>}
          {loss && <p className="admin-dash-funnel-loss" data-funnel-loss={loss.key}
            data-tone={loss.incomparable ? 'muted' : loss.lost > 0 ? 'warn' : 'plain'}>
            {loss.incomparable
              ? `流失为负（多出 ${formatCount(Math.abs(loss.lost))}）→ 口径不可比，不作流失解读`
              : loss.lost === 0
                ? '本步无流失'
                : `流失 ${formatCount(loss.lost)}（占上一步 ${loss.sharePct === null ? '—' : loss.sharePct + '%'}）`}
          </p>}
        </li>;
      })}
    </ol>
    <p className="admin-dash-funnel-total" data-funnel-overall data-tone={conversionIsIncomparable(overall) ? 'muted' : undefined}>
      <span>总转化率</span>
      <b>{conversionLabel(overall, works)}</b>
      <small>口径：社区发布 ÷ 图纸创建</small>
    </p>
    {/* 结论行：按数据动态选出最大流失段，给一句可执行建议。 */}
    <p className="admin-dash-funnel-conclusion" data-funnel-conclusion>{funnelConclusion(funnel)}</p>
  </section>;
}
