import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import SceneNotesToFountainPlugin from '../src/main';
import { PRO_UI, SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());

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

const FILES: Record<string, string> = {
	'Script/A lab.md': '---\nslugline: INT. LAB - DAY\nsynopsis: Ada finds a key.\n---\nBody text.\n',
	'Script/B street.md': '---\nslugline: EXT. STREET - NIGHT\n---\n# Notes\n- a list\n\nBo runs home.\n',
	'Script/C rooftop.md': 'Ada waits.\n',
	'Script/D bad.md': '---\nsynopsis:\n  - one\n  - two\n---\n',
	'Script/Sub/E deep.md': 'Not in the folder.\n',
	'Other/F.md': 'Other folder.\n',
};

async function setup(files: Record<string, string> = FILES) {
	const app = App.createConfigured__({ files });
	const plugin = new SceneNotesToFountainPlugin(app as never, manifest as never);
	await plugin.loadSettings();
	return { app, plugin };
}

async function readPath(plugin: SceneNotesToFountainPlugin, path: string): Promise<string | null> {
	const f = plugin.app.vault.getFileByPath(path);
	return f ? plugin.app.vault.read(f) : null;
}

describe('settings', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const { plugin } = await setup();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ sluglineProperty: 5 as never, groups: 'x' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ outputFolder: '/Out/', groups: [{ name: 'Act 1', folder: 'Script', paths: ['a.md', 3] } as never, { name: '' } as never] })).toMatchObject({
			outputFolder: 'Out',
			groups: [{ name: 'Act 1', folder: 'Script', paths: ['a.md'] }],
		});
	});
});

describe('notes and folders', () => {
	it('sorts file names in numeric order', async () => {
		const { plugin } = await setup({ 'S/10.md': 'Ten.', 'S/2.md': 'Two.', 'S/1.md': 'One.' });
		expect(plugin.notesIn('S').map((f) => f.basename)).toEqual(['1', '2', '10']);
	});
	it('lists notes directly in one folder in file-name order', async () => {
		const { plugin } = await setup();
		expect(plugin.notesIn('Script').map((f) => f.path)).toEqual(['Script/A lab.md', 'Script/B street.md', 'Script/C rooftop.md', 'Script/D bad.md']);
		expect(plugin.folders()).toEqual(['Other', 'Script', 'Script/Sub']);
	});
});

describe('plan and save', () => {
	it('builds the outline in the given order from properties and fallbacks', async () => {
		const { plugin } = await setup();
		const sp = await plugin.makePlan(['Script/A lab.md', 'Script/C rooftop.md', 'Script/B street.md']);
		expect(sp.plan.errors).toEqual([]);
		expect(sp.plan.text).toBe('.INT. LAB - DAY\n\n= Ada finds a key.\n\n.C rooftop\n\n= Ada waits.\n\n.EXT. STREET - NIGHT\n\n= Bo runs home.\n');
	});

	it('reports a property-type error and gives no text', async () => {
		const { plugin } = await setup();
		const sp = await plugin.makePlan(['Script/A lab.md', 'Script/D bad.md']);
		expect(sp.plan.text).toBeNull();
		expect(sp.plan.errors).toEqual([{ path: 'Script/D bad.md', message: 'The property "synopsis" is a list. It must be text.' }]);
		const r = await plugin.savePlan(sp, 'Script', 'Outline');
		expect(r.status).toBe('invalid');
		expect(plugin.app.vault.getFiles().some((f) => f.extension === 'fountain')).toBe(false);
	});

	it('saves a new file and keeps the source notes byte for byte', async () => {
		const { plugin } = await setup();
		const sp = await plugin.makePlan(['Script/A lab.md']);
		const r = await plugin.savePlan(sp, 'Script', 'Outline');
		expect(r.status).toBe('saved');
		expect(await readPath(plugin, 'Script/Outline.fountain')).toBe('.INT. LAB - DAY\n\n= Ada finds a key.\n');
		for (const [p, t] of Object.entries(FILES)) expect(await readPath(plugin, p)).toBe(t);
	});

	it('picks a numbered name and does not change an existing file', async () => {
		const { plugin } = await setup({ ...FILES, 'Script/Outline.fountain': 'OLD BYTES' });
		const sp = await plugin.makePlan(['Script/C rooftop.md']);
		const r = await plugin.savePlan(sp, 'Script', 'Outline');
		expect(r.status === 'saved' && r.file.path).toBe('Script/Outline 2.fountain');
		expect(await readPath(plugin, 'Script/Outline.fountain')).toBe('OLD BYTES');
	});

	it('refuses a plan when a selected note changed after the preview', async () => {
		const { plugin } = await setup();
		const sp = await plugin.makePlan(['Script/C rooftop.md']);
		await plugin.app.vault.modify(plugin.app.vault.getFileByPath('Script/C rooftop.md')!, 'Ada leaves.\n');
		expect((await plugin.savePlan(sp, 'Script', 'Outline')).status).toBe('stale');
		expect(plugin.app.vault.getFileByPath('Script/Outline.fountain')).toBeNull();
		const again = await plugin.makePlan(['Script/C rooftop.md']);
		expect(again.plan.text).toBe('.C rooftop\n\n= Ada leaves.\n');
	});

	it('zero notes give an error and no file', async () => {
		const { plugin } = await setup();
		const sp = await plugin.makePlan([]);
		expect(sp.plan.errors[0]?.message).toBe('Select one or more notes.');
		expect((await plugin.savePlan(sp, 'Script', 'Outline')).status).toBe('invalid');
		expect(plugin.app.vault.getFiles().filter((f) => f.extension === 'fountain')).toEqual([]);
	});
});

