# 2026-05-19 — Docker Quickstart & Docs Overhaul

This is a plain-language record of everything we shipped in this session, why, and what we considered but didn't do. Written for someone whose Docker background is limited — concepts are explained inline.

If you're skimming, the table of contents below is the fastest way in.

- [Where we started](#where-we-started)
- [Part 1 — Docs trust overhaul (already merged to `main`)](#part-1--docs-trust-overhaul-already-merged-to-main)
  - [1.1 — Tighter README lede](#11--tighter-readme-lede)
  - [1.2 — Security Model & Limitations section](#12--security-model--limitations-section)
  - [1.3 — Honest RBAC docs (verb regex + its known misses)](#13--honest-rbac-docs-verb-regex--its-known-misses)
  - [1.4 — Backend-unreachable behavior section](#14--backend-unreachable-behavior-section)
  - [1.5 — Troubleshooting section](#15--troubleshooting-section)
  - [1.6 — CONTRIBUTING.md + CHANGELOG.md](#16--contributingmd--changelogmd)
- [Part 2 — Docker Compose quickstart (PR #1)](#part-2--docker-compose-quickstart-pr-1)
  - [2.1 — What "the quickstart" actually is](#21--what-the-quickstart-actually-is)
  - [2.2 — Firestore emulator support in `initFirestore`](#22--firestore-emulator-support-in-initfirestore)
  - [2.3 — Mock stdio MCP backend](#23--mock-stdio-mcp-backend)
  - [2.4 — Firestore seeder (one-shot script)](#24--firestore-seeder-one-shot-script)
  - [2.5 — `Dockerfile` for the gateway image](#25--dockerfile-for-the-gateway-image)
  - [2.6 — `docker-compose.yml` wiring the three services together](#26--docker-composeyml-wiring-the-three-services-together)
  - [2.7 — `docker/demo-call.sh` wrapper](#27--dockerdemo-callsh-wrapper)
  - [2.8 — README "Try it in 30 Seconds" section](#28--readme-try-it-in-30-seconds-section)
- [Part 3 — Drive-by fixes](#part-3--drive-by-fixes)
  - [3.1 — Smart router missed `miro` entirely](#31--smart-router-missed-miro-entirely)
  - [3.2 — Stale `classify` test (expected 4 backends, got 6)](#32--stale-classify-test-expected-4-backends-got-6)
  - [3.3 — README documented the wrong Firestore schema](#33--readme-documented-the-wrong-firestore-schema)
- [Part 4 — Real bugs caught during end-to-end verification](#part-4--real-bugs-caught-during-end-to-end-verification)
  - [4.1 — `wget` not in `cloud-sdk:emulators` image](#41--wget-not-in-cloud-sdkemulators-image)
  - [4.2 — Mock backend tool names were double-prefixed](#42--mock-backend-tool-names-were-double-prefixed)
  - [4.3 — MCP SDK processes JSON-RPC requests concurrently](#43--mcp-sdk-processes-json-rpc-requests-concurrently)
  - [4.4 — zsh doesn't word-split unquoted variables](#44--zsh-doesnt-word-split-unquoted-variables)
- [Part 5 — Follow-up work we deliberately didn't do](#part-5--follow-up-work-we-deliberately-didnt-do)

---

## Where we started

The repo had:
- Good architecture documentation, but a "you should care about this because…" line that was buried below ASCII diagrams.
- An aspirational "Cloud Hosting" section in the README describing an HTTP endpoint that doesn't actually exist in the code.
- A single-file setup that needed a real Google Cloud project, real backend tokens, and ~30 minutes of credential plumbing before an evaluator could see anything run.
- Some real bugs nobody had caught (router missed a configured backend; docs described a Firestore schema the code never used).
- 0 forks, 1 star — a signal that drive-by visitors weren't converting.

A reviewer left feedback making six specific suggestions. We addressed all of them across this session.

---

## Part 1 — Docs trust overhaul (already merged to `main`)

Shipped earlier in the session as commit `5623d9c` on `main`.

### 1.1 — Tighter README lede

**What we changed:** Replaced the opening tagline + paragraph with a 3-line problem statement that puts "why should I care" above any diagram.

**Why it was necessary:** Reviewers and casual visitors who don't get hooked in the first 10 seconds close the tab. The previous opening said "what" before "why."

**Impact:** A skimmer now sees the value proposition before they scroll past the ASCII art.

**Alternatives considered:**
- Add a video / GIF demo. Rejected: more work, lives outside the README, can rot.
- Keep the old opening, add a separate "TL;DR" box. Rejected: redundant signal, adds noise.

### 1.2 — Security Model & Limitations section

**What we changed:** Added an explicit section that says:
- Identity is **self-reported** via env var or `git config`. Not cryptographically verified. Anyone with shell access to the host can claim to be anyone in Firestore.
- The hosted HTTP transport has no request-level auth (relevant once HTTP transport exists — see issue #2).
- No audit log persistence; stderr only.
- The verb-based RBAC is a heuristic, not exhaustive.
- Recommended deployment posture today: local-per-developer.

**Why it was necessary:** The previous README implied the gateway was production-ready for teams. A developer evaluating it for real team use would either trust it incorrectly (bad) or abandon the repo without understanding the limits are solvable (also bad). Honest disclosure builds more trust than omission.

**Impact:** A serious evaluator now knows exactly what's safe and what isn't. The known gaps are now roadmap items, not landmines.

**Alternatives considered:**
- Stay silent and hope reviewers don't ask. Rejected: classic open-source trust-killer.
- Add a tiny warning at the top only. Rejected: doesn't give enough context for someone making an adoption decision.

### 1.3 — Honest RBAC docs (verb regex + its known misses)

**What we changed:** The RBAC section now explicitly lists the verb regex (`create | update | delete | edit | …`) and documents:
- Tools whose name happens to contain a verb as a noun (e.g. `*_delete_status`) get false-positive blocks.
- Tools that use unusual verbs (e.g. a hypothetical `*_clobber_database`) get false-negative passes.
- There is no per-tool override yet; this is on the roadmap.

**Why it was necessary:** Write detection by regex is a clever shortcut, but undocumented cleverness is a trap. Honest documentation of the trade-off lets users decide whether the heuristic is good enough for their setup.

**Impact:** Sets correct expectations + invites contributions toward a config escape hatch.

**Alternatives considered:**
- Build the override system now. Rejected: scope creep on a docs PR.
- Document only the rule, not the misses. Rejected: same trust problem as above.

### 1.4 — Backend-unreachable behavior section

**What we changed:** Added a section explaining what happens when a backend fails to start, when a backend is slow, and when a backend dies mid-session — drawn from reading the actual code in `src/gateway/mcpClient/` and `src/index.ts`.

**Why it was necessary:** A natural evaluator question is "does the whole gateway fall over if one backend is down?" The answer is "no — failures are isolated and logged" but it wasn't written down.

**Impact:** Removes a question that would otherwise need to be answered in an issue or DM.

### 1.5 — Troubleshooting section

**What we changed:** Added a Troubleshooting section covering:
- Firestore auth failures (`Could not load the default credentials`)
- Backend never appearing in `tools/list` (usually a missing token or hanging OAuth)
- `Access denied` errors (working as intended — your Firestore role is `dev`)
- "Identity not found" at tool-call time

Each item has the symptom, the cause, and the fix.

**Why it was necessary:** The reviewer specifically called out that Firestore auth failures and backend connection timeouts would be the most likely first-time pain points. Better to address them up front than via issue triage.

**Impact:** Fewer support questions; faster recovery for users who hit known problems.

### 1.6 — CONTRIBUTING.md + CHANGELOG.md

**What we changed:** Created [CONTRIBUTING.md](../../CONTRIBUTING.md) (workflow + prioritized roadmap) and [CHANGELOG.md](../../CHANGELOG.md) (Keep-a-Changelog format with a `0.1.0` entry).

**Why it was necessary:** With 0 forks and 1 star, the repo needs to signal "this is intentional, here's how to contribute, here's where it's going." A CONTRIBUTING file and a CHANGELOG are table-stakes signals of an actively-maintained project.

**Impact:** Potential contributors now have a place to look before opening duplicate issues. The CHANGELOG anchors what each release adds.

**Alternatives considered:**
- Tag `v0.1.0` immediately. Held off — flagged for you to do when ready.
- Pin a GitHub roadmap issue. Held off — easier to do once the first PR (#1) lands as a reference point.

---

## Part 2 — Docker Compose quickstart (PR #1)

The main work of the session. PR: https://github.com/rohitjb/mcp-gateway/pull/1.

### 2.1 — What "the quickstart" actually is

**Concept primer (skip if familiar):**

- **Docker** is a tool that runs apps inside isolated "containers" — think lightweight VMs that share the host kernel. Each container has its own filesystem, processes, and network namespace.
- A **Docker image** is a frozen snapshot of an app and its dependencies. You build an image once, then start any number of running containers from it.
- **Docker Compose** is a tool for describing a group of containers that work together (e.g. "a web app + its database + its cache"). The description lives in `docker-compose.yml`.
- **`docker exec`** runs a command inside an already-running container.

**What we built:** `docker compose up` now boots three containers — a fake Firestore database, a one-shot script that seeds it with demo users, and the gateway itself wired to a small fake backend. Total time from `git clone` to "the gateway is running": about 30 seconds.

**Why it was necessary:** Before this, an evaluator had to create a real Firebase project, get real backend tokens, install pnpm, and run `gcloud auth login` — about 30 minutes of yak-shaving before they could see anything. Most evaluators drop off somewhere in that funnel.

**Impact:** Time-to-first-success drops from ~30 minutes to ~30 seconds. Anyone can clone the repo, run one command, and see RBAC actually blocking a write.

**Alternatives considered (decided up front):**
- **Run the gateway locally, only emulator + mock backend in docker.** Lighter (no Dockerfile for the gateway), but the user still needs Node + pnpm + clone, which weakens the "30 second" pitch.
- **Add a real HTTP transport to the gateway as part of this work.** Cleanest evaluator experience but doubles the scope. Deferred to follow-up issue #2.

We picked the full-docker approach because it gives the simplest evaluator UX without expanding scope.

### 2.2 — Firestore emulator support in `initFirestore`

**Concept primer:** The Firestore emulator is a free local program from Google that pretends to be the real Firestore database. Your code talks to it the same way it would talk to the real thing, but no GCP project is needed.

**What we changed:** ~6 lines in [src/rbac/firestore.ts](../../src/rbac/firestore.ts). When the env var `FIRESTORE_EMULATOR_HOST` is set, the gateway skips the call to `applicationDefault()` (which would try to load real Google credentials) and skips the connectivity probe (which would fail without those credentials). The `firebase-admin` SDK then routes all queries to the emulator automatically.

**Why it was necessary:** Without this, the gateway can't run against the emulator — it would crash at startup trying to load credentials that don't exist.

**Impact:** Useful beyond the docker quickstart — CI pipelines and local development can now run the gateway without a real GCP project. Two new unit tests cover both branches.

**Alternatives considered:**
- **Ship a fake service-account JSON file inside the docker image.** Rejected: feels hacky, the fake credentials sit alarmingly in the repo, and it would mask the real fix.
- **Wrap with a flag like `--use-emulator`.** Rejected: `FIRESTORE_EMULATOR_HOST` is already the standard env var the firebase-admin SDK recognizes; following the convention is less surprising.

### 2.3 — Mock stdio MCP backend

**Concept primer:** An "MCP backend" is any program that speaks the Model Context Protocol over standard input/output (stdio). It exposes "tools" (think function names + parameter schemas) and handles "tool calls" (run the function with arguments, return a result).

**What we changed:** Created [docker/mock-backend/index.ts](../../docker/mock-backend/index.ts) — a ~40-line stdio MCP server with two tools:
- `search` — returns canned mock results.
- `create` — returns a canned success response.

The gateway prefixes them as `demo_search` and `demo_create` when exposing them to the AI client. `demo_create` matches the gateway's write-verb regex, so RBAC correctly blocks it for `dev` role.

**Why it was necessary:** The quickstart needs *something* the gateway can talk to. A mock that we control gives us:
- No external dependencies (no API keys, no rate limits, no network flakiness).
- Deterministic responses for the demo.
- Exactly the right tool surface to demonstrate RBAC (one read tool, one write tool).

**Impact:** An evaluator can call both tools, see the read succeed for everyone, and see the write blocked for the `dev` user. The demo proves the gateway's value prop in two commands.

**Alternatives considered:**
- **Use a real GitHub MCP server with a test PAT.** The original reviewer suggested this. Rejected because: (a) requires the evaluator to supply a PAT or ship one (token leak risk), (b) introduces network flakiness, (c) weakens the "zero setup" pitch. Moved to follow-up issue #3 as an *opt-in* profile.
- **Skip a mock entirely and just demo `tools/list`.** Rejected: doesn't actually prove RBAC works, which is the main thing worth showing.

### 2.4 — Firestore seeder (one-shot script)

**What we changed:** Created [docker/seed-firestore.ts](../../docker/seed-firestore.ts) — a script that writes the RBAC config document into the emulator at startup. Document shape:

```typescript
rbac/config = {
  leads: ['lead@example.com'],
  dev:   ['viewer@example.com'],
}
```

This is the shape `src/rbac/firestore.ts:89-104` reads at runtime. It is idempotent (uses `.set()`, not `.add()`), so re-running it is safe.

**Why it was necessary:** Without seeded data, the gateway's first tool call would fail with "User not found." Hand-seeding inside the emulator container would be painful and racy.

**Impact:** Anyone running `docker compose up` gets a working RBAC config with no manual steps.

**Alternatives considered:**
- **Bake the seed into the emulator image itself.** Rejected: would require building a custom emulator image and complicates updates.
- **Seed at every tool call (lazy).** Rejected: hides the "set up your users" step that real deployments will need.

### 2.5 — `Dockerfile` for the gateway image

**Concept primer:** A `Dockerfile` is a recipe for building a Docker image. Each line is a step — install dependencies, copy files, set the default command, etc.

**What we changed:** Created [Dockerfile](../../Dockerfile) — uses `node:20-alpine` as the base (small Linux image with Node 20 pre-installed), installs pnpm, installs the project's dependencies via `pnpm install --frozen-lockfile`, copies the source, and sets a default command that starts the gateway with the docker-specific config.

Also created [.dockerignore](../../.dockerignore) so files like `node_modules`, the developer's real `gateway.config.json` (which has real tokens!), and `.git` don't get baked into the image.

**Why it was necessary:** Without a Dockerfile, there's no way to build an image of the gateway, so the compose stack can't run it.

**Impact:** The gateway runs identically on any machine that has Docker, without requiring Node or pnpm to be installed locally.

**Alternatives considered:**
- **Use a fatter base image (`node:20` instead of `node:20-alpine`).** Slightly easier (some npm packages have issues with Alpine's musl libc), but the resulting image would be ~3× larger. We didn't hit any musl-related issues so the smaller image won.
- **Multi-stage build (build a slim production image).** Overkill for a quickstart — the dev-friendly single-stage build is fine and reads more clearly.

### 2.6 — `docker-compose.yml` wiring the three services together

**What we changed:** Created [docker-compose.yml](../../docker-compose.yml) defining three services:

| Service | What it does | Lifecycle |
|---------|--------------|-----------|
| `firestore-emulator` | Runs Google's official Firestore emulator on port 8080 | Long-running |
| `seeder` | One-shot — writes the demo RBAC config, then exits | Runs once, exits 0 |
| `gateway` | The MCP gateway, configured to use the emulator + mock backend | Long-running |

Services start in dependency order: emulator must be healthy → seeder runs → gateway starts. The gateway container is named `mcp-gateway-quickstart` so the README's `docker exec` commands have a predictable name to target.

**Why it was necessary:** Docker Compose is the glue that turns "three things that have to start in the right order" into "one command."

**Impact:** `docker compose up` becomes the single command an evaluator needs to remember.

**Alternatives considered:**
- **Use one big container running all three processes (supervisord-style).** Rejected: violates the "one process per container" Docker convention; harder to debug; harder to swap the emulator for the real Firestore later.
- **Use Kubernetes manifests instead.** Rejected: massive overkill for a quickstart; raises the prerequisites bar from "have Docker" to "have a cluster."

### 2.7 — `docker/demo-call.sh` wrapper

**What we changed:** Created [docker/demo-call.sh](../../docker/demo-call.sh) — a small Bash script that sends an MCP `tools/call` to the running gateway. It handles the JSON-RPC initialization sequence (`initialize` + `notifications/initialized` + `tools/list` + wait + `tools/call`) so the user doesn't have to.

**Why it was necessary:** Two reasons:
1. The MCP protocol requires a specific message sequence before tool calls work; raw `echo | docker exec` skips it.
2. The MCP SDK processes incoming requests concurrently (see [Part 4.3](#43--mcp-sdk-processes-json-rpc-requests-concurrently) for why this matters). The wrapper inserts the right ordering so the demo is reliable.

**Impact:** The README's "Try it in 30 Seconds" section can now use clean one-liners like `./docker/demo-call.sh demo_create '{"name":"widget"}'` instead of multi-line JSON pipes.

**Alternatives considered:**
- **Fix the SDK race in the gateway itself** (make `handleCallTool` await `backendsReady` like `handleListTools` does). Tempting, but real AI clients never hit this race because they always call `tools/list` first and wait for the response. Fixing it in the gateway would just be defensive — and is worth doing eventually, but not as part of the quickstart PR.
- **Inline the JSON-RPC dance in the README.** Rejected: ugly, error-prone for users to copy correctly, and easy to silently break.

### 2.8 — README "Try it in 30 Seconds" section

**What we changed:** Added a new section near the top of the README that shows the three-command flow:

```bash
git clone https://github.com/rohitjb/mcp-gateway
cd mcp-gateway
docker compose up --build
# in another terminal:
./docker/demo-call.sh demo_create '{"name":"widget"}'                            # → success
./docker/demo-call.sh demo_create '{"name":"widget"}' viewer@example.com         # → Access denied
./docker/demo-call.sh demo_search '{"query":"hello"}' viewer@example.com         # → results
```

Plus a clear note that this is a *demo*, not a *deployment* — the real setup is below.

**Why it was necessary:** A quickstart is only useful if people can find it and follow it. Burying it would defeat the purpose.

**Impact:** The reader's first decision is no longer "should I commit 30 minutes to set this up?" but "should I commit 30 seconds to try it?"

---

## Part 3 — Drive-by fixes

Things we found while doing other work. Small enough to fix in place rather than file as tickets.

### 3.1 — Smart router missed `miro` entirely

**What we changed:** Added `miro` to `KNOWN_BACKENDS` in [src/router/classify.ts](../../src/router/classify.ts) with whiteboard / sticky / brainstorm / mindmap keywords.

**Why it was necessary:** The hardcoded list had five backends — `atlassian`, `firebase`, `teams`, `github`, `figma` — but never included `miro`, even though miro is in the example config and you actually use it. The `search_all` tool was silently never routing queries to miro, which means a query like "find my whiteboard notes" would never hit it.

**Impact:** `search_all` now correctly considers miro for relevant queries.

**Alternatives considered:**
- **Make `KNOWN_BACKENDS` derive from the loaded config** (the architectural fix). Rejected for this PR: bigger refactor, classify tests would need to change, worth a separate ticket. The minimal fix unblocks miro without expanding scope.

### 3.2 — Stale `classify` test (expected 4 backends, got 6)

**What we changed:** Updated `src/router/classify.tests.ts` — bumped the "no keywords match" length assertion from 4 to 6 and added the missing `toContain('figma')` and `toContain('miro')` checks.

**Why it was necessary:** The test was written when there were 4 backends; figma was added without updating the test; the assertion failed on `main` and was masking the miro miss above. Tests that are out of sync with the code are worse than no tests — they erode trust.

**Impact:** Full test suite goes from 99/100 passing to 100/100. Future contributors hit a green suite.

### 3.3 — README documented the wrong Firestore schema

**What we changed:** The "Add users to Firestore" section in the README was telling people to create a `users/{email} → { role }` collection. The code has always read `rbac/config → { dev: [emails], leads: [emails] }`. Fixed the docs to match.

**Why it was necessary:** Anyone following the README would have hand-created a collection the gateway never queries, then hit "User not found" with no obvious explanation.

**Impact:** First-time setup actually works now.

**How we caught it:** While writing the seeder for the docker quickstart, I had to look at the *actual* shape the code reads. The mismatch between the code and the docs was obvious once both were open at the same time.

---

## Part 4 — Real bugs caught during end-to-end verification

These are the things that broke during the actual `docker compose up` test run. Each is fixed in PR #1.

### 4.1 — `wget` not in `cloud-sdk:emulators` image

**The problem:** The first version of `docker-compose.yml` used a healthcheck of `wget --spider -q http://localhost:8080` to confirm the emulator was ready. The check failed because Google's `cloud-sdk:emulators` image doesn't ship `wget`. The emulator IS running; the *check command* couldn't run. Compose then refused to start dependent services because the emulator was marked "unhealthy."

**The fix:** Switched the healthcheck to `curl -fsS http://localhost:8080`. We verified by running `docker run --rm --entrypoint sh gcr.io/.../cloud-sdk:emulators -c "which wget curl"` — only `curl` was present.

**Why it matters:** Container healthchecks are how Compose decides when to start the next service. A broken healthcheck looks identical to "the service is broken."

**Lesson:** Always verify what tooling your base image actually ships before depending on a specific binary in a healthcheck.

### 4.2 — Mock backend tool names were double-prefixed

**The problem:** The mock backend originally named its tools `demo_search` and `demo_create`. The gateway then automatically prefixed them with the backend name (`demo` in `gateway.config.docker.json`), producing `demo_demo_search` and `demo_demo_create`. The README documents `demo_search` and `demo_create`, so the README commands would fail.

**The fix:** Renamed the mock backend's tools to bare `search` and `create`. The gateway adds the `demo_` prefix automatically, so the AI client sees them as `demo_search` and `demo_create` — matching the README.

**Lesson:** The gateway's namespacing convention is "backend-key prefix + tool's own name." Mock backends should follow this convention, just like real backends do (e.g. GitHub's MCP server's `create_pull_request` becomes `github_create_pull_request`).

### 4.3 — MCP SDK processes JSON-RPC requests concurrently

**The problem:** When I tested the gateway by piping `initialize` + `tools/list` + `tools/call` into `docker exec`, the call returned `"Unknown tool: demo_create"`. Looking at the timing logs, the `tools/call` was processed *before* the backend had finished registering its tools — even though `tools/list` came earlier in the input.

This happens because the MCP SDK dispatches incoming requests concurrently. `tools/list` blocks on a "backends are ready" promise; `tools/call` doesn't. The two run in parallel and `tools/call` finishes first when there's no real network delay.

**Why real AI clients never hit this:** A real client calls `tools/list`, *waits for the response*, then calls `tools/call`. The wait serializes the requests. Raw shell pipes don't wait.

**The fix:** [docker/demo-call.sh](../../docker/demo-call.sh) inserts a `sleep 6` between `tools/list` and `tools/call`. Crude but effective for a demo wrapper. The "right" fix — making `handleCallTool` await `backendsReady` too — is worth doing eventually but was out of scope for this PR.

**Lesson:** When testing protocols designed for request/response clients via raw pipes, you have to mimic the client's pacing yourself.

### 4.4 — zsh doesn't word-split unquoted variables

**The problem:** My first attempt at a batch test used a Bash function with an `email_env` variable holding `-e GATEWAY_USER_EMAIL=viewer@example.com`. Two of three tests "passed" but with the wrong identity — viewer was being treated as lead. The RBAC log showed `email=lead@example.com` even when I'd set `viewer@example.com`.

**The cause:** zsh (which this Mac uses by default) does NOT word-split unquoted variables. So `docker exec -i $email_env mcp-gateway-quickstart` passed `-e GATEWAY_USER_EMAIL=viewer@example.com` as **one single argument**, not two. Docker silently ignored the malformed argument and the env var never reached the container.

**The fix:** Stopped relying on variable expansion. Rewrote the wrapper script to use proper Bash arrays (`EXEC_ARGS+=(-e "GATEWAY_USER_EMAIL=$EMAIL")`) so each arg is a distinct string.

**Lesson:** Bash and zsh have different word-splitting semantics. If a script needs to pass conditional args to a command, use arrays, not unquoted variable expansion.

---

## Part 5 — Follow-up work we deliberately didn't do

Two GitHub issues filed for tomorrow:

- **[Issue #2 — HTTP transport for the gateway server](https://github.com/rohitjb/mcp-gateway/issues/2)** — The README's "Cloud Hosting" section is aspirational. Adding an HTTP transport (likely `StreamableHTTPServerTransport`) is the single biggest unlock for both the cloud-hosting story and a cleaner docker-quickstart UX (point Claude Desktop at `http://localhost:3000/mcp` instead of a `docker exec` command). Includes the security gating discussion (untrusted multi-tenant exposure must not happen until verified identity ships).
- **[Issue #3 — Real-backend opt-in profile for the quickstart](https://github.com/rohitjb/mcp-gateway/issues/3)** — `docker compose --profile real up` to swap the mock for a real GitHub MCP server when `GITHUB_PAT` is set. Bridges "see it run in 30 seconds" and "see it work with my real stack."

**Why we deferred these:** Both are real features (not just polish), each takes meaningful design + implementation time, and the PR was already big enough that mixing them in would have made it hard to review. Separate issues + separate PRs = each lands cleanly.

**Other things we chose not to do (no ticket — these are decisions, not deferred work):**
- **Image push to a registry.** Deliberately local-build-only. Once we publish, we own the publishing cadence.
- **Multi-arch image builds.** Same reasoning — once we publish.
- **Switch to a lighter Firestore emulator image** (e.g. third-party `mtlynch/firestore-emulator-docker`). Google's official image is ~1.5 GB but it's official; the smaller third-party alternative would save bandwidth but adds a trust dependency on a maintainer outside Google. For a security-focused project this is the wrong trade.
