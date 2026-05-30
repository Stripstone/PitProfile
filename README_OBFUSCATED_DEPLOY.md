# PitProfile GitHub Pages Obfuscated Deploy

This repo is a static site. GitHub Pages does not need to compile it by default, so this workflow adds a build step before Pages receives the deploy artifact.

## Files added

- `.github/workflows/deploy.yml` — GitHub Actions workflow.
- `package.json` — build dependency and scripts.
- `scripts/build-obfuscate.js` — copies the static site to `dist/` and obfuscates JavaScript in the deployed copy.

## How it works

On push to `main`:

1. GitHub Actions checks out the readable source repo.
2. `npm install` installs `javascript-obfuscator`.
3. `npm run build` creates `dist/`.
4. Inline JavaScript in `dist/index.html` is obfuscated.
5. `dist/sw.js` is obfuscated if present.
6. GitHub Pages deploys only the `dist/` artifact.

Your source `index.html` in the repo remains readable. The public Pages deployment receives the obfuscated copy.

## GitHub setting required

In your repository:

`Settings → Pages → Build and deployment → Source → GitHub Actions`

## Local testing

Install dependencies and build:

```bash
npm install
npm run build
```

Preview the generated static site from `dist/`:

```bash
python -m http.server 8080 -d dist
```

Plain, non-obfuscated build for debugging:

```bash
npm run build:plain
```

## Important

Obfuscation is not security. Do not put private keys, service-role Supabase keys, or secrets in frontend JavaScript. Public Supabase anon keys are expected in client-side apps; private secrets must stay server-side.
