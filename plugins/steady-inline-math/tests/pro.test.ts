import { afterEach, describe, expect, it, vi } from 'vitest';
import { folderEnabled, equations } from '../src/math';
import { bindPro, isPro, onProChange, resetPro, SPONSORS, PRO_UI } from '../src/pro';
import SteadyInlineMathPlugin from '../src/main';
import { SteadyInlineMathSettingTab } from '../src/settings';
afterEach(resetPro);
describe('Sponsors gates', () => {
	it('uses the reference price and public client', () => { expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' }); expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.'); });
	it('starts off and unbinds listeners', () => {
		expect(isPro()).toBe(false); const callbacks = new Set<() => void>(); let on = true;
		bindPro({ isPro: () => on, onChange: (cb: () => void) => { callbacks.add(cb); return () => callbacks.delete(cb); } } as never);
		const fn = vi.fn(); const off = onProChange(fn); expect(isPro()).toBe(true); on = false; for (const cb of callbacks) cb(); expect(fn).toHaveBeenCalledTimes(1); expect(isPro()).toBe(false); off(); resetPro(); expect(callbacks.size).toBe(0);
	});
	it('free mode ignores saved folder rules', () => expect(folderEnabled('Archive/a.md', '-Archive', false)).toBe(true));
	it('uses exact folder boundaries and the most specific rule', () => {
		const rules = '-Archive\n+Archive/Study';
		expect(folderEnabled('Archive/a.md', rules, true)).toBe(false);
		expect(folderEnabled('Archive/Study/a.md', rules, true)).toBe(true);
		expect(folderEnabled('Archive-old/a.md', rules, true)).toBe(true);
		expect(folderEnabled('archive/a.md', rules, true)).toBe(true);
	});
	it('blocks the panel without Pro', async () => {
		const plugin = Object.create(SteadyInlineMathPlugin.prototype) as SteadyInlineMathPlugin;
		await expect(plugin.showEquations()).resolves.toBe(false);
	});
	it('does not save folder rules without Pro', async () => {
		const owner = { settings: { enabled: true, folderRules: '' } };
		const tab = new SteadyInlineMathSettingTab({} as never, owner as never);
		await tab.setControlValue('folderRules', '-Archive'); expect(owner.settings.folderRules).toBe('');
	});
});
describe('panel parser', () => {
	it('finds two equations with source line numbers', () => expect(equations('Text $x$.\n\nText $y+z$.')).toEqual([{ from: 5, to: 8, line: 1, text: 'x' }, { from: 16, to: 21, line: 3, text: 'y+z' }]));
});
