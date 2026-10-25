import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminBrandsColors } from './AdminBrandsColors';
import type { AdminRequest } from './adminRequest';
import type { ManagedBrandCatalog, BrandMutationReceipt } from './AdminBrandsColors.model';

export async function runAdminBrandsColorsChecks() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const checks: string[] = [], browserErrors: string[] = [], writes: { path: string; method: string; body: any }[] = [];
  window.addEventListener('error', event => browserErrors.push(event.message));
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  let catalog: ManagedBrandCatalog = { items: [
    { code: 'MARD', name: 'Mard-221', builtin: true, enabled: true, protected: true, version: 1, colorCount: 1,
      colors: [{ id: 'MARD_A1', code: 'A1', name: '奶黄', hex: '#FAF4C8', screenReferenceOnly: false }] },
    { code: 'STUDIO', name: '工作室', builtin: false, enabled: true, protected: false, version: 1, colorCount: 2,
      colors: [{ id: 'studio_green', code: 'G1', name: '松绿', hex: '#A3B18A', screenReferenceOnly: false },
        { id: 'studio_pink', code: 'P1', name: '樱花粉', hex: '#FFB7C5', screenReferenceOnly: false }] },
  ] };
  let failRead = false, unknownNext = false, conflictNext = false;
  const receipts = new Map<string, BrandMutationReceipt>();
  // Successful admin writes also refresh the public consumer, without any live request.
  globalThis.fetch = async () => Response.json({ success: true, data: structuredClone(catalog) });
  const request: AdminRequest = async <T,>(path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (path.includes('/mutations?')) {
        const receipt = receipts.get(new URL(path, 'https://fixture.invalid').searchParams.get('id')!);
        return { ok: Boolean(receipt), status: receipt ? 200 : 404, data: receipt as T };
      }
      return failRead ? { ok: false, status: 503, error: 'fixture directory unavailable' }
        : { ok: true, status: 200, data: structuredClone(catalog) as T };
    }
    const body = JSON.parse(String(init?.body)); writes.push({ path, method, body });
    if (conflictNext) { conflictNext = false; return { ok: false, status: 409, error: '版本冲突，请刷新核对' }; }
    const brand = catalog.items.find(item => item.code === body.brandCode);
    let action: BrandMutationReceipt['action']; let colorId: string | null = null;
    if (path.endsWith('/colors')) {
      action = method === 'POST' ? 'createColor' : method === 'PATCH' ? 'updateColor' : 'deleteColor';
      if (method === 'POST') {
        colorId = `color_${writes.length}`;
        brand!.colors.push({ id: colorId, code: body.code, name: body.name, hex: body.hex, screenReferenceOnly: body.screenReferenceOnly });
      } else if (method === 'PATCH') {
        colorId = body.colorId;
        Object.assign(brand!.colors.find(color => color.id === colorId)!, { code: body.code, name: body.name, hex: body.hex, screenReferenceOnly: body.screenReferenceOnly });
      } else { colorId = body.colorId; brand!.colors = brand!.colors.filter(color => color.id !== colorId); }
      brand!.version++; brand!.colorCount = brand!.colors.length;
    } else {
      action = method === 'POST' ? 'createBrand' : method === 'PATCH' ? 'updateBrand' : 'deleteBrand';
      if (method === 'POST') catalog.items.push({ code: body.brandCode, name: body.name, builtin: false,
        enabled: body.enabled, protected: false, version: 1, colorCount: 0, colors: [] });
      else if (method === 'PATCH') Object.assign(brand!, { name: body.name, enabled: body.enabled, version: brand!.version + 1 });
      else catalog.items = catalog.items.filter(item => item.code !== body.brandCode);
    }
    const receipt = { operationId: body.operationId, brandCode: body.brandCode, action, colorId,
      version: catalog.items.find(item => item.code === body.brandCode)?.version ?? body.expectedVersion + 1 };
    receipts.set(receipt.operationId, receipt);
    if (unknownNext) { unknownNext = false; return { ok: false, status: 0, error: 'lost response' }; }
    return { ok: true, status: 200, data: receipt as T };
  };
  const root = createRoot(document.getElementById('root')!);
  const flush = async (action?: () => void) => {
    await act(async () => { action?.(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const button = (text: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent?.trim() === text)!;
  const ariaButton = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const input = async (element: HTMLInputElement, value: string) => flush(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const formInput = (index: number) => document.querySelectorAll<HTMLInputElement>('.admin-brand-form input:not([type=checkbox]):not([type=color])')[index];
  const save = async () => flush(() => document.querySelector<HTMLFormElement>('.admin-brand-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const click = async (element: HTMLElement) => flush(() => element.click());
  const text = () => document.body.textContent ?? '';
  await flush(() => root.render(<div className="admin-root" style={{ padding: 16 }}><AdminBrandsColors request={request} /></div>));
  assert(text().includes('Mard-221') && text().includes('工作室'), 'real brand list and counts loaded');
  assert(button('删除品牌').disabled, 'default MARD delete is disabled');
  assert(ariaButton('删除颜色 A1').disabled, 'last MARD color cannot be deleted');
  await click(button('工作室STUDIO2色'));
  assert(document.querySelectorAll('.admin-brand-color').length === 2, 'selecting a brand shows only its child colors');
  assert(button('删除品牌').disabled && button('删除品牌').title.includes('先删除'), 'nonempty brand deletion explains protection');
  await input(document.querySelector<HTMLInputElement>('input[placeholder="搜索色号、名称或 HEX"]')!, '#a3b18a');
  assert(document.querySelectorAll('.admin-brand-color').length === 1, 'HEX search filters actual selected-brand colors');
  await input(document.querySelector<HTMLInputElement>('input[placeholder="搜索色号、名称或 HEX"]')!, '');
  await click(ariaButton('新增品牌'));
  await input(formInput(0), 'newbrand'); await input(formInput(1), '新品牌'); await save();
  assert(writes.at(-1)?.body.brandCode === 'NEWBRAND', 'new brand code is canonical uppercase');
  assert(text().includes('这个品牌还没有颜色'), 'new brand opens its actual empty child list');
  assert(!button('删除品牌').disabled, 'empty non-default brand can be deleted');
  await click(button('新增颜色')); await input(formInput(0), 'a1'); await input(formInput(1), '新松绿');
  await input(document.querySelector<HTMLInputElement>('input[aria-label="HEX"]')!, '#abcdef'); await save();
  assert(text().includes('#ABCDEF') && text().includes('新松绿'), 'created child color is re-read and displayed');
  assert(writes.at(-1)?.body.expectedVersion === 1, 'child create carries parent version');
  await click(ariaButton('编辑颜色 A1')); await input(formInput(1), '编辑后的颜色'); await save();
  assert(text().includes('编辑后的颜色'), 'child update flows back into color grid');
  await click(ariaButton('删除颜色 A1'));
  assert(document.querySelector('[role=dialog]')?.textContent?.includes('历史图纸'), 'delete confirmation explicitly preserves historical palettes');
  await click(button('确认删除', document.querySelector('[role=dialog]')!));
  assert(text().includes('这个品牌还没有颜色'), 'child delete refreshes actual count');
  await click(button('删除品牌')); await click(button('确认删除', document.querySelector('[role=dialog]')!));
  assert(!catalog.items.some(item => item.code === 'NEWBRAND'), 'brand deletion completes after emptying colors');
  await click(button('工作室STUDIO2色'));
  await click(button('新增颜色')); await input(formInput(0), 'U1'); await input(formInput(1), '未知结果颜色');
  unknownNext = true; const beforeUnknown = writes.length; await save();
  assert(text().includes('待核对操作'), 'lost write response shows unknown state with stable operation ID');
  assert(button('保存颜色').disabled, 'unknown result blocks new saves');
  assert(button('新增颜色').disabled, 'unknown result blocks unrelated writes');
  await click(button('核对结果 / 重试同一操作'));
  assert(writes.length === beforeUnknown + 1, 'receipt reconciliation never creates a second operation');
  assert(text().includes('未知结果颜色') && !document.querySelector('[role=dialog]'), 'committed unknown result is recovered and modal closes');
  await click(button('编辑品牌')); await input(formInput(1), '不应覆盖'); conflictNext = true; await save();
  assert(text().includes('版本冲突'), 'concurrent conflict is visible and stale editor closes');
  assert(catalog.items.find(item => item.code === 'STUDIO')?.name === '工作室', 'conflict did not silently overwrite the brand');
  failRead = true; await click(button('刷新目录'));
  assert(document.querySelector('[role=alert]') && button('新增颜色').disabled, 'failed read is explicit and blocks stale writes');
  failRead = false; await click(button('刷新目录'));
  const beforeReadonly = writes.length;
  await flush(() => root.render(<div className="admin-root" style={{ padding: 16 }}><AdminBrandsColors request={request} readOnly operatorUid="read-only-fixture" /></div>));
  assert(ariaButton('新增品牌').disabled && button('编辑品牌').disabled && button('新增颜色').disabled, 'read-only account has no write actions');
  assert(text().includes('read-only-fixture') && text().includes('colors.read') && text().includes('colors.write'), 'read-only account shows the effective brand permissions');
  assert(writes.length === beforeReadonly, 'read-only rendering sends no writes');
  assert(document.documentElement.scrollWidth <= innerWidth + 1, 'responsive page has no horizontal overflow');
  assert(browserErrors.length === 0, 'browser recorded no runtime errors');
  return { viewportWidth: innerWidth, checks, browserErrors, writeCount: writes.length };
}
