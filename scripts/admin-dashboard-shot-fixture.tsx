/**
 * 仪盘盘截图 fixture（仅用于视觉验收，不参与构建产物）。
 * 用真实组件 + 真实 admin.css 渲染，数据为固定造数（可复现）。
 * URL 参数：?range=7|30&tip=first|peak|last
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import DashboardView from '../src/components/admin/dashboard/DashboardView';

const params = new URLSearchParams(window.location.search);
const range = params.get('range') === '30' ? 30 : 7;
const tip = params.get('tip');

const DAY = 86_400_000;
const TODAY = Date.UTC(2025, 10, 11);

/** 造数：30 天基础曲线（末日=今天），7 天取尾部 7 点。 */
const BASE = [
  { newUsers: 3, activeUsersProxy: 6, works: 5, posts: 2, completions: 4, errors: 0, avgDurationMs: 148 },
  { newUsers: 5, activeUsersProxy: 9, works: 8, posts: 3, completions: 6, errors: 1, avgDurationMs: 162 },
  { newUsers: 2, activeUsersProxy: 4, works: 3, posts: 1, completions: 2, errors: 0, avgDurationMs: 131 },
  { newUsers: 7, activeUsersProxy: 12, works: 11, posts: 5, completions: 9, errors: 0, avgDurationMs: 175 },
  { newUsers: 4, activeUsersProxy: 7, works: 6, posts: 2, completions: 5, errors: 2, avgDurationMs: 240 },
  { newUsers: 6, activeUsersProxy: 10, works: 9, posts: 4, completions: 7, errors: 1, avgDurationMs: 158 },
  { newUsers: 9, activeUsersProxy: 14, works: 13, posts: 6, completions: 11, errors: 0, avgDurationMs: 143 },
  { newUsers: 1, activeUsersProxy: 3, works: 2, posts: 0, completions: 1, errors: 0, avgDurationMs: null },
  { newUsers: 8, activeUsersProxy: 13, works: 12, posts: 5, completions: 10, errors: 1, avgDurationMs: 199 },
  { newUsers: 4, activeUsersProxy: 8, works: 7, posts: 3, completions: 6, errors: 0, avgDurationMs: 152 },
  { newUsers: 5, activeUsersProxy: 9, works: 8, posts: 4, completions: 7, errors: 0, avgDurationMs: 168 },
  { newUsers: 12, activeUsersProxy: 18, works: 16, posts: 7, completions: 14, errors: 2, avgDurationMs: 285 },
  { newUsers: 3, activeUsersProxy: 5, works: 4, posts: 1, completions: 3, errors: 0, avgDurationMs: 121 },
  { newUsers: 6, activeUsersProxy: 11, works: 9, posts: 4, completions: 8, errors: 1, avgDurationMs: 176 },
  { newUsers: 7, activeUsersProxy: 12, works: 10, posts: 5, completions: 9, errors: 0, avgDurationMs: 154 },
  { newUsers: 2, activeUsersProxy: 4, works: 3, posts: 1, completions: 2, errors: 0, avgDurationMs: 138 },
  { newUsers: 9, activeUsersProxy: 15, works: 14, posts: 6, completions: 12, errors: 1, avgDurationMs: 187 },
  { newUsers: 5, activeUsersProxy: 9, works: 8, posts: 3, completions: 7, errors: 0, avgDurationMs: 149 },
  { newUsers: 4, activeUsersProxy: 7, works: 6, posts: 2, completions: 5, errors: 1, avgDurationMs: 205 },
  { newUsers: 6, activeUsersProxy: 10, works: 9, posts: 4, completions: 8, errors: 0, avgDurationMs: 163 },
  { newUsers: 18, activeUsersProxy: 26, works: 22, posts: 11, completions: 19, errors: 2, avgDurationMs: 312 },
  { newUsers: 3, activeUsersProxy: 6, works: 5, posts: 2, completions: 4, errors: 0, avgDurationMs: 144 },
  { newUsers: 5, activeUsersProxy: 9, works: 8, posts: 3, completions: 6, errors: 0, avgDurationMs: 157 },
  { newUsers: 7, activeUsersProxy: 12, works: 11, posts: 5, completions: 9, errors: 1, avgDurationMs: 171 },
  { newUsers: 2, activeUsersProxy: 5, works: 4, posts: 1, completions: 3, errors: 0, avgDurationMs: 133 },
  { newUsers: 6, activeUsersProxy: 11, works: 9, posts: 4, completions: 8, errors: 0, avgDurationMs: 166 },
  { newUsers: 8, activeUsersProxy: 13, works: 12, posts: 5, completions: 10, errors: 1, avgDurationMs: 192 },
  { newUsers: 4, activeUsersProxy: 8, works: 7, posts: 3, completions: 6, errors: 0, avgDurationMs: 151 },
  { newUsers: 5, activeUsersProxy: 10, works: 8, posts: 4, completions: 7, errors: 1, avgDurationMs: 174 },
  { newUsers: 7, activeUsersProxy: 12, works: 10, posts: 5, completions: 9, errors: 0, avgDurationMs: 158 },
  { newUsers: 6, activeUsersProxy: 11, works: 9, posts: 4, completions: 8, errors: 0, avgDurationMs: 147 },
];

