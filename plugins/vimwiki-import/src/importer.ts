export interface Source { path: string; text: string }
export interface Options { source: string; destination: string; diary?: string }
export interface Issue { source: string; target: string; reason: string }
export interface Page extends Source { output: string; markdown: string }
export interface Plan { options: Options; pages: Page[]; issues: Issue[] }

/** Resolve dot segments without a filesystem API. Refuse paths above the vault. */
export function cleanPath(value: string): string {
	const parts: string[] = [];
	for (const part of value.replace(/\\/g, '/').normalize().split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') { if (!parts.length) throw new Error('Path leaves the vault.'); parts.pop(); }
		else { if ([...part].some(c => c.charCodeAt(0) < 32) || /[:*?"<>|#^]/.test(part)) throw new Error('Path has an unsupported character.'); parts.push(part); }
	}
	return parts.join('/');
}
export function validDiary(name: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return false;
	const d = new Date(`${name}T00:00:00Z`);
	return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === name;
}
export function planImport(files: Source[], input: Options): Plan {
	const options: Options = { source: cleanPath(input.source), destination: cleanPath(input.destination), ...(input.diary ? { diary: cleanPath(input.diary) } : {}) };
	if (!options.source || !options.destination || options.destination === options.source || options.destination.startsWith(`${options.source}/`) || options.source.startsWith(`${options.destination}/`)) throw new Error('Use separate source and destination folders.');
	if (options.diary && (options.diary === options.source || options.diary.startsWith(`${options.source}/`) || options.source.startsWith(`${options.diary}/`))) throw new Error('Daily-note folder overlaps the source.');
	const selected = files.filter(f => f.path.startsWith(`${options.source}/`) && f.path.endsWith('.wiki')).sort((a,b) => a.path.localeCompare(b.path));
	const map = new Map<string, string>();
	const outputs = new Set<string>();
	const issues: Issue[] = [];
	const kept: Source[] = [];
	for (const f of selected) {
		try { cleanPath(f.path); } catch { issues.push({source:f.path,target:f.path,reason:'Unsupported file name; page skipped.'}); continue; }
		const rel = f.path.slice(options.source.length + 1, -5);
		const name = rel.split('/').pop() ?? rel;
		const output = options.diary && rel.startsWith('diary/') && validDiary(name) ? `${options.diary}/${name}.md` : `${options.destination}/${rel}.md`;
		// Case-insensitive file systems cannot hold both; links to a skipped page stay unresolved.
		if (outputs.has(output.toLowerCase())) { issues.push({source:f.path,target:output,reason:'Duplicate output path; page skipped.'}); continue; }
		outputs.add(output.toLowerCase());
		map.set(f.path, output);
		kept.push(f);
	}
	const pages: Page[] = [];
	for (const f of kept) {
		const output = map.get(f.path)!;
		const converted = convert(f, map, options.source);
		issues.push(...converted.issues);
		pages.push({...f,output,markdown:converted.text});
	}
	return { options, pages, issues };
}
function convert(file: Source, map: Map<string,string>, root: string): { text: string; issues: Issue[] } {
	const issues: Issue[] = [];
	const warn = (target: string, reason: string) => issues.push({source:file.path,target,reason});
	let code = false;
	let fenceLength = 3;
	for (const match of file.text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
	const fence = '`'.repeat(fenceLength);
	const text = file.text.replace(/\r\n/g,'\n').split('\n').map(line => {
		const open = code ? null : line.match(/^\s*\{\{\{(.*)$/);
		if (open) {
			code=true;
			const option = open[1]!.trim();
			if (/^[\w+-]+$/.test(option)) return `${fence}${option}`;
			if (option) warn(option,'Code block option dropped; review it.');
			return fence;
		}
		if (/^\s*\}\}\}\s*$/.test(line) && code) {code=false; return fence;}
		if (code) return line;
		const heading = line.match(/^\s*(={1,6})\s+(.+?)\s+\1\s*$/);
		if (heading) line = `${'#'.repeat(heading[1]!.length)} ${heading[2]}`;
		else line = line.replace(/^(\s*)[+*-]\s+/, '$1- ').replace(/^(\s*)(?:#|\d+[.)])\s+/, '$11. ');
		line = line.replace(/^(\s*(?:- |1\. ))\[([^\]])\]/, (_m:string, prefix:string, state:string) => {
			if (state === ' ') return `${prefix}[ ]`;
			if (state === 'X' || state === 'x') return `${prefix}[x]`;
			warn(state,'Unsupported checkbox state retained as text.'); return `${prefix}\\[${state}\\]`;
		});
		if (/\{\{[^{}]+\}\}|^\s*\||^\s*%/.test(line)) warn(line,'Image, table or directive syntax retained; review it.');
		return line.replace(/\[\[([^\]]+)\]\]/g, (original:string, inner:string) => {
			const bar = inner.indexOf('|');
			const target = bar < 0 ? inner : inner.slice(0,bar);
			const label = bar < 0 ? target : inner.slice(bar+1);
			if (/^https?:\/\//i.test(target)) return `[${label.replace(/([\]\\[])/g,'\\$1')}](${target.replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/ /g,'%20')})`;
			if (target.startsWith('\\') || target.startsWith('//')) { warn(target,'Rooted path retained; review it.'); return original; }
			if (/#|:/.test(target)) { warn(target,'Anchor or link scheme retained; review it.'); return original; }
			let resolved: string;
			try {
				const base = target.startsWith('/') ? root : file.path.slice(0,file.path.lastIndexOf('/'));
				resolved=cleanPath(`${base}/${target.replace(/^\/+/, '').replace(/\.wiki$/,'')}.wiki`);
			}
			catch { warn(target,'Unresolved link; target retained.'); return original; }
			const to = map.get(resolved);
			if (!to) { warn(target,'Unresolved link; target retained.'); return original; }
			return `[[${to.slice(0,-3)}|${label}]]`;
		});
	}).join('\n');
	if (code) {warn('{{{','Unclosed code block; closing fence added.'); return {text:`${text}\n${fence}`,issues};}
	return {text,issues};
}

export interface ImportRecord { source: string; destination: string; issues: Issue[] }
export function reportText(title: string, lines: string[], issues: Issue[]): string {
	return `# ${title}\n\n${lines.join('\n')}\n\n## Review\n\n` + (issues.length ? issues.map(i => `- ${JSON.stringify(i.source)} → ${JSON.stringify(i.target)}: ${i.reason}`).join('\n') : 'No conversion warnings.');
}
export function combinedReport(records: ImportRecord[]): string {
	return reportText('Vimwiki unresolved links', ['These are the latest saved import results for each source folder. They are not a new scan.'], records.flatMap(r => r.issues.filter(i => i.reason.startsWith('Unresolved link'))));
}

export function assessPage(before: string, current: string | null, exists: boolean, cancelled = false): string {
	if (cancelled) return 'Cancelled; no write.';
	if (current === null || current !== before) return 'Source changed or missing; page skipped.';
	if (exists) return 'Output conflict; page skipped.';
	return '';
}
