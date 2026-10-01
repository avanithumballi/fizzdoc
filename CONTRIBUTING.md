# Contributing to Fizzdoc

Thanks for helping build the private alternative to upload-everything PDF sites. Every contribution counts — a fixed typo, a better translation, a new tool, a bug report with a sample file.

**Quick links:** [good first issues](https://github.com/kingrishabdugar/fizzdoc/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) · [help wanted](https://github.com/kingrishabdugar/fizzdoc/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) · [open a new issue](https://github.com/kingrishabdugar/fizzdoc/issues/new/choose)

## The one rule

**Nothing may leave the visitor's device.** No uploads, no analytics, no third-party scripts, fonts or CDNs. The page's Content Security Policy only allows connections to its own origin, and the end-to-end tests fail if any request goes elsewhere. Everything else is negotiable.

## Get set up (2 minutes)

```sh
git clone https://github.com/<you>/fizzdoc.git
cd fizzdoc
npm install
npm run dev            # http://localhost:5173 — every tool page works in dev
```

Before you open a pull request:

```sh
npm run check          # TypeScript + unit tests (fast)
npm run test:e2e       # builds the site and runs real-browser tests
```

You need Node 22+. Playwright's Chromium is installed with `npx playwright install chromium` the first time.

## Project map

| Path | What lives there |
|---|---|
| `src/site.ts` | **The tool registry**: every tool's slug, format, button label and English SEO copy |
| `src/i18n.ts` | Every interface string in English, and the list of languages |
| `src/i18n/<lang>.json` | Translations of the interface and tool pages |
| `src/seo.ts` | Renders every page (all languages), JSON-LD, sitemap, robots.txt, llms.txt |
| `src/app.ts` | The page controller: file picking, options, running a job, download |
| `src/engine/` | The actual document work — pure functions that take files and return files |
| `src/tools/` | Interactive tools with their own UI (PDF editor, OCR viewer) |
| `tests/` | Unit tests (`*.test.ts`, Vitest) and browser tests (`app.e2e.ts`, Playwright) |

## 🌍 Translate Fizzdoc (no coding needed)

Translations are the easiest high-impact contribution: each one opens Fizzdoc to millions of people.

- **Improve an existing language:** edit `src/i18n/<code>.json` and open a PR. Native speakers fixing a phrase or using the words people actually search for are hugely valuable.
- **Add a new language:**
  1. Add it to `LANGS` in `src/i18n.ts` (for example `ja: '日本語'`) and to `OG_LOCALE` in `src/seo.ts`.
  2. Copy any existing file in `src/i18n/` to `src/i18n/<code>.json` and translate every value. Keep the keys, keep `{placeholders}` like `{n}` or `{tool}`, and keep product names (Fizzdoc, PDF, Word, Excel, GitHub) as they are.
  3. Keep each tool's `title` between 20 and 70 characters and `description` between 80 and 160 — they are what Google shows. Use the phrases people in your language really type into a search box.
  4. Run `npm run test:e2e`: it checks every page in every language.

The new language gets its own pages (`/<code>/…`), sitemap entries and search tags automatically.

## 🧰 Add a new tool

A tool is three small pieces:

1. **Engine** — a function in `src/engine/` that takes `File`s and returns `{ blob, name, summary }`. Keep it pure (no DOM) so it can be unit-tested in Node. Load heavy libraries with `await import()` inside the function so the first page stays small. Throw `new LocalError('CODE')` for user-facing errors: add the code to `LocalError` in `src/engine/local.ts` and its message (`error.CODE`) to `src/i18n.ts`.
2. **Registry entry** — add the tool to `TOOLS` in `src/site.ts`: slug, format, name, one-line summary, button label, SEO title/description, h1, lede, three steps and a short FAQ. Add its icon in `src/seo.ts` and its engine call to the `LOCAL` table in `src/app.ts`.
3. **Tests** — a unit test for the engine in `tests/` and a short browser test in `tests/app.e2e.ts` that runs it end to end.

Look at `src/engine/stamp.ts` (page numbers and watermark) for a small, complete example.

## Code style

- **Do the simplest thing that works.** Standard library and browser features before new dependencies; no abstractions until there are two real users of them. If you knowingly cut a corner, leave a short comment saying where the limit is and how to lift it.
- **Never cut corners on** input validation, error handling that could lose a user's work, security or accessibility.
- Match the surrounding code: TypeScript, 2-space indent, single quotes, short comments that explain *why*.
- New dependencies must be permissively licensed (MIT, BSD, Apache-2.0, ISC), actively maintained, and added to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No GPL/AGPL.

## Pull requests

- One focused change per PR, with a clear title (`Add sign PDF tool`, `Fix rotated pages in OCR`).
- Link the issue it closes (`Closes #12`) and include a screenshot for anything visual.
- `npm run check` and `npm run test:e2e` pass.
- Be kind in review, and expect the same. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Open a [bug report](https://github.com/kingrishabdugar/fizzdoc/issues/new?template=bug_report.yml) with the tool, browser, and what happened. If a specific file triggers it, a small sample that contains nothing private is gold. **Never attach a private document.**

Security issue? Please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## 🎃 Hacktoberfest and good first issues

Hacktoberfest 2026 no longer counts pull requests (it's now about Fests and online challenges around open-source AI), but contributions here are welcome all year. Issues labelled [`good first issue`](https://github.com/kingrishabdugar/fizzdoc/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/kingrishabdugar/fizzdoc/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) are scoped and ready to pick up, including new tools, translations and improvements.

- **Claim first.** Comment on the issue so two people don't build the same thing. If a claimed issue sees no progress for 7 days, it's open again.
- **One focused change per pull request**, with a test, following the pull request template.
- Low-effort pull requests (whitespace or typo churn in unrelated files, generated content, README edits that don't help users) are closed.

Stuck? Ask on the issue; questions are welcome.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), the same license as the rest of the project.
