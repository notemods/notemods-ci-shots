// A small EDN reader for the tests: maps, vectors, keywords, strings, numbers, true, false and nil.
export type Edn = string | number | boolean | null | { kw: string } | Edn[] | Map<string, Edn>;

export function readEdn(src: string): Edn {
	let i = 0;
	const ws = () => {
		while (i < src.length && /[\s,]/.test(src[i]!)) i++;
	};
	const value = (): Edn => {
		ws();
		const c = src[i];
		if (c === '{') {
			i++;
			const m = new Map<string, Edn>();
			for (;;) {
				ws();
				if (src[i] === '}') {
					i++;
					return m;
				}
				const k = value() as { kw: string };
				m.set(k.kw, value());
			}
		}
		if (c === '[') {
			i++;
			const a: Edn[] = [];
			for (;;) {
				ws();
				if (src[i] === ']') {
					i++;
					return a;
				}
				a.push(value());
			}
		}
		if (c === '"') {
			i++;
			let s = '';
			while (src[i] !== '"') {
				if (i >= src.length) throw new Error('open string');
				if (src[i] === '\\') {
					const e = src[i + 1]!;
					if (e === 'u') {
						s += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
						i += 6;
						continue;
					}
					s += ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' } as Record<string, string>)[e] ?? '';
					i += 2;
					continue;
				}
				s += src[i++];
			}
			i++;
			return s;
		}
		const m = /^[^\s,{}[\]"]+/.exec(src.slice(i));
		if (!m) throw new Error(`bad EDN at ${i}`);
		i += m[0].length;
		const t = m[0];
		if (t.startsWith(':')) return { kw: t.slice(1) };
		if (t === 'true' || t === 'false') return t === 'true';
		if (t === 'nil') return null;
		if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
		throw new Error(`bad token ${t}`);
	};
	const v = value();
	ws();
	if (i !== src.length) throw new Error('trailing text');
	return v;
}
