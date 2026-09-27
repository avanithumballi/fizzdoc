import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PAGES, SITE_LANGS } from '../src/seo';
import { SITE } from '../src/site';

const file = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const fixture = (name: string) => file(`${name}.pdf`);

/** Records every request and console CSP violation, so tests can prove nothing leaves the page. */
function watch(page: Page) {
  const requests: { url: string; method: string; body: string | null }[] = [];
  const violations: string[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  page.on('console', (m) => m.text().includes('Content Security Policy') && violations.push(m.text()));
  return { requests, violations };
}

async function downloadBytes(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  return { name: download.suggestedFilename(), bytes: readFileSync((await download.path())!) };
}

test('merges two PDFs locally without sending any file data', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/merge-pdf/');
  await page.locator('#file-input').setInputFiles([fixture('form'), fixture('bookmarks')]);
  await expect(page.locator('#file-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Merge PDFs' }).click();

  await expect(page.locator('#status')).toContainText('Done — 6 pages');
  await expect(page.locator('#warnings')).toContainText('Bookmarks from the second and later files');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('form-merged.pdf');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) {
    if (request.url.startsWith('blob:')) continue;
    expect(new URL(request.url).origin, request.url).toBe(origin);
    expect(request.method, request.url).toBe('GET');
    expect(request.body, request.url).toBeNull();
  }
  expect(seen.violations).toEqual([]);
});

test('unlocks a protected PDF after a wrong then a right password', async ({ page }) => {
  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('input').fill('wrong');
  await dialog.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog).toContainText('Try again (2 of 3)');
  await dialog.locator('input').fill('test-only');
  await dialog.getByRole('button', { name: 'Unlock' }).click();

  await expect(page.locator('#status')).toContainText('Done — 3 pages');
  const { name } = await downloadBytes(page);
  expect(name).toBe('user-password-unlocked.pdf');
});

