# SPLA white-label fork

This is `n8n-io/n8n` rebranded for the Sneaker Project LA "Autobot" instance
(deployed via [mckay-aspen/n8n-aspen](https://github.com/mckay-aspen/n8n-aspen)).
Upstream `master` is untouched; all changes live on **`spla-main`**, branched
from the `n8n@2.38.7` release tag. Every change is marked with a
`SPLA WHITE-LABEL` comment — `git grep -n 'SPLA WHITE-LABEL'` lists the full
surface.

Licensing: n8n's Sustainable Use License permits modification for internal
business use, which is what this fork is. Distributing a rebranded n8n to
third parties would require n8n's embed license.

## What is changed

| Area | Files |
| ---- | ----- |
| Brand ramp (orange → navy/indigo) | `packages/frontend/@n8n/design-system/src/css/_primitives.scss` |
| Primary color + dark-mode brand | `.../css/_tokens.legacy.scss`, `.../css/_tokens.scss` |
| Logo icon + wordmark | `.../components/N8nLogo/logo-icon.svg`, `logo-text.svg`, `Logo.vue` |
| Tab title ("Autobot") | `packages/frontend/@n8n/composables/src/useDocumentTitle.ts` (+ its tests) |
| HTML title + favicons | `packages/frontend/editor-ui/index.html`, `public/favicon.svg`, `public/favicon.ico` |
| E-mail logo | `packages/frontend/editor-ui/public/static/n8n-logo.png` |
| Serve `/favicon.svg` as a static asset (SPA fallback whitelists only `.ico`) | `packages/cli/src/server.ts` (`nonUIRoutes`) |
| Image build CI | `.github/workflows/spla-build.yml` |

Colors mirror `apps/admin/src/styles.css` in `mckay-aspen/sneakerprojectla-website`:
light `#172d72` (hover `#122459`, focus `#2851c4`), dark `#93a9ff`.
Deliberately unchanged: in-product "n8n" text strings, docs links, node icons
that are semantically orange.

## Image publishing

Pushing to `spla-main` runs `.github/workflows/spla-build.yml`, which builds
the monorepo (`pnpm build:docker`) and pushes:

- `ghcr.io/mckay-aspen/n8n-spla:<version>-spla` (+ `:latest`)
- `ghcr.io/mckay-aspen/n8n-spla-runners:<version>-spla`

Both GHCR packages stay **private**. Pulls authenticate with a GitHub token
carrying `read:packages`:

- Local: `gh auth token | docker login ghcr.io -u mckay-aspen --password-stdin`
- Railway: paste a token into the `autobot` service's Settings → Source →
  Registry Credentials (private-registry pulls need the Railway Pro plan).

## Upgrading to a new upstream release

```sh
git fetch upstream 'refs/tags/n8n@X.Y.Z:refs/tags/n8n@X.Y.Z' --no-tags
git checkout spla-main
git merge 'n8n@X.Y.Z'      # conflicts, if any, will be in the files above
pnpm install --frozen-lockfile
pnpm --filter n8n-editor-ui build   # quick local sanity check
git push origin spla-main           # CI builds + publishes the image
```

Then bump the image tag in `mckay-aspen/n8n-aspen` (compose + Railway).
The release-check workflow in `n8n-aspen` opens an issue when upstream
publishes a new release.
