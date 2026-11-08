# Releasing

The plugin is installed from a **pinned Git commit** listed in a market index, so a release is: build → commit `dist/` → record that commit in the index.

## Cut a release

```bash
# 1. Bump "version" in package.json (and add a CHANGELOG.md entry)
# 2. Check everything — unit tests, build, and the "stranger's machine" verification
npm run check
npm run e2e                      # browser tests, needs Google Chrome

# 3. Commit the source AND the rebuilt dist/
git add -A && git commit -m "ThinkBoard x.y.z"
git tag vx.y.z

# 4. Update the index on the gh-pages branch (it keeps older versions)
git worktree add ../thinkboard-pages gh-pages
node scripts/make-index.mjs --out ../thinkboard-pages/index.json
git -C ../thinkboard-pages add index.json && git -C ../thinkboard-pages commit -m "Release x.y.z"

# 5. Publish
git push origin main --tags
git -C ../thinkboard-pages push origin gh-pages
```

Why `dist/` is committed: the market installs the commit as-is, so users need no build toolchain and no install scripts.

## Rules

- A published version is immutable. `make-index.mjs` refuses to point an already-released version at a different commit; fix forward with a new version.
- The index is generated from a **clean working tree**, so it always points at the exact commit you tested.
- `engines.dsh` in `package.json` is what the market uses to decide compatibility — widen it only after testing on that dsh version.
- dsh judges `engines.dsh` with `semver.satisfies(version, range, { includePrerelease: true })`, so a prerelease such as `0.2.2-rc.1` is accepted as long as the width of the range covers it — keep the upper bound at the next minor (`<0.3.0-0`) rather than the next patch, or every dsh prerelease will block installs.
