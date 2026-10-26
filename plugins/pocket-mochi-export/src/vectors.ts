// Entry point of the golden vectors (packages/spec/vectors/pocket-mochi-export.json). Pure: no Obsidian import.
import { archivePath, ednString, normalizeTag, parseCards, parsePresets, planExport, type DeckMode, type NoteInput, type Resolver } from './mochi';

/**
 * A stand-in for MetadataCache.getFirstLinkpathDest over a list of vault paths. A link with a folder matches the
 * path from the vault root or from the folder of the note. A bare name matches a file in the folder of the note
 * first, then the first file with that name in path order.
 */
export function listResolver(files: string[]): Resolver {
	const sorted = [...files].sort();
	return (link, source) => {
		const dir = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
		const want = link.replace(/^\.\//, '');
		const tries = [want, `${dir}${want}`, `${want}.md`, `${dir}${want}.md`];
		for (const t of tries) if (sorted.includes(t)) return t;
		if (want.includes('/')) return null;
		const lower = want.toLowerCase();
		const same = sorted.find((f) => f.toLowerCase() === `${dir}${lower}`.toLowerCase());
		if (same) return same;
		return sorted.find((f) => f.slice(f.lastIndexOf('/') + 1).toLowerCase() === lower || f.slice(f.lastIndexOf('/') + 1).toLowerCase() === `${lower}.md`) ?? null;
	};
}

export type VectorInput =
	| { op: 'export'; notes: NoteInput[]; files?: string[]; tag?: string; mode?: DeckMode; parentName?: string }
	| { op: 'parse'; text: string; tag?: string }
	| { op: 'archivePath'; folder: string; name: string; existing: string[] }
	| { op: 'ednString'; text: string }
	| { op: 'normalizeTag'; tag: string }
	| { op: 'presets'; text: string };

export function evaluateCase(input: VectorInput): unknown {
	switch (input.op) {
		case 'export': {
			const plan = planExport(input.notes, listResolver(input.files ?? []), { tag: input.tag, mode: input.mode, parentName: input.parentName });
			return {
				edn: plan.edn,
				cardCount: plan.cardCount,
				decks: plan.deckData.map((d) => ({ id: d.id, name: d.name, ...(d.parentId ? { parentId: d.parentId } : {}), cards: d.cards })),
				media: plan.media,
				missing: plan.missing,
				warnings: plan.warnings,
			};
		}
		case 'parse':
			return parseCards(input.text, input.tag);
		case 'archivePath':
			return archivePath(input.folder, input.name, (p) => input.existing.includes(p));
		case 'ednString':
			return ednString(input.text);
		case 'normalizeTag':
			return normalizeTag(input.tag);
		case 'presets':
			return parsePresets(input.text);
	}
}
