import { describe, expect, it } from 'vitest';
import { splitBacklinks, type ResolvedLinks } from '../src/links';

/** A vault of n notes. Note i links to the 10 notes after it. Hub.md gets a link from every third note and links to every ninth. */
function vault(n: number): ResolvedLinks {
	const r: ResolvedLinks = {};
	const hub: Record<string, number> = {};
	for (let i = 0; i < n; i++) {
		const links: Record<string, number> = {};
		for (let k = 1; k <= 10; k++) links[`F${(i + k) % 10}/N${(i + k) % n}.md`] = 1;
		if (i % 3 === 0) links['Hub.md'] = 1 + (i % 2);
		if (i % 9 === 0) hub[`F${i % 10}/N${i}.md`] = 1;
		r[`F${i % 10}/N${i}.md`] = links;
	}
	r['Hub.md'] = hub;
	return r;
}

describe('a vault of 10,000 notes', () => {
	it('splits the backlinks of a hub in one pass and gives the expected counts', () => {
		const resolved = vault(10_000);
		const start = performance.now();
		const split = splitBacklinks(resolved, 'Hub.md');
		const ms = performance.now() - start;
		// Every third note links to Hub (3,334 notes). Every ninth note is linked back (1,112 notes), and each is also a third.
		expect(split.oneWay.length + split.paired.length).toBe(3334);
		expect(split.paired.length).toBe(1112);
		expect(split.oneWay.length).toBe(2222);
		// The time goes to the log, not into an assert: a slow CI machine must not turn the build red.
		console.info(`splitBacklinks 10,000 notes, 100,000 links: ${ms.toFixed(1)} ms`);
	});

	it('reads each source once: a note with no backlinks costs one pass and gives two empty lists', () => {
		let reads = 0;
		const resolved = vault(10_000);
		const counting = new Proxy(resolved, {
			get(target, key, recv) {
				if (typeof key === 'string' && key.endsWith('.md')) reads++;
				return Reflect.get(target, key, recv) as unknown;
			},
		});
		const split = splitBacklinks(counting, 'Nobody.md');
		expect(split).toEqual({ oneWay: [], paired: [] });
		// One read of the current note, then one read for each of the 10,001 sources.
		expect(reads).toBe(10_002);
	});
});
