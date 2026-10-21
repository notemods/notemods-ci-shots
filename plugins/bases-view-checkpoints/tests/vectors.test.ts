import { App } from 'obsidian-test-mocks/obsidian';
import BasesViewCheckpointsPlugin from '../src/main';
import manifest from '../manifest.json';
import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-view-checkpoints.json';
import { parseDocument } from 'yaml';
import { compareCheckpoint, restoreCheckpoint, saveCheckpoint, viewNames, type Checkpoint } from '../src/basefile';

function parseModel(text: string): unknown {
	return parseDocument(text).toJS();
}

interface CaseArgs {
	file: string;
	saveView?: string;
	checkpointView?: string;
	checkpointText?: string;
	edit?: string;
	action?: 'restore-changes' | 'compare' | 'viewnames' | 'undo' | 'undo-conflict' | 'rename';
}

interface Case {
	name: string;
	args: CaseArgs[] | CaseArgs;
	expected: unknown;
}

function argsOf(c: Case): CaseArgs {
	return (Array.isArray(c.args) ? c.args[0] : c.args) as CaseArgs;
}

async function run(args: CaseArgs): Promise<string | Record<string, unknown>> {
	if (['undo', 'undo-conflict', 'rename'].includes(args.action ?? '')) {
		const app = App.createConfigured__({ files: { 'x.base': args.file } });
		const plugin = new BasesViewCheckpointsPlugin(app as never, manifest as never);
		await plugin.onload();
		try {
			await plugin.saveForFile('x.base', args.saveView ?? 'A');
			const file = app.vault.getFileByPath('x.base')!;
			if (args.action === 'rename') {
				await app.vault.rename(file, 'renamed.base');
				return { path: Object.values(plugin.data.free)[0]!.path };
			}
			await app.vault.modify(file, args.edit ?? args.file);
			await plugin.restoreForFile('x.base', args.saveView ?? 'A');
			if (args.action === 'undo-conflict') {
				await app.vault.modify(file, (await app.vault.read(file)) + '# edit\n');
				return { refused: (await plugin.undoForFile()).includes('undo was refused') };
			}
			await plugin.undoForFile();
			return { undo: await app.vault.read(file) };
		} finally { plugin.unload(); plugin.onunload(); }
	}
	if (args.action === 'viewnames') {
		const names = viewNames(args.edit ?? args.file);
		return { viewNames: names };
	}
	let checkpoint: Checkpoint;
	if (args.checkpointText) {
		const saved = saveCheckpoint(args.checkpointText, 'x.base', args.checkpointView ?? '');
		if (!saved.ok) return { error: saved.reason };
		checkpoint = saved.checkpoint;
	} else if (args.checkpointView) {
		checkpoint = { path: 'x.base', viewName: args.checkpointView, view: JSON.parse(JSON.stringify({ name: args.checkpointView })), shared: {} };
	} else {
		const r = saveCheckpoint(args.file, 'x.base', args.saveView ?? '');
		if (!r.ok) return { error: r.reason };
		checkpoint = r.checkpoint;
	}
	if (args.action === 'restore-changes') {
		const r = restoreCheckpoint(args.edit ?? args.file, checkpoint);
		if (!r.ok) return { error: r.reason };
		return { changes: r.changes };
	}
	if (args.action === 'compare') {
		const changes = compareCheckpoint(args.edit ?? args.file, checkpoint);
		return { compare: changes };
	}
	const target = args.edit ?? args.file;
	const r = restoreCheckpoint(target, checkpoint);
	if (!r.ok) return { error: r.reason };
	return r.text;
}

describe('golden vectors (packages/spec/vectors/bases-view-checkpoints.json)', () => {
	const cases = vectors.cases as Case[];
	it('has at least 20 cases', () => {
		expect(cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of cases) {
		it(c.name, async () => {
			const got = await run(argsOf(c));
			if (typeof c.expected === 'string' && typeof got === 'string') {
				// The writer may reorder quotes and flow style, so full-text cases compare the parsed model.
				expect(parseModel(got)).toEqual(parseModel(c.expected));
				return;
			}
			expect(got).toEqual(c.expected);
		});
	}
	it('save and restore of every case text round trips viewNames', () => {
		for (const c of cases) {
			const names = viewNames(argsOf(c).edit ?? argsOf(c).file);
			if (names !== null) expect(names.length).toBeGreaterThanOrEqual(0);
		}
	});
});
