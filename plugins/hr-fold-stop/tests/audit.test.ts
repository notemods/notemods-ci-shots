// Fold state of open notes must stay when nothing that changes Fold Stop changes.
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { editorInfoField, type Command } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import HrFoldStopPlugin from '../src/main';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';

vi.mock('obsidian', async () => {
	const original = await import('obsidian-test-mocks/obsidian');
	const { StateField } = await import('@codemirror/state');
	return { ...original, editorInfoField: StateField.define({ create: () => ({ file: { path: '' } }), update: value => value }) };
});

afterEach(() => { resetPro(); vi.restoreAllMocks(); });

/** A view stand-in with one fold in the note at `path`. */
function foldedView(path: string): EditorView {
	let state = EditorState.create({ doc: '# A\nBody\n\n---\nTail', extensions: [editorInfoField.init(() => ({ file: { path } }) as never), codeFolding()] });
	state = state.update({ effects: foldEffect.of({ from: 3, to: 9 }) }).state;
	return { get state() { return state; }, dispatch: (spec: Parameters<EditorState['update']>[0]) => { state = state.update(spec).state; } } as unknown as EditorView;
}

async function loaded(files: Record<string, string> = { 'A.md': '# A', 'B.md': '# B' }) {
	const app = App.createConfigured__({ files });
	const plugin = new HrFoldStopPlugin(app as never, manifest as never);
	const commands: Command[] = [];
	vi.spyOn(plugin, 'addCommand').mockImplementation(command => { commands.push(command); return command; });
	await plugin.onload();
	return { app, plugin, commands };
}

it('keeps folds when a sponsorship check ends with the same Pro state', async () => {
	const { plugin } = await loaded();
	const view = foldedView('A.md');
	plugin.editorViews.add(view);
	// A check, a failed retry or sign out saves the state and calls each listener, also when Pro did not change.
	plugin.pro!.signOut();
	expect(foldedRanges(view.state).size).toBe(1);
});

it('the restore command expands only the views of its own note', async () => {
	const { plugin, commands } = await loaded();
	const own = foldedView('A.md');
	const other = foldedView('B.md');
	plugin.editorViews.add(own).add(other);
	const restore = commands.find(command => command.id === 'restore-normal-folding');
	restore!.editorCallback!({ exec: () => {} } as never, { file: { path: 'A.md' } } as never);
	expect(foldedRanges(own.state).size).toBe(0);
	expect(foldedRanges(other.state).size).toBe(1);
});

it('a renamed note keeps normal folding from the restore command', async () => {
	const { app, plugin, commands } = await loaded();
	const restore = commands.find(command => command.id === 'restore-normal-folding');
	restore!.editorCallback!({ exec: () => {} } as never, { file: { path: 'A.md' } } as never);
	await app.fileManager.renameFile(app.vault.getFileByPath('A.md')!, 'C.md');
	expect(plugin.editorConfig('C.md').enabled).toBe(false);
	expect(plugin.restoredNotes.has('A.md')).toBe(false);
});
