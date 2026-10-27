import { describe, expect, it } from 'vitest';
import vectors from './vectors/jsonpath-vault-query.json';
import * as query from '../src/query';
import { normalizeSettings } from '../src/settings';
import QueryPlugin from '../src/main';
import { App } from 'obsidian-test-mocks/obsidian';
import manifest from '../manifest.json';
interface Case { name: string; function?: string; args: unknown[]; expected: unknown }
describe('golden acceptance vectors', () => {
	for (const c of vectors.cases as Case[]) it(c.name, async () => {
		const args = c.args.map((v) => v && typeof v === 'object' && 'repeat' in v ? String((v as { repeat: string }).repeat).repeat((v as { count: number }).count) : v);
		const name = c.function ?? 'runQuery';
		const p = new QueryPlugin(App.createConfigured__({ files: {} }) as never, manifest as never);
		const fn = name === 'normalizeSettings' ? normalizeSettings : name === 'queryFile' ? p.queryFile.bind(p) : query[name as keyof typeof query];
		const run = async () => (fn as (...a: unknown[]) => unknown)(...args);
		if (c.expected !== null && typeof c.expected === 'object' && 'errorContains' in c.expected) {
			await expect(run()).rejects.toThrow((c.expected as { errorContains: string }).errorContains);
		} else expect(await run()).toEqual(c.expected);
	});
});
