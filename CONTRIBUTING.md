# Development

`src/` is the editable application for local and cloud work. Open `src/Index.html` directly; no server or runtime installation is required.

For automated checks, use Node.js 20+ and Python 3.9+:

```sh
npm ci
npx playwright-core install chromium
npm test
npm run test:browser
npm run build
npm run check
```

`BROWSER_EXECUTABLE` may select an existing Chromium executable. `DASHBOARD_ROOT` may select an extracted app for browser tests. Reports and test downloads stay in ignored `test-results/`; all test inputs are fictional.

GitHub Actions runs the unit tests, verifies the checked-in distribution ZIP, and checks the build on pushes and pull requests. It then extracts the checked-in ZIP and runs both browser suites against its `Index.html` using `file://` with networking disabled. The workflow uses Chromium on Ubuntu; it does not establish Windows or macOS compatibility. Browser reports, screenshots, and fictional test downloads are available in the `offline-browser-results` artifact for seven days, including when a browser test fails.

The builder packages only its explicit 18-file runtime allowlist as `downloads/grade-analysis-dashboard.zip`. `--check` verifies the existing ZIP without writing it. Keep the sample JSON and classic JS identical. Preserve MIT and the separate third-party licenses/NOTICE; update pinned checksums deliberately with vendor changes.

For an explicitly requested release, inspect existing versions/tags, run the checks, extract and test the ZIP, then create a versioned GitHub Release with the fixed asset name `grade-analysis-dashboard.zip`. Re-download and verify the asset before changing README to the latest-release link. Keep the existing downloads ZIP available. Do not enable Pages or rewrite history.
