import { describe, expect, it } from 'vitest';
import vectors from './vectors/substack-export-import.json';
import { prepareImport, type Mapping } from '../src/importer';
import { convertBody } from '../src/convert';
import Plugin from '../src/main';
import { App } from 'obsidian-test-mocks/obsidian';
import manifest from '../manifest.json';

interface Case { name: string; function?: string; args: unknown[]; expected: Record<string, unknown> }
describe('golden acceptance vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const test of vectors.cases as Case[]) it(test.name, async () => {
		if (test.function === 'writeImport') {
			const [members, folder, files] = test.args as [Record<string, string>, string, Record<string, string>];
			const plugin = new Plugin(App.createConfigured__({ files }) as never, manifest as never);
			await expect(plugin.writeImport(prepareImport(members, convertBody), folder)).rejects.toThrow(String(test.expected.error));
			return;
		}
		const [members, mapping] = test.args as [Record<string, string>, Mapping | undefined];
		if ('error' in test.expected) { expect(() => prepareImport(members, convertBody, mapping)).toThrow(String(test.expected.error)); return; }
		const preview = prepareImport(members, convertBody, mapping);
		const want = structuredClone(test.expected);
		if (Array.isArray(want.posts)) {
			for (const [i, post] of (want.posts as Record<string, unknown>[]).entries()) {
				if ('bodyContains' in post) { expect(preview.posts[i]?.body).toContain(post.bodyContains); delete post.bodyContains; }
			}
		}
		expect(preview).toMatchObject(want);
	});
});
