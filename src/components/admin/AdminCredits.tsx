import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AdminButton, AdminConfirmDialog, AdminDialog } from './AdminPrimitives';
import { AdminDataTable, type AdminDataTableColumn } from './shared/AdminDataTable';
import { AdminPagination } from './shared/AdminPagination';
import { AdminToast } from './shared/AdminToast';
import {
  CREDIT_PAGE_SIZE, CREDIT_TYPES, creditLedgerQuery, formatCreditUnits, matchesCreditAdjustment,
  parseCreditPoints, readCreditRecovery, saveCreditRecovery, validCreditAccount,
  type AdminCreditsProps, type CreditAccount, type CreditAdjustment, type CreditAdjustmentBody,
  type CreditLedgerOperation, type CreditPage, type CreditType,
} from './adminCreditsModel';
import './AdminCredits.css';

export type { AdminCreditsProps } from './adminCreditsModel';
const dateText = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const name = (a: { uid: string; displayName: string | null; email: string | null }) => a.displayName || a.email || a.uid;
const CREDIT_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/** Keying the panel clears all sensitive views synchronously when operator/permissions change. */
export function AdminCredits(props: AdminCreditsProps) {
  if (!props.canRead || !props.operatorUid) return <section className="admin-credits"><p role="alert">没有查看积分的权限。</p></section>;
  return <AdminCreditsPanel key={`${props.operatorUid}:${props.canAdjust}`} {...props} />;
}

