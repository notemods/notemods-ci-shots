import { describe, expect, it } from 'vitest';
import vectors from './vectors/colornote-backup-import.json';
import * as backup from '../src/backup';
import { fixture, encryptPlain, normal } from './fixture';
import { App } from 'obsidian-test-mocks/obsidian';
import Plugin from '../src/main';
import { ImportModal } from '../src/ui';
import { resetPro } from '../src/pro';
import manifest from '../manifest.json';
import { vi } from 'vitest';
describe('golden vectors', () => {
	it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, async () => {
		resetPro();
		if (['importSummary', 'privacy', 'profileGuard'].includes(c.function)) {
			const app = App.createConfigured__({ files: {} }); const p = new Plugin(app as never, manifest as never);
			if (c.function === 'profileGuard') { const saved = await p.saveProfile({ name: 'Test', folder: 'Notes', colors: {} }); expect({ saved, profiles: p.settings.profiles }).toEqual(c.expected); return; }
			const create = vi.spyOn(app.vault, 'create');
			if (c.function === 'privacy') {
				const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
				try { const modal = new ImportModal(p); modal.onOpen(); const password = modal.contentEl.querySelector<HTMLInputElement>('input[type=password]')!; password.value = '1234'; await p.importBackup(backup.decodeBackup(fixture([normal]), '1234')); modal.onClose(); expect({ requests: request.mock.calls.length, password: password.value, settings: p.settings }).toEqual(c.expected); } finally { request.mockRestore(); }
				return;
			}
			await p.importBackup({ headerCount: 2, records: c.args[0] as backup.SourceRecord[] });
			expect({ filenames: create.mock.calls.map((r) => r[0].split('/').pop()), bodies: create.mock.calls.slice(0, -1).map((r) => r[1].split('---\n\n')[1]!.trim()), passwordSaved: JSON.stringify(p.settings).includes('1234') }).toEqual(c.expected); return;
		}
		if (c.function === 'folderReject' || c.function === 'mapReject') { expect(() => c.function === 'folderReject' ? backup.validFolder(c.args[0] as string) : backup.colorMap(c.args[0] as string)).toThrow(c.expected as string); return; }
		if (c.function === 'decodeCount') {
			const [n, h, pw] = c.args as [number, number, string];
			const decoded = backup.decodeBackup(fixture(Array.from({ length: n }, (_, i) => ({ _id: i })), pw, h), pw);
			expect({ records: decoded.records.length, headerCount: decoded.headerCount }).toEqual(c.expected); return;
		}
		if (c.function === 'reject') {
			const bytes = c.args[0] === 'length' ? encryptPlain(new Uint8Array([...new Uint8Array(16), 0, 15, 66, 63, ...new TextEncoder().encode('{"_id":')])) : fixture();
			if (c.args[0] === 'version') { new DataView(bytes.buffer).setUint32(8, 8); new DataView(bytes.buffer).setUint32(12, 0); }
			expect(() => backup.decodeBackup(bytes, c.args[0] === 'wrong-password' ? 'wrong' : '1234')).toThrow(c.expected as string); return;
		}
		const fn = backup[c.function as keyof typeof backup] as (...args: unknown[]) => unknown;
		expect(fn(...c.args)).toEqual(c.expected);
	});
});
