/**
 * 侧栏面板（参数设置 / 用量统计）唯一的一套尺寸尺度。
 *
 * 背景：两个面板原先各自混用 `h-11 sm:h-auto sm:min-h-0`、裸 `h-12`、`text-sm`
 * 无覆盖等写法，桌面 320px 侧栏里最终出现 16 / 20 / 23 / 25 / 30 / 32 / 34 / 44 / 48px
 * 九种控件高度和 9 / 10 / 11 / 12 / 14px 五种字号。下拉框被 `sm:h-auto + py-0`
 * 压成 20px 的一条线，抖动按钮却是 34px / 14px。
 *
 * 现在只有两套值，按面板所在形态二选一，不再靠断点互相覆盖：
 * - sidebar（桌面侧栏）：控件 32px，字号 13 / 12 / 11 / 10
 * - sheet（移动抽屉）：控件 ≥44px，字号 15 / 14 / 13 / 12
 *
 * 新增控件只能取这里的 token，不要再写 h-11 / sm: / lg: 这类尺寸类；
 * panelScale.test.ts 会扫描两个面板文件，发现裸尺寸类就报错。
 */
export interface PanelScale {
  panelTitle: string;
  sectionTitle: string;
  cardTitle: string;
  body: string;
  micro: string;
  control: string;
  chip: string;
  numberInput: string;
  range: string;
  checkbox: string;
  card: string;
  stack: string;
  sectionStack: string;
  iconBtn: string;
  headerBtn: string;
  primary: string;
  row: string;
  rowTitle: string;
  rowMeta: string;
}

export function createPanelScale(sheet: boolean): PanelScale {
  return {
    panelTitle: sheet ? 'text-[15px] font-extrabold' : 'text-[13px] font-extrabold',
    sectionTitle: sheet ? 'text-sm font-extrabold' : 'text-[12px] font-extrabold',
    cardTitle: sheet ? 'text-[13px] font-bold' : 'text-[11px] font-bold',
    body: sheet ? 'text-xs leading-snug' : 'text-[10px] leading-snug',
    micro: sheet ? 'text-xs' : 'text-[10px]',
    /** 单行控件（按钮 / 下拉 / 输入框）——同一面板内高度必须完全一致 */
    control: sheet ? 'h-11 text-sm' : 'h-8 text-[11px]',
    /** 两行卡片式按钮（板型预设），第二行说明需要额外高度 */
    chip: sheet ? 'h-12' : 'h-10',
    numberInput: sheet ? 'h-11 text-base' : 'h-8 text-[11px]',
    range: sheet ? 'h-11' : 'h-6',
    checkbox: sheet ? 'w-5 h-5' : 'w-4 h-4',
    card: sheet ? 'p-3 rounded-2xl' : 'p-2 rounded-xl',
    stack: sheet ? 'space-y-5' : 'space-y-4',
    sectionStack: sheet ? 'space-y-3' : 'space-y-2.5',
    iconBtn: sheet ? 'h-11 w-11' : 'h-8 w-8',
    headerBtn: sheet ? 'h-11 px-3 text-sm' : 'h-8 px-2.5 text-[11px]',
    primary: sheet ? 'h-12 text-sm' : 'h-9 text-[12px]',
    row: sheet ? 'p-2.5' : 'p-1.5',
    rowTitle: sheet ? 'text-xs' : 'text-[11px]',
    rowMeta: sheet ? 'text-xs' : 'text-[10px]',
  };
}
