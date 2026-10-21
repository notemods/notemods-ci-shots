import { describe, expect, it } from 'vitest';
import { bindPro, isPro, onProChange, resetPro } from '../src/pro';
import type { SponsorsManager } from '../src/license/index';
describe('Pro state facade', () => {
 it('defaults to free and resets on unload', () => { resetPro(); expect(isPro()).toBe(false); });
 it('reads the shared manager and notifies views without a network request', () => {
  let changed: (()=>void) | undefined; let calls = 0;
  bindPro({ isPro: ()=>true, onChange: (fn: ()=>void)=>{changed=fn; return ()=>{};} } as SponsorsManager);
  const off = onProChange(()=>calls++);
  expect(isPro()).toBe(true); changed?.(); expect(calls).toBe(1);
  off(); changed?.(); expect(calls).toBe(1); resetPro(); expect(isPro()).toBe(false);
 });
});
