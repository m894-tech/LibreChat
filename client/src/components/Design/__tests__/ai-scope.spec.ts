import { resolveAIScope } from '../ai-scope';
const doc: any = {
  payload: {
    nodes: [
      { id: 'root', type: 'group', parentId: null },
      { id: 'child', type: 'text', parentId: 'root' },
      { id: 'other', type: 'text', parentId: null },
    ],
  },
};
it('scope expands only when user selects group or document', () => {
  expect(resolveAIScope(doc, 'child', 'element')).toEqual(['child']);
  expect(resolveAIScope(doc, 'child', 'group')).toEqual(['root', 'child']);
  expect(resolveAIScope(doc, null, 'document')).toEqual(['root', 'child', 'other']);
  expect(resolveAIScope(doc, 'other', 'group')).toEqual([]);
});
