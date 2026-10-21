// Allow-list HTML sanitizer for the export and the copy (pure, no DOM, so the tests run the code that ships).
// Asciidoctor safe mode does not clean passthrough HTML (`++++` blocks, pass:[]), so the converter output can hold
// any markup that the document holds. The preview goes through the sanitizer of the app; an exported file and the
// clipboard leave the app, so they get this one.
//
// The output is built from three things only: text with every stray "<" escaped, tags whose name is in an allow
// list, and attributes whose name is in an allow list with an escaped value. No comment, doctype, raw text element
// (script, style, textarea and so on) or SVG is written. So the result does not depend on how close this tokenizer is
// to a browser parser: a difference can change how broken markup looks, but it cannot make an element or an attribute
// that is not on the lists. Well-formed Asciidoctor output passes through byte for byte.

const words = (s: string): Set<string> => new Set(s.split(' '));

/** Elements without an end tag. */
const VOID = words('br col hr img input source track wbr');
/** HTML elements that stay. */
const HTML_TAGS = words(
	'a abbr address article aside audio b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em ' +
		'figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img input ins kbd li main mark nav ol p pre q rp rt ruby s samp ' +
		'section small source span strong sub summary sup table tbody td tfoot th thead time tr track u ul var video wbr',
);
/** Presentation MathML elements that stay (no annotation, no glyph). */
const MATH_TAGS = words(
	'math menclose merror mfrac mi mmultiscripts mn mo mover mpadded mphantom mprescripts mroot mrow ms mspace msqrt mstyle ' +
		'msub msubsup msup mtable mtd mtext mtr munder munderover semantics',
);
/** Elements that go away with everything inside them. Each other unknown element loses its tags and keeps its text. */
const DROP = words('annotation annotation-xml datalist iframe noembed noframes noscript script select style svg template textarea title xmp');

const GLOBAL_ATTRS = words('class dir id lang role title');
const MATH_ATTRS = words('accent accentunder columnalign columnspan display displaystyle fence linethickness lspace mathvariant rowalign rowspan rspace scriptlevel separator stretchy');
const MEDIA_ATTRS = 'src width height controls loop autoplay muted preload';
const CELL_ATTRS = 'colspan rowspan scope headers align valign';
const TAG_ATTRS: Record<string, Set<string>> = {
	a: words('href target rel'),
	img: words('src alt width height loading'),
	video: words(`${MEDIA_ATTRS} poster playsinline`),
	audio: words(MEDIA_ATTRS),
	source: words('src type'),
	track: words('src kind srclang label default'),
	table: words('width'),
	col: words('span width'),
	colgroup: words('span width'),
	td: words(CELL_ATTRS),
	th: words(CELL_ATTRS),
	ol: words('start type reversed'),
	li: words('value'),
	blockquote: words('cite'),
	q: words('cite'),
	del: words('cite datetime'),
	ins: words('cite datetime'),
	time: words('datetime'),
	details: words('open'),
	input: words('type checked disabled data-item-complete'),
	code: words('data-lang'),
	i: words('data-value'),
	b: words('data-value'),
};
const URL_ATTRS = words('href src poster cite');
const URL_SCHEMES = words('http https mailto tel ftp ftps irc file');
const DATA_IMAGE = /^data:image\/(?:png|gif|jpeg|webp|avif|bmp);base64,[a-z0-9+/=]*$/i;
/** Inline style: these properties, and a value without a bracket, a quote, a colon, a slash or an escape (so no url()). */
const STYLE_PROPS = words(
	'background-color break-after break-before color float font-style font-weight height max-width min-width page-break-after page-break-before ' +
		'text-align text-decoration vertical-align white-space width',
);
const STYLE_VALUE = /^[a-z0-9 .%#,+-]+$/i;
/** Named character references that matter for a URL scheme. Each other name stays as it is. */
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', sol: '/' };

const TAG_NAME = /<(\/?)([a-zA-Z][^\s/>]*)/y;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const ENTITY = /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]{1,31}));?/gi;

/** What a browser writes for a character reference that names no character. */
const REPLACEMENT = String.fromCodePoint(0xfffd);

function codePoint(n: number): string {
	return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : REPLACEMENT;
}

