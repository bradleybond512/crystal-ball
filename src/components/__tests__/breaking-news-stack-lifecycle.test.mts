import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Window } from 'happy-dom';

const source = ts.transpileModule(readFileSync(new URL('../BreakingNewsBanner.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture(t: TestContext, mounted = true) {
  const window = new Window({url:'https://fixture.test/'});
  const document = window.document;
  const sizes: any[] = [], mutations: any[] = [], frames = new Map<number, () => void>();
  let frame = 0, reads = 0;
  class SizeObserver {
    targets = new Set<Element>(); observeCalls = 0; disconnectCalls = 0;
    constructor(public callback: () => void) { sizes.push(this); }
    observe(element: Element, options: ResizeObserverOptions) { this.targets.add(element);this.observeCalls++;assert.equal(options?.box,'border-box'); }
    disconnect() { this.targets.clear();this.disconnectCalls++; }
  }
  class BodyObserver {
    options?: MutationObserverInit; disconnected=false;
    constructor(public callback: (records: any[]) => void) { mutations.push(this); }
    observe(target: Element, options: MutationObserverInit) { assert.equal(target,document.body);this.options=options; }
    disconnect() { this.disconnected=true; }
  }
  const shelf = () => {const e=document.createElement('div');e.id='cb-notification-stack';e.getBoundingClientRect=()=>{reads++;return {bottom:80} as DOMRect;};return e;};
  const first=shelf();if(mounted)document.body.append(first);
  const exports: any = {};
  vm.runInNewContext(source,{exports,require:(id:string)=>({
    '@/services/breaking-news-alerts':{getAlertSettings:()=>({soundEnabled:false})},
    '@/services/i18n':{t:(s:string)=>s},'@/services/sound-manager':{playAlertPing:()=>{}},
  })[id],document,window,MutationObserver:BodyObserver,ResizeObserver:SizeObserver,
  requestAnimationFrame:(fn:()=>void)=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:(id:number)=>frames.delete(id),setTimeout,clearTimeout});
  const banner=new exports.BreakingNewsBanner();
  const child=(added: Element[]=[],removed: Element[]=[])=>mutations[0].callback([{type:'childList',addedNodes:added,removedNodes:removed}]);
  const classes=()=>mutations[0].callback([{type:'attributes',attributeName:'class'}]);
  t.after(()=>{banner.destroy();return window.happyDOM.abort();});
  return {document,window,banner,sizes,mutations,frames,first,shelf,child,classes,reads:()=>reads};
}

test('observes one existing shelf border box without rebinding identical target',t=>{
  const f=fixture(t);assert.equal(f.sizes.length,1);const ro=f.sizes[0];assert.deepEqual([...ro.targets],[f.first]);
  f.classes();f.classes();assert.equal(ro.observeCalls,1);assert.equal(ro.disconnectCalls,0);
});
test('late direct-body shelf mount attaches while unrelated children do no geometry work',t=>{
  const f=fixture(t,false);const mo=f.mutations[0];assert.equal(mo.options.childList,true);assert.notEqual(mo.options.subtree,true);
  const other=f.document.createElement('div');f.document.body.append(other);const reads=f.reads();f.child([other]);assert.equal(f.reads(),reads);
  f.document.body.append(f.first);f.child([f.first]);assert.equal(f.sizes.length,1);assert.ok(f.sizes[0].targets.has(f.first));
  const after=f.reads();other.remove();f.child([],[other]);assert.equal(f.reads(),after);
});
test('replacement removal and same-batch reattachment reconcile only current shelf identity',t=>{
  const f=fixture(t);const ro=f.sizes[0];assert.ok(ro);const next=f.shelf();f.first.replaceWith(next);f.child([next],[f.first]);
  assert.equal(f.sizes.length,1);assert.deepEqual([...ro.targets],[next]);assert.equal(ro.disconnectCalls,1);
  const calls=ro.observeCalls;next.remove();f.document.body.append(next);f.child([next],[next]);assert.equal(ro.observeCalls,calls);
  next.remove();f.child([],[next]);assert.equal(ro.targets.size,0);assert.equal(f.document.querySelector<HTMLElement>('.breaking-news-container')?.style.top,'44px');
  f.document.body.append(next);f.child([next]);assert.deepEqual([...ro.targets],[next]);
});
test('destroy disconnects targets and queued callbacks cannot rebind or recreate offset',t=>{
  const f=fixture(t);const ro=f.sizes[0];assert.ok(ro);const mo=f.mutations[0];
  f.window.dispatchEvent(new f.window.Event('resize'));const callbacks=[...f.frames.values()];assert.equal(callbacks.length,1);
  f.banner.destroy();assert.equal(ro.targets.size,0);assert.equal(mo.disconnected,true);assert.equal(f.frames.size,0);
  const reads=f.reads();ro.callback();f.classes();for(const cb of callbacks)cb();
  assert.equal(f.reads(),reads);assert.equal(ro.targets.size,0);
  assert.equal(f.document.documentElement.style.getPropertyValue('--breaking-alert-offset'),'');
  assert.equal(f.document.querySelector('.breaking-news-container'),null);
});
