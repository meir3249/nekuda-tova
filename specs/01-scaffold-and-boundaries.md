# 01 — Repo Scaffold, Tooling, CI, Architecture Boundaries

## Purpose and scope
Create the project skeleton and the machinery that keeps `src/core/` independent of infrastructure from day one. No product behavior beyond the `Clock` port and its two implementations.

## Relevant requirements
Brief §7 (decoupling, verification), §8 (free tools), §11 (docs). D-009, D-015, P-12.

## Technical design
- Single `package.json` (no workspaces). Scripts: `lint`, `typecheck`, `test`, `test:boundary`, `validate:content` (stub until Task 2), `build:pwa` (stub until Task 6), `ci` (runs lint, typecheck, test).
- TypeScript `strict`, `noUncheckedIndexedAccess`, ESM. Separate `tsconfig` project references are **not** used; one tsconfig with path-free relative imports.
- ESLint flat config. Rule `no-restricted-imports` scoped to `src/core/**`: forbid every bare specifier and Node built-ins (`node:*`, `fs`, `path`, ...), forbid relative paths that escape `src/core/`. Also forbid `src/core/**` using `fetch`, `process`, `window`, `document`, `localStorage`, `navigator` globals (via `no-restricted-globals`); `Intl`, `Date`, `Math`, `Number` allowed. `src/core/environment/` receives its inputs as parameters, never reads globals.
- **Boundary test** (`tests/boundary/core-isolation.test.ts`): uses the TypeScript compiler API (already a dev dependency) to parse every file under `src/core/`, collect all import/export-from/dynamic-import specifiers, and assert each resolves to a file inside `src/core/`. A second assertion: no file in `src/core` mentions the strings `supabase`, `web-push`, `node:` in an import. A third: `adapters/*` do not import each other.
- CI `ci.yml`: on push and pull_request; Node from `.nvmrc`; `npm ci`; lint; typecheck; test; boundary; content validation step present but a no-op until Task 2. Uses only GitHub-hosted runners (free on public repos, see research notes).
- `.nvmrc`: current Active LTS at implementation time (record the choice and date in `DEPENDENCIES.md`).
- `DEPENDENCIES.md`: table of every dependency with exact version, license (verified from the package metadata, not memory), purpose, and any free-tier limit. Includes the `web-push` license check (R-08) as a **pending** row until Task 5 adds the package.
- `README.md` skeleton: sections What it does / Principles / Prerequisites / Run / Test / Build / Architecture / Content / Limitations, each with a one-line stub and a pointer to the owning task. Filled in Task 8.
- Clock port + implementations (the only "feature"): `src/core/ports/clock.ts` (interface from 00 §4), `src/adapters/system/system-clock.ts`, `tests/fakes/fake-clock.ts` (settable, `advance(ms)`).

## Files and components
`package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.nvmrc`, `.gitignore`, `.editorconfig`, `.github/workflows/ci.yml`, `README.md`, `DEPENDENCIES.md`, `src/core/ports/clock.ts`, `src/core/index.ts` (re-exports ports), `src/adapters/system/system-clock.ts`, `tests/fakes/fake-clock.ts`, `tests/boundary/core-isolation.test.ts`, `tests/adapters/system-clock.test.ts`.

## Interfaces and contracts
`Clock` per 00 §4. `SystemClock.now()` returns `new Date()`. `FakeClock` has `set(date)`, `advance(ms)`.

## Dependencies
None (first task). Dev dependencies only: `typescript`, `vitest`, `eslint`, `typescript-eslint`. Exact versions pinned. No runtime dependencies yet.

## Acceptance criteria
1. `npm ci && npm run ci` passes locally and in GitHub Actions.
2. Adding `import fs from 'node:fs'` or `import x from '../adapters/system/system-clock'` to any file under `src/core/` makes **both** lint and the boundary test fail (demonstrated in the PR description with a deliberate temporary violation, then removed).
3. `DEPENDENCIES.md` lists each package with a verified license; all licenses are free/open-source.
4. No file under `src/core/` references infrastructure packages.
5. README skeleton and `.nvmrc` exist.

## Unit tests
- `FakeClock` set/advance behavior.
- `SystemClock` returns a `Date` within a tolerance of real time.

## Integration tests
- Boundary test (above) runs against the real tree.
- A fixture-based test feeds the boundary checker a temp directory containing a violating file and asserts it is detected (so the checker itself is proven to work).

## Error cases
- Missing/incorrect Node version → `npm ci` fails fast with message from `engines` field.
- Lockfile drift → CI fails (`npm ci`).

## Edge cases
- Type-only imports of non-core types in core are also forbidden (checked by the same test).
- Dynamic `import()` and `require` forms are scanned.
- Windows path separators are normalized in the boundary test (developer machine is Windows).

## Definition of Done
All acceptance criteria met; CI green on default branch; `DEPENDENCIES.md` committed; `DECISIONS.md` change log updated; no unapproved dependency.
