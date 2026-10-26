import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from './vectors/zoho-znote-import.json';
import { planImport, readExport, type Profile } from '../src/importer';
import { fixture, type SyntheticCard } from './helpers';

describe('golden native export cases', () => {
	for (const c of vectors.cases) it(c.name, () => {
		const [input, folder, profile, existing] = c.args as [string | SyntheticCard[], string, Profile | null, boolean];
		const bytes = typeof input === 'string' ? new Uint8Array(readFileSync(`tests/fixtures/${input}`)) : fixture(input);
		const archive = readExport(bytes); const e = c.expected as Record<string, unknown>;
		if (e.error) { expect(() => planImport(archive, folder, profile, existing)).toThrow(String(e.error)); return; }
		const plan = planImport(archive, folder, profile, existing);
		for (const field of ['cardCount', 'resourceCount', 'notebookCount'] as const) if (field in e) expect(archive[field]).toBe(e[field]);
		if ('supportedCount' in e) expect(archive.cards).toHaveLength(e.supportedCount as number);
		if ('assetCount' in e) expect(plan.assets).toHaveLength(e.assetCount as number);
		if (e.paths) expect(plan.notes.map(n => n.path)).toEqual(e.paths);
		if (e.assetPaths) expect(plan.assets.map(n => n.path)).toEqual(e.assetPaths);
		if (e.properties) (e.properties as Record<string, unknown>[]).forEach((props, i) => expect(archive.cards[i]?.properties).toMatchObject(props));
		if (e.dates) expect(plan.notes.map(n => n.dates)).toEqual(e.dates);
		for (const text of e.bodyIncludes as string[] ?? []) expect(plan.notes[0]?.content).toContain(text);
		for (const text of e.bodyExcludes as string[] ?? []) expect(plan.notes[0]?.content).not.toContain(text);
		for (const text of e.warningIncludes as string[] ?? []) expect(plan.warnings.join('\n')).toContain(text);
		if (e.ordered) {
			const [a, b] = e.ordered as string[];
			expect(plan.notes[0]!.content.indexOf(a!)).toBeLessThan(plan.notes[0]!.content.indexOf(b!));
		}
	});
});