describe('pro features', () => {
	it('without Pro, ignores saved mappings, output folder and groups', async () => {
		const { plugin } = await setup();
		plugin.settings.sluglineProperty = 'scene';
		plugin.settings.outputFolder = 'Out';
		plugin.settings.fileName = 'Draft';
		expect(plugin.mapping()).toEqual({ slugline: 'slugline', synopsis: 'synopsis' });
		expect(plugin.outputFolder('Script')).toBe('Script');
		expect(plugin.defaultFileName()).toBe('Outline');
		expect(await plugin.saveGroup('Act 1', 'Script', ['Script/A lab.md'])).toBe(false);
		expect(plugin.settings.groups).toEqual([]);
		expect(await plugin.exportGroups()).toEqual([]);
	});

	it('with Pro, uses saved mappings and exports each saved group', async () => {
		const { plugin } = await setup({ ...FILES, 'Script/G.md': '---\nscene: EXT. PIER - NIGHT\nsummary: Fog.\n---\n' });
		bindPro(fakeManager(true) as never);
		plugin.settings.sluglineProperty = 'scene';
		plugin.settings.synopsisProperty = 'summary';
		plugin.settings.outputFolder = 'Out';
		expect(await plugin.saveGroup('Pier', 'Script', ['Script/G.md'])).toBe(true);
		expect(await plugin.saveGroup('Rooftop', 'Script', ['Script/C rooftop.md'])).toBe(true);
		expect(await plugin.exportGroups()).toEqual(['Out/Pier.fountain', 'Out/Rooftop.fountain']);
		expect(await readPath(plugin, 'Out/Pier.fountain')).toBe('.EXT. PIER - NIGHT\n\n= Fog.\n');
		expect(await readPath(plugin, 'Out/Rooftop.fountain')).toBe('.C rooftop\n\n= Ada waits.\n');
	});
});

describe('group export errors', () => {
	it('a failed write of one group does not stop the next group', async () => {
		const { plugin } = await setup();
		bindPro(fakeManager(true) as never);
		await plugin.saveGroup('One', 'Script', ['Script/A lab.md']);
		await plugin.saveGroup('Two', 'Script', ['Script/C rooftop.md']);
		vi.spyOn(plugin.app.vault, 'create').mockRejectedValueOnce(new Error('disk full'));
		expect(await plugin.exportGroups()).toEqual(['Script/Two.fountain']);
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
