# Nekuda Tova (נקודה טובה)

One small moment of positive thought, once a day. A quiet notification, nothing to open, nothing to keep up with.

> Skeleton. Each section is filled in by the task named next to it. Full documentation arrives in Task 08.

## What it does
A Progressive Web App on GitHub Pages sends one Web Push notification a day at a time you choose. *(Task 08)*

## Principles
No streaks, no scores, no guilt, no required interaction. Messages feel like a thought, not an instruction. See [DECISIONS.md](DECISIONS.md) D-001..D-004. *(Task 08)*

## Prerequisites
- Node.js 24 (see `.nvmrc`)
- Git

## Run
```
npm ci
```
The PWA dev server arrives in Task 06 and the sender in Task 05. *(Tasks 05, 06)*

## Test
```
npm test              # all tests
npm run test:boundary # architecture boundary checks only
npm run lint
npm run typecheck
npm run ci            # lint + typecheck + tests
```

## Build and deploy
GitHub Pages workflow arrives in Task 06. *(Task 06)*

## Architecture
Pure TypeScript core (`src/core`) with ports; adapters for Supabase, web-push, the repo file, and the system clock; a PWA; a scheduled sender. `src/core` may not import infrastructure, enforced by an ESLint rule and a boundary test. Structure and contracts: [specs/00-overview.md](specs/00-overview.md). *(Task 08)*

## Content
Messages live in `data/messages.json`. Management guide arrives in Task 02. *(Task 02)*

## Limitations
Delivery and exact timing cannot be guaranteed. See `docs/limitations.md` once written. *(Task 08)*

## Cost
Everything is free: GitHub (public repo, Pages, Actions), Supabase free tier, Web Push. See [DEPENDENCIES.md](DEPENDENCIES.md).
