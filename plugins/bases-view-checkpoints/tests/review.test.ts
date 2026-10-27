import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import BasesViewCheckpointsPlugin from '../src/main';
import { bindPro } from '../src/pro';
import { restoreCheckpoint, saveCheckpoint } from '../src/basefile';
import manifest from '../manifest.json';

afterEach(() => { bindPro(null); vi.restoreAllMocks(); });

function saved(text: string, view: string) {
	const result = saveCheckpoint(text, 'x.base', view);
	if (!result.ok) throw new Error(result.reason);
	return result.checkpoint;
}

describe('review defects', () => {
	it('refuses a restore that would break a YAML alias of another view, without a throw', () => {
		const text = 'filters: &f\n  and:\n    - status == "open"\nviews:\n  - name: A\n    type: table\n  - name: B\n    type: table\n    filters: *f\n';
		const cp = saved(text, 'A');
		let result: ReturnType<typeof restoreCheckpoint> | undefined;
		expect(() => { result = restoreCheckpoint(text, cp); }).not.toThrow();
		expect(result?.ok).toBe(false);
	});
	it('refuses a restore when the anchor sits in the restored view', () => {
		const text = 'views:\n  - name: A\n    type: table\n    order: &o [a, b]\n  - name: B\n    type: table\n    order: *o\n';
		const cp = saved(text, 'A');
		expect(() => restoreCheckpoint(text, cp)).not.toThrow();
		expect(restoreCheckpoint(text, cp).ok).toBe(false);
	});
	it('keeps the text of the other views when it restores one view', () => {
		const long = 'file.hasTag("project") && note.status != "done" && note.priority > 2 && file.mtime > now() - "7 days"';
		const text = `views:\n  - name: A\n    type: table\n  - name: B\n    type: table\n    order: [file.name, note.status]\n    filters:\n      and:\n        - '${long}'\n`;
		const result = restoreCheckpoint(text, saved(text, 'A'));
		expect(result.ok && result.text).toBe(text);
	});
	it('keeps the CRLF line ends of the file', () => {
		const text = 'views:\r\n  - name: A\r\n    type: table\r\n  - name: B\r\n    type: table\r\n';
		const result = restoreCheckpoint(text, saved(text, 'A'));
		expect(result.ok && result.text).toBe(text);
	});
	it('refuses to save a value that the JSON plugin data cannot hold', () => {
		const result = saveCheckpoint('views:\n  - name: A\n    type: table\n    limit: .inf\n', 'x.base', 'A');
		expect(result.ok).toBe(false);
	});
	it('drops a named checkpoint without a label, so it cannot pass as a free checkpoint', async () => {
		const app = App.createConfigured__({ files: { 'x.base': 'views:\n  - name: A\n' } });
		const plugin = new BasesViewCheckpointsPlugin(app as never, manifest as never);
		vi.spyOn(plugin, 'loadData').mockResolvedValue({ named: { '["x.base","A"]': { path: 'x.base', viewName: 'A', view: { name: 'A' }, shared: {} } } });
		await plugin.loadSettings();
		expect(plugin.data.named).toEqual({});
	});
	it('checks the GitHub Sponsors state when the layout is ready, like the reference product', async () => {
		const app = App.createConfigured__({ files: {} });
		const plugin = new BasesViewCheckpointsPlugin(app as never, manifest as never);
		let ready: (() => void) | null = null;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((cb: () => void) => { ready = cb; });
		await plugin.onload();
		const refresh = vi.spyOn(plugin.pro!, 'refresh').mockResolvedValue();
		expect(ready).not.toBeNull();
		ready!();
		expect(refresh).toHaveBeenCalledTimes(1);
		plugin.onunload();
	});
});