const series = BASE.slice(-range).map((point, index) => {
  // 每日请求数造数（620~785 条/天），错误率由后端公式算好再塞进 series（前端不做除法）。
  const requests = 620 + (index % 4) * 55;
  const total = requests + point.errors;
  return {
    date: new Date(TODAY - (range - 1 - index) * DAY).toISOString().slice(0, 10),
    ...point,
    requests,
    errorRatePct: total > 0 ? Math.round((point.errors / total) * 10_000) / 100 : null,
  };
});

const sum = (key: keyof (typeof BASE)[number]) => series.reduce((total, point) => total + (Number(point[key]) || 0), 0);
const works = sum('works');
const completions = sum('completions');
const posts = sum('posts');
const errors = sum('errors');
const requests = series.length * 620;

const analytics = {
  range,
  todayStartUtc: '2025-11-11T00:00:00.000Z',
  kpis: {
    todayNewCreators: 6,
    todayNewCreatorsPrevSameTime: 5,
    todayNewCreatorsDeltaPct: 20,
    publishConversion: { numerator: posts, denominator: works, rate: works > 0 ? posts / works : null },
    pendingTotal: 5,
    pendingBreakdown: { reviews: 3, reports: 2, reportsReviewing: 1 },
    errorRate24hProxy: { errors: 8, requests: 640, rate: 8 / 648 },
  },
  series,
  comparison: {
    from: series[0]!.date,
    to: series[series.length - 1]!.date,
    previousFrom: new Date(TODAY - (2 * range - 1) * DAY).toISOString().slice(0, 10),
    previousTo: series[0]!.date,
    current: {
      newUsers: sum('newUsers'), activeUsersProxy: sum('activeUsersProxy'), works, completions, posts, errors, requests,
    },
    previous: {
      newUsers: Math.round(sum('newUsers') * 0.89), activeUsersProxy: Math.round(sum('activeUsersProxy') * 0.92),
      works: Math.round(works * 0.88), completions: Math.round(completions * 0.9), posts: Math.round(posts * 1.04),
      errors: Math.max(0, errors - 3), requests: Math.round(requests * 0.93),
    },
    deltaPct: { newUsers: 12.4, activeUsersProxy: 8.7, works: 13.6, completions: 11.1, posts: -3.8, errors: 18.2, requests: 7.5 },
  },
  funnel: {
    works, completions, posts,
    stepRate: { toCompletion: works > 0 ? completions / works : null, toPublish: completions > 0 ? posts / completions : null },
    overallRate: works > 0 ? posts / works : null,
    completionsAreEvents: true,
  },
  quality: {
    errorRateProxy: requests + errors > 0 ? errors / (requests + errors) : null,
    errors, requests, avgDurationMs: 168, maxDurationMs: 312, durationSamples: requests,
    errorCodesTop5: [{ code: 'HTTP_500', count: 9 }, { code: 'HTTP_502', count: 4 }, { code: 'UNHANDLED_EXCEPTION', count: 2 }, { code: 'HTTP_504', count: 1 }, { code: 'OTHER', count: 1 }],
    unresolvedErrors: 3,
  },
};

const data = {
  overview: { totalUsers: 12846, newUsers30Days: 512, activeVipUsers: 318, works: 40218, communityPosts: 3120, redeemedCodes: 902, recentErrors: 8 },
  todo: { pendingReviews: 3, pendingReports: 2, lowStockCodes: false, availableCodes: 42, lowStockThreshold: 50 },
  analytics,
  meta: { requests: 6, generatedAt: Date.UTC(2025, 10, 11, 6, 30), range },
  warnings: [],
};

function App() {
  return <div className="admin-root">
    <div className="admin-layout" style={{ marginLeft: 0 }}>
      <header className="admin-header">
        <div className="admin-header-title"><div>
          <nav className="admin-breadcrumb"><span>管理工作台</span><span>/</span><span>总览</span></nav>
          <h1>数据仪表盘</h1>
        </div></div>
        <div className="admin-header-actions"><div className="admin-account"><span className="admin-account-name">运营管理员</span><span className="admin-account-session"><i />会话有效</span></div></div>
      </header>
      <main className="admin-main">
        <DashboardView data={data} error="" loading={false} retry={() => undefined} range={range}
          onRangeChange={() => undefined} onDrill={() => undefined} />
      </main>
    </div>
  </div>;
}

/** 暴露峰值日，供截图脚本核对「峰值日 tooltip」确实落在峰值那天。 */
const peakPoint = series.reduce((best, point) => (point.newUsers > best.newUsers ? point : best), series[0]!);
(window as unknown as { __dashPeakDate?: string }).__dashPeakDate = peakPoint.date;

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

/** tooltip 截图：用键盘路径（←/→ 逐日）定位，避免依赖鼠标坐标。 */
if (tip) {
  const targetIndex = (() => {
    if (tip === 'first') return 0;
    if (tip === 'last') return series.length - 1;
    let peak = 0;
    series.forEach((point, index) => { if (point.newUsers > series[peak]!.newUsers) peak = index; });
    return peak;
  })();
  // 图表是懒加载 chunk：轮询等它真正挂载后再发键盘事件（虚拟时间下也稳定）。
  let attempts = 0;
  const tick = () => {
    const canvas = document.querySelector<HTMLElement>('.admin-chart-canvas');
    if (!canvas) {
      if (attempts++ < 120) setTimeout(tick, 100);
      return;
    }
    canvas.focus();
    for (let index = 0; index <= targetIndex; index += 1) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
  };
  setTimeout(tick, 200);
}
