// Asciidoctor.js wrapper. The library (about 1 MB) is evaluated on the first render, not when the app starts.
// Safe mode "safe": no file system access, no include from disk, no URI read. esbuild.config.mjs also removes the two
// synchronous XMLHttpRequest readers and the string eval path from the bundled library (see stubAsciidoctor there).
import type { Asciidoctor } from '@asciidoctor/core';
import { prepareMermaid } from './adoc/mermaid';

export interface ConvertInput {
	text: string;
	/** Vault path of the document (docname and messages). */
	path: string;
	/** "preview": xrefs to other documents end in .adoc so a click opens the file. "export": they end in .html. */
	target: 'preview' | 'export';
}

export interface ConvertOutput {
	html: string;
	title: string | null;
	lang: string | null;
	warnings: string[];
}

let processor: Asciidoctor | null = null;

async function load(): Promise<Asciidoctor> {
	if (!processor) {
		const mod = await import('@asciidoctor/core');
		processor = mod.default();
	}
	return processor;
}

function stem(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Converts AsciiDoc to embeddable HTML (no head, no scripts from Asciidoctor). Passthrough HTML of the document is
 * in the result as it is, so each caller sanitizes it: the preview with the app, the export with adoc/sanitize.
 */
export async function convert(input: ConvertInput): Promise<ConvertOutput> {
	const p = await load();
	// A fresh memory logger per document: warnings go under the preview, not to the developer console.
	const log = p.MemoryLogger.create();
	p.LoggerManager.setLogger(log);
	const attributes: Record<string, string | boolean> = {
		showtitle: '',
		'attribute-missing': 'warn',
		docname: stem(input.path),
		relfilesuffix: input.target === 'preview' ? '.adoc' : '.html',
		'icons!': '',
		'source-highlighter!': '',
		'data-uri!': '',
		'allow-uri-read!': '',
		'webfonts!': '',
	};
	const doc = p.load(prepareMermaid(input.text), { safe: 'safe', standalone: false, attributes });
	const html = doc.convert();
	const title = doc.getDocumentTitle({ sanitize: true }) as string | undefined;
	const lang = doc.getAttribute('lang') as string | undefined;
	const warnings = log.getMessages().map((m) => `${m.getSeverity()}: ${String(m.getText())}`);
	return { html: typeof html === 'string' ? html : '', title: title ?? null, lang: lang ?? null, warnings };
}
