import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian-test-mocks/obsidian';
import type { Command, TFile } from 'obsidian';
import type { SponsorsManager } from '../src/license/index';
import RevisionSessionMarksPlugin from '../src/main';
import { RevisionSessionMarksSettingTab } from '../src/settings';
import { PRO_NAMED, PRO_FOLDER, PRO_STYLE, bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

// A free user who runs a Pro command or selects a Pro setting gets the shared Pro notice with the
// "Sponsor on GitHub" button. Nothing runs or is saved, and the settings show the values in effect.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'revision-session-marks' },
		init: () => undefined,
		refresh: async () => undefined,
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'Drafts/A.md': 'We go.' } });
	const p = new RevisionSessionMarksPlugin(app as never, manifest as never);
	const commands = new Map<string, Command>();
	vi.spyOn(p, 'addCommand').mockImplementation((c: Command) => { commands.set(c.id, c); return c; });
	const saveData = vi.spyOn(p, 'saveData').mockResolvedValue(undefined);
	vi.spyOn(p, 'loadData').mockResolvedValue(null);
	await p.onload();
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
		// A shown notice is in the document until it hides.
		document.body.append(this.messageEl);
	});
	const file = app.vault.getAbstractFileByPath('Drafts/A.md') as unknown as TFile;
	vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(file as never);
	const editor = { getValue: () => 'We go.' };
	const run = async (id: string) => { await commands.get(id)!.editorCallback!(editor as never, { file } as never); };
	return { app, p, run, shown, saveData };
}

describe('Pro commands and settings', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); document.body.empty(); });

	it('a free user who runs a Pro command gets the Pro notice with a Sponsor button, and nothing runs or is saved', async () => {
		const { p, run, shown, saveData } = await setup(false);
		const saveNamed = vi.spyOn(p, 'saveNamed'); const reviewNamed = vi.spyOn(p, 'reviewNamed'); const reviewFolder = vi.spyOn(p, 'reviewFolder');
		for (const id of ['save-named-baseline', 'review-named-baseline', 'review-folder']) { document.body.empty(); await run(id); }
		expect(shown).toEqual([PRO_NAMED, PRO_NAMED, PRO_FOLDER].map((lead) => ({ text: `${lead} ${PITCH}Sponsor on GitHub`, buttons: 1 })));
		expect(saveNamed).not.toHaveBeenCalled(); expect(reviewNamed).not.toHaveBeenCalled(); expect(reviewFolder).not.toHaveBeenCalled();
		expect(saveData).not.toHaveBeenCalled();
		expect(p.state.named).toEqual([]);
		// The free session command still runs.
		await run('start-session');
		expect(p.state.session?.path).toBe('Drafts/A.md');
	});

	it('a free user who selects a Pro setting gets the Pro notice, nothing is saved, and the controls show the values in effect', async () => {
		const { p, shown, saveData } = await setup(false);
		p.settings.author = 'Sam'; p.settings.includeSummary = true; p.settings.baselineName = 'Second draft';
		const before = JSON.stringify(p.settings);
		const tab = new RevisionSessionMarksSettingTab(p.app, p);
		const update = vi.spyOn(tab, 'update').mockImplementation(() => undefined);
		expect(['baselineName', 'author', 'includeSummary'].map((k) => tab.getControlValue(k))).toEqual(['First draft', '', false]);
		for (const [key, value] of [['baselineName', 'Final'], ['author', 'Ana'], ['includeSummary', true]] as const) { document.body.empty(); await tab.setControlValue(key, value); }
		expect(shown).toEqual([PRO_NAMED, PRO_STYLE, PRO_STYLE].map((lead) => ({ text: `${lead} ${PITCH}Sponsor on GitHub`, buttons: 1 })));
		expect(update).toHaveBeenCalledTimes(3);
		expect(saveData).not.toHaveBeenCalled();
		expect(JSON.stringify(p.settings)).toBe(before);
	});

	it('a Pro user who runs Save a named baseline and changes a Pro setting saves them, with no Pro notice', async () => {
		const { p, run, shown } = await setup(true);
		await run('save-named-baseline');
		expect(p.state.named.map((b) => b.name)).toEqual(['First draft']);
		const tab = new RevisionSessionMarksSettingTab(p.app, p);
		await tab.setControlValue('author', 'Ana');
		expect(p.settings.author).toBe('Ana');
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});
