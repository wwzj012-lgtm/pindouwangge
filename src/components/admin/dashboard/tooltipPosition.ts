/**
 * 图表悬浮提示避让（纯函数，不依赖 DOM，可单测）。
 *
 * 用户反馈的原缺陷：tooltip 绝对定位 `top:0`，固定贴在绘图区顶部，正好压住峰值。
 * 规则（PRD §4）：
 * 1. 垂直：数据点位于绘图区上半部（pointY < plotHeight/2）→ 提示放到点下方 12px；
 *    否则放到点上方 12px。最后整体钳位到 [0, plotHeight - tipHeight]，不溢出卡片。
 * 2. 水平：以数据点为中心（pointX - tipWidth/2），钳位到 [0, plotWidth - tipWidth]；
 *    tipWidth 比绘图区还宽时左对齐 0。
 * 3. 提示本身 `pointer-events:none`（由 CSS 保证），不遮挡鼠标命中。
 */

export interface TooltipPlacementInput {
  /** 数据点在绘图区内的 X（px，相对绘图区左上角）。 */
  pointX: number;
  /** 数据点在绘图区内的 Y。 */
  pointY: number;
  plotWidth: number;
  plotHeight: number;
  tipWidth: number;
  tipHeight: number;
  /** 与数据点的垂直间距，默认 12px（PRD 指定）。 */
  gap?: number;
}

export interface TooltipPlacement {
  x: number;
  y: number;
  placement: 'above' | 'below';
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function placeTooltip(input: TooltipPlacementInput): TooltipPlacement {
  const gap = Number.isFinite(input.gap) ? Math.max(0, input.gap as number) : 12;
  const plotWidth = Math.max(0, input.plotWidth);
  const plotHeight = Math.max(0, input.plotHeight);
  const tipWidth = Math.max(0, input.tipWidth);
  const tipHeight = Math.max(0, input.tipHeight);
  const pointX = Number.isFinite(input.pointX) ? input.pointX : 0;
  const pointY = Number.isFinite(input.pointY) ? input.pointY : 0;

  // 点在上半部 → 提示放下方（否则会遮住上方更高的数据）。
  const placement: 'above' | 'below' = pointY < plotHeight / 2 ? 'below' : 'above';
  const rawY = placement === 'below' ? pointY + gap : pointY - tipHeight - gap;

  return {
    x: tipWidth > plotWidth ? 0 : clamp(pointX - tipWidth / 2, 0, plotWidth - tipWidth),
    y: clamp(rawY, 0, plotHeight - tipHeight),
    placement,
  };
}

/** 图表内边距（轴标签占位）：绘图区 = 容器去掉这四块。 */
export interface ChartGutter {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartTooltipInput extends Omit<TooltipPlacementInput, 'pointX' | 'pointY' | 'plotWidth' | 'plotHeight'> {
  /** 数据点 X（相对整个图表容器，即 recharts 的 activeCoordinate.x）。 */
  pointX: number;
  /** 数据点 Y（相对整个图表容器）。 */
  pointY: number;
  /** 图表容器尺寸。 */
  boxWidth: number;
  boxHeight: number;
  /** 轴标签占位；提示只在绘图区内定位，因此不会压住 Y 轴刻度。 */
  gutter: ChartGutter;
}

/**
 * 图表用版本：先把点位换算到绘图区坐标，避让后再换算回容器坐标。
 * 这样首日/末日的提示会被钳在绘图区内侧，**不会盖住左右 Y 轴刻度**，
 * 也不会溢出卡片。
 */
export function placeChartTooltip(input: ChartTooltipInput): TooltipPlacement {
  const plotWidth = Math.max(0, input.boxWidth - input.gutter.left - input.gutter.right);
  const plotHeight = Math.max(0, input.boxHeight - input.gutter.top - input.gutter.bottom);
  const local = placeTooltip({
    pointX: input.pointX - input.gutter.left,
    pointY: input.pointY - input.gutter.top,
    plotWidth,
    plotHeight,
    tipWidth: input.tipWidth,
    tipHeight: input.tipHeight,
    gap: input.gap,
  });
  return { x: local.x + input.gutter.left, y: local.y + input.gutter.top, placement: local.placement };
}
