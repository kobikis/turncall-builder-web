<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/wordmark-dark.svg">
    <img src="docs/logo/wordmark-light.svg" alt="TurnCall" width="260">
  </picture>

  <h1>Builder · Console</h1>

  <h3>Describe a voice agent on the left. Watch it take shape on the right.</h3>

  <p>
    Chat until the design is clear, edit the generated config directly,<br>
    ship it to TurnCall, then watch the events its calls produce.
  </p>

  <p>
    <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-orange?style=flat" alt="FSL-1.1-ALv2"></a>
    <a href="https://github.com/kobikis/turncall-builder-web/actions/workflows/ci.yml"><img src="https://github.com/kobikis/turncall-builder-web/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
    <a href="#"><img src="https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB" alt="React"></a>
    <a href="#"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white" alt="Vite"></a>
    <a href="#"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript"></a>
    <a href="https://github.com/kobikis/turncall"><img src="https://img.shields.io/badge/engine-TurnCall_(MIT)-green?style=flat" alt="TurnCall engine"></a>
    <a href="https://docs.turncall.io"><img src="https://img.shields.io/badge/docs-docs.turncall.io-0B7285?style=flat&logo=readthedocs&logoColor=white" alt="Docs"></a>
  </p>

  <p>
    <a href="#quickstart">Quickstart</a> ·
    <a href="https://github.com/kobikis/turncall-builder-api/blob/main/ROADMAP.md">Roadmap</a> ·
    <a href="https://docs.turncall.io">Engine docs</a> ·
    <a href="CONTRIBUTING.md">Contributing</a> ·
    <a href="#license">License</a>
  </p>
</div>

---

## The layout

```
┌───────────────────────────┬───────────────────────────┐
│  Chat                     │  Config                   │
│                           │                           │
│  "a receptionist for my   │  {                        │
│   dental clinic"          │    "name": "receptionist" │
│                           │    "llm":  { ... }        │
│  → What are your hours?   │    "tts":  { ... }        │
│  → Transfer to a human    │    "tools": [ ... ]       │
│    when?                  │  }         ↑ editable     │
│                           │                           │
│                           │  [ Create in TurnCall ]   │
├───────────────────────────┴───────────────────────────┤
│  Events — live, once the agent starts taking calls    │
└───────────────────────────────────────────────────────┘
```

Backend, glossary and decisions live in
[`turncall-builder-api`](https://github.com/kobikis/turncall-builder-api).
The voice runtime is the MIT-licensed
[TurnCall engine](https://github.com/kobikis/turncall) — its docs live at
[docs.turncall.io](https://docs.turncall.io).

## Quickstart

Runs on the host (the Vite dev server proxies `/api` to the builder-api on
`:8000`, so start `turncall-builder-api` first).

```bash
make install   # npm ci
make dev       # Vite dev server on http://localhost:5173
```

Other targets: `make build` (type-check + prod build), `make preview`,
`make test`, `make clean`. Run `make help` to list them.

> The dev port is pinned to 5173 so the Google OAuth redirect URI stays stable.

### Log in (local dev)

Skip Google OAuth: in `turncall-builder-api`, run `make seed-guest` once, then
log in on the **Log in** tab with `guest@turncall.local` / `guest`. It lands in
an admin workspace, ready to create agents. (Sign-up still requires an 8+ char
password; login doesn't.)

## Contributing

Bug fixes and docs: open a PR. Features: open an issue first.

Sign your commits (`git commit -s`) — CI enforces it. **No CLA, no forms.**
Contributing here also grants the right to relicense your work under commercial
terms, which is what lets it be included in this licence's Apache 2.0
conversion. See [CONTRIBUTING.md](CONTRIBUTING.md); the MIT
[engine](https://github.com/kobikis/turncall) carries no such grant.

Security issues: see [SECURITY.md](SECURITY.md), not the public issue tracker.

## License

**FSL-1.1-ALv2** — see [LICENSE.md](LICENSE.md). Use, modify and redistribute
for any purpose other than competing with us; each release converts to Apache
2.0 two years after it ships.

TurnCall is open core: this builder is source-available, while the
[TurnCall engine](https://github.com/kobikis/turncall) it drives is MIT. The
reasoning is recorded in [adr/0015](https://github.com/kobikis/turncall/blob/master/adr/0015-open-core-licensing.md).
