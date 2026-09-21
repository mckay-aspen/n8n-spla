# SPLA white-label fork

This is `n8n-io/n8n` rebranded for the Sneaker Project LA "Autobot" instance
(deployed via [mckay-aspen/n8n-aspen](https://github.com/mckay-aspen/n8n-aspen)).
Upstream `master` is untouched; all changes live on **`spla-main`**, rebased
onto the `release-candidate/2.40.x` line (currently `n8n@2.40.3`). Every change
is marked with a `SPLA WHITE-LABEL` comment — `git grep -n 'SPLA WHITE-LABEL'`
lists the full surface.

Track a release line, not `master`. `master` is the v3 development trunk, so
merging it moves the instance onto unreleased code.

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
| Weekly upstream update check | `.github/workflows/spla-upstream-update.yml`, `.n8n-release-line` |

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

`.n8n-release-line` names the line this fork tracks. It is the single source of
truth for what "up to date" means, and both the automation and the manual
procedure below read it.

### The weekly worker

`.github/workflows/spla-upstream-update.yml` runs every Monday and can also be
started by hand from the Actions tab. It compares the version in `package.json`
against the newest `n8n@X.Y.Z` tag on the tracked line and then:

- **New patch on the line** — cuts `upgrade/n8n-X.Y.Z`, merges the tag, runs
  `pnpm build` and `pnpm typecheck`, checks the brand colors and the "Autobot"
  title survived, and opens a PR reporting both results and any new database
  migrations. A red check still opens the PR, saying so in the body.
- **Merge conflicts** — opens an issue instead, with the commands to resolve it.
- **Upstream opens a new line** — opens an issue, because a cross-line jump is a
  rebase and needs a human. It does not attempt the rebase.

It never merges its own PR and never touches a deployment pin. Merging the PR
is what publishes the image; deploying it is a separate, manual step, because
an upgrade runs database migrations against n8n-Postgres and the Autobot
service is stateless with no volume. **Back that database up before deploying.**

Two things it depends on, both easy to break:

- The fork defaults `GITHUB_TOKEN` to read-only, so the workflow declares an
  explicit `permissions:` block. Do not remove it.
- Opening the PR needs *Settings → Actions → General → Allow GitHub Actions to
  create and approve pull requests*. Without it the workflow still pushes the
  branch and falls back to opening an issue.

`n8n-aspen`'s `n8n-release-check.yml` predates this and overlaps with it. That
one watches `releases/latest`, which is upstream's newest release overall
rather than the tracked line, so it will start reporting versions this fork has
deliberately not moved to. Disable it, or leave it as the wider-horizon signal —
but do not read it as "the fork is behind".

### By hand

**Within the same release line** (for example 2.40.3 to 2.40.4), merge the tag:

```sh
git fetch upstream 'refs/tags/n8n@X.Y.Z:refs/tags/n8n@X.Y.Z' --no-tags
git checkout spla-main
git merge 'n8n@X.Y.Z'      # conflicts, if any, will be in the files above
pnpm install --frozen-lockfile
pnpm --filter n8n-editor-ui build   # quick local sanity check
git push origin spla-main           # CI builds + publishes the image
```

**Across release lines** (for example 2.38.x to 2.40.x), do not merge. Each line
carries its own backports of the same upstream fixes, so a merge conflicts on
every file those backports touched — the 2.38 to 2.40 jump produced 430
conflicts, 293 of them in source. Rebase the fork's own commits instead. Only
three commits are ours, and the rest of `spla-main` is upstream's:

```sh
git log --oneline upstream/release-candidate/<OLD>..spla-main   # confirm what is ours
git checkout -b upgrade/n8n-X.Y.x upstream/release-candidate/<NEW>
git cherry-pick <our commits, oldest first>
```

Git follows upstream's renames, so the design-system move to
`packages/frontend/@n8n/` carried the brand tokens across without a conflict.
Verify with `git grep -n 'SPLA WHITE-LABEL'` before building. Then point
`.n8n-release-line` at the new line so the worker tracks it.

## Deploying an upgrade

Merging to `spla-main` only publishes the image. Two pins decide what actually
runs, and they live in different repositories:

| Pin | Where |
| --- | ----- |
| `N8N_VERSION` | `mckay-aspen/n8n-aspen` — `.env.example` and `.env` (Docker Compose) |
| `ghcr.io/mckay-aspen/n8n-spla:<version>-spla` | the website repo's `.railway/railway.ts` — what `railway config apply` deploys |

The Railway pin is the one that matters for the live instance. Note that
`railway config apply` applies the *whole* project config, not just `autobot`,
so check what else is pending in that file before running it.

Migrations run at container start and the service has no volume, so back up
n8n-Postgres first.
