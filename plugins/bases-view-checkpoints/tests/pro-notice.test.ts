import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, type Command } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import BasesViewCheckpointsPlugin from '../src/main';
import { bindPro, PRO_COMPARE, PRO_NAMED } from '../src/pro';
import manifest from '../manifest.json';

// A free user can run the two Pro commands. The command shows the shared Pro notice with a Sponsor button
// and does nothing else: no picker opens and nothing is saved. A Pro user gets the picker, as before.
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';
const START = 'views:\n  - name: Alpha\n    type: table\n';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'bases-view-checkpoints' },
		init: () => undefined,
		refresh: async () => undefined,
	} as unknown as SponsorsManager;
}

async function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'x.base': START } });
	const plugin = new BasesViewCheckpointsPlugin(app as never, manifest as never);
	const commands: Record<string, Command> = {};
	vi.spyOn(plugin, 'addCommand').mockImplementation((c: Command) => { commands[c.id] = c; return c; });
	vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation(() => undefined);
	await plugin.onload();
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	const save = vi.spyOn(plugin, 'saveSettings');
	const picker = vi.spyOn(plugin.app.vault, 'getFiles');
	return { plugin, commands, shown, save, picker };
}

describe('Pro commands for a free user', () => {
	afterEach(() => { bindPro(null); vi.restoreAllMocks(); });

	it('a free user who runs Save named checkpoint or Compare checkpoint gets the Pro notice with a Sponsor button, and nothing runs', async () => {
		const { plugin, commands, shown, save, picker } = await setup(false);
		await plugin.save(plugin.app.vault.getFileByPath('x.base') as never, 'Alpha');
		save.mockClear(); shown.length = 0;
		for (const id of ['save-named', 'compare-checkpoint']) {
			expect(commands[id]!.checkCallback!(true)).toBe(true);
			commands[id]!.checkCallback!(false);
		}
		expect(shown).toEqual([
			{ text: `${PRO_NAMED} ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `${PRO_COMPARE} ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		expect(picker).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
		expect(plugin.data.named).toEqual({});
	});

	it('a Pro user who runs the same commands gets the pickers and no Pro notice', async () => {
		const { plugin, commands, shown, picker } = await setup(true);
		await plugin.save(plugin.app.vault.getFileByPath('x.base') as never, 'Alpha');
		shown.length = 0;
		expect(commands['save-named']!.checkCallback!(true)).toBe(true);
		commands['save-named']!.checkCallback!(false);
		expect(picker).toHaveBeenCalled();
		const pick = vi.spyOn(plugin as unknown as { pickCheckpoint(cb: unknown): void }, 'pickCheckpoint');
		commands['compare-checkpoint']!.checkCallback!(false);
		expect(pick).toHaveBeenCalledTimes(1);
		expect(shown.filter((n) => n.buttons > 0)).toEqual([]);
	});
});
