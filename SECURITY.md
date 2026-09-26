# Security policy

Fizzdoc's whole promise is that documents never leave the visitor's device, so security reports are taken seriously and handled first.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/kingrishabdugar/fizzdoc/security/advisories/new)).

Include what you found, how to reproduce it, and the impact. You'll get an acknowledgement within a few days, and credit in the fix's release notes if you'd like it.

## What counts

Especially interesting:

- Any way a document, password or its contents could reach a network request, another origin, or persistent storage.
- Bypasses of the page's Content Security Policy.
- Script injection through a crafted file (for example Markdown, Word or PDF input rendered into the page).
- Output files that are silently corrupted or that keep content the user asked to remove.

## Supported versions

Only the latest deployment at [fizzdoc.pages.dev](https://fizzdoc.pages.dev) and the `main` branch are supported.
