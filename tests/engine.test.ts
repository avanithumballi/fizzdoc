import { readFileSync } from 'node:fs';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parsePages, runJob, type Job, type Qpdf } from '../src/engine/pdf';

type NodeQpdf = Qpdf & { FS: { writeFile(path: string, data: Uint8Array): void } };
const load = () => (createQpdf as unknown as (opts: object) => Promise<NodeQpdf>)({});
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));

/** Runs a job on fixtures; `answers` are handed out one per password prompt (null = dismiss). */
async function run(files: (string | Uint8Array)[], job: Job, answers: (string | null)[] = []) {
  const q = await load();
  files.forEach((file, i) => q.FS.writeFile(`/${i}.pdf`, typeof file === 'string' ? fixture(file) : file));
  const prompts: number[] = [];
  const result = await runJob(
    q,
    files.map((_, i) => `/${i}.pdf`),
    job,
    async (file) => {
      prompts.push(file);
      return answers.shift() ?? null;
    },
  );
  return { ...result, prompts };
}

/** Reads back what a PDF contains, using a fresh qpdf instance. */
async function inspect(bytes: Uint8Array) {
  const q = await load();
  q.FS.writeFile('/x.pdf', bytes);
  expect(q.callMain(['--json=2', '/x.pdf', '/x.json'])).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(q.FS.readFile('/x.json')));
  const objects = json.qpdf[1];
  const pages = json.pages.map((p: { object: string }) => objects[`obj:${p.object}`].value);
  return {
    pages: pages.length,
    bookmarks: json.outlines.length,
    fields: json.acroform.fields.map((f: { fullname: string }) => f.fullname),
    annotations: pages.reduce((n: number, p: Record<string, unknown[]>) => n + (p['/Annots']?.length ?? 0), 0),
    rotations: pages.map((p: Record<string, number>) => p['/Rotate'] ?? 0) as number[],
    encrypted: json.encrypt.encrypted,
  };
}

const code = (promise: Promise<unknown>) => promise.then(() => 'OK', (error) => error.code);

describe('parsePages', () => {
  it('keeps typed order, expands ranges and drops repeats', () => {
    expect(parsePages('1-3, 8', 10)).toEqual([1, 2, 3, 8]);
    expect(parsePages('3,1-2,3', 10)).toEqual([3, 1, 2]);
    expect(parsePages('8-', 10)).toEqual([8, 9, 10]);
    expect(parsePages('2–4', 10)).toEqual([2, 3, 4]);
  });

  it('stops a range at the last page', () => {
    expect(parsePages('1-5', 1)).toEqual([1]);
    expect(parsePages('2-99, 1', 3)).toEqual([2, 3, 1]);
  });

  it('reports the page count with a bad range', () => {
    expect(() => parsePages('4', 3)).toThrow(expect.objectContaining({ code: 'BAD_RANGE', pages: 3 }));
  });

  it.each(['', '0', '5-3', '11', 'a', '1-2-3', ' , '])('rejects %j', (text) => {
    expect(() => parsePages(text, 10)).toThrow('BAD_RANGE');
  });
});

describe('merge', () => {
  it('keeps form fields and links from every file', async () => {
    const result = await run(['text-only', 'form', 'links'], { op: 'merge' });
    const out = await inspect(result.output);
    expect(out.pages).toBe(9);
    expect(result.pageCount).toBe(9);
    expect(out.fields).toEqual(['customer']);
    expect(out.annotations).toBe((await inspect(fixture('form'))).annotations + (await inspect(fixture('links'))).annotations);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the first file bookmarks and reports dropped ones from later files', async () => {
    const primary = await run(['bookmarks', 'text-only'], { op: 'merge' });
    expect((await inspect(primary.output)).bookmarks).toBe(2);
    expect(primary.warnings).toEqual([]);

    const secondary = await run(['text-only', 'bookmarks'], { op: 'merge' });
    expect(secondary.warnings).toEqual(['BOOKMARKS_DROPPED']);
  });

  it('needs at least two files', async () => {
    expect(await code(run(['text-only'], { op: 'merge' }))).toBe('WRONG_FILE_COUNT');
  });
});

describe('split and delete', () => {
  it('extracts pages in the typed order and keeps links', async () => {
    const result = await run(['links'], { op: 'split', pages: '2,1' });
    const out = await inspect(result.output);
    expect(out.pages).toBe(2);
    expect(out.annotations).toBe((await inspect(fixture('links'))).annotations);
  });

  it('reports bookmarks whose page was removed', async () => {
    expect((await run(['bookmarks'], { op: 'split', pages: '2' })).warnings).toEqual(['BOOKMARKS_BROKEN']);
    expect((await run(['bookmarks'], { op: 'split', pages: '1-3' })).warnings).toEqual([]);
  });

  it('deletes the chosen pages and refuses to delete all of them', async () => {
    const result = await run(['mixed'], { op: 'delete', pages: '1' });
    expect((await inspect(result.output)).pages).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(await code(run(['mixed'], { op: 'delete', pages: '1-3' }))).toBe('NO_PAGES_LEFT');
  });

  it('keeps form fields on kept pages and removes those on removed pages', async () => {
    expect((await inspect((await run(['form'], { op: 'split', pages: '1' })).output)).fields).toEqual(['customer']);
    expect((await inspect((await run(['form'], { op: 'delete', pages: '1' })).output)).fields).toEqual([]);
  });

  it('rejects ranges outside the document', async () => {
    expect(await code(run(['mixed'], { op: 'split', pages: '4' }))).toBe('BAD_RANGE');
  });

  it('keeps what exists when a range runs past the last page', async () => {
    const result = await run(['mixed'], { op: 'split', pages: '2-10' });
    expect(result.pageCount).toBe(2);
  });
});

