import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type { TFile } from 'obsidian';
import RevisionSessionMarksPlugin from '../src/main';
import { bindPro, isPro, resetPro, SPONSORS } from '../src/pro';
import { DEFAULT_SETTINGS, loadState } from '../src/state';
import { RevisionSessionMarksSettingTab } from '../src/settings';
import manifest from '../manifest.json';

afterEach(() => resetPro());
function fixture(files: Record<string, string> = { 'Drafts/A.md': 'We go.', 'Drafts/B.md': 'We walk.' }) {
	const app = App.createConfigured__({ files });
	Object.defineProperty(app, 'fileManager', { value: { trashFile: (f: TFile) => app.vault.delete(f as never) }, configurable: true });
	const p = new RevisionSessionMarksPlugin(app as never, manifest as never);
	let disk: unknown = null;
	vi.spyOn(p, 'saveData').mockImplementation(async (data: unknown) => { disk = structuredClone(data); });
	vi.spyOn(p, 'loadData').mockImplementation(async () => structuredClone(disk));
	vi.spyOn(p as unknown as { showReview(): void }, 'showReview').mockImplementation(() => undefined);
	const file = (path = 'Drafts/A.md') => app.vault.getAbstractFileByPath(path) as unknown as TFile;
	return { app, p, file, disk: () => disk };
}
function pro(value = true) { bindPro({ isPro: () => value, onChange: () => () => undefined } as never); }

describe('Free session transaction', () => {
	it('loads defaults and stays free', async () => {
		const { p } = fixture();
		await p.loadSettings();
		expect(p.settings).toEqual(DEFAULT_SETTINGS);
		expect(isPro()).toBe(false);
	});
	it('persists text and path then restores the baseline on restart', async () => {
		const { app, p, file, disk } = fixture();
		await p.startSession(file(), 'We go.');
		const next = new RevisionSessionMarksPlugin(app as never, manifest as never);
		vi.spyOn(next, 'loadData').mockResolvedValue(disk());
		vi.spyOn(next, 'saveData').mockResolvedValue();
		vi.spyOn(next as unknown as { showReview(): void }, 'showReview').mockImplementation(() => undefined);
		await next.loadSettings();
		await app.vault.modify(file() as never, 'We now go.');
		const out = await next.stopSession(file(), 'We now go.');
		expect(await app.vault.read(out as never)).toBe('We {++now ++}go.');
		expect(await app.vault.read(file() as never)).toBe('We now go.');
		expect(next.state.session).toBeNull();
	});
	it('refuses a second free session', async () => {
		const { p, file } = fixture();
		await p.startSession(file(), 'We go.');
		await expect(p.startSession(file('Drafts/B.md'), 'We walk.')).rejects.toThrow('already saved');
		expect(p.state.session?.path).toBe('Drafts/A.md');
	});
	it('creates no output for equal inputs and keeps the baseline', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		expect(await p.stopSession(file(), 'We go.')).toBeNull();
		expect(p.lastMessage).toBe('No changes.');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.session).not.toBeNull();
	});
	it('refuses another note and keeps the baseline', async () => {
		const { p, file } = fixture();
		await p.startSession(file(), 'We go.');
		await expect(p.stopSession(file('Drafts/B.md'), 'We stay.')).rejects.toThrow('Baseline file does not match');
		expect(p.state.session?.text).toBe('We go.');
	});
	it('refuses a renamed note', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		const f = file();
		await app.vault.rename(f as never, 'Drafts/Renamed.md');
		await expect(p.stopSession(f, 'We stay.')).rejects.toThrow('Baseline file does not match');
	});
	it('refuses a deleted baseline', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		const f = file();
		await app.vault.delete(f as never);
		await expect(p.stopSession(f, 'We stay.')).rejects.toThrow('Baseline file does not match');
	});
	it('rejects unsupported final input without an output', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		await expect(p.stopSession(file(), '# We stay.')).rejects.toThrow('Unsupported final input');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.session?.text).toBe('We go.');
	});
	it('rejects large final input without an output', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		await expect(p.stopSession(file(), 'a'.repeat(102401))).rejects.toThrow('100 KB');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.session?.text).toBe('We go.');
	});
	it('rejects excessive edits and keeps the baseline', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'a '.repeat(600));
		await expect(p.stopSession(file(), 'b '.repeat(600))).rejects.toThrow('Diff work limit');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.session?.text).toBe('a '.repeat(600));
	});
	it('uses a new output name when a review exists', async () => {
		const { p, app, file } = fixture();
		await app.vault.create('Drafts/A review.md', 'Existing review.');
		await p.startSession(file(), 'We go.');
		const out = await p.stopSession(file(), 'We stay.');
		expect(out?.path).toBe('Drafts/A review 2.md');
		expect(await app.vault.read(app.vault.getAbstractFileByPath('Drafts/A review.md') as never)).toBe('Existing review.');
	});
	it('retains the baseline when output write fails', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		vi.spyOn(app.vault, 'create').mockRejectedValueOnce(new Error('Disk full.'));
		await expect(p.stopSession(file(), 'We stay.')).rejects.toThrow('Disk full');
		expect(p.state.session?.text).toBe('We go.');
	});
	it('rolls back output if clearing saved state fails', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		vi.mocked(p.saveData).mockRejectedValueOnce(new Error('Data write failed.'));
		await expect(p.stopSession(file(), 'We stay.')).rejects.toThrow('Data write failed');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.session?.text).toBe('We go.');
	});
	it('does not install an unsaved baseline', async () => {
		const { p, file } = fixture();
		vi.mocked(p.saveData).mockRejectedValueOnce(new Error('Data write failed.'));
		await expect(p.startSession(file(), 'We go.')).rejects.toThrow('Data write failed');
		expect(p.state.session).toBeNull();
	});
	it('blocks overlapping actions while persistence is pending', async () => {
		const { p, file } = fixture();
		let resolve!: () => void;
		vi.mocked(p.saveData).mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
		const pending = p.startSession(file(), 'We go.');
		await expect(p.startSession(file(), 'We stay.')).rejects.toThrow('in progress');
		resolve(); await pending;
	});
	it('discards only the baseline', async () => {
		const { p, app, file } = fixture();
		await p.startSession(file(), 'We go.');
		await p.discardSession();
		expect(p.state.session).toBeNull();
		expect(await app.vault.read(file() as never)).toBe('We go.');
	});
	it('free review ignores saved Pro author options', async () => {
		const { p, app, file } = fixture();
		p.settings.author = 'Sam'; p.settings.includeSummary = true;
		await p.startSession(file(), 'We go.');
		const out = await p.stopSession(file(), 'We stay.');
		expect(await app.vault.read(out as never)).toBe('We {~~go~>stay~~}.');
	});
});

