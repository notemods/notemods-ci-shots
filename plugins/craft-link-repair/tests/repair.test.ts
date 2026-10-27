import { afterEach, describe, it, expect, vi } from 'vitest';
import { safePath, planRepair, convertMarkdown, reportText } from '../src/repair';

const url = 'craftdocs://open?documentId=page';
const link = `[Page](${url})`;
const map = new Map([['page', 'Export/Page.repaired']]);
afterEach(() => vi.unstubAllGlobals());

describe('path protection', () => {
	for (const path of ['../Export', 'Export/../Other', '/Export', 'C:\\Export', '.obsidian', 'Export/.git', 'Export/./Note', 'Export\u0000']) it(`rejects ${JSON.stringify(path)}`, () => expect(() => safePath(path)).toThrow());
	it('normalizes slashes', () => expect(safePath(' Export\\Folder// ')).toBe('Export/Folder'));
	it('rejects overlapping output roots', () => {
		for (const output of ['Export', 'Export/Copies', 'Root']) expect(() => planRepair([], { folder: output === 'Root' ? 'Root/Export' : 'Export', pro: true, outputFolder: output })).toThrow('separate');
	});
});
describe('Markdown protection', () => {
	it('resolves Craft routes when URL.hostname is empty in Chromium 120', () => {
		vi.stubGlobal('URL', class OpaqueUrl {
			protocol = 'craftdocs:';
			hostname = '';
			pathname = '//open';
			hash = '';
			searchParams = new URLSearchParams('documentId=page');
		});
		expect(convertMarkdown(link, 'Export/Note.md', 'Export/Note.repaired.md', map).text).toBe('[[Export/Page.repaired|Page]]');
	});
	it('repairs links outside fenced code only', () => {
		const text = `${link}\n\n\`\`\`md\n${link}\n\`\`\`\n${link}`;
		const out = convertMarkdown(text, 'Export/Note.md', 'Export/Note.repaired.md', map);
		expect(out.text).toBe(`[[Export/Page.repaired|Page]]\n\n\`\`\`md\n${link}\n\`\`\`\n[[Export/Page.repaired|Page]]`);
		expect(out.changes).toHaveLength(2);
	});
	it('keeps unclosed fences intact', () => {
		const text = '```md\n'+link+'\n';
		expect(convertMarkdown(text, 'Export/Note.md', 'Export/Note.repaired.md', map).text).toBe(text);
	});
	it('keeps CRLF code fences intact', () => {
		const text = '```md\r\n'+link+'\r\n```\r\n';
		expect(convertMarkdown(text, 'Export/Note.md', 'Export/Note.repaired.md', map).text).toBe(text);
	});
	it('keeps CRLF around links', () => {
		expect(convertMarkdown(`Title\r\n${link}\r\n`, 'Export/Note.md', 'Export/Note.repaired.md', map).text).toBe('Title\r\n[[Export/Page.repaired|Page]]\r\n');
	});
	it('keeps an escaped Markdown link intact', () => {
		const text = '\\'+link;
		expect(convertMarkdown(text, 'Export/Note.md', 'Export/Note.repaired.md', map).text).toBe(text);
	});
	it('keeps an empty Markdown destination intact in Pro output', () => {
		expect(convertMarkdown('[]()', 'Export/Note.md', 'Copies/Note.md', map).text).toBe('[]()');
	});
	it('preserves unhandled reference and HTML syntax', () => {
		const text = `[Page][id]\n[id]: ${url}\n<a href="${url}">Page</a>`;
		expect(convertMarkdown(text, 'a', 'a', map).text).toBe(text);
	});
	it('reports missing urls without inventing links', () => {
		const plan = planRepair([{ path: 'Export/Page.md', text: link }], { folder: 'Export' });
		const report = reportText(plan, ['Export/Page.repaired.md'], ['disk failure']);
		expect(report).toContain(url);
		expect(report).toContain('disk failure');
		expect(report).toContain('Copies written: 1');
	});
	it('retains code in a large input', () => {
		const text = ('```md\n'+link+'\n```\n').repeat(2000);
		expect(convertMarkdown(text, 'Export/Page.md', 'Export/Page.repaired.md', map).text).toBe(text);
	}, 30000);
});
