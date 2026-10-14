import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentDrawer, frozenValue, parseJsonDraft } from './AdminContentFlow';

describe('existing JSON values and frozen content submission', () => {
  it('reports invalid JSON inline-compatible error without fabricated value', () => { const result=parseJsonDraft('{invalid');expect(result.error).toContain('JSON');expect(result.value).toBeUndefined(); });
  it('retains explicit JSON null rather than replacing it with an object', () => { expect(parseJsonDraft('null')).toEqual({value:null,error:''}); });
  it('retains permitted arrays and primitive JSON values', () => { expect(parseJsonDraft('[1,2]').value).toEqual([1,2]);expect(parseJsonDraft('false').value).toBe(false); });
  it('detaches nested resource metadata from mutable editor state', () => { const body={id:'asset1',metadata:{owner:'old'}};const frozen=frozenValue(body);body.metadata.owner='new';expect(frozen.metadata.owner).toBe('old'); });
  it('freezes before/after independently for exact confirmation', () => { const before={enabled:false,config:{n:1}},after={enabled:true,config:{n:2}};const a=frozenValue(before),b=frozenValue(after);before.config.n=9;after.config.n=10;expect(a.config.n).toBe(1);expect(b.config.n).toBe(2); });
  it('keeps DELETE body absent', () => { expect(frozenValue(undefined)).toBeUndefined(); });
  it('does not invent evidence or fields while freezing moderation', () => { const body={entityType:'post',entityId:'summary1',action:'hide',metadata:{}};expect(frozenValue(body)).toEqual(body);expect(frozenValue(body)).not.toHaveProperty('image'); });
  it('uses shared semantic drawer rather than a CSS-only panel', () => { const html=renderToStaticMarkup(React.createElement(ContentDrawer,{title:'元数据',description:'不上传对象',onClose:()=>{},children:'字段'}));expect(html).toContain('role="dialog"');expect(html).toContain('aria-modal="true"');expect(html).toContain('不上传对象'); });
});
