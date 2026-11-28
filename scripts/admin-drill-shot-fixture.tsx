/**
 * 下钻验收 fixture（仅用于 QA 复验截图，不进构建产物）。
 *
 * 复刻 AdminConsole 的真实导航语义：
 *   待办卡点击 → `todoDrillQuery(card)` 写进 URL（先删旧 preset 再写）→ pushState → 重挂目标模块。
 * 目标模块用**生产组件**渲染，preset 由生产代码 `drillPresetFromLocation()` 读取。
 * URL：?module=community|codes|brands&preset=review-queue|reports|low-stock
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminCommunityPosts } from '../src/components/admin/AdminCommunityPosts';
import { AdminLogsCodes } from '../src/components/admin/AdminLogsCodes';
import { AdminBrandsColors } from '../src/components/admin/AdminBrandsColors';
import type { AdminRequest } from '../src/components/admin/adminRequest';
import { todoDrillQuery } from '../src/components/admin/adminDashboardModel';

const readModule = (): 'community' | 'codes' | 'brands' => {
  const value = new URLSearchParams(window.location.search).get('module');
  return value === 'codes' || value === 'brands' ? value : 'community';
};

const catalog = {
  items: [
    {
      code: 'MARD', name: 'Mard-221', builtin: true, enabled: true, protected: true, version: 1, colorCount: 2,
      colors: [
        { id: 'MARD_A1', code: 'A1', name: '奶黄', hex: '#FAF4C8', screenReferenceOnly: false },
        { id: 'MARD_B2', code: 'B2', name: '雾蓝', hex: '#A8C5DA', screenReferenceOnly: false },
      ],
    },
    {
      code: 'STUDIO', name: '工作室自有色卡', builtin: false, enabled: true, protected: false, version: 1, colorCount: 2,
      colors: [
        { id: 'studio_green', code: 'G1', name: '松绿', hex: '#A3B18A', screenReferenceOnly: false },
        { id: 'studio_pink', code: 'P1', name: '樱花粉', hex: '#FFB7C5', screenReferenceOnly: false },
      ],
    },
  ],
};

/** 所有接口都返回空列表 + 稳定 total；只为让页签/筛选渲染出来，不伪造业务数字。 */
const request: AdminRequest = async <T,>(path: string) => {
  if (path.startsWith('/api/admin/brands')) return { ok: true, status: 200, data: catalog as unknown as T };
  if (path.includes('/api/admin/codes')) {
    return { ok: true, status: 200, data: { items: [], total: 0, page: 1, limit: 20, stats: { total: 0, redeemed: 0, available: 0, deletePending: 0, copied: 0 } } as unknown as T };
  }
  return { ok: true, status: 200, data: { items: [], total: 0 } as unknown as T };
};

const todoCards = [
  { key: 'reviews' as const, module: 'community' as const, label: '待审核帖子', value: 3, note: '' },
  { key: 'reports' as const, module: 'community' as const, label: '待处理举报', value: 2, note: '复核中 1 条（不计入）' },
  { key: 'codes' as const, module: 'codes' as const, label: '兑换码可用库存', value: 42, note: '低库存阈值 50' },
];

function App() {
  const [revision, setRevision] = useState(0);
  const active = readModule();

  // 与 AdminConsole.performAction 完全一致的 URL 写法：先删 preset，再写入本次下钻参数。
  const drill = (target: 'community' | 'codes', card: 'reviews' | 'reports' | 'codes'): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('module', target);
    url.searchParams.delete('preset');
    for (const [key, value] of Object.entries(todoDrillQuery(card))) url.searchParams.set(key, value);
    window.history.pushState({}, '', url);
    setRevision(value => value + 1);
  };

  return <div className="admin-root">
    <div className="admin-layout" style={{ marginLeft: 0 }}>
      <main className="admin-main">
        <section className="admin-dash-panel admin-dash-panel--todo" data-dashboard-todo>
          <div className="admin-dash-panel-head"><h2>待办</h2><p className="admin-dash-scope">点击进入对应列表并带筛选条件</p></div>
          <div className="admin-dash-todo">
            {todoCards.map(card => <button type="button" key={card.key} className="admin-dash-todo-item" data-todo-card={card.key}
              onClick={() => drill(card.module, card.key)}>
              <span className="admin-dash-todo-label">{card.label}</span>
              <strong data-todo-value={card.key}>{card.value}</strong>
              {card.note && <small className="admin-dash-todo-note">{card.note}</small>}
              <span className="admin-dash-todo-action" aria-hidden="true">去处理 →</span>
            </button>)}
          </div>
        </section>
        <div className="admin-module" data-admin-module={active} key={active + revision}>
          {active === 'community' ? <AdminCommunityPosts request={request} />
            : active === 'codes' ? <AdminLogsCodes mode="codes" request={request} />
              : <AdminBrandsColors request={request} readOnly operatorUid="fixture-admin" />}
        </div>
      </main>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
