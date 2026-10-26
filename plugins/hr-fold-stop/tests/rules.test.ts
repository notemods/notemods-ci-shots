// Tests for the Pro folder rules and the note override (pure logic).
import { describe, expect, it } from 'vitest';
import { effectiveRuleForPath, normalizeFolders } from '../src/rules';

const FOLDERS = [
	{ folder: 'Archive', enabled: true },
	{ folder: 'Archive/Active', enabled: true },
	{ folder: 'Notes/Drafts', enabled: false },
];

describe('normalizeFolders', () => {
	it('fills defaults and drops junk', () => {
		const out = normalizeFolders([null, { folder: ' A ', enabled: true }, { folder: 42 }, 'x'] as never[]);
		expect(out).toEqual([{ folder: 'A', enabled: true }]);
	});

	it('keeps a valid empty list', () => {
		expect(normalizeFolders([])).toEqual([]);
	});
});

describe('effectiveRuleForPath', () => {
	it('no rules: active comes from the vault toggle', () => {
		expect(effectiveRuleForPath({ vaultEnabled: true, folders: [], overrideProperty: '' }, 'Any/A.md', undefined).source).toBe('vault');
		expect(effectiveRuleForPath({ vaultEnabled: false, folders: [], overrideProperty: '' }, 'Any/A.md', undefined).active).toBe(false);
	});

	it('case 9: a matching folder rule wins over the vault toggle', () => {
		const r = effectiveRuleForPath({ vaultEnabled: false, folders: FOLDERS, overrideProperty: '' }, 'Archive/Active/A.md', undefined);
		expect(r.active).toBe(true);
		expect(r.source).toBe('folder');
	});

	it('case 9: a disabled folder rule turns Fold Stop off for that folder', () => {
		const r = effectiveRuleForPath({ vaultEnabled: true, folders: FOLDERS, overrideProperty: '' }, 'Notes/Drafts/B.md', undefined);
		expect(r.active).toBe(false);
	});

	it('case 9: the longest matching folder path wins', () => {
		const folders = [{ folder: 'Archive', enabled: false }, { folder: 'Archive/Active', enabled: true }];
		expect(effectiveRuleForPath({ vaultEnabled: true, folders, overrideProperty: '' }, 'Archive/Active/A.md', undefined).active).toBe(true);
		expect(effectiveRuleForPath({ vaultEnabled: true, folders, overrideProperty: '' }, 'Archive/B.md', undefined).active).toBe(false);
	});

	it('case 9: a non-matching path falls back to the vault toggle', () => {
		const r = effectiveRuleForPath({ vaultEnabled: true, folders: FOLDERS, overrideProperty: '' }, 'Journal/C.md', undefined);
		expect(r.source).toBe('vault');
	});

	it('case 9: a note override takes priority over folder rules', () => {
		expect(effectiveRuleForPath({ vaultEnabled: true, folders: FOLDERS, overrideProperty: 'fold-stop' }, 'Archive/B.md', false).active).toBe(false);
		expect(effectiveRuleForPath({ vaultEnabled: false, folders: FOLDERS, overrideProperty: 'fold-stop' }, 'Notes/Drafts/B.md', true).active).toBe(true);
	});

	it('a non-Boolean override is ignored', () => {
		expect(effectiveRuleForPath({ vaultEnabled: true, folders: [], overrideProperty: 'x' }, 'A.md', undefined).active).toBe(true);
	});
});
