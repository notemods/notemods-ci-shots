import { afterEach, expect, it } from 'vitest';
import type { SponsorsManager } from '../src/license/index';
import { bindPro, isPro, onProChange, resetPro } from '../src/pro';
afterEach(() => resetPro());
it('is free before sign-in', () => expect(isPro()).toBe(false));
it('uses the cached sponsorship state and redraws after changes', () => {
 let active = false; let changed = () => {}; let redraws = 0;
 const manager = { isPro: () => active, onChange: (fn: () => void) => { changed = fn; return () => {}; } } as unknown as SponsorsManager;
 bindPro(manager); const unsubscribe = onProChange(() => redraws++);
 expect(isPro()).toBe(false); active = true; changed(); expect(isPro()).toBe(true); expect(redraws).toBe(1);
 unsubscribe(); changed(); expect(redraws).toBe(1); resetPro(); expect(isPro()).toBe(false);
});
