import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, WorkspaceLeaf } from 'obsidian-test-mocks/obsidian';
import FountainReferencePanelPlugin, { VIEWER_NEEDED, fileStamp } from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { incoming } from '../src/scan';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { ReferenceView } from '../src/view';
import manifest from '../manifest.json';

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

/** A stand-in for the SponsorsManager: only isPro and onChange, which the facade uses. */
function fakeManager(start: boolean) {
	let pro = start;
	const fns = new Set<() => void>();
	return {
		isPro: () => pro,
		onChange: (fn: () => void) => {
			fns.add(fn);
			return () => fns.delete(fn);
		},
		set(v: boolean) {
			pro = v;
			for (const fn of fns) fn();
		},
		listeners: () => fns.size,
	};
}

const FILES = {
	'People/Ada.md': '# Ada',
	'Film A/Ada.md': '# Ada A',
	'Film B/Ada.md': '# Ada B',
	'Script.fountain': 'INT. LAB - NIGHT\n\nAda sees [[>People/Ada|Doctor]].\n/* [[>People/Ada]] */',
	'Film A/Script.fountain': 'INT. HOUSE - DAY\n\n[[>Ada]] enters. [[>Missing]]',
	'notes/plain.md': '[[>People/Ada]] in Markdown is not a Fountain script.',
};

function setup(files: Record<string, string> = FILES) {
	const app = App.createConfigured__({ files });
	// The mock resolver ignores the source path. Obsidian prefers a match in the folder of the source, so this does too.
	vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation((linkpath: string, sourcePath: string) => {
		const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) : '';
		return app.vault.getFileByPath(`${dir}${linkpath}.md`) ?? app.vault.getFileByPath(`${linkpath}.md`);
	});
	const plugin = new FountainReferencePanelPlugin(app as never, manifest as never);
	return { app, plugin };
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const { plugin } = setup();
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ folders: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
});

describe('scan of the vault', () => {
	it('reads only .fountain files and resolves each target from the script path', async () => {
		const { app, plugin } = setup();
		const scan = await plugin.refresh();
		expect(scan.scripts).toBe(2);
		expect(vi.mocked(app.metadataCache.getFirstLinkpathDest).mock.calls.map((c) => [c[0], c[1]])).toEqual([
			['Ada', 'Film A/Script.fountain'],
			['Missing', 'Film A/Script.fountain'],
			['People/Ada', 'Script.fountain'],
		]);
		expect(scan.unresolved).toBe(1);
		expect(incoming(scan, 'People/Ada.md').map((r) => [r.source, r.display, r.scene])).toEqual([['Script.fountain', 'Doctor', 'INT. LAB - NIGHT']]);
	});

	it('Refresh rebuilds from saved files after a rename and a delete', async () => {
		const { app, plugin } = setup();
		await plugin.refresh();
		expect(incoming(plugin.scan!, 'People/Ada.md').map((r) => r.source)).toEqual(['Script.fountain']);
		await app.vault.rename(app.vault.getFileByPath('Script.fountain')!, 'Drafts/Pilot.fountain');
		await plugin.refresh();
		expect(incoming(plugin.scan!, 'People/Ada.md').map((r) => r.source)).toEqual(['Drafts/Pilot.fountain']);
		await app.vault.delete(app.vault.getFileByPath('Drafts/Pilot.fountain')!);
		await plugin.refresh();
		expect(incoming(plugin.scan!, 'People/Ada.md')).toEqual([]);
	});

	it('records a read failure and keeps the other scripts', async () => {
		const { app, plugin } = setup();
		const read = app.vault.cachedRead.bind(app.vault);
		vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (f) => {
			if (f.path === 'Script.fountain') throw new Error('File is locked');
			return read(f);
		});
		const scan = await plugin.refresh();
		expect(scan.failures).toEqual([{ path: 'Script.fountain', error: 'File is locked' }]);
		expect(scan.scripts).toBe(2);
	});

	it('ignores the project folders without Pro and uses them with Pro', async () => {
		const { plugin } = setup();
		plugin.settings.folders = 'Film A';
		expect((await plugin.refresh()).scripts).toBe(2);
		bindPro(fakeManager(true) as never);
		expect((await plugin.refresh()).scripts).toBe(1);
	});
});

