// Runs the real worker bundle (nerdamer with the build patches from worker-build.mjs) in a Node vm.
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import type { SolverReply, SolverRequest } from '../src/protocol';

describe('worker bundle', () => {
	it('holds no eval or new Function, and solves the acceptance cases after the patches', () => {
		// A child process builds the bundle: esbuild does not run inside the happy-dom test environment.
		const src = execFileSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./worker-build.mjs'); process.stdout.write(await m.workerSource());"], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
		expect(src).not.toMatch(/(?<![\w$.])(?:eval\s*\(|(?:new\s+)?Function\s*\()/);
		const replies: SolverReply[] = [];
		const self: { onmessage: ((ev: { data: SolverRequest }) => void) | null; postMessage: (m: SolverReply) => void } = { onmessage: null, postMessage: (m) => replies.push(m) };
		runInNewContext(src, { self, console });
		const ask = (equation: string, symbol: string) => {
			self.onmessage!({ data: { id: replies.length + 1, kind: 'solve', equation, symbol } });
			return replies[replies.length - 1]!.result;
		};
		expect(ask('F=m*a', 'a')).toMatchObject({ ok: true, insert: '$$a = \\frac{F}{m}$$' });
		expect(ask('x^2-5*x+6=0', 'x')).toMatchObject({ ok: true, insert: '$$x = 2 \\quad\\text{or}\\quad x = 3$$' });
		expect(ask('x^2+1=0', 'x')).toMatchObject({ ok: true, complex: true });
		expect(ask('sin(x)=0', 'x')).toMatchObject({ ok: true, family: true });
		expect(ask('2*y=4', 'x')).toEqual({ ok: false, error: 'x is not in the equation' });
		expect(ask('((x', 'x')).toEqual({ ok: false, error: 'Cannot parse the equation' });
	});
});

describe('mobile safety', () => {
	it('uses no Node or Electron API: the source imports only obsidian, nerdamer, the license and hello packages and its own files', async () => {
		const { readdirSync, readFileSync } = await import('node:fs');
		const specs = readdirSync('src')
			.filter((f) => f.endsWith('.ts'))
			.flatMap((f) => [...readFileSync(`src/${f}`, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!));
		expect(specs.filter((s) => !/^(obsidian|nerdamer|@pf\/(license|hello)(\/[\w-]+)?|\.\/[\w-]+(\/[\w-]+)*(\.json)?)$/.test(s))).toEqual([]);
		expect(readFileSync('src/main.ts', 'utf8') + readFileSync('src/runner.ts', 'utf8')).not.toMatch(/\b(require|process|electron|Buffer)\b/);
	});
});
