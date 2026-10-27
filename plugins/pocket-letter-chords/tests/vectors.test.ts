import { describe, expect, it } from 'vitest';
import vectors from './vectors/pocket-letter-chords.json';
import { ChordEngine, type Binding } from '../src/chords';
function run(bindings: Binding[], events: unknown[][]): string {
 let text = '', second = '', onB = false, paused = false, composing = false;
 const history: string[] = [];
 const insert = (s: string) => { history.push(text); if (onB) second += s; else text += s; };
 let engine = new ChordEngine(bindings, insert);
 for (const event of events) {
  const [op, key, now, repeat] = event;
  if (op === 'down') { if (!composing && (paused || !engine.down(String(key), Number(now), repeat === true))) insert(String(key)); }
  if (op === 'up') engine.up(String(key));
  if (op === 'tick') engine.tick(Number(key));
  if (op === 'select') { text = String(key); engine = new ChordEngine(bindings, s => { history.push(text); text = s; }); }
  if (op === 'undo') text = history.pop() ?? text;
  if (op === 'native') { engine.reset(); insert(String(key)); }
  if (op === 'composition') { engine.reset(); composing = key === true; }
  if (op === 'modified' || op === 'reset') engine.reset();
  if (op === 'focus') { engine.reset(); onB = true; }
  if (op === 'pause') { engine.reset(); paused = key === true; }
  if (op === 'reload') { engine.reset(); engine = new ChordEngine(bindings, insert); }
 }
 engine.flush();
 return onB ? text + '|' + second : text;
}
describe('acceptance vectors', () => {
 it('has at least 20 cases', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
 for (const c of vectors.cases) it(c.name, () => {
  const [bindings, events] = c.args as [Binding[], unknown[][]];
  expect(run(bindings, events)).toBe(c.expected);
 });
});
