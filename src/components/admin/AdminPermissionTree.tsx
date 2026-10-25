import React, { useMemo, useState } from 'react';
import {
  buildPermissionGroups,
  permissionCheckState,
  permissionDisplayLabel,
  permissionMatchesSearch,
  togglePermissionCodes,
  unknownGrantedCodes,
  type PermissionTreeItem,
} from './adminPermissionTreeModel';

interface Props {
  permissions: readonly PermissionTreeItem[];
  selectedCodes: ReadonlySet<string>;
  lockedCodes?: readonly string[];
  disabled?: boolean;
  onChange: (codes: Set<string>) => void;
}

function CheckState({ state, disabled, onChange, label }: {
  state: 'checked' | 'mixed' | 'empty';
  disabled: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = React.useCallback((node: HTMLInputElement | null) => {
    if (node) node.indeterminate = state === 'mixed';
  }, [state]);
  return <input ref={ref} type="checkbox" checked={state === 'checked'} disabled={disabled} aria-label={label}
    onChange={event => onChange(event.currentTarget.checked)} />;
}

export function AdminPermissionTree({ permissions, selectedCodes, lockedCodes = [], disabled = false, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => buildPermissionGroups(permissions), [permissions]);
  const locked = useMemo(() => new Set(lockedCodes), [lockedCodes]);
  const visibleGroups = useMemo(() => groups.map(group => ({
    ...group,
    permissions: group.permissions.filter(permission => permissionMatchesSearch(permission, group.label, query)),
  })).filter(group => group.permissions.length > 0), [groups, query]);
  const visibleCodes = visibleGroups.flatMap(group => group.permissions.map(permission => permission.code));
  const staleCodes = unknownGrantedCodes(permissions, selectedCodes);
  const canChange = !disabled;

  const bulk = (codes: readonly string[], checked: boolean) => {
    if (canChange) onChange(togglePermissionCodes(selectedCodes, codes, locked, checked));
  };

  return <div className="admin-permission-tree" aria-label="按模块配置角色权限">
    <div className="admin-permission-tree-toolbar">
      <label className="admin-permission-search">搜索权限
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="搜索中文名称、模块或权限编码" aria-label="搜索权限" />
      </label>
      <div className="admin-permission-tree-actions">
        <span role="status">当前目录已选 {permissions.filter(item => selectedCodes.has(item.code)).length} / {permissions.length} 项</span>
        <button type="button" disabled={!canChange || visibleCodes.every(code => selectedCodes.has(code))}
          onClick={() => bulk(visibleCodes, true)}>全选当前结果</button>
        <button type="button" disabled={!canChange || visibleCodes.every(code => !selectedCodes.has(code) || locked.has(code))}
          onClick={() => bulk(visibleCodes, false)}>清空当前结果</button>
      </div>
    </div>

    {visibleGroups.length ? <div className="admin-permission-tree-groups">
      {visibleGroups.map(group => {
        const codes = group.permissions.map(item => item.code);
        const state = permissionCheckState(codes, selectedCodes);
        const groupLocked = codes.every(code => locked.has(code));
        const isExpanded = Boolean(query.trim()) || expanded.has(group.key);
        const panelId = `admin-permission-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        return <section className="admin-permission-module" key={group.key}>
          <div className="admin-permission-module-heading">
            <CheckState state={state} disabled={!canChange || groupLocked}
              label={`${group.label}模块${state === 'mixed' ? '部分选中' : ''}`}
              onChange={checked => bulk(codes, checked)} />
            <button type="button" className="admin-permission-module-toggle" aria-expanded={isExpanded}
              aria-controls={panelId} onClick={() => setExpanded(current => {
                const next = new Set(current);
                if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                return next;
              })}>
              <strong>{group.label}</strong><span>{codes.filter(code => selectedCodes.has(code)).length} / {codes.length} 项</span>
              <span aria-hidden="true">{isExpanded ? '收起' : '展开'}</span>
            </button>
            <button type="button" className="admin-permission-module-bulk" disabled={!canChange || groupLocked || codes.every(code => selectedCodes.has(code))}
              onClick={() => bulk(codes, true)}>全选</button>
            <button type="button" className="admin-permission-module-bulk" disabled={!canChange || groupLocked || codes.every(code => !selectedCodes.has(code) || locked.has(code))}
              onClick={() => bulk(codes, false)}>清空</button>
          </div>
          <div id={panelId} className="admin-permission-module-items" hidden={!isExpanded}>
            {group.permissions.map(permission => {
              const isLocked = locked.has(permission.code);
              const name = permissionDisplayLabel(permission);
              const description = permission.description && /[\u3400-\u9fff]/u.test(permission.description) ? permission.description : '';
              return <label className="admin-permission-tree-item" key={permission.id}>
                <input data-permission-code={permission.code} type="checkbox" checked={selectedCodes.has(permission.code)}
                  disabled={!canChange || isLocked} onChange={event => onChange(togglePermissionCodes(selectedCodes, [permission.code], locked, event.currentTarget.checked))} />
                <span className="admin-permission-tree-item-copy"><strong>{name}</strong>
                  <small className="admin-mono" title="服务端权限标识">{permission.code}</small>
                  {description && <small>{description}</small>}
                  {isLocked && <small className="admin-permission-locked">系统最低授权 · 不可取消</small>}
                </span>
              </label>;
            })}
          </div>
        </section>;
      })}
    </div> : <p className="admin-empty-inline">没有匹配的权限目录项。</p>}

    {staleCodes.length > 0 && <aside className="admin-permission-stale" aria-label="目录外已有授权">
      <strong>已授权但目录暂未返回（保留，不参与修改）</strong>
      <ul>{staleCodes.map(code => <li className="admin-mono" key={code}>{code}</li>)}</ul>
    </aside>}
  </div>;
}
