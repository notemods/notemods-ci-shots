import { afterEach, expect, it } from 'vitest';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
afterEach(resetPro);
it('starts free and follows the Sponsors manager', () => {
 expect(isPro()).toBe(false);
 let enabled = false; const listeners = new Set<() => void>();
 bindPro({ isPro: () => enabled, onChange: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } } as never);
 let calls = 0; const off = onProChange(() => calls++);
 enabled = true; for (const fn of listeners) fn();
 expect(isPro()).toBe(true); expect(calls).toBe(1);
 off(); resetPro(); expect(listeners.size).toBe(0); expect(isPro()).toBe(false);
});
it('uses the reference payment terms', () => expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }));
