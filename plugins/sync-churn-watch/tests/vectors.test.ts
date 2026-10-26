import { describe, expect, it } from 'vitest';
import vectors from './vectors/sync-churn-watch.json';
import { markdown, rate, exclusionFolders } from '../src/watch';
import { fixture } from './fixture';
interface Step { op: string; path?: string; mtime?: number; size?: number; time?: number; name?: string }
interface Input { config?: string; files?: Record<string, [number, number]>; manifests?: Record<string, string>; steps: Step[] }
async function replay(input: Input) {
	const f = fixture(input.config);
	for (const [path, [mtime, size]] of Object.entries(input.files ?? {})) f.put(path, mtime, size);
	for (const [path, manifest] of Object.entries(input.manifests ?? {})) f.manifests.set(path, manifest);
	for (const s of input.steps) {
		if (s.time !== undefined) f.time(s.time);
		switch (s.op) {
			case 'start': await f.watch.start(); break;
			case 'poll': await f.watch.poll(); break;
			case 'write': f.put(s.path!, s.mtime!, s.size); break;
			case 'note': f.watch.observe(s.path!, s.name ?? s.path!, 'vault', s.size ?? 0); break;
			case 'stop': f.watch.stop(); break;
			case 'unload': f.watch.dispose(); break;
		}
	}
	const session = f.watch.session;
	return { active: f.watch.active, label: session ? session.stopped === null ? 'Watching' : 'Session stopped' : 'No session',
		rows: session?.rows ?? [], folders: exclusionFolders(session), markdown: markdown(session, 3_600_000),
		rates: session?.rows.map((r) => rate(r, session, 3_600_000)) ?? [], statCalls: f.adapter.stat.mock.calls.length };
}
describe('golden acceptance vectors', () => {
	it('has at least twenty cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, async () => {
		const result = await replay(c.args[0] as Input);
		const expected = c.expected as Record<string, unknown>;
		expect(Object.fromEntries(Object.keys(expected).map((key) => [key, result[key as keyof typeof result]]))).toEqual(expected);
	});
});
