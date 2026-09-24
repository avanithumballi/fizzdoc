import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PAGES } from '../src/seo';

const fixture = (name: string) => new URL(`./fixtures/${name}.pdf`, import.meta.url).pathname;

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
  await page.locator('#pages').fill('9');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await expect(page.locator('#status')).toContainText('Check the page numbers');

  await page.goto('/unlock-pdf/');
  await page.locator('#file-input').setInputFiles(fixture('user-password'));
  await page.getByRole('button', { name: 'Remove password' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#status')).toContainText('needs its password');
  await expect(page.getByRole('button', { name: 'Remove password' })).toBeEnabled();
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
    expect(html).toContain(`<link rel="canonical" href="https://hushpdf.com${path}">`);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toContain('FAQPage');
    if (tool) expect(html).toContain(`data-tool="${tool.op}"`);
  });
}

test('publishes sitemap, robots.txt and llms.txt', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const { path } of PAGES) expect(sitemap).toContain(`<loc>https://hushpdf.com${path}</loc>`);
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: https://hushpdf.com/sitemap.xml');
  expect(await (await request.get('/llms.txt')).text()).toContain('## Tools');
});