function decodeEntities(s: string): string {
	return s.replace(ENTITY, (m: string, hex?: string, dec?: string, name?: string) => {
		if (hex) return codePoint(parseInt(hex, 16));
		if (dec) return codePoint(parseInt(dec, 10));
		return NAMED[(name ?? '').toLowerCase()] ?? m;
	});
}

/** Removes white space and control characters. A browser skips some of them inside a URL scheme. */
function compact(s: string): string {
	let out = '';
	for (const ch of s) {
		const c = ch.codePointAt(0) ?? 0;
		if (c > 0x20 && (c < 0x7f || c > 0xa0) && !/\s/.test(ch)) out += ch;
	}
	return out;
}

/** True for a relative address, a fragment, and the schemes of URL_SCHEMES. An image can also be a base64 data image. */
export function isSafeUrl(raw: string, tag: string, attr: string): boolean {
	const v = compact(decodeEntities(raw));
	const head = v.split(/[/?#]/, 1)[0] ?? '';
	const colon = head.indexOf(':');
	// No scheme. A character reference that this file does not decode could still hide one, so that is refused.
	if (colon < 0) return !/&[a-z0-9#]+;/i.test(head);
	const scheme = head.slice(0, colon).toLowerCase();
	if (URL_SCHEMES.has(scheme)) return true;
	return scheme === 'data' && tag === 'img' && attr === 'src' && DATA_IMAGE.test(v);
}

/** Keeps the declarations of an inline style that are on the list. Null when none is left. */
function safeStyle(raw: string): string | null {
	const parts = raw.split(';').map((d) => d.trim()).filter((d) => d !== '');
	const kept = parts.filter((d) => {
		const colon = d.indexOf(':');
		return colon > 0 && STYLE_PROPS.has(d.slice(0, colon).trim().toLowerCase()) && STYLE_VALUE.test(d.slice(colon + 1).trim());
	});
	if (!kept.length) return null;
	return kept.length === parts.length ? raw : `${kept.join('; ')};`;
}

function escapeAttr(s: string): string {
	return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrAllowed(tag: string, name: string): boolean {
	if (GLOBAL_ATTRS.has(name) || /^aria-[a-z]+$/.test(name)) return true;
	if (MATH_TAGS.has(tag)) return MATH_ATTRS.has(name);
	return name === 'style' || (TAG_ATTRS[tag]?.has(name) ?? false);
}

/** The attributes of one start tag that stay, as name and raw value (null for an attribute without a value). */
function keptAttrs(tag: string, source: string): Map<string, string | null> {
	const kept = new Map<string, string | null>();
	for (const m of source.matchAll(ATTR)) {
		const name = (m[1] ?? '').toLowerCase();
		if (kept.has(name) || !attrAllowed(tag, name)) continue;
		let value: string | null = m[2] ?? m[3] ?? m[4] ?? null;
		if (name === 'style') value = safeStyle(value ?? '');
		if (name === 'style' && value === null) continue;
		if (URL_ATTRS.has(name) && !isSafeUrl(value ?? '', tag, name)) continue;
		kept.set(name, value);
	}
	return kept;
}

function startTag(tag: string, attrs: Map<string, string | null>): string {
	let out = `<${tag}`;
	for (const [name, value] of attrs) out += value === null ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
	return `${out}>`;
}

/**
 * Index of the ">" that ends the tag which starts before `from`, or -1. A ">" inside a quoted value does not count.
 * As in a browser, a quote opens a value only when it comes after "=".
 */
function tagEnd(html: string, from: number): number {
	let quote = '';
	let afterEquals = false;
	for (let k = from; k < html.length; k++) {
		const c = html[k] ?? '';
		if (quote) {
			if (c === quote) quote = '';
			continue;
		}
		if (c === '>') return k;
		if (afterEquals && (c === '"' || c === "'")) quote = c;
		if (!/\s/.test(c)) afterEquals = c === '=';
	}
	return -1;
}

/** Index after the end tag of a dropped element, or the end of the text when it has none. */
function afterEndTag(html: string, tag: string, from: number): number {
	const re = new RegExp(`</${tag}[\\s/>]`, 'gi');
	re.lastIndex = from;
	const m = re.exec(html);
	const gt = m ? html.indexOf('>', m.index) : -1;
	return gt < 0 ? html.length : gt + 1;
}

/** A frame can not stay. Its web address stays as a plain link, so a video macro still leads to the video. */
function frameLink(attrSource: string): string {
	let src = '';
	for (const m of attrSource.matchAll(ATTR)) {
		if ((m[1] ?? '').toLowerCase() !== 'src') continue;
		src = m[2] ?? m[3] ?? m[4] ?? '';
		break;
	}
	if (!/^https?:\/\//i.test(compact(decodeEntities(src)))) return '';
	return `<a href="${escapeAttr(src)}">${escapeAttr(src)}</a>`;
}

/** The output so far and the elements that are open in it. */
interface Sink {
	out: string[];
	open: string[];
	/** How many of each element are open, so an end tag without a start tag costs no search. */
	counts: Map<string, number>;
}

function openTag(tag: string, sink: Sink): void {
	sink.open.push(tag);
	sink.counts.set(tag, (sink.counts.get(tag) ?? 0) + 1);
}

function closeLast(sink: Sink): string {
	const tag = sink.open.pop() ?? '';
	sink.counts.set(tag, (sink.counts.get(tag) ?? 1) - 1);
	sink.out.push(`</${tag}>`);
	return tag;
}

/** Closes `tag` and each element that is still open inside it. An end tag without a start tag does nothing. */
function closeTag(tag: string, sink: Sink): void {
	if (!sink.counts.get(tag)) return;
	for (let last = ''; last !== tag && sink.open.length; ) last = closeLast(sink);
}

/** Handles the markup that starts at the "<" at `lt`. Returns the index where the text continues. */
function readMarkup(html: string, lt: number, sink: Sink): number {
	if (html.startsWith('<!--', lt)) {
		const end = html.indexOf('-->', lt + 4);
		return end < 0 ? html.length : end + 3;
	}
	TAG_NAME.lastIndex = lt;
	const m = TAG_NAME.exec(html);
	if (!m) {
		// A doctype, a CDATA section or a processing instruction goes away. Each other "<" is text.
		if (html[lt + 1] !== '!' && html[lt + 1] !== '?') {
			sink.out.push('&lt;');
			return lt + 1;
		}
		const gt = html.indexOf('>', lt);
		return gt < 0 ? html.length : gt + 1;
	}
	const nameEnd = lt + m[0].length;
	const end = tagEnd(html, nameEnd);
	// A tag that never ends takes the rest of the text with it, as it does in a browser.
	if (end < 0) return html.length;
	const tag = (m[2] ?? '').toLowerCase();
	const attrSource = html.slice(nameEnd, end);
	if (m[1]) closeTag(tag, sink);
	else if (DROP.has(tag)) {
		if (tag === 'iframe') sink.out.push(frameLink(attrSource));
		return tag === 'svg' && attrSource.endsWith('/') ? end + 1 : afterEndTag(html, tag, end + 1);
	} else if (HTML_TAGS.has(tag) || MATH_TAGS.has(tag)) {
		const attrs = keptAttrs(tag, attrSource);
		// The only form control that stays is the check box of a task list.
		if (tag === 'input' && compact(decodeEntities(attrs.get('type') ?? '')).toLowerCase() !== 'checkbox') return end + 1;
		sink.out.push(startTag(tag, attrs));
		if (!VOID.has(tag)) openTag(tag, sink);
	}
	return end + 1;
}

/**
 * Returns `html` without scripts, event handlers, unsafe addresses, frames, forms, embedded objects and inline SVG.
 * Headings, tables, lists, code, images, links, anchors, media and MathML stay as they are.
 */
export function sanitizeHtml(html: string): string {
	const sink: Sink = { out: [], open: [], counts: new Map() };
	let i = 0;
	while (i < html.length) {
		const lt = html.indexOf('<', i);
		if (lt < 0) {
			sink.out.push(html.slice(i));
			break;
		}
		sink.out.push(html.slice(i, lt));
		i = readMarkup(html, lt, sink);
	}
	while (sink.open.length) closeLast(sink);
	return sink.out.join('');
}