describe('Pro baselines and folder preflight', () => {
	it('gates named and folder operations', async () => {
		const { p, file } = fixture();
		await expect(p.saveNamed(file(), 'We go.')).rejects.toThrow('needs Pro');
		await expect(p.reviewNamed(file(), 'We go.')).rejects.toThrow('needs Pro');
		await expect(p.reviewFolder(file(), 'We go.')).rejects.toThrow('needs Pro');
		expect(p.state.named).toEqual([]);
	});
	it('saves several named baselines and refuses replacement', async () => {
		pro(); const { p, file } = fixture();
		await p.saveNamed(file(), 'We go.');
		await p.saveNamed(file('Drafts/B.md'), 'We walk.');
		await expect(p.saveNamed(file(), 'We stay.')).rejects.toThrow('exists');
		expect(p.state.named.map((b) => b.path)).toEqual(['Drafts/A.md', 'Drafts/B.md']);
	});
	it('creates author and summary comments and keeps the named baseline', async () => {
		pro(); const { p, app, file } = fixture();
		p.settings.author = 'Sam'; p.settings.includeSummary = true;
		await p.saveNamed(file(), 'We go.');
		const out = await p.reviewNamed(file(), 'We stay.');
		expect(await app.vault.read(out as never)).toBe('{>>Author: Sam; Changes: 0 additions, 0 deletions, 1 substitutions<<}We {~~go~>stay~~}.');
		expect(p.state.named).toHaveLength(1);
	});
	it('preflights an unsupported folder draft before output', async () => {
		pro(); const { p, app, file } = fixture();
		await p.saveNamed(file(), 'We go.'); await p.saveNamed(file('Drafts/B.md'), 'We walk.');
		await app.vault.modify(file('Drafts/B.md') as never, '[Bad](link)');
		await expect(p.reviewFolder(file(), 'We stay.')).rejects.toThrow('Unsupported final input');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.named).toHaveLength(2);
	});
	it('creates copies for two changed notes, using active editor text', async () => {
		pro(); const { p, app, file } = fixture();
		await p.saveNamed(file(), 'We go.'); await p.saveNamed(file('Drafts/B.md'), 'We walk.');
		await app.vault.modify(file('Drafts/B.md') as never, 'We run.');
		const out = await p.reviewFolder(file(), 'We stay.');
		expect(out.map((f) => f.path)).toEqual(['Drafts/A review.md', 'Drafts/B review.md']);
		expect(await app.vault.read(out[0] as never)).toBe('We {~~go~>stay~~}.');
		expect(await app.vault.read(file() as never)).toBe('We go.');
		expect(await app.vault.read(file('Drafts/B.md') as never)).toBe('We run.');
	});
	it('rolls back its first copy on a later write failure', async () => {
		pro(); const { p, app, file } = fixture();
		await p.saveNamed(file(), 'We go.'); await p.saveNamed(file('Drafts/B.md'), 'We walk.');
		await app.vault.modify(file('Drafts/B.md') as never, 'We run.');
		const create = app.vault.create.bind(app.vault);
		vi.spyOn(app.vault, 'create').mockImplementation(async (path, text, opts) => {
			if (path === 'Drafts/B review.md') throw new Error('Disk full.');
			return create(path, text, opts);
		});
		await expect(p.reviewFolder(file(), 'We stay.')).rejects.toThrow('Disk full');
		expect(app.vault.getAbstractFileByPath('Drafts/A review.md')).toBeNull();
		expect(p.state.named).toHaveLength(2);
	});
	it('keeps baselines when sponsorship is off and permits removal', async () => {
		pro(); const { p, file } = fixture();
		await p.saveNamed(file(), 'We go.'); pro(false);
		await expect(p.reviewNamed(file(), 'We stay.')).rejects.toThrow('needs Pro');
		await p.removeNamed(file());
		expect(p.state.named).toEqual([]);
	});
	it('removes a named baseline of a deleted note so folder review works again', async () => {
		pro(); const { p, app, file } = fixture({ 'Drafts/A.md': 'We go.', 'Drafts/B.md': 'We walk.', 'Drafts/C.md': 'We sit.' });
		await p.saveNamed(file(), 'We go.'); await p.saveNamed(file('Drafts/B.md'), 'We walk.');
		await app.vault.delete(file('Drafts/B.md') as never);
		await expect(p.reviewFolder(file(), 'We stay.')).rejects.toThrow('Remove invalid named baselines');
		await p.removeInvalid();
		expect(p.state.named.map((b) => b.path)).toEqual(['Drafts/A.md']);
		const out = await p.reviewFolder(file(), 'We stay.');
		expect(out.map((f) => f.path)).toEqual(['Drafts/A review.md']);
	});
	it('reports when no selected named baseline exists for the note', async () => {
		const { p, file } = fixture();
		await p.removeNamed(file());
		expect(p.lastMessage).toBe('No selected named baseline for this note.');
	});
	it('keeps up to 50 named baselines and refuses the 51st', async () => {
		pro();
		const files: Record<string, string> = {};
		for (let i = 0; i < 51; i++) files[`N/${i}.md`] = 'We go.';
		const { p, file } = fixture(files);
		for (let i = 0; i < 50; i++) await p.saveNamed(file(`N/${i}.md`), 'We go.');
		await expect(p.saveNamed(file('N/50.md'), 'We go.')).rejects.toThrow('limit: 50');
		expect(p.state.named).toHaveLength(50);
	});
	it('folder review skips subfolders and other baseline names', async () => {
		pro(); const { p, file } = fixture({ 'Drafts/A.md': 'We go.', 'Drafts/B.md': 'We walk.', 'Drafts/Sub/C.md': 'We sit.' });
		await p.saveNamed(file(), 'We go.'); await p.saveNamed(file('Drafts/Sub/C.md'), 'We sit.');
		p.settings.baselineName = 'Other'; await p.saveNamed(file('Drafts/B.md'), 'We walk.');
		p.settings.baselineName = 'First draft';
		const out = await p.reviewFolder(file(), 'We stay.');
		expect(out.map((f) => f.path)).toEqual(['Drafts/A review.md']);
	});
	it('setting changes preserve the baseline on disk', async () => {
		const { p, app, file, disk } = fixture();
		await p.startSession(file(), 'We go.');
		const tab = new RevisionSessionMarksSettingTab(app as never, p);
		await tab.setControlValue('author', 'Sam');
		expect(loadState(disk()).session?.text).toBe('We go.');
		expect(loadState(disk()).settings.author).toBe('Sam');
	});
	it('uses the required public sponsor client and prices', () => {
		expect(SPONSORS).toMatchObject({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, scope: 'read:user', oneTimeMonths: 0 });
	});
});
