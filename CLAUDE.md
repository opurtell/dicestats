# dicestats

Dice Roll Statistics Tracker — vanilla JS single-page app (`index.html`, `styles.css`,
`app.js`, Chart.js from CDN, localStorage persistence). Repo: `opurtell/dicestats`.
Design/implementation notes in `PLAN.md` (repo-only, not deployed).

## Deploy

Live at https://dicestats.oscarpurtell.com as a static-assets-only Cloudflare Worker
(`wrangler.jsonc`) — same pattern as `~/claudeCode/personal/homepage`.

```bash
npx wrangler@4 deploy   # needs wrangler login (oscarpurtell@gmail.com)
```

- `.assetsignore` keeps repo-only files (`PLAN.md`, config, dotfiles) out of the upload.
  **`.git` must stay in it** — without it wrangler uploads git internals publicly. Verify
  after any deploy: `curl -s -o /dev/null -w "%{http_code}\n" https://dicestats.oscarpurtell.com/.git/index` → 404.
- The `custom_domain` route creates the DNS record and certificate itself; the deploy
  fails if the hostname already has a DNS record.
- Deploying from any machine works — the Worker lives in the Cloudflare account
  (Oscar Purtell), not tied to this Mac beyond wrangler auth.

Listed on oscarpurtell.com: one `<tr>` in `~/claudeCode/personal/homepage/public/index.html`.

## GitHub Pages (legacy)

The repo also served https://opurtell.github.io/dicestats/ until 12/11/2026, when the
Cloudflare URL became canonical.
