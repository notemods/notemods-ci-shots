import { expect, it } from 'vitest';
import { validHeadingRange } from '../src/store';
it('accepts a section and its child heading through the next peer',()=>{
 const text='# Scope\nblue bird\n## Child\nchild body\n# Other\nred fox';
 expect(validHeadingRange(text,0,text.indexOf('# Other'),'Scope',1)).toBe(true);
});
it('rejects a stale heading end after an edit before the next peer',()=>{
 const before='# Scope\nblue bird\n# Other\nred fox';const after=before.replace('blue bird','blue bird near the river');
 expect(validHeadingRange(after,0,before.indexOf('# Other'),'Scope',1)).toBe(false);
});
it('rejects a stale range that used to end at the file end',()=>{
 const text='# Scope\nblue bird\n# Other\nred fox';
 expect(validHeadingRange(text,0,text.length,'Scope',1)).toBe(false);
});
it('ignores fenced heading examples when validating the section',()=>{
 const text='# Scope\n```md\n# Example\n```\nblue bird';expect(validHeadingRange(text,0,text.length,'Scope',1)).toBe(true);
});
