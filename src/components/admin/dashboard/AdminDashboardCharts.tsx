/**
 * 图表区（唯一 import recharts 的文件，随管理端路由懒加载）。
 *
 * 拆分理由：recharts + d3 实测 ~113KB gzip，必须隔离成独立 chunk，
 * 让 AdminPage 主 chunk 零增长（架构 §3.1）。这里不做任何取数，
 * 只吃已解析好的行数据与 CSS 变量色。
 *
 * 交互（PRD §4）：
 * - 悬浮提示**不固定在绘图区顶部**：按数据点位置上下避让 12px、水平钳位（tooltipPosition.ts）。
 * - 图例右上可点切换序列；隐藏后 Y 轴按可见序列自适应。
 * - 单序列不显示图例。
 * - 键盘：容器 tabIndex=0，←/→ 逐日移动，Esc 关闭。
 */

import React, { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardChartRow } from '../adminDashboardModel';
import { axisTicks, formatCount, formatDurationMs, formatPercentValue } from '../adminDashboardModel';
import { placeChartTooltip } from './tooltipPosition';
import type { resolveChartColors } from './useAdminChartColors';

type ChartColors = ReturnType<typeof resolveChartColors>;

/** 悬浮提示尺寸（固定宽度便于纯函数定位；高度按序列条数估） */
const TREND_TIP_WIDTH = 190;
const TREND_TIP_HEIGHT = 86;

/** 图表内边距（= recharts 轴宽 + X 轴高度）：tooltip 只在绘图区内定位，不压轴刻度。 */
const TREND_GUTTER = { left: 34, right: 34, top: 8, bottom: 24 };

interface HoverState { index: number; x: number; y: number }

interface LegendEntry { key: string; label: string; color: string; unit: string }

function useHoverKeyboard(rowCount: number) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (rowCount === 0) return;
    if (event.key === 'Escape') { setKeyboardIndex(null); setHover(null); return; }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = keyboardIndex ?? (event.key === 'ArrowRight' ? -1 : rowCount);
    const next = Math.min(rowCount - 1, Math.max(0, current + (event.key === 'ArrowRight' ? 1 : -1)));
    setKeyboardIndex(next);
    setHover(null);
  };
  return { hover, setHover, keyboardIndex, setKeyboardIndex, onKeyDown };
}

