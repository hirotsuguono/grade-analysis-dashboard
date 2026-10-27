# Development

- Use GitHub noreply addresses for commit authors, committers, co-authors and taggers. Configure `git config user.email '195975487+hirotsuguono@users.noreply.github.com'`, `git config user.useConfigOnly true`, and `git config core.hooksPath .githooks` in every new clone. Run `python3 scripts/check_commit_email.py` before publishing. Hooks are local and must be enabled in each clone; CI reports violations after a push and does not retract published data. Do not restore old history from another clone or backup.
- Edit the application only in `src/`. It runs directly from `src/Index.html` using local assets; keep file:// and offline operation.
- Preserve all seven panels, Excel imports, printing, accessibility and JSON v1–v3 compatibility. Blank scores are not zero.
- Keep tests and fixtures fictional. Never commit real data, user JSON/Excel, credentials, logs, browser profiles or private work notes.
- Use Node.js 20+ and Python 3.9+. Run `npm test`, `npm run test:browser`, `npm run build`, then `npm run check` after relevant changes.
- Install development tools with `npm ci` and `npx playwright-core install chromium`. Runtime users need none of these tools.
- The ZIP contains only the explicit runtime allowlist in `scripts/package.py`. Keep its bytes synchronized with `src/`, including the JSON/classic-JS sample pair.
- Retain the MIT license and separate third-party licenses/NOTICE. Review vendor checksums intentionally when updating a library.
- Keep README brief and user-facing. Do not publish private motivations, QA reports or release checklists.
- Publish commits, tags and Releases only when explicitly requested. Never force push, rewrite history or enable GitHub Pages. Verify a Release asset before updating the README download link.