test('explains bad page ranges and cancels cleanly', async ({ page }) => {
  await page.goto('/split-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await expect(page.locator('#file-list')).toContainText('3 pages');
  await page.locator('#pages').fill('9');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('This PDF has 3 pages. Use page numbers from 1 to 3');

  // A range past the end keeps what exists: "1-5" on a one-page bill is just page 1.
  await page.locator('#file-input').setInputFiles(fixture('blank'));
  await expect(page.locator('#file-list')).toContainText('1 page');
  await page.locator('#pages').fill('1-5');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('1 page');
  await expect(page.locator('#download')).toBeVisible();
  await page.locator('#pages').fill('2');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('This PDF has only 1 page');

  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('needs its password');
  await expect(page.getByRole('button', { name: 'Remove password' })).toBeEnabled();
});

test('password-protects a PDF after checking both entries match', async ({ page }) => {
  await page.goto('/protect-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  await page.locator('#new-password').fill('s3cret');
  await page.locator('#confirm-password').fill('typo');
  await page.getByRole('button', { name: 'Protect PDF' }).click();
  await expect(page.locator('#status')).toContainText('do not match');
  await page.locator('#confirm-password').fill('s3cret');
  await page.getByRole('button', { name: 'Protect PDF' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('text-only-protected.pdf');
  expect(bytes.toString('latin1')).toContain('/Encrypt');
});

test('turns images into a PDF and PDF pages into images', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/jpg-to-pdf/');
  await page.locator('#file-input').setInputFiles([file('photo.png'), file('photo.jpg')]);
  await page.getByRole('button', { name: 'Create PDF' }).click();
  await expect(page.locator('#status')).toContainText('Done — 2 pages');
  expect((await downloadBytes(page)).name).toBe('photo-and-more.pdf');

  await page.goto('/pdf-to-jpg/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.locator('#status')).toContainText('Done — 3 images');
  await expect(page.locator('#download')).toHaveText('Download ZIP');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('mixed-images.zip');
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(seen.violations).toEqual([]);
});

test('cleans Office metadata and extracts Office images', async ({ page }) => {
  await page.goto('/remove-word-metadata/');
  await page.locator('#file-input').setInputFiles(file('report.docx'));
  await page.getByRole('button', { name: 'Remove metadata' }).click();
  await expect(page.locator('#status')).toContainText('Done — Metadata removed');
  const clean = await downloadBytes(page);
  expect(clean.name).toBe('report-clean.docx');

  await page.goto('/extract-images-from-excel/');
  await page.locator('#file-input').setInputFiles(file('sheet.xlsx'));
  await page.getByRole('button', { name: 'Extract images' }).click();
  await expect(page.locator('#status')).toContainText('Done — 1 image');
  expect((await downloadBytes(page)).name).toBe('sheet-images.zip');

  await page.locator('#file-input').setInputFiles(file('report.docx'));
  await expect(page.locator('#status')).toContainText('That file type can’t be used with this tool.');
});

test('compresses a PDF and reports the saving', async ({ page }) => {
  await page.goto('/compress-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  await page.getByRole('button', { name: 'Compress PDF' }).click();
  await expect(page.locator('#status')).toContainText(/smaller|Already optimized/);
  expect((await downloadBytes(page)).name).toBe('text-only-compressed.pdf');
});

test('resizes and converts images with the chosen options', async ({ page }) => {
  await page.goto('/resize-image/');
  await page.locator('#file-input').setInputFiles(file('photo.png'));
  await page.locator('input[name="width"]').fill('60');
  await page.getByRole('button', { name: 'Resize images' }).click();
  await expect(page.locator('#status')).toContainText('60 × 40');
  expect((await downloadBytes(page)).name).toBe('photo-60x40.png');

  // A scale outside 1–1000 % is refused up front instead of making a 1×1 image or exhausting memory.
  await page.locator('input[name="width"]').fill('');
  for (const scale of ['0', '-50', '99999']) {
    await page.locator('input[name="scale"]').fill(scale);
    await page.getByRole('button', { name: 'Resize images' }).click();
    await expect(page.locator('#status')).toHaveText('The scale must be between 1% and 1000%.');
  }
  await page.locator('input[name="scale"]').fill('');

  await page.goto('/convert-image/');
  await page.locator('#file-input').setInputFiles([file('photo.png'), file('photo.jpg')]);
  await page.locator('input[name="quality"]').fill('50');
  await expect(page.locator('.options output')).toHaveText('50%');
  await page.getByRole('button', { name: 'Convert images' }).click();
  await expect(page.locator('#status')).toContainText('Done — 2 images');
  expect((await downloadBytes(page)).name).toBe('images-resized.zip');

  // Compressing an already-small image never makes it bigger.
  await page.goto('/compress-image/');
  await page.locator('#file-input').setInputFiles(file('photo.jpg'));
  await page.locator('input[name="quality"]').fill('100');
  await page.getByRole('button', { name: 'Compress images' }).click();
  expect((await downloadBytes(page)).bytes.length).toBeLessThanOrEqual(readFileSync(file('photo.jpg')).length);
});

test('compresses a photo under a form’s size limit while keeping it as large as possible', async ({ page }) => {
  await page.goto('/compress-image-to-50kb/');
  await expect(page.locator('input[name="targetKb"]')).toHaveValue('50');
  await page.locator('#file-input').setInputFiles(file('big-photo.jpg'));
  await page.getByRole('button', { name: 'Compress images' }).click();
  await expect(page.locator('#status')).toContainText('smaller');
  const small = await downloadBytes(page);
  expect(small.name).toBe('big-photo-50kb.jpg');
  expect(small.bytes.length).toBeLessThanOrEqual(50 * 1024);
  // It lowers the quality before it shrinks the picture, so the photo stays as large as it can.
  const widthNow = async () => Number(/(\d+) × \d+/.exec((await page.locator('#status').textContent())!)![1]);
  expect(await widthNow()).toBeGreaterThanOrEqual(800);
  await page.locator('input[name="targetKb"]').fill('100');
  await page.getByRole('button', { name: 'Compress images' }).click();
  await expect(page.locator('#status')).toContainText('smaller');
  expect(await widthNow()).toBeGreaterThanOrEqual(1000);
  expect((await downloadBytes(page)).bytes.length).toBeLessThanOrEqual(100 * 1024);

  await page.locator('input[name="targetKb"]').fill('5');
  await page.getByRole('button', { name: 'Compress images' }).click();
  await expect(page.locator('#status')).toContainText('too small for this image');
});

test('converts PDFs to text, Markdown, Word and PowerPoint', async ({ page }) => {
  const seen = watch(page);
  for (const [slug, button, name] of [
    ['pdf-to-text', 'Extract text', 'rich-text.txt'],
    ['pdf-to-markdown', 'Convert to Markdown', 'rich-text.md'],
    ['pdf-to-word', 'Convert to Word', 'rich-text.docx'],
    ['pdf-to-powerpoint', 'Convert to PowerPoint', 'rich-text.pptx'],
  ]) {
    await page.goto(`/${slug}/`);
    await page.locator('#file-input').setInputFiles(fixture('rich-text'));
    await page.getByRole('button', { name: button }).click();
    await expect(page.locator('#status')).toContainText('Done');
    expect((await downloadBytes(page)).name).toBe(name);
  }
  expect(seen.violations).toEqual([]);

  await page.goto('/pdf-to-text/');
  await page.locator('#file-input').setInputFiles(fixture('blank'));
  await page.getByRole('button', { name: 'Extract text' }).click();
  await expect(page.locator('#status')).toContainText('Run OCR PDF first');
});

test('prepares Word and Markdown documents for Save as PDF without running their scripts', async ({ page }) => {
  const seen = watch(page);
  await page.goto('/word-to-pdf/');
  await page.locator('#file-input').setInputFiles(file('rich.docx'));
  await page.getByRole('button', { name: 'Convert to PDF' }).click();
  await expect(page.locator('#status')).toContainText('Save as PDF');
  await expect(page.locator('#download')).toHaveText('Save as PDF');
  expect(await page.locator('.print-frame').getAttribute('srcdoc')).toContain('<table');

  await page.goto('/markdown-to-pdf/');
  await page.locator('#file-input').setInputFiles(file('notes.md'));
  await page.getByRole('button', { name: 'Create PDF' }).click();
  const frame = page.frameLocator('.print-frame');
  await expect(frame.locator('h1')).toHaveText('Notes');
  await expect(frame.locator('strong')).toHaveText('bold');
  await expect(frame.locator('script')).toHaveCount(0);
  expect(seen.violations).toEqual([]);
});

test('converts between Excel and CSV', async ({ page }) => {
  await page.goto('/csv-to-excel/');
  await page.locator('#file-input').setInputFiles(file('data.csv'));
  await page.getByRole('button', { name: 'Convert to Excel' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const xlsx = await downloadBytes(page);
  expect(xlsx.name).toBe('data.xlsx');

  await page.goto('/excel-to-csv/');
  await page.locator('#file-input').setInputFiles({ name: 'data.xlsx', mimeType: '', buffer: xlsx.bytes });
  await page.getByRole('button', { name: 'Convert to CSV' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  const csv = await downloadBytes(page);
  expect(csv.name).toBe('data.csv');
  expect(csv.bytes.toString('utf8')).toContain('007,"Smith, Jane",12.5');
});

test('edits PDF text in place and saves on the device', async ({ page, baseURL }) => {
  const seen = watch(page);
  await page.goto('/edit-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  const viewer = page.locator('#viewer');
  const undo = page.getByRole('button', { name: 'Undo' });
  // Undo while still typing reverts that edit, so only the next one is saved.
  await viewer.locator('.edit-hitbox').nth(1).click();
  await page.keyboard.type('Oops');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await viewer.locator('.edit-hitbox').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Replaced text');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect(page.locator('#status')).toContainText('1 edit');
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('text-only-edited.pdf');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) if (!request.url.startsWith('blob:')) expect(new URL(request.url).origin).toBe(origin);
  expect(seen.violations).toEqual([]);
});

/** A PNG of printed English text, drawn by the browser: a stand-in for a photo or scan. */
async function textImage(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 220;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '64px Arial, sans-serif';
    context.fillText('Private invoice total', 40, 130);
    return canvas.toDataURL('image/png');
  });
  return { name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
}

test('recognizes text in an image and lets you select it on the picture', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const seen = watch(page);
  await page.goto('/image-to-text/');
  await page.locator('#file-input').setInputFiles(await textImage(page));
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await expect(page.locator('#status')).toContainText('recognized', { timeout: 90_000 });
  await expect(page.locator('#viewer')).toContainText('invoice');
  // The overlay must match the picture's shape (900 × 220), and each word box must sit on its word.
  expect(await page.locator('.ocr-frame').evaluate((el) => (el as HTMLElement).style.aspectRatio)).toBe('900 / 220');
  const word = await page.locator('.ocr-word').first().boundingBox();
  const frame = await page.locator('.ocr-frame').boundingBox();
  expect(word!.x - frame!.x).toBeGreaterThan(10);
  expect(word!.width).toBeGreaterThan(20);
  const { name, bytes } = await downloadBytes(page);
  expect(name).toBe('scan.txt');
  expect(bytes.toString()).toMatch(/Private invoice total/i);
  const origin = new URL(baseURL!).origin;
  for (const request of seen.requests) if (!request.url.startsWith('blob:')) expect(new URL(request.url).origin).toBe(origin);
  expect(seen.violations).toEqual([]);
});

test('makes a scanned PDF searchable', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/jpg-to-pdf/');
  await page.locator('#file-input').setInputFiles(await textImage(page));
  await page.getByRole('button', { name: 'Create PDF' }).click();
  const scanned = await downloadBytes(page);

  await page.goto('/ocr-pdf/');
  await page.locator('#file-input').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scanned.bytes });
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await expect(page.locator('#status')).toContainText('1 recognized', { timeout: 90_000 });
  const ocr = await downloadBytes(page);
  expect(ocr.name).toBe('scan-ocr.pdf');

  await page.goto('/pdf-to-text/');
  await page.locator('#file-input').setInputFiles({ name: 'scan-ocr.pdf', mimeType: 'application/pdf', buffer: ocr.bytes });
  await page.getByRole('button', { name: 'Extract text' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  expect((await downloadBytes(page)).bytes.toString()).toMatch(/invoice/i);
});

test('numbers and watermarks PDF pages, and converts between image formats', async ({ page }) => {
  await page.goto('/add-page-numbers-to-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await page.locator('select[name="style"]').selectOption('page-of');
  await page.getByRole('button', { name: 'Add page numbers' }).click();
  await expect(page.locator('#status')).toContainText('3 pages numbered');
  expect((await downloadBytes(page)).name).toBe('mixed-numbered.pdf');

  await page.goto('/watermark-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('mixed'));
  await page.locator('input[name="text"]').fill('DRAFT');
  await page.getByRole('button', { name: 'Add watermark' }).click();
  await expect(page.locator('#status')).toContainText('3 pages watermarked');

  // Any script works: text the standard PDF fonts can't show is drawn by the browser, never dropped.
  await page.locator('input[name="text"]').fill('गोपनीय CONFIDENTIAL');
  await page.getByRole('button', { name: 'Add watermark' }).click();
  await expect(page.locator('#status')).toContainText('3 pages watermarked');
  const stamped = await PDFDocument.load((await downloadBytes(page)).bytes);
  for (const p of stamped.getPages()) expect(p.node.Resources()!.lookup(PDFName.of('XObject'))).toBeTruthy();

  await page.goto('/pdf-to-png/');
  await page.locator('#file-input').setInputFiles(fixture('text-only'));
  await page.getByRole('button', { name: 'Convert to PNG' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  expect((await downloadBytes(page)).name).toMatch(/\.(png|zip)$/);

  await page.goto('/png-to-jpg/');
  await expect(page.locator('select[name="format"]')).toHaveCount(0);
  await page.locator('#file-input').setInputFiles(file('photo.png'));
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await expect(page.locator('#status')).toContainText('Done');
  expect((await downloadBytes(page)).name).toMatch(/\.jpg$/);
});

test('asks for a GitHub star at the top, the bottom and after a download', async ({ page }) => {
  await page.goto('/');
  for (const star of [page.locator('.star-btn'), page.locator('.star-hero'), page.locator('.star-big')]) {
    await expect(star).toHaveAttribute('href', SITE.repo);
    await expect(star).toHaveAttribute('target', '_blank');
  }
  await page.goto('/merge-pdf/');
  await expect(page.locator('.star-nudge a')).toHaveAttribute('href', SITE.repo);
});

test('serves every language with hreflang links, a language menu and a one-time tip', async ({ page, request }) => {
  const other = SITE_LANGS.find((lang) => lang !== 'en');
  test.skip(!other, 'no translations yet');
  const html = await (await request.get(`/${other}/merge-pdf/`)).text();
  expect(html).toContain(`<html lang="${other}">`);
  expect(html).toContain(`<link rel="alternate" hreflang="en" href="${SITE.url}/merge-pdf/">`);
  expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE.url}/merge-pdf/">`);
  expect(html).toContain('id="ui-strings"');

  await page.goto('/merge-pdf/');
  await expect(page.locator('#lang-tip')).toBeVisible();
  await page.locator('#lang-select').selectOption(`/${other}/merge-pdf/`);
  await expect(page).toHaveURL(new RegExp(`/${other}/merge-pdf/$`));
  await expect(page.locator('html')).toHaveAttribute('lang', other!);
  await expect(page.locator('#lang-tip')).toBeHidden(); // shown once only
  await expect(page.locator('.crumbs a').first()).toHaveAttribute('href', `/${other}/`);
});

test('remembers the chosen theme across pages', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/merge-pdf/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('dragged cards spring back and do not open their link', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.tool-card').first();
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 90, { steps: 8 });
  expect(await card.evaluate((el) => el.style.transform)).toContain('translate');
  await page.mouse.up();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => card.evaluate((el) => el.style.transform)).toBe('');
});

test('reorders merge files by dragging', async ({ page }) => {
  await page.goto('/merge-pdf/');
  await page.locator('#file-input').setInputFiles([fixture('form'), fixture('bookmarks'), fixture('links')]);
  await page.locator('#file-list li').nth(2).dragTo(page.locator('#file-list li').nth(0));
  await expect(page.locator('#file-list .file-name')).toHaveText(['links.pdf', 'form.pdf', 'bookmarks.pdf']);
});

test('ripples on background clicks only', async ({ page }) => {
  await page.goto('/');
  await page.mouse.click(8, 400);
  await expect(page.locator('.tap-ripple')).toHaveCount(1);
  await expect(page.locator('.tap-ripple')).toHaveCount(0);
});

for (const { path, tool } of PAGES) {
  test(`serves search-ready HTML at ${path}`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toMatch(/<title>[^<]{20,70}<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{80,160}">/);
    expect(html).toContain(`<link rel="canonical" href="${SITE.url}${path}">`);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toContain('FAQPage');
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="${SITE.url}/og(/[a-z]{2})?\\.png">`));
    if (tool) expect(html).toContain(`data-tool="${tool.op}"`);
  });
}

test('answers unknown links with a not-found page that search engines skip', async ({ request }) => {
  const html = await (await request.get('/404.html')).text();
  expect(html).toContain('<h1>Page not found</h1>');
  expect(html).toContain('<meta name="robots" content="noindex, follow">');
  expect(html).not.toContain('rel="canonical"');
  expect(html).toContain('href="/merge-pdf/"');
});

test('explains extra dropped files, lets any job be canceled and keeps qpdf chatter out of the console', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
  await page.goto('/compress-pdf/');
  const drop = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    for (const name of ['a.pdf', 'b.pdf']) data.items.add(new File(['%PDF-1.4'], name, { type: 'application/pdf' }));
    return data;
  });
  await page.locator('#drop').dispatchEvent('drop', { dataTransfer: drop });
  await expect(page.locator('#status')).toHaveText('This tool works on one file at a time, so the first file was added.');
  await expect(page.locator('#file-list li')).toHaveCount(1);

  await page.goto('/ocr-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('blank'));
  await page.getByRole('button', { name: 'Recognize text' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#status')).toContainText('Canceled');
  await expect(page.getByRole('button', { name: 'Recognize text' })).toBeEnabled();

  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();
  await page.locator('#password').fill('wrong');
  await page.keyboard.press('Enter');
  await expect(page.locator('#password-hint')).toContainText('2');
  expect(logged.filter((line) => line.includes('this.program'))).toEqual([]);
});

test('publishes sitemap, robots.txt and llms.txt', async ({ request }) => {
  const licenses = await (await request.get('/third-party-licenses.txt')).text();
  for (const part of ['Apache License', 'pdf-lib (MIT)', 'fflate (MIT)', 'Independent JPEG Group', 'Open Font License']) expect(licenses).toContain(part);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const { path } of PAGES) expect(sitemap).toContain(`<loc>${SITE.url}${path}</loc>`);
  expect(await (await request.get('/robots.txt')).text()).toContain(`Sitemap: ${SITE.url}/sitemap.xml`);
  expect(await (await request.get('/llms.txt')).text()).toContain('## Tools');
  expect(await (await request.get('/llms-full.txt')).text()).toContain('## Watermark PDF');
  expect(await (await request.get('/robots.txt')).text()).toContain('User-agent: *\nAllow: /');
  expect((await request.get('/og.png')).headers()['content-type']).toBe('image/png');
});