function AdminCreditsPanel({ request, canAdjust, operatorUid }: AdminCreditsProps & { key?: string }) {
  const [initial] = useState(() => readCreditRecovery(operatorUid));
  const [storageError, setStorageError] = useState(initial.error);
  const [recovery, setRecovery] = useState<CreditAdjustmentBody | null>(initial.body);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [accounts, setAccounts] = useState<CreditPage<CreditAccount> | null>(null);
  const [ledger, setLedger] = useState<CreditPage<CreditLedgerOperation> | null>(null);
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [uid, setUid] = useState(''), [q, setQ] = useState(''), [qDraft, setQDraft] = useState('');
  const [type, setType] = useState<CreditType>('consumption'), [typeDraft, setTypeDraft] = useState<CreditType>('consumption');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [fromDraft, setFromDraft] = useState(''), [toDraft, setToDraft] = useState('');
  const [accountPage, setAccountPage] = useState(0), [ledgerPage, setLedgerPage] = useState(0), [revision, setRevision] = useState(0);
  const [accountLimit, setAccountLimit] = useState(CREDIT_PAGE_SIZE), [ledgerLimit, setLedgerLimit] = useState(CREDIT_PAGE_SIZE);
  const [accountError, setAccountError] = useState(''), [ledgerError, setLedgerError] = useState(''), [detailError, setDetailError] = useState('');
  const [accountLoading, setAccountLoading] = useState(false), [ledgerLoading, setLedgerLoading] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const [amount, setAmount] = useState(''), [direction, setDirection] = useState<'add' | 'subtract'>('add'), [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<{ body: CreditAdjustmentBody; retry: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [writeError, setWriteError] = useState('');
  const [success, setSuccess] = useState<CreditAdjustment | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [miniLedger, setMiniLedger] = useState<CreditPage<CreditLedgerOperation> | null>(null);
  const [miniLedgerLoading, setMiniLedgerLoading] = useState(false), [miniLedgerError, setMiniLedgerError] = useState('');
  const [toast, setToast] = useState('');
  const mounted = useRef(true), writing = useRef(false), reading = useRef(false), detailEpoch = useRef(0), miniEpoch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailEpoch.current++; miniEpoch.current++; }; }, []);

  useEffect(() => {
    let active = true; setAccountLoading(true); setAccountError(''); setAccounts(null);
    const params = new URLSearchParams({ q, limit: String(accountLimit), offset: String(accountPage*accountLimit) });
    void (async () => {
      try {
        const result = await request<CreditPage<CreditAccount>>('/api/admin/credits/accounts?' + params);
        if (!active) return;
        if (!result.ok || !result.data || !Array.isArray(result.data.items) || !result.data.items.every(validCreditAccount)) {
          setAccountError(result.error || `读取用户积分失败（${result.status}）`); return;
        }
        setAccounts(result.data);
      } catch { if (active) setAccountError('用户积分读取失败，请重试。'); }
      finally { if (active) setAccountLoading(false); }
    })(); return () => { active = false; };
  }, [q, accountPage, accountLimit, request, revision]);

  useEffect(() => {
    let active = true; setLedgerLoading(true); setLedgerError(''); setLedger(null);
    void (async () => {
      try {
        const result = await request<CreditPage<CreditLedgerOperation>>('/api/admin/credits/ledger?' + creditLedgerQuery(q,type,from,to,uid,ledgerPage,ledgerLimit));
        if (!active) return;
        if (!result.ok || !result.data || !Array.isArray(result.data.items)) { setLedgerError(result.error || `读取积分记录失败（${result.status}）`); return; }
        setLedger(result.data);
      } catch { if (active) setLedgerError('积分记录读取失败，请重试。'); }
      finally { if (active) setLedgerLoading(false); }
    })(); return () => { active = false; };
  }, [q,type,from,to,uid,ledgerPage,ledgerLimit,request,revision]);

  const readAccount = useCallback(async (selectedUid: string) => {
    const epoch = ++detailEpoch.current;
    setAccount(null); setDetailError(''); setDetailLoading(true);
    try {
      const result = await request<{ account: CreditAccount }>('/api/admin/credits/account?uid=' + encodeURIComponent(selectedUid));
      if (!mounted.current || epoch !== detailEpoch.current) return;
      if (!result.ok || !validCreditAccount(result.data?.account) || result.data.account.uid !== selectedUid) {
        setDetailError(result.error || '无法读取该用户余额，请重试。'); return;
      }
      setAccount(result.data.account);
    } catch { if (mounted.current && epoch === detailEpoch.current) setDetailError('读取余额失败，请重试。'); }
    finally { if (mounted.current && epoch === detailEpoch.current) setDetailLoading(false); }
  }, [request]);
  useEffect(() => {
    if (uid) void readAccount(uid);
    return () => { detailEpoch.current++; };
  }, [uid,readAccount,revision]);

  // 弹窗内「该用户最近流水」：复用 ledger 请求契约，固定 limit=10。
  useEffect(() => {
    if (!dialogOpen || !uid) { setMiniLedger(null); setMiniLedgerError(''); return; }
    let active = true; const epoch = ++miniEpoch.current;
    setMiniLedgerLoading(true); setMiniLedgerError('');
    void (async () => {
      try {
        const result = await request<CreditPage<CreditLedgerOperation>>('/api/admin/credits/ledger?' + creditLedgerQuery('', 'all', '', '', uid, 0, 10));
        if (!active || epoch !== miniEpoch.current) return;
        if (!result.ok || !result.data || !Array.isArray(result.data.items)) { setMiniLedgerError(result.error || '读取该用户流水失败。'); return; }
        setMiniLedger(result.data);
      } catch { if (active && epoch === miniEpoch.current) setMiniLedgerError('读取该用户流水失败，请重试。'); }
      finally { if (active && epoch === miniEpoch.current) setMiniLedgerLoading(false); }
    })();
    return () => { active = false; miniEpoch.current++; };
  }, [dialogOpen, uid, revision, request]);

  const clearRecovery = () => {
    try { saveCreditRecovery(operatorUid,null); setRecovery(null); setRecoveryMessage(''); return true; }
    catch { setStorageError('无法更新待核查记录，调账已停用。'); return false; }
  };
  const completed = (value: CreditAdjustment) => {
    clearRecovery(); setSuccess(value); setAmount(''); setReason(''); setWriteError(''); setRevision(v=>v+1);
    setToast(`积分调整成功：${value.uid} 可用积分 ${formatCreditUnits(value.beforeAvailableUnits)} → ${formatCreditUnits(value.afterAvailableUnits)}`);
  };
  const submit = async () => {
    if (!confirm || !canAdjust || storageError || writing.current || reading.current) return;
    const input = confirm.body;
    try { saveCreditRecovery(operatorUid,input); }
    catch { setStorageError('无法保存待核查记录，本次未发送调整。请检查浏览器存储。'); setConfirm(null); return; }
    writing.current = true; setBusy(true); setRecovery(input); setSuccess(null); setWriteError(''); setRecoveryMessage('');
    try {
      const result = await request<CreditAdjustment>('/api/admin/credits/adjust', { method:'POST', body:JSON.stringify(input) });
      if (!mounted.current) return;
      if (result.ok && matchesCreditAdjustment(result.data,input,operatorUid)) completed(result.data);
      else if (!confirm.retry && [400,401,403,404,409,413].includes(result.status) && !result.ok) {
        clearRecovery(); setWriteError(result.error || '服务端拒绝了本次调整，请重新读取余额并确认。'); setRevision(v=>v+1);
      } else setRecoveryMessage('调整结果未知，请先查询原请求结果。请勿重新发起调整。');
    } catch { if (mounted.current) setRecoveryMessage('连接中断，调整结果未知。请查询原请求结果。'); }
    finally { writing.current=false; if (mounted.current) { setBusy(false); setConfirm(null); } }
  };
  const checkResult = async () => {
    if (!recovery || !canAdjust || writing.current || reading.current) return;
    reading.current=true; setChecking(true); setRecoveryMessage('');
    try {
      const result = await request<{ status:'completed'|'not_found'; adjustment?:CreditAdjustment }>('/api/admin/credits/adjustment?idempotencyKey='+encodeURIComponent(recovery.idempotencyKey));
      if (!mounted.current) return;
      if (result.ok && result.data?.status === 'completed' && matchesCreditAdjustment(result.data.adjustment,recovery,operatorUid)) completed(result.data.adjustment);
      else setRecoveryMessage(result.ok && result.data?.status === 'not_found'
        ? '尚未查到已完成记录，请求可能仍在处理中。保留原幂等键；可再次查询，或确认后原样重试。'
        : '暂时无法确认原请求结果，请稍后再次查询。原请求已保留。');
    } catch { if (mounted.current) setRecoveryMessage('查询失败，请稍后再次查询。原请求已保留。'); }
    finally { reading.current=false; if (mounted.current) setChecking(false); }
  };
  const prepare = (event: React.FormEvent) => {
    event.preventDefault(); setWriteError(''); setSuccess(null);
    const units = parseCreditPoints(amount);
    if (!canAdjust || recovery || storageError || !account || busy) return;
    if (units === null) { setWriteError('请输入大于零的积分，最多一位小数，且不能超出安全整数范围。'); return; }
    const deltaUnits = direction === 'subtract' ? -units : units;
    const after = account.availableUnits+deltaUnits;
    if (!Number.isSafeInteger(after) || after < 0) { setWriteError('调整后可用积分不能为负数或超出安全范围；冻结积分不能扣减。'); return; }
    if (!reason.trim() || reason.trim().length > 500) { setWriteError('请填写 1–500 字的调整原因。'); return; }
    setConfirm({ retry:false, body:{ uid:account.uid, deltaUnits, reason:reason.trim(), expectedAvailableUnits:account.availableUnits,
      expectedHeldUnits:account.heldUnits, expectedVersion:account.version, idempotencyKey:crypto.randomUUID() } });
  };
  const filters = (event: React.FormEvent) => {
    event.preventDefault();
    if ((fromDraft && !Number.isFinite(new Date(fromDraft).getTime())) || (toDraft && !Number.isFinite(new Date(toDraft).getTime()))
      || (fromDraft && toDraft && new Date(fromDraft).getTime() >= new Date(toDraft).getTime())) {
      setLedgerError('开始时间必须早于结束时间。'); return;
    }
    setQ(qDraft.trim()); setType(typeDraft); setFrom(fromDraft); setTo(toDraft); setAccountPage(0); setLedgerPage(0); setRevision(v=>v+1);
  };
  const blocked = !canAdjust || !!recovery || !!storageError || busy;
  const openUser = (a: CreditAccount) => {
    setAccount(null); setUid(a.uid); setLedgerPage(0); setAmount(''); setReason(''); setWriteError(''); setSuccess(null); setToast('');
    setDialogOpen(true);
    if (uid === a.uid) void readAccount(a.uid);
  };
  // 批次 5：共享表格列定义（机械替换，行为不变；.admin-credits-table 响应式布局经
  // wrapperClassName 保留，data-label 单元格属性经 cellAttrs 透传）。
  const accountColumns: Array<AdminDataTableColumn<CreditAccount>> = [
    {
      key: 'uid',
      label: '用户',
      render: a => <div className="admin-user-cell" title={a.uid}><strong>{name(a)}</strong><span className="admin-user-email">{a.email}</span></div>,
    },
    { key: 'availableUnits', label: '可用积分', numeric: true, render: a => formatCreditUnits(a.availableUnits), cellAttrs: () => ({ 'data-label': '可用' }) },
    { key: 'heldUnits', label: '冻结积分', numeric: true, render: a => formatCreditUnits(a.heldUnits), cellAttrs: () => ({ 'data-label': '冻结' }) },
    {
      key: 'actions',
      label: '操作',
      sticky: 'right',
      render: a => <AdminButton data-credit-user={a.uid} onClick={() => openUser(a)}>查看</AdminButton>,
    },
  ];
  const ledgerColumns: Array<AdminDataTableColumn<CreditLedgerOperation>> = [
    {
      key: 'uid',
      label: '用户',
      render: row => <div className="admin-user-cell" title={row.uid}><strong>{name(row)}</strong><span className="admin-user-email">{row.email}</span></div>,
    },
    {
      key: 'purpose',
      label: '用途',
      render: row => <>{row.purpose}<small>{CREDIT_TYPES[row.type as CreditType] || '积分变动'} · {row.operationId}</small></>,
    },
    { key: 'createdAt', label: '时间', render: row => dateText(row.createdAt) },
    {
      key: 'amount',
      label: '数额（积分）',
      numeric: true,
      render: row => <>{row.type === 'consumption' ? '-' + formatCreditUnits(row.consumedUnits) : formatCreditUnits(row.deltaAvailableUnits)}{row.deltaHeldUnits !== 0 && <small>冻结变动 {formatCreditUnits(row.deltaHeldUnits)}</small>}</>,
    },
  ];
  return <section className="admin-credits" aria-label="积分管理">
    <header><h2>积分管理</h2><p>查看用户可用与冻结积分，核查最近消费，并留下完整的调整记录。</p></header>
    <form className="admin-credits-filters" onSubmit={filters} aria-label="积分筛选">
      <label>搜索用户<input value={qDraft} maxLength={128} onChange={e=>setQDraft(e.target.value)} placeholder="用户名、邮箱或用户 ID" /></label>
      <label>开始时间<input type="datetime-local" value={fromDraft} onChange={e=>setFromDraft(e.target.value)} /></label>
      <label>结束时间（不含）<input type="datetime-local" value={toDraft} onChange={e=>setToDraft(e.target.value)} /></label>
      <label>记录类型<select value={typeDraft} onChange={e=>setTypeDraft(e.target.value as CreditType)}>{Object.entries(CREDIT_TYPES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <AdminButton type="submit" variant="primary">查询</AdminButton>
    </form>
    {storageError && <p role="alert">{storageError}</p>}
    {recovery && <section className="admin-credits-recovery" aria-label="待核查积分调整">
      <h3>有一笔调整等待核查</h3><p>用户 {recovery.uid}，{recovery.deltaUnits>0?'调增':'调减'} {formatCreditUnits(Math.abs(recovery.deltaUnits))} 积分。完成核查前已停用新的调整。</p>
      <p className="admin-mono">核查编号：{recovery.idempotencyKey}</p>
      {recoveryMessage && <p role="status">{recoveryMessage}</p>}
      {!canAdjust && <p>当前没有调整权限，请恢复权限后核查原请求。</p>}
      <AdminButton onClick={checkResult} busy={checking} disabled={!canAdjust||busy}>查询原请求结果</AdminButton>
      <AdminButton onClick={()=>setConfirm({body:recovery,retry:true})} disabled={!canAdjust||busy||checking||!!storageError}>原样重试（同一请求）</AdminButton>
    </section>}
    <section className="admin-credits-card" aria-label="用户积分账户"><h3>用户积分账户</h3>
      {accountLoading && <p role="status">正在读取账户…</p>}{accountError && <p role="alert">{accountError} <AdminButton onClick={()=>setRevision(v=>v+1)}>重试</AdminButton></p>}
      {accounts && <><AdminDataTable wrapperClassName="admin-credits-table" columns={accountColumns} rows={accounts.items} rowKey={a => a.uid} ariaLabel="用户积分账户" />
      {accounts.items.length===0 && <p>未找到符合条件的用户。</p>}
      <AdminPagination label="账户分页" total={accounts.total} limit={accountLimit} offset={accountPage*accountLimit}
        busy={accountLoading} onPageChange={nextOffset => setAccountPage(Math.floor(nextOffset/accountLimit))}
        pageSizeOptions={CREDIT_SIZE_OPTIONS} onLimitChange={nextLimit => { setAccountLimit(nextLimit); setAccountPage(0); }} /></>}
    </section>
    <section className="admin-credits-card" aria-label="最近积分记录"><div className="admin-credits-heading"><div><h3>{CREDIT_TYPES[type]}</h3>
      <p>{uid?`当前用户：${uid}`:'全部用户'} · 消费按一次操作汇总，冻结、解冻、过期与管理员调整不计入消费。</p></div>
      {uid && <AdminButton onClick={()=>{setUid('');setAccount(null);setLedgerPage(0);}}>查看全部用户记录</AdminButton>}</div>
      {ledgerLoading && <p role="status">正在读取积分记录…</p>}{ledgerError && <p role="alert">{ledgerError} <AdminButton onClick={()=>setRevision(v=>v+1)}>重试</AdminButton></p>}
      {ledger && <><AdminDataTable wrapperClassName="admin-credits-table" columns={ledgerColumns} rows={ledger.items} rowKey={row => `${row.uid}:${row.operationId}:${row.entryKind}:${row.referenceId}`} ariaLabel="积分记录" />
      {ledger.items.length===0 && <p>暂无符合条件的积分记录。</p>}
      <AdminPagination label="记录分页" total={ledger.total} limit={ledgerLimit} offset={ledgerPage*ledgerLimit}
        busy={ledgerLoading} onPageChange={nextOffset => setLedgerPage(Math.floor(nextOffset/ledgerLimit))}
        pageSizeOptions={CREDIT_SIZE_OPTIONS} onLimitChange={nextLimit => { setLedgerLimit(nextLimit); setLedgerPage(0); }} /></>}
    </section>
    {/* 积分调整弹窗：点「查看」打开，余额/调整/最近流水集中在一个窗口内操作。 */}
    <AdminDialog open={dialogOpen} title="积分调整" description="查看余额并调整积分；提交前需复核。" className="admin-credit-dialog"
      onClose={() => setDialogOpen(false)}>
      {detailLoading && <p role="status">正在读取最新余额…</p>}
      {detailError && <p role="alert">{detailError} <AdminButton onClick={()=>void readAccount(uid)}>重新读取</AdminButton></p>}
      {account && <>
        <p data-credit-selected><strong>{name(account)}</strong> · {account.email} · {account.uid}</p>
        <dl className="admin-credits-balances"><div><dt>可用积分</dt><dd data-credit-balance-available>{formatCreditUnits(account.availableUnits)}</dd></div><div><dt>冻结积分</dt><dd>{formatCreditUnits(account.heldUnits)}</dd></div></dl>
        {success && <p role="status" data-credit-success>调整已完成：用户 {success.uid} 的可用积分 {formatCreditUnits(success.beforeAvailableUnits)} → {formatCreditUnits(success.afterAvailableUnits)}；冻结 {formatCreditUnits(success.heldUnits)} 积分。审计编号 {success.id}</p>}
        {writeError && <p role="alert">{writeError}</p>}
        {!canAdjust ? <p>当前为只读权限，不能调整积分。</p> : <form onSubmit={prepare} aria-label="填写积分调整">
          <fieldset disabled={blocked}><legend>调整内容</legend>
            <label>调整方式<select value={direction} onChange={e=>setDirection(e.target.value as 'add'|'subtract')}><option value="add">调增</option><option value="subtract">调减</option></select></label>
            <label>调整积分<input inputMode="decimal" value={amount} maxLength={32} onChange={e=>setAmount(e.target.value)} placeholder="如 0.1" /></label>
            <p>最小 0.1 积分；只调整可用余额，冻结积分保持不变。</p>
            <label>调整原因<textarea value={reason} maxLength={500} rows={3} onChange={e=>setReason(e.target.value)} /></label>
            <AdminButton type="submit" variant="primary" disabled={blocked}>核对调整</AdminButton>
          </fieldset>
        </form>}
        <section className="admin-credit-mini-ledger" aria-label="该用户最近流水">
          <h3>最近流水（最多 10 条）</h3>
          {miniLedgerLoading && <p role="status">正在读取流水…</p>}
          {miniLedgerError && <p role="alert">{miniLedgerError}</p>}
          {miniLedger && (miniLedger.items.length
            ? <ul className="admin-credit-mini-list">{miniLedger.items.map(row => <li key={`${row.uid}:${row.operationId}:${row.entryKind}:${row.referenceId}`}>
              <span>{row.purpose}</span>
              <strong>{row.type === 'consumption' ? '-' + formatCreditUnits(row.consumedUnits) : formatCreditUnits(row.deltaAvailableUnits)}</strong>
              <small>{dateText(row.createdAt)}</small>
            </li>)}</ul>
            : <p>该用户暂无积分流水。</p>)}
        </section>
      </>}
      {!account && !detailLoading && !detailError && <p>正在读取该用户余额…</p>}
    </AdminDialog>
    <AdminConfirmDialog open={!!confirm} title={confirm?.retry?'确认原样重试积分调整':'确认积分调整'}
      description={confirm?.retry?'复用原请求及幂等键。即使原请求已经完成，也不会重复调整。':'请核对用户、原因和变更前后积分。余额发生变化时服务端会拒绝本次调整。'}
      subject={confirm && `${confirm.body.uid}${account?.uid===confirm.body.uid?' · '+name(account):''}`}
      impact={confirm && `可用积分：${formatCreditUnits(confirm.body.expectedAvailableUnits)} → ${formatCreditUnits(confirm.body.expectedAvailableUnits+confirm.body.deltaUnits)}；冻结积分保持 ${formatCreditUnits(confirm.body.expectedHeldUnits)}`}
      reason={confirm?.body.reason} tone={confirm && confirm.body.deltaUnits<0?'danger':'primary'}
      confirmLabel={confirm?.retry?'确认原样重试':'确认调整'} pending={busy} confirmDisabled={!canAdjust||!!storageError||checking}
      onConfirm={()=>void submit()} onClose={()=>{if(!writing.current)setConfirm(null);}} />
    {toast && <AdminToast message={toast} onDismiss={() => setToast('')} />}
  </section>;
}
