import { describe, expect, it } from 'vitest';
import { normalizeHelloContent } from '../src/core/index';
import WHATS_NEW from '../src/whats-new.json';
import manifest from '../manifest.json';

describe("what's new content", () => {
	it('is this plugin at the shipped version, with change lines or a tip and no links', () => {
		const c = normalizeHelloContent(WHATS_NEW, manifest);
		expect(c).not.toBeNull();
		expect(c!.id).toBe(manifest.id);
		expect(WHATS_NEW.version).toBe(manifest.version);
		expect(c!.changes.length + (c!.tip ? 1 : 0)).toBeGreaterThan(0);
		expect(JSON.stringify(WHATS_NEW)).not.toMatch(/https?:|t\.me/);
	});
});