export function DashboardTrendChart({ rows, colors }: { rows: DashboardChartRow[]; colors: ChartColors }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const { hover, setHover, keyboardIndex, setKeyboardIndex, onKeyDown } = useHoverKeyboard(rows.length);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const legend: LegendEntry[] = [
    { key: 'newUsers', label: '新增用户', color: colors.series[0]!, unit: '人' },
    { key: 'activeUsersProxy', label: '互动活跃用户（代理）', color: colors.series[1]!, unit: '人' },
    { key: 'works', label: '图纸创建', color: colors.series[2]!, unit: '个' },
  ];
  const show = (key: string): boolean => !hidden.has(key);

  const leftMax = useMemo(() => Math.max(
    0,
    ...rows.flatMap(row => [
      show('newUsers') ? row.newUsers : 0,
      show('activeUsersProxy') ? row.activeUsersProxy : 0,
    ]),
  ), [rows, hidden]);
  const rightMax = useMemo(() => Math.max(0, ...rows.map(row => (show('works') ? row.works : 0))),
    [rows, hidden]);
  const leftTicks = axisTicks(leftMax, 4);
  const rightTicks = axisTicks(rightMax, 4);
  const leftTop = leftTicks[leftTicks.length - 1] ?? 1;
  const rightTop = rightTicks[rightTicks.length - 1] ?? 1;

  // 键盘模式：没有鼠标坐标，按索引估算点位，再交给同一套避让函数。
  const keyboardPoint = (index: number): HoverState => {
    const usable = Math.max(1, box.width - TREND_GUTTER.left - TREND_GUTTER.right);
    const x = TREND_GUTTER.left + (rows.length <= 1 ? usable / 2 : (index / (rows.length - 1)) * usable);
    const plotHeight = Math.max(1, box.height - TREND_GUTTER.top - TREND_GUTTER.bottom);
    const value = Math.max(rows[index]?.newUsers ?? 0, rows[index]?.activeUsersProxy ?? 0);
    const y = Math.max(0, box.height - TREND_GUTTER.bottom - (value / Math.max(1, leftTop)) * plotHeight);
    return { index, x, y };
  };
  const active: HoverState | null = keyboardIndex !== null ? keyboardPoint(keyboardIndex) : hover;
  const activeRow = active ? rows[active.index] : undefined;
  const tip = active && activeRow
    ? placeChartTooltip({
      pointX: active.x,
      pointY: active.y,
      boxWidth: box.width,
      boxHeight: box.height,
      gutter: TREND_GUTTER,
      tipWidth: TREND_TIP_WIDTH,
      tipHeight: TREND_TIP_HEIGHT,
      gap: 12,
    })
    : null;

  return <div className="admin-chart-frame">
    <div className="admin-chart-legend" role="group" aria-label="图例，可切换序列显隐">
      <span className="admin-chart-axis-unit" aria-hidden="true">左轴 人 · 右轴 个</span>
      {legend.map(entry => {
        const on = show(entry.key);
        return <button type="button" key={entry.key} className="admin-chart-legend-item" aria-pressed={on}
          data-series={entry.key} data-hidden={on ? undefined : 'true'}
          onClick={() => setHidden(previous => {
            const next = new Set(previous);
            if (next.has(entry.key)) next.delete(entry.key);
            else if (next.size < legend.length - 1) next.add(entry.key); // 至少留一条，避免空图
            return next;
          })}>
          <i aria-hidden="true" style={{ background: entry.color }} />{entry.label}
        </button>;
      })}
    </div>
    <div className="admin-chart-canvas" tabIndex={0} role="img"
      aria-label={'趋势图：' + rows.map(row => row.title + ' 新增用户 ' + row.newUsers + ' 人、互动活跃用户 ' + row.activeUsersProxy + ' 人、图纸创建 ' + row.works + ' 个').join('；')}
      onKeyDown={event => { onKeyDown(event); if (event.key === 'Escape') setKeyboardIndex(null); }}
      onBlur={() => setKeyboardIndex(null)}>
      <ResponsiveContainer width="100%" height="100%"
        onResize={(width: number, height: number) => setBox({ width, height })}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={(state: unknown) => {
            const next = state as { isTooltipActive?: boolean; activeTooltipIndex?: number; activeCoordinate?: { x: number; y: number } };
            if (!next?.isTooltipActive || next.activeTooltipIndex === undefined || !next.activeCoordinate) { setHover(null); return; }
            setHover({ index: next.activeTooltipIndex, x: next.activeCoordinate.x, y: next.activeCoordinate.y });
          }}
          onMouseLeave={() => setHover(null)}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 4" vertical={false} />
          {/* 只为取得 active 状态/坐标：内容由下方自绘 tooltip 渲染（避让 + 钳位）。 */}
          <Tooltip content={() => null} cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }} />
          <XAxis dataKey="label" tick={{ fill: colors.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: colors.grid }}
            interval={rows.length > 10 ? 4 : 0} minTickGap={8} />
          <YAxis yAxisId="people" width={34} ticks={leftTicks} domain={[0, leftTop]}
            tick={{ fill: colors.axis, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false}
 />
          <YAxis yAxisId="items" orientation="right" width={34} ticks={rightTicks} domain={[0, rightTop]}
            tick={{ fill: colors.axis, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false}
 />
          {show('works') && <Bar yAxisId="items" dataKey="works" name="图纸创建" fill={colors.series[2]} fillOpacity={0.85}
            radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />}
          {show('newUsers') && <Line yAxisId="people" type="monotone" dataKey="newUsers" name="新增用户"
            stroke={colors.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />}
          {show('activeUsersProxy') && <Line yAxisId="people" type="monotone" dataKey="activeUsersProxy" name="互动活跃用户（代理）"
            stroke={colors.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      {activeRow && tip && <div className="admin-dash-tip" data-dash-tooltip data-placement={tip.placement}
        style={{ transform: 'translate(' + Math.round(tip.x) + 'px,' + Math.round(tip.y) + 'px)', width: TREND_TIP_WIDTH + 'px' }}>
        <span className="admin-dash-tip-date">{activeRow.title}</span>
        {legend.filter(entry => show(entry.key)).map(entry => <span className="admin-dash-tip-row" key={entry.key}>
          <i aria-hidden="true" style={{ background: entry.color }} />{entry.label}
          <b>{formatCount(activeRow[entry.key as 'newUsers' | 'activeUsersProxy' | 'works'])} {entry.unit}</b>
        </span>)}
      </div>}
    </div>
  </div>;
}

const QUALITY_TIP_WIDTH = 190;
const QUALITY_TIP_HEIGHT = 92;

const QUALITY_GUTTER = { left: 46, right: 40, top: 8, bottom: 24 };

export function DashboardQualityChart({ rows, colors }: { rows: DashboardChartRow[]; colors: ChartColors }) {
  const { hover, setHover, keyboardIndex, onKeyDown } = useHoverKeyboard(rows.length);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const hasRate = rows.some(row => row.errorRatePct !== null);
  const hasDuration = rows.some(row => row.avgDurationMs !== null);
  const show = (key: string): boolean => (key === 'errorRatePct' ? hasRate : hasDuration) && !hidden.has(key);
  const showRate = show('errorRatePct');
  const showDuration = show('avgDurationMs');
  // 两条序列都在才给图例（单序列不显示图例，PRD §4）。
  const legendVisible = hasRate && hasDuration;

  const durationMax = Math.max(0, ...rows.map(row => (showDuration ? row.avgDurationMs ?? 0 : 0)));
  const durationTicks = axisTicks(durationMax, 3);
  const durationTop = durationTicks[durationTicks.length - 1] ?? 1;
  const rateMax = Math.max(0, ...rows.map(row => (showRate ? row.errorRatePct ?? 0 : 0)));

  const active: HoverState | null = keyboardIndex !== null
    ? (() => {
      const usable = Math.max(1, box.width - QUALITY_GUTTER.left - QUALITY_GUTTER.right);
      const x = QUALITY_GUTTER.left + (rows.length <= 1 ? usable / 2 : (keyboardIndex / (rows.length - 1)) * usable);
      const plotHeight = Math.max(1, box.height - QUALITY_GUTTER.top - QUALITY_GUTTER.bottom);
      const value = rows[keyboardIndex]?.avgDurationMs ?? rows[keyboardIndex]?.errorRatePct ?? 0;
      const top = Math.max(1, durationTop);
      return { index: keyboardIndex, x, y: Math.max(0, box.height - QUALITY_GUTTER.bottom - (value / top) * plotHeight) };
    })()
    : hover;
  const activeRow = active ? rows[active.index] : undefined;
  const tip = active && activeRow
    ? placeChartTooltip({
      pointX: active.x,
      pointY: active.y,
      boxWidth: box.width,
      boxHeight: box.height,
      gutter: QUALITY_GUTTER,
      tipWidth: QUALITY_TIP_WIDTH,
      tipHeight: QUALITY_TIP_HEIGHT,
      gap: 12,
    })
    : null;

  return <div className="admin-chart-frame">
    <div className="admin-chart-legend" role="group" aria-label={legendVisible ? '图例，可切换序列显隐' : '图例'}>
      <span className="admin-chart-axis-unit" aria-hidden="true">左轴 错误率% · 右轴 ms</span>
      {legendVisible
        ? <>
          {hasRate && <button type="button" className="admin-chart-legend-item" data-series="errorRatePct"
            aria-pressed={showRate} data-hidden={showRate ? undefined : 'true'}
            onClick={() => setHidden(previous => {
              const next = new Set(previous);
              if (next.has('errorRatePct')) next.delete('errorRatePct');
              else if (next.size < 1) next.add('errorRatePct');
              return next;
            })}>
            <i aria-hidden="true" style={{ background: colors.series[2] }} />错误率 %
          </button>}
          {hasDuration && <button type="button" className="admin-chart-legend-item" data-series="avgDurationMs"
            aria-pressed={showDuration} data-hidden={showDuration ? undefined : 'true'}
            onClick={() => setHidden(previous => {
              const next = new Set(previous);
              if (next.has('avgDurationMs')) next.delete('avgDurationMs');
              else if (next.size < 1) next.add('avgDurationMs');
              return next;
            })}>
            <i aria-hidden="true" style={{ background: colors.series[0] }} />平均耗时 ms
          </button>}
        </>
        : <>
          {hasRate && <span className="admin-chart-legend-item" data-series="errorRatePct"><i aria-hidden="true" style={{ background: colors.series[2] }} />错误率 %</span>}
          {hasDuration && <span className="admin-chart-legend-item" data-series="avgDurationMs"><i aria-hidden="true" style={{ background: colors.series[0] }} />平均耗时 ms</span>}
        </>}
    </div>
    <div className="admin-chart-canvas" tabIndex={0} role="img"
      aria-label={'质量趋势：' + rows.map(row => row.title + ' 错误率 ' + formatPercentValue(row.errorRatePct) + '、平均耗时 ' + formatDurationMs(row.avgDurationMs) + '、错误 ' + row.errors + ' 次 / 请求 ' + row.requests + ' 次').join('；')}
      onKeyDown={onKeyDown} onBlur={() => { setHover(null); }}>
      <ResponsiveContainer width="100%" height="100%"
        onResize={(width: number, height: number) => setBox({ width, height })}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={(state: unknown) => {
            const next = state as { isTooltipActive?: boolean; activeTooltipIndex?: number; activeCoordinate?: { x: number; y: number } };
            if (!next?.isTooltipActive || next.activeTooltipIndex === undefined || !next.activeCoordinate) { setHover(null); return; }
            setHover({ index: next.activeTooltipIndex, x: next.activeCoordinate.x, y: next.activeCoordinate.y });
          }}
          onMouseLeave={() => setHover(null)}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 4" vertical={false} />
          <Tooltip content={() => null} cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }} />
          <XAxis dataKey="label" tick={{ fill: colors.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: colors.grid }}
            interval={rows.length > 10 ? 4 : 0} minTickGap={8} />
          {showRate && <YAxis yAxisId="rate" width={46} domain={[0, 'auto']} tickCount={3}
            tick={{ fill: colors.axis, fontSize: 12 }} tickLine={false} axisLine={false}
            tickFormatter={(value: number) => formatPercentValue(value, 2)} />}
          {showDuration && <YAxis yAxisId="duration" orientation="right" width={40} ticks={durationTicks} domain={[0, durationTop]}
            allowDecimals={false} tick={{ fill: colors.axis, fontSize: 12 }} tickLine={false} axisLine={false} />}
          {showRate && <Line yAxisId="rate" type="monotone" dataKey="errorRatePct" name="错误率 %" connectNulls={false}
            stroke={colors.series[2]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />}
          {showDuration && <Line yAxisId="duration" type="monotone" dataKey="avgDurationMs" name="平均耗时 ms" connectNulls={false}
            stroke={colors.series[0]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
      {activeRow && tip && <div className="admin-dash-tip" data-dash-tooltip data-placement={tip.placement}
        style={{ transform: 'translate(' + Math.round(tip.x) + 'px,' + Math.round(tip.y) + 'px)', width: QUALITY_TIP_WIDTH + 'px' }}>
        <span className="admin-dash-tip-date">{activeRow.title}</span>
        {hasRate && <span className="admin-dash-tip-row"><i aria-hidden="true" style={{ background: colors.series[2] }} />错误率
          <b>{formatPercentValue(activeRow.errorRatePct)}</b></span>}
        {hasDuration && <span className="admin-dash-tip-row"><i aria-hidden="true" style={{ background: colors.series[0] }} />平均耗时
          <b>{formatDurationMs(activeRow.avgDurationMs)}</b></span>}
        {/* 每日错误数不再单独成线：放进副行，避免第三条同构图。 */}
        <span className="admin-dash-tip-sub" data-tip-sub>错误 {formatCount(activeRow.errors)} 次 / 请求 {formatCount(activeRow.requests)} 次</span>
      </div>}
    </div>
  </div>;
}
