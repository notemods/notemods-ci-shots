import { FONT_BASE64 } from './font';

/** Read the tables of the bundled, static Noto Sans TrueType font.
 * Table fields follow the OpenType cmap, head, hhea and hmtx specifications.
 * https://learn.microsoft.com/en-us/typography/opentype/spec/cmap
 */
export class TrueTypeFont {
 readonly bytes: Uint8Array;
 readonly unitsPerEm: number;
 readonly ascent: number;
 readonly descent: number;
 readonly capHeight: number;
 readonly bbox: number[];
 private readonly view: DataView;
 private readonly glyphs = new Map<number, number>();
 private readonly metrics: number;
 private readonly hmtx: number;
 constructor(bytes: Uint8Array) {
  this.bytes = bytes;
  this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < this.u16(4); i++) {
   const row = 12 + i * 16;
   const tag = String.fromCharCode(...bytes.slice(row, row + 4));
   const offset = this.view.getUint32(row + 8); const length = this.view.getUint32(row + 12);
   if (offset + length > bytes.length) throw new Error('The bundled font has an invalid table.');
   tables.set(tag, { offset, length });
  }
  const table = (name: string) => { const entry = tables.get(name); if (!entry) throw new Error(`The bundled font has no ${name} table.`); return entry.offset; };
  const head = table('head'); const hhea = table('hhea');
  this.unitsPerEm = this.u16(head + 18);
  if (!this.unitsPerEm) throw new Error('The bundled font has invalid units.');
  this.ascent = this.view.getInt16(hhea + 4); this.descent = this.view.getInt16(hhea + 6);
  this.bbox = [36, 38, 40, 42].map((n) => this.view.getInt16(head + n));
  const os2 = tables.get('OS/2');
  this.capHeight = os2 && os2.length >= 90 && this.u16(os2.offset) >= 2 ? this.view.getInt16(os2.offset + 88) : this.ascent;
  this.metrics = this.u16(hhea + 34); this.hmtx = table('hmtx');
  const glyphCount = this.u16(table('maxp') + 4);
  if (!this.metrics || this.metrics > glyphCount) throw new Error('The bundled font has invalid metrics.');
  const cmap = table('cmap'); let unicode = -1;
  for (let i = 0; i < this.u16(cmap + 2); i++) {
   const record = cmap + 4 + i * 8;
   const platform = this.u16(record); const encoding = this.u16(record + 2);
   const offset = cmap + this.view.getUint32(record + 4);
   if ((platform === 0 || (platform === 3 && encoding === 1)) && this.u16(offset) === 4) { unicode = offset; break; }
  }
  if (unicode < 0) throw new Error('The bundled font has no format 4 Unicode map.');
  const count = this.u16(unicode + 6) / 2;
  const endCodes = unicode + 14;
  const startCodes = endCodes + count * 2 + 2;
  const deltas = startCodes + count * 2;
  const ranges = deltas + count * 2;
  for (let i = 0; i < count; i++) {
   const start = this.u16(startCodes + 2 * i); const end = this.u16(endCodes + 2 * i);
   const delta = this.view.getInt16(deltas + 2 * i); const range = this.u16(ranges + 2 * i);
   for (let code = start; code <= end && code < 0xffff; code++) {
    let glyph = range ? this.u16(ranges + 2 * i + range + 2 * (code - start)) : code;
    if (!range || glyph !== 0) glyph = (glyph + delta) & 0xffff;
    if (glyph > 0 && glyph < glyphCount) this.glyphs.set(code, glyph);
   }
  }
 }
 private u16(offset: number): number { return this.view.getUint16(offset); }
 glyphId(char: string): number { return this.glyphs.get(char.codePointAt(0)!) ?? 0; }
 advance(glyph: number): number { return this.u16(this.hmtx + 4 * Math.min(glyph, this.metrics - 1)); }
 width(text: string, size: number): number { let width = 0; for (const char of text) width += this.advance(this.glyphId(char)); return width * size / this.unitsPerEm; }
}
let font: TrueTypeFont | null = null;
export function bundledFont(): TrueTypeFont { font ??= new TrueTypeFont(Uint8Array.from(atob(FONT_BASE64), (c) => c.charCodeAt(0))); return font; }
