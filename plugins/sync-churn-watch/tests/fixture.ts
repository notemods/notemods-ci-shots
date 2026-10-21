import { vi } from 'vitest';
import { Watch, type FileStat } from '../src/watch';
export function fixture(config = '.obsidian') {
	let now = 0;
	const files = new Map<string, FileStat>();
	const manifests = new Map<string, string>();
	const adapter = {
		stat: vi.fn(async (path: string) => files.get(path) ?? null),
		list: vi.fn(async () => ({ folders: [...new Set([...files.keys()].filter((p) => p.startsWith(`${config}/plugins/`)).map((p) => p.slice(0, p.lastIndexOf('/'))))], files: [] as string[] })),
		read: vi.fn(async (path: string) => { if (!manifests.has(path)) throw new Error('Missing'); return manifests.get(path)!; }),
	};
	const changed = vi.fn(); const wrote = vi.fn();
	const watch = new Watch(adapter, config, `${config}/plugins/sync-churn-watch`, changed, wrote, () => now);
	const put = (path: string, mtime: number, size = 100) => files.set(path, { type: 'file', mtime, size });
	return { watch, adapter, files, manifests, put, changed, wrote, time: (n: number) => { now = n; } };
}
