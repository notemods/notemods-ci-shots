import esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';

// The solver runs in a Web Worker (src/runner.ts). Bundle src/worker.ts with nerdamer into one string first.
// nerdamer has two constructs that the network gate refuses (tools/network-gate.mjs, "code built at run time"):
// buildFunction makes a JavaScript function with new Function, and a static method has the name Function.
// The plugin does not call buildFunction, so it throws now. The method and its 3 callers get the name FunctionSymbol.
// Each entry: [text, replacement, number of matches].
const PATCHES = [
	['return new Function(...o,`${n}${r} return ${i}`)', 'throw new Error("buildFunction is not available in Pocket Symbolic Solver")', 1],
	['static Function(e){', 'static FunctionSymbol(e){', 1],
	['Expression_Expression.Function(', 'Expression_Expression.FunctionSymbol(', 3],
];

/** Applies PATCHES to the raw nerdamer bundle when esbuild loads it. Each patch must match the given number of times. */
const patchNerdamer = {
	name: 'patch-nerdamer',
	setup(build) {
		build.onLoad({ filter: /[\\/]nerdamer[\\/]dist[\\/]bundle\.js$/ }, async (args) => {
			let js = await readFile(args.path, 'utf8');
			for (const [from, to, count] of PATCHES) {
				const n = js.split(from).length - 1;
				if (n !== count) throw new Error(`nerdamer patch: expected ${count} matches of ${from}, found ${n}`);
				js = js.split(from).join(to);
			}
			return { contents: js, loader: 'js' };
		});
	},
};

export async function workerSource() {
	const out = await esbuild.build({
		plugins: [patchNerdamer],
		entryPoints: [new URL('./src/worker.ts', import.meta.url).pathname],
		bundle: true,
		format: 'iife',
		target: 'es2021',
		write: false,
		minify: true,
		legalComments: 'inline',
		logLevel: 'warning',
	});
	const js = out.outputFiles[0].text;
	if (/(?<![\w$.])(?:eval\s*\(|(?:new\s+)?Function\s*\()/.test(js)) throw new Error('worker: eval or new Function is still in the bundle');
	return js;
}
