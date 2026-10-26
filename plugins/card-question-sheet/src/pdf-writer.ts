import type { TrueTypeFont } from './truetype';
import type { PageSettings, SheetPage } from './pdf';

/** PDF 1.7 with an embedded TrueType font, CID map and selectable Unicode text.
 * No compression, code generation or network transport is required.
 * ISO 32000-1 sections 7.5, 9.7 and 9.10 define these objects.
 */
export function writePdf(pages: SheetPage[], settings: PageSettings, font: TrueTypeFont): Uint8Array {
 const ascii = (text: string) => new TextEncoder().encode(text);
 const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
 };
 const objects: Uint8Array[] = [];
 const reserve = () => { objects.push(new Uint8Array()); return objects.length; };
 const set = (id: number, text: string) => { objects[id - 1] = ascii(text); };
 const stream = (id: number, data: Uint8Array, extra = '') => { objects[id - 1] = join([ascii(`<< /Length ${data.length} ${extra} >>\nstream\n`), data, ascii('\nendstream')]); };
 const catalog = reserve(); const pageTree = reserve(); const type0 = reserve(); const cidFont = reserve(); const descriptor = reserve(); const fontFile = reserve(); const cidMap = reserve(); const toUnicode = reserve();
 const chars = [...new Set([...'QuestionsAnswer keyPage 0123456789', ...pages.flatMap((p) => p.lines.flatMap((l) => [...l.text]))])];
 if (chars.length > 65534) throw new Error('The PDF has too many distinct characters.');
 const cids = new Map(chars.map((c, i) => [c, i + 1]));
 const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
 const unicodeHex = (c: string) => { let value = ''; for (let i = 0; i < c.length; i++) value += hex(c.charCodeAt(i)); return value; };
 const glyphMap = new Uint8Array((chars.length + 1) * 2);
 const mapView = new DataView(glyphMap.buffer);
 const widths: number[] = [];
 chars.forEach((char, i) => {
  const gid = font.glyphId(char); if (!gid) throw new Error(`The bundled font has no glyph for ${char}.`);
  mapView.setUint16((i + 1) * 2, gid);
  widths.push(Number((font.advance(gid) * 1000 / font.unitsPerEm).toFixed(4)));
 });
 stream(fontFile, font.bytes, `/Length1 ${font.bytes.length}`); stream(cidMap, glyphMap);
 const mapLines = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /NotoSansUnicode def', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
 for (let start = 0; start < chars.length; start += 100) {
  const group = chars.slice(start, start + 100); mapLines.push(`${group.length} beginbfchar`);
  group.forEach((char, i) => { mapLines.push(`<${hex(start + i + 1)}> <${unicodeHex(char)}>`); }); mapLines.push('endbfchar');
 }
 mapLines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'); stream(toUnicode, ascii(mapLines.join('\n')));
 const scale = (n: number) => Number((n * 1000 / font.unitsPerEm).toFixed(4));
 set(descriptor, `<< /Type /FontDescriptor /FontName /NotoSans-Regular /Flags 4 /FontBBox [${font.bbox.map(scale).join(' ')}] /ItalicAngle 0 /Ascent ${scale(font.ascent)} /Descent ${scale(font.descent)} /CapHeight ${scale(font.capHeight)} /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
 set(cidFont, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSans-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${cidMap} 0 R /DW 1000 /W [1 [${widths.join(' ')}]] >>`);
 set(type0, `<< /Type /Font /Subtype /Type0 /BaseFont /NotoSans-Regular /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
 const pageIds: number[] = [];
 pages.forEach((page, index) => {
  const pageId = reserve(); const content = reserve(); pageIds.push(pageId);
  const text = (value: string, y: number, size = settings.textSize) => {
   const encoded = [...value].map((c) => hex(cids.get(c)!)).join('');
   return `BT /F1 ${size} Tf 1 0 0 1 ${settings.margin} ${y} Tm <${encoded}> Tj ET`;
  };
  const commands = [text(page.kind === 'questions' ? 'Questions' : 'Answer key', 841.89 - settings.margin - settings.textSize)];
  for (const line of page.lines) commands.push(text(line.text, line.y));
  commands.push(text(`Page ${index + 1}`, settings.margin / 2, 8));
  stream(content, ascii(commands.join('\n')));
  set(pageId, `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${type0} 0 R >> >> /Contents ${content} 0 R >>`);
 });
 set(pageTree, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`); set(catalog, `<< /Type /Catalog /Pages ${pageTree} 0 R >>`);
 const parts = [ascii('%PDF-1.7\n'), new Uint8Array([37, 226, 227, 207, 211, 10])];
 let offset = parts.reduce((sum, p) => sum + p.length, 0); const offsets = [0];
 objects.forEach((object, i) => {
  const data = join([ascii(`${i + 1} 0 obj\n`), object, ascii('\nendobj\n')]);
  offsets.push(offset); parts.push(data); offset += data.length;
 });
 const xref = offsets.slice(1).map((n) => n.toString().padStart(10, '0') + ' 00000 n ').join('\n');
 parts.push(ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
 return join(parts);
}
