/** Patch keyed elements in place so updates retain scroll, focus and native controls. */
export function patchChildren(target: HTMLElement, source: HTMLElement): void {
 const key = (node: Node): string | null => node.instanceOf(HTMLElement) ? node.dataset.node ?? node.dataset.group ?? null : null;
 const previous = Array.from(target.childNodes);
 const used = new Set<Node>();
 for (const fresh of Array.from(source.childNodes)) {
  const id = key(fresh);
  const old = previous.find((node) => !used.has(node) && node.nodeName === fresh.nodeName && (id ? key(node) === id : key(node) === null));
  const node = old ?? fresh;
  used.add(node);
  const index = used.size - 1;
  if (target.childNodes[index] !== node) target.insertBefore(node, target.childNodes[index] ?? null);
  if (old?.instanceOf(HTMLElement) && fresh.instanceOf(HTMLElement)) {
   for (const attr of Array.from(old.attributes)) if (!fresh.hasAttribute(attr.name)) old.removeAttribute(attr.name);
   for (const attr of Array.from(fresh.attributes)) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
   patchChildren(old, fresh);
  } else if (old && old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue;
 }
 for (const node of previous) if (!used.has(node)) node.remove();
}