describe('rotate', () => {
  it('rotates only the selected pages, on top of their existing rotation', async () => {
    const before = (await inspect(fixture('mixed'))).rotations;
    const result = await run(['mixed'], { op: 'rotate', angle: 90, pages: '2' });
    expect((await inspect(result.output)).rotations).toEqual(before.map((r, i) => (i === 1 ? (r + 90) % 360 : r)));
  });

  it('keeps bookmarks, form fields and links', async () => {
    for (const name of ['bookmarks', 'form', 'links']) {
      const { rotations, ...before } = await inspect(fixture(name));
      const { rotations: _, ...after } = await inspect((await run([name], { op: 'rotate', angle: 90 })).output);
      expect(after, name).toEqual(before);
    }
  });

  it('rotates every page when no pages are given', async () => {
    const result = await run(['incremental'], { op: 'rotate', angle: 180 });
    const out = await inspect(result.output);
    expect(out.rotations.every((r) => r === 180)).toBe(true);
  });
});

describe('passwords', () => {
  it('prompts until the right password, then writes an unencrypted copy', async () => {
    const result = await run(['user-password'], { op: 'rotate', angle: 90 }, ['wrong', 'test-only']);
    expect(result.prompts).toEqual([0, 0]);
    expect(result.warnings).toEqual(['PASSWORD_REMOVED']);
    expect((await inspect(result.output)).encrypted).toBe(false);
  });

  it('gives up after three wrong passwords, or when the prompt is dismissed', async () => {
    expect(await code(run(['user-password'], { op: 'unlock' }, ['a', 'b', 'c']))).toBe('BAD_PASSWORD');
    expect(await code(run(['user-password'], { op: 'unlock' }, [null]))).toBe('PASSWORD_REQUIRED');
  });

  it('opens owner-only PDFs without a prompt and reports removed restrictions', async () => {
    const result = await run(['owner-only'], { op: 'rotate', angle: 90 });
    expect(result.prompts).toEqual([]);
    expect(result.warnings).toEqual(['PERMISSIONS_REMOVED']);
  });

  it('asks for the password of a protected second file in a merge', async () => {
    const result = await run(['text-only', 'user-password'], { op: 'merge' }, ['test-only']);
    expect(result.prompts).toEqual([1]);
    expect((await inspect(result.output)).pages).toBe(6);
  });

  it('unlocks a protected PDF and refuses one that has no password', async () => {
    const result = await run(['user-password'], { op: 'unlock' }, ['test-only']);
    expect((await inspect(result.output)).encrypted).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(await code(run(['text-only'], { op: 'unlock' }))).toBe('NOT_ENCRYPTED');
  });
});

it('rejects files that are not PDFs', async () => {
  expect(await code(run([new TextEncoder().encode('not a pdf')], { op: 'rotate', angle: 90 }))).toBe('INVALID_PDF');
});

describe('protect and clean', () => {
  const opens = async (bytes: Uint8Array, password: string) => {
    const q = await load();
    q.FS.writeFile('/x.pdf', bytes);
    return q.callMain([`--password=${password}`, '--check', '/x.pdf']) === 0;
  };

  it('protects a PDF so it only opens with the new password', async () => {
    const result = await run(['text-only'], { op: 'protect', password: 'correct horse' });
    expect(await opens(result.output, '')).toBe(false);
    expect(await opens(result.output, 'correct horse')).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(await code(run(['text-only'], { op: 'protect', password: '' }))).toBe('NO_PASSWORD');
  });

  it('removes the document info dictionary and XMP metadata', async () => {
    const info = async (bytes: Uint8Array) => {
      const q = await load();
      q.FS.writeFile('/x.pdf', bytes);
      q.callMain(['--json=2', '--json-key=qpdf', '/x.pdf', '/x.json']);
      const objects = JSON.parse(new TextDecoder().decode(q.FS.readFile('/x.json'))).qpdf[1];
      const catalog = objects[`obj:${objects.trailer.value['/Root']}`].value;
      const info = objects[`obj:${objects.trailer.value['/Info']}`]?.value ?? {};
      return { info: Object.keys(info), xmp: '/Metadata' in catalog };
    };
    const doc = await PDFDocument.load(fixture('text-only'));
    doc.setAuthor('Secret Author');
    const withAuthor = await doc.save();
    expect((await info(withAuthor)).info).toContain('/Author');
    expect(await info((await run([withAuthor], { op: 'clean' })).output)).toEqual({ info: ['/ModDate'], xmp: false });
  });
});
