// Tool search on the home page. Ranks the tool cards already on the page with TF-IDF, so it works
// offline, in every language, and nothing typed ever leaves the device.

export interface Doc {
  /** Words that matter most: the tool's name in the page language and in English. */
  name: string;
  /** Everything else worth matching: summary, slug, file extensions. */
  text: string;
}

// Everyday words people type that the tool names don't use.
const SYNONYMS: Record<string, string> = {
  join: 'merge',
  combine: 'merge',
  cut: 'split',
  trim: 'split',
  shrink: 'compress',
  reduce: 'compress',
  smaller: 'compress',
  size: 'compress',
  kb: 'compress',
  mb: 'compress',
  photo: 'image',
  picture: 'image',
  jpeg: 'jpg',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  sheet: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  slides: 'powerpoint',
  song: 'audio',
  music: 'audio',
  sound: 'audio',
  hide: 'redact',
  blackout: 'redact',
  scan: 'scanned',
  password: 'protect',
  lock: 'protect',
  remove: 'delete',
};

export const tokens = (text: string) => text.toLowerCase().normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

const NAME_WEIGHT = 3;

/** Whether the query words appear side by side in this order, so "pdf to word" beats "word to pdf". */
const inOrder = (list: string[], words: string[][]) =>
  words.length > 1 &&
  list.some((_, start) => words.every((forms, k) => forms.some((f) => list[start + k]?.startsWith(f))));

/**
 * Indexes of the docs that best match the query, best first. A query word matches a doc word it
 * starts (so "comp" finds "compress"); rare words count more than common ones, and a match in the
 * name counts more than one in the text. Docs matching every query word come before partial ones,
 * and among those, docs with the words in the typed order come first.
 */
export function rank(query: string, docs: Doc[], limit = 8): number[] {
  const words = [...new Set(tokens(query))].map((w) => [w, SYNONYMS[w]].filter(Boolean) as string[]);
  if (!words.length) return [];
  const indexed = docs.map((d) => ({ name: tokens(d.name), text: tokens(d.text) }));
  const matches = (list: string[], forms: string[]) => list.filter((w) => forms.some((f) => w.startsWith(f))).length;
  const scored = indexed.map((doc, i) => {
    let score = 0;
    let hit = 0;
    for (const forms of words) {
      const found = indexed.filter((d) => matches(d.name, forms) + matches(d.text, forms) > 0).length;
      if (!found) continue;
      const tf = NAME_WEIGHT * matches(doc.name, forms) + matches(doc.text, forms);
      if (!tf) continue;
      hit++;
      score += (1 + Math.log(tf)) * Math.log(1 + docs.length / found);
    }
    const all = hit === words.length;
    return { i, score: score + (all ? 1000 : 0) + (all && (inOrder(doc.name, words) || inOrder(doc.text, words)) ? 500 : 0), hit };
  });
  return scored
    .filter((s) => s.hit)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.i);
}

export function setUpSearch() {
  const input = document.querySelector<HTMLInputElement>('#tool-search');
  const list = document.querySelector<HTMLUListElement>('#tool-results');
  const status = document.querySelector<HTMLElement>('#tool-search-status');
  if (!input || !list || !status) return;
  const cards = [...document.querySelectorAll<HTMLAnchorElement>('.tool-grid .tool-card')];
  const docs = cards.map((card) => ({
    name: `${card.querySelector('strong')?.textContent ?? ''} ${card.dataset.name ?? ''}`,
    text: `${card.querySelector('span:last-child')?.textContent ?? ''} ${card.dataset.k ?? ''}`,
  }));
  let active = -1;

  const links = () => [...list.querySelectorAll<HTMLAnchorElement>('a')];
  const highlight = (next: number) => {
    const all = links();
    active = all.length ? (next + all.length) % all.length : -1;
    all.forEach((a, i) => a.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) input.setAttribute('aria-activedescendant', all[active].id);
    else input.removeAttribute('aria-activedescendant');
    all[active]?.scrollIntoView({ block: 'nearest' });
  };

  const show = () => {
    const query = input.value.trim();
    const found = rank(query, docs);
    list.replaceChildren(
      ...found.map((index, n) => {
        const card = cards[index];
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.id = `tool-result-${n}`;
        a.href = card.href;
        a.className = card.className.replace('tool-card', 'tool-result');
        a.setAttribute('role', 'option');
        a.append(card.querySelector('.tool-icon')!.cloneNode(true), card.querySelector('strong')!.cloneNode(true));
        li.append(a);
        return li;
      }),
    );
    list.hidden = !found.length;
    input.setAttribute('aria-expanded', String(!!found.length));
    status.textContent = query ? (found.length ? (status.dataset.count ?? '').replace('{n}', String(found.length)) : (status.dataset.none ?? '')) : '';
    status.classList.toggle('none', !!query && !found.length); // the count is for screen readers only
    highlight(0);
  };

  input.addEventListener('input', show);
  input.addEventListener('focus', () => {
    if (input.value.trim()) show();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      const target = links()[Math.max(active, 0)];
      if (target) {
        event.preventDefault();
        location.href = target.href;
      }
    } else if (event.key === 'Escape') {
      input.value = '';
      show();
    }
  });
  // Close the list when focus leaves the search box and its results.
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target as Element).closest('.tool-search')) list.hidden = true;
  });
}
