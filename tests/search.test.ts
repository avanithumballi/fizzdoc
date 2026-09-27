import { describe, expect, it } from 'vitest';
import { rank, type Doc } from '../src/search';
import { FORMATS, TOOLS } from '../src/site';

// The same fields the home page puts on each tool card.
const docs: Doc[] = TOOLS.map((t) => ({
  name: t.name,
  text: [t.summary, t.slug.replaceAll('-', ' '), FORMATS[t.format].label, FORMATS[t.format].ext, t.input?.accept ?? ''].join(' '),
}));
const top = (query: string) => rank(query, docs).map((i) => TOOLS[i].slug);

describe('tool search', () => {
  it('puts the obvious tool first', () => {
    expect(top('merge pdf')[0]).toBe('merge-pdf');
    expect(top('compress pdf')[0]).toBe('compress-pdf');
    expect(top('split audio')[0]).toBe('split-audio');
    expect(top('redact')[0]).toBe('redact-pdf');
  });

  it('matches word starts and everyday synonyms', () => {
    expect(top('comp')).toContain('compress-pdf');
    expect(top('join mp3')[0]).toBe('merge-audio');
    expect(top('shrink photo 50kb')[0]).toBe('compress-image-to-50kb');
    expect(top('trim song')[0]).toBe('split-audio');
  });

  it('returns nothing for empty or unknown queries and respects the limit', () => {
    expect(top('')).toEqual([]);
    expect(top('  ,, ')).toEqual([]);
    expect(top('zzqx')).toEqual([]);
    expect(rank('pdf', docs, 3)).toHaveLength(3);
  });

  it('finds tools by their translated name', () => {
    expect(rank('मर्ज', [{ name: 'PDF मर्ज करें', text: '' }, { name: 'PDF विभाजित करें', text: '' }])).toEqual([0]);
  });
});

describe('tool search word order', () => {
  it('prefers the direction the words were typed in', () => {
    expect(top('pdf to word')[0]).toBe('pdf-to-word');
    expect(top('word to pdf')[0]).toBe('word-to-pdf');
    expect(top('jpg to pdf')[0]).toBe('jpg-to-pdf');
  });
});
