import { vi } from 'vitest';
import { App, getFrontMatterInfo, stringifyYaml } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import SceneSubtreeMoverPlugin from '../src/main';
import manifest from '../manifest.json';
import { bindPro } from '../src/pro';
import { readIndex } from '../src/index-file';
import { moveTree } from '../src/tree';

export function enablePro(value = true) {
	const listeners = new Set<() => void>();
	const manager = {
		isPro: () => value,
		onChange: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
	};
	bindPro(manager as unknown as SponsorsManager);
	return { set(next: boolean) { value = next; for (const fn of listeners) fn(); } };
}

export const BODY = '\n# Manuscript\nKeep this paragraph.\n\n[[A]]\n';
export function sourceFor(scenes: unknown, eol = '\n'): string {
	return ('---\n' + stringifyYaml({ title: 'Original title', tags: ['draft', 'writing'], custom: { progress: 12, note: 'Do not change' }, longform: { format: 'scenes', sceneFolder: 'Scenes', title: 'Book', scenes } }) + '---\n' + BODY).replace(/\n/g, eol);
}

export function fixture(scenes: unknown = ['A', ['a1', ['x']], 'B', 'C'], source = sourceFor(scenes)) {
	const app = App.createConfigured__({ files: { 'Book/Index.md': source } });
	const plugin = new SceneSubtreeMoverPlugin(app as never, manifest as never);
	const file = app.vault.getFileByPath('Book/Index.md')!;
	return { app, plugin, file, source };
}

export async function applyFixture(input: { scenes: unknown; path: number[]; position: number; inject: string }) {
	const f = fixture(input.scenes);
	const preview = await f.plugin.readPreview(f.file as never);
	preview.after = moveTree(preview.before, { path: input.path, position: input.position });
	const process = f.app.vault.process.bind(f.app.vault);
	const processSpy = vi.spyOn(f.app.vault, 'process');
	const create = f.app.vault.create.bind(f.app.vault);
	if (input.inject === 'before') await f.app.vault.modify(f.file, f.source + '\nSync edit.\n');
	if (input.inject === 'backup') vi.spyOn(f.app.vault, 'create').mockRejectedValue(new Error('backup-failed'));
	if (input.inject === 'process') vi.spyOn(f.app.vault, 'create').mockImplementation(async (...args) => {
		const backup = await create(...args);
		await f.app.vault.modify(f.file, f.source + '\nSync edit.\n');
		return backup;
	});
	processSpy.mockImplementation(process);
	let outcome = 'applied';
	try { await f.plugin.applyPreview(preview); } catch (error) {
		const message = String(error);
		outcome = message.includes('Conflict:') ? 'conflict' : message.includes('backup-failed') ? 'backup-failed' : message;
	}
	const current = await f.app.vault.read(f.file);
	const backups = f.app.vault.getFiles().filter((file) => file.path.includes('.scene-backup-'));
	const parsed = readIndex(current);
	return {
		outcome,
		unchanged: current === f.source,
		backupCount: backups.length,
		backupExact: (await Promise.all(backups.map((file) => f.app.vault.read(file)))).every((text) => text === f.source),
		processCalls: processSpy.mock.calls.length,
		scenes: parsed.longform.scenes,
		body: current.slice(getFrontMatterInfo(current).contentStart),
		title: parsed.data.title,
	};
}
