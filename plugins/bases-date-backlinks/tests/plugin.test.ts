import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRO_ONE_TIME_URL, PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DateBacklinksView, KEY, viewOptions } from '../src/view';

afterEach(() => {
	resetPro();
	vi.useRealTimers();
});

function fakeManager(start: boolean) {
	let enabled = start;
	const listeners = new Set<() => void>();
	return {
		isPro: () => enabled,
		onChange: (callback: () => void) => {
			listeners.add(callback);
			return () => listeners.delete(callback);
		},
		set(value: boolean) {
			enabled = value;
			for (const callback of listeners) callback();
		},
	};
}

describe('Bases view options', () => {
	it('offers one date property and a formula for the daily note date', () => {
		const options = viewOptions();
		expect(options[0]).toMatchObject({ type: 'property', key: KEY.property, default: 'note.date' });
		expect(options[1]).toMatchObject({ type: 'formula', key: KEY.dateExpression, default: 'file.name' });
		expect(options[2]).toMatchObject({ type: 'text', key: KEY.dateFormat, default: 'YYYY-MM-DD' });
	});

	it('keeps rollups, extra properties and date ranges in the Pro group', () => {
		const options = viewOptions();
		const group = options[3];
		if (!('items' in group)) throw new Error('Pro options must be grouped');
		expect(group.items.map((item) => item.key)).toEqual([KEY.period, KEY.weekStart, KEY.additionalProperties, KEY.rangeStart, KEY.rangeEnd]);
		expect(group.shouldHide?.()).toBe(true);
	});
});

describe('Pro facade', () => {
	it('is off before a GitHub Sponsors manager is bound', () => {
		expect(isPro()).toBe(false);
	});

	it('follows the Sponsors manager and notifies view listeners', () => {
		const manager = fakeManager(false);
		bindPro(manager as never);
		const listener = vi.fn();
		const off = onProChange(listener);
		manager.set(true);
		expect(isPro()).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);
		off();
		manager.set(false);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(isPro()).toBe(false);
	});

	it('clears the manager and listeners when the plugin unloads', () => {
		const manager = fakeManager(true);
		bindPro(manager as never);
		const listener = vi.fn();
		onProChange(listener);
		resetPro();
		manager.set(false);
		expect(isPro()).toBe(false);
		expect(listener).not.toHaveBeenCalled();
	});

	it('uses the shared Sponsors terms and the one-time storefront link', () => {
		expect(SPONSORS).toMatchObject({
			clientId: 'Ov23lic5UPGPZqhBlBGg',
			sponsorLogin: 'theluckystrike',
			minMonthlyUsd: 5,
			oneTimeUsd: 15,
			scope: 'read:user',
		});
		expect(PRO_UI.proSummary).toBe('Pro adds week and month rollups, extra date properties, and inclusive date ranges.');
		expect(PRO_ONE_TIME_URL).toBe('https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=bases-date-backlinks');
	});
});


describe('Bases view lifecycle', () => {
	it('waits for config before rendering and updates when Bases supplies data', () => {
		vi.useFakeTimers();
		const container = document.createElement('div');
		const view = Object.create(DateBacklinksView.prototype) as DateBacklinksView;
		Object.assign(view, { container, plugin: { syncPropertyFilter: vi.fn() } });
		expect(() => { view.onDataUpdated(); vi.runAllTimers(); }).not.toThrow();
		expect(container.textContent).toBe('');
		Object.assign(view, {
			config: {
				get: () => undefined,
				getAsPropertyId: (key: string) => key === KEY.property ? 'note.date' : null,
				getEvaluatedFormula: () => ({ toString: () => '2026-10-21' }),
				getDisplayName: () => 'date',
			},
			data: { data: [{ file: { path: 'Meeting.md', basename: 'Meeting' }, getValue: () => ({ toString: () => '2026-10-21' }) }] },
		});
		view.onDataUpdated();
		vi.runAllTimers();
		expect(container.querySelector('a')?.textContent).toBe('Meeting');
		view.data = { data: [] } as never;
		view.onDataUpdated();
		vi.runAllTimers();
		expect(container.textContent).toContain('No notes match this date.');
	});
});
