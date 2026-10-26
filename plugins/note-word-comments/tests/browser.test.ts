// Acceptance case 10: the browser build runs with no Buffer, require, process, fs or Electron global.
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { strFromU8, unzipSync } from 'fflate';
import { resolve } from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';

describe('browser build of the DOCX writer', () => {
	it('Packer.toBlob and Blob.arrayBuffer succeed without Node globals', async () => {
		const entry = resolve('tests/fixtures/browser-entry.ts');
		const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2021', plugins: [] });
		const code = out.outputFiles[0]!.text;
		// A plain context: only Blob and the web globals that a browser has. Node Blob, because the test DOM Blob differs.
		const sandbox: Record<string, unknown> = { Blob: NodeBlob, Uint8Array, ArrayBuffer, DataView, Uint16Array, Uint32Array, TextEncoder, TextDecoder, setTimeout, clearTimeout, console, Promise, Date };
		runInNewContext(code, sandbox);
		const result = (await (sandbox.run as () => Promise<{ globals: Record<string, string>; bytes: Uint8Array }>)()) as { globals: Record<string, string>; bytes: Uint8Array };
		expect(result.globals).toEqual({ Buffer: 'undefined', require: 'undefined', process: 'undefined', fs: 'undefined', electron: 'undefined' });
		const zip = unzipSync(result.bytes);
		const body = strFromU8(zip['word/document.xml']!);
		const comments = strFromU8(zip['word/comments.xml']!);
		const ref = [...body.matchAll(/<w:commentReference w:id="(\d+)"/g)].map((m) => m[1]);
		const defs = [...comments.matchAll(/<w:comment w:id="(\d+)"/g)].map((m) => m[1]);
		expect(ref).toEqual(['0', '1']);
		expect(defs).toEqual(ref);
	}, 60000);
});