describe('open the script', () => {
	it('explains that a viewer is needed when no view opens .fountain files', async () => {
		const { plugin } = setup();
		const scan = await plugin.refresh();
		const notice = vi.spyOn(Notice.prototype as never as { constructor__: (m: string) => void }, 'constructor__');
		const ok = await plugin.openSource(incoming(scan, 'People/Ada.md')[0]!);
		expect(ok).toBe(false);
		expect(notice).toHaveBeenCalledWith(VIEWER_NEEDED, undefined);
	});

	it('tells the user to refresh when the script is gone', async () => {
		const { app, plugin } = setup();
		const scan = await plugin.refresh();
		await app.vault.delete(app.vault.getFileByPath('Script.fountain')!);
		const notice = vi.spyOn(Notice.prototype as never as { constructor__: (m: string) => void }, 'constructor__');
		expect(await plugin.openSource(incoming(scan, 'People/Ada.md')[0]!)).toBe(false);
		expect(notice).toHaveBeenCalledWith('Script.fountain is no longer in the vault. Select Refresh to scan again.', undefined);
	});
});

describe('report (Pro)', () => {
	it('does nothing without Pro', async () => {
		const { plugin } = setup();
		expect(await plugin.exportReport(['People/Ada.md'])).toBeNull();
	});

	it('writes a new Markdown note with Pro', async () => {
		const { app, plugin } = setup();
		bindPro(fakeManager(true) as never);
		await plugin.refresh();
		expect(plugin.referencedNotes()).toEqual([
			{ path: 'Film A/Ada.md', count: 1 },
			{ path: 'People/Ada.md', count: 1 },
		]);
		const file = await plugin.exportReport(['People/Ada.md']);
		expect(file).not.toBeNull();
		const text = await app.vault.read(file!);
		expect(text).toContain('## People/Ada.md');
		expect(text).toContain('| Script.fountain | 3 | INT. LAB - NIGHT | Ada sees Doctor. |');
	});
});

describe('report file name', () => {
	it('stamps local date and time', () => {
		expect(fileStamp(new Date(2026, 9, 5, 7, 3))).toBe('2026-10-05 0703');
	});
});

describe('pro facade', () => {
	it('follows the GitHub Sponsors manager and tells listeners on each change', () => {
		const m = fakeManager(false);
		bindPro(m as never);
		const cb = vi.fn();
		const off = onProChange(cb);
		m.set(true);
		expect(isPro()).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		off();
		resetPro();
		expect(m.listeners()).toBe(0);
		expect(isPro()).toBe(false);
	});

	it('the sponsor terms match product.yaml', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user' });
		expect(PRO_UI.priceText).toBe('Sponsor $5 a month, or $15 once. When you have paid $15 in total, Pro stays on.');
	});
});

describe('panel view', () => {
	it('keeps the rows of the last note while a script is active and clears them for other files', async () => {
		const { app, plugin } = setup();
		await plugin.refresh();
		const view = new ReferenceView(WorkspaceLeaf.create2__(app) as never, plugin as never);
		const active = vi.spyOn(app.workspace, 'getActiveFile');
		active.mockReturnValue(app.vault.getFileByPath('People/Ada.md'));
		view.render();
		expect(view.rows.length).toBe(1);
		active.mockReturnValue(app.vault.getFileByPath('Script.fountain'));
		view.render();
		expect(view.rows.length).toBe(1);
		active.mockReturnValue(null);
		view.render();
		expect(view.rows.length).toBe(0);
		active.mockReturnValue(app.vault.getFileByPath('Script.fountain'));
		view.render();
		expect(view.rows.length).toBe(0);
	});

	it('the status describes the folders of the last scan after Pro turns off', async () => {
		const { app, plugin } = setup();
		const m = fakeManager(true);
		bindPro(m as never);
		plugin.settings.folders = 'Film A';
		await plugin.refresh();
		m.set(false);
		const view = new ReferenceView(WorkspaceLeaf.create2__(app) as never, plugin as never);
		vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(app.vault.getFileByPath('Film A/Ada.md'));
		view.render();
		expect(view.contentEl.querySelector('.fountain-reference-panel-status')?.textContent).toContain('scanned in the project folders');
	});

	it('a second Refresh during a scan waits for the same scan', async () => {
		const { app, plugin } = setup();
		const read = vi.spyOn(app.vault, 'cachedRead');
		const a = plugin.refresh();
		const b = plugin.refresh();
		expect(plugin.scanning).toBe(true);
		expect(await a).toBe(await b);
		expect(plugin.scanning).toBe(false);
		expect(read).toHaveBeenCalledTimes(2);
	});
});
