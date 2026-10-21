import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import TableRowLinksPlugin from '../src/main';
import { TableRowLinksSettingTab } from '../src/settings';
import manifest from '../manifest.json';

const listeners: (() => void)[] = [];
const refresh = vi.fn(async () => undefined);
vi.mock('../src/license/github-obsidian', async (orig) => ({
	...(await orig<object>()),
	createGitHubSponsors: () => ({ init: () => undefined, isPro: () => false, refresh, onChange: (cb: () => void) => { listeners.push(cb); return () => undefined; } }),
}));

describe('Pro wiring', () => {
	it('redraws the settings tab when the Pro state changes and refreshes on a timer, like the reference plugin', async () => {
		const app = App.createConfigured__({ files: {} });
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((cb: () => unknown) => { cb(); });
		const interval = vi.spyOn(window, 'setInterval');
		const update = vi.spyOn(TableRowLinksSettingTab.prototype, 'update').mockImplementation(() => undefined);
		const p = new TableRowLinksPlugin(app as never, manifest as never);
		await p.onload();
		expect(refresh).toHaveBeenCalled();
		expect(interval.mock.calls.some((c) => c[1] === 6 * 60 * 60 * 1000)).toBe(true);
		for (const cb of listeners) cb();
		expect(update).toHaveBeenCalled();
	});
});
