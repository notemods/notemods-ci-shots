import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownRenderer, type Component } from 'obsidian-test-mocks/obsidian';
import KanbanEmbedPlugin from '../src/main';
import { resetPro } from '../src/pro';
import { BoardEmbed } from '../src/view';
import manifest from '../manifest.json';

afterEach(() => {
	resetPro();
	vi.restoreAllMocks();
});

describe('board embed', () => {
	it('unloads the rendered card text of the old board on each redraw', async () => {
		const app = App.createConfigured__({ files: { 'Board.md': '---\nkanban-plugin: board\n---\n\n## A\n- [ ] a\n' } });
		const plugin = new KanbanEmbedPlugin(app as never, manifest as never);
		await plugin.loadSettings();
		const owners: Component[] = [];
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, _el, _path, component) => {
			owners.push(component as never);
		});
		const embed = new BoardEmbed(plugin, document.createElement('div'), 'board: [[Board]]', 'Note.md');
		embed.load();
		await embed.draw();
		expect(owners).toHaveLength(1);
		const first = owners[0]!;
		expect(first).not.toBe(embed);
		const unloaded = vi.fn();
		first.register(unloaded);
		await app.vault.modify(app.vault.getFileByPath('Board.md')!, '---\nkanban-plugin: board\n---\n\n## A\n- [ ] b\n');
		await embed.draw();
		expect(owners).toHaveLength(2);
		expect(unloaded).toHaveBeenCalledTimes(1);
		embed.unload();
	});
});
