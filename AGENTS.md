# AGENTS.md

Guidance for developers and coding agents working on **ceph-calc**, *The ceph real net capacity calculator*: a
static Vue 3 single-page app that answers "how much data can this Ceph cluster really hold?". The
[README](README.md) covers the features and the calculation model. This file covers how the code is organised,
the conventions to follow, and the deliberate decisions that are easy to undo by accident.

**Status:**
- **Beta, not published yet.** There are no public links, users or stored state to stay compatible with, so
  **don't add migration or backward-compatibility code** for URL state or `localStorage`. Renaming or rescaling a
  field is fine. Revisit this once the site is live.
- **License:** GPL-3.0-only.
- **Package manager:** npm (`package-lock.json`). Yarn Plug'n'Play files are ignored on purpose.

## Commands

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # vitest (src/**/*.test.ts, node environment)
npx vue-tsc --noEmit # type-check only
npm run build        # vue-tsc + vite build into dist/
npm run preview      # serve dist/ (http://localhost:4173)
podman build -t ceph-calc -f Containerfile .   # runs tests + build inside the image
```

**Before every commit:** run `npm test` and the type-check. Both must pass, and the container build runs the tests
too.

## Architecture

```
src/
  App.vue                 state owner: reads/writes the URL hash, computes results, warnings, facts
  components/             presentational components; ConfigPanel = steps 1–4 on the left
  lib/                    framework-free logic, all of it unit-tested
    ceph.ts               capacity model (computeCapacity, placeableCapacity, ratios, placement messages)
    topology.ts           CRUSH tree: bucket types, builders, split/duplicate, failureDomains, examples
    pool.ts               pool options (step 4): defaults, derived rule/profile names, validation
    commands.ts           generated Ceph command sections (commandsToScript for copy/download)
    schemes.ts            presets (Replication 2x–4x, EC …) and scheme labels
    urlState.ts           AppState <-> compact JSON in the URL hash (#s=…), defaults, untrusted-input checks
    format.ts / units.ts  number formatting; TB/TiB display unit (formatCapacity)
    pricing.ts            price per TB, cost per usable TB, formatPrice, CURRENCY_MAX_LENGTH
    iops.ts               IOPS estimate: OSD ops per client op (opCosts), capacity-weighted OSD count, ceiling
    faq.ts                FAQ anchor ids + openFaq()
  styles/                 _tokens.scss (breakpoints, fonts, mixins), _themes.scss (colour tokens), main.scss
```

**Data flow:**
1. `App.vue` holds a single `reactive<AppState>` and keeps it in the URL hash.
2. It derives the failure domains with `failureDomains()` and the result with `computeCapacity()`.
3. It passes both down. Components may call the `src/lib/` functions (e.g. `SchemeTable` runs `computeCapacity()` for
   every preset) but never reimplement capacity logic.

## Capacity model (`src/lib/ceph.ts`)

```
real net = placeable(domains − N largest) × nearfull × f
```

- **Terms:**
  - `w` = copies/shards per object (`size` or `k+m`);
  - `f` = data fraction (`1/size` or `k/(k+m)`);
  - `N` = recovery reserve, counted in failure domains.
- **Placement (water-filling):** `placeableCapacity()` uses the rule that no failure domain can hold more than `1/w`
  of the stored data. Space beyond that in an oversized domain is *stranded*.
- **The bar is split so that usable + protection + reserved + unusable = raw.** Tests enforce this; keep it true.
  - **Reserved headroom** is kept free on purpose:
    - **recovery reserve** = `healthyPlaceableTB − placeable after losing the N largest domains`;
    - **nearfull headroom**.
  - **Unusable** can never be filled, not even by a healthy cluster:
    - **stranded** = `placed − healthyPlaceableTB`;
    - **outside failure domains**: hosts not under any bucket of the failure-domain type.
- **Ratio markers and "+X until backfillfull/full"** use `healthyPlaceableTB × ratio`: the healthy cluster, not the
  plan.
- **`min_size`:**
  - replicated pools use the user's value;
  - EC uses Ceph's default `k + min(1, m − 1)` (`schemeMinSize`).
- **"Not enough failure domains" wording** comes from `placementHint()` / `placementMessage()` only (e.g. "needs 8
  hosts (+ 2 recovery reserve)"). Don't build such sentences elsewhere.
- **First visit:** Replication 3x, recovery reserve 0, ratios 0.85 / 0.90 / 0.95, no price and no IOPS (step 5
  "Miscellaneous"; empty `NumberField`s with `blank-zero` mean "not set"). The currency starts as the browser
  locale's symbol (`localCurrency()` in `pricing.ts`).

## IOPS estimate (`src/lib/iops.ts`)

```
N_eff = placed capacity / largest OSD      (CRUSH weights I/O by capacity; equal OSDs = OSD count)
IOPS  = N_eff / (reads / R + writes / W)   (R, W = per-OSD read / write IOPS at the client I/O size, step 5)
```

- **OSD operations per client op** (`opCosts`; d = min(k, ⌈I/O size / stripe_unit⌉), requests aligned to their size):
  - replication: 1 read / n writes;
  - classic EC: k reads (k+m with `fast_read`) / k reads + k+m writes;
  - `allow_ec_optimizations` (Tentacle): d reads / min(d+m, k−d) reads + d+m writes;
  - whole stripes (a multiple of k × stripe_unit): k+m writes and no reads; a remainder is a partial stripe.
- **Checked against Ceph's FastEC table** (6+2, stripe_unit 16K: 4–16K writes 3r+3w, 32K writes 4r+4w); keep those
  test cases.
- **Opt-in:** with both inputs at 0 the result card's IOPS row and the table's IOPS column are hidden. A value an
  operation needs but that is 0 shows "—".
- **Scope:** a healthy-cluster ceiling only. Keep it that way unless the model is extended deliberately (network,
  CPU, latency and recovery are out of scope).

## Conventions

### Terminology (UI *and* code identifiers)

| Use | Not |
| --- | --- |
| Real net capacity | net capacity, usable capacity (as the headline) |
| Recovery reserve (`recoveryReserve`, `recoveryReserveTB`) | heal, re-heal, healDomains |
| Reserved headroom / Unusable | "reserved margins" for both |
| Nearfull headroom (`nearfullHeadroomTB`) | full margin |
| Protection overhead | parity/replica overhead |
| Failure domain ("Spread across" in the UI) | |

- **Ceph names:** write *Ceph* in prose. The site title stays lowercase: "The ceph real net capacity calculator".
- **Settings:** use the exact Ceph spellings (`min_size`, `nearfull_ratio`, `allow_ec_overwrites`, …).

### Vue / TypeScript
- **Components:** Vue 3 `<script setup lang="ts">`, with scoped SCSS per component. Keep logic in `src/lib/` (testable)
  and keep components thin.
- **Style:** match the surrounding code. Comments are short and explain *why*; there are no linters, so follow the
  existing formatting (2 spaces, no semicolons, single quotes, about 120 columns).
- **Formatting numbers:** use `formatCapacity()` for every displayed capacity (it follows the TB/TiB toggle),
  `formatInt` / `formatPct` / `formatPrice` for the rest, and `plural(type, n)` for bucket names. Don't format by
  hand.
- **Numeric inputs:** these are text inputs with `inputmode`, never `type="number"` (`NumberField`, `MiniStepper`).
  They accept a comma or a dot and step with the arrow keys.

### Styling
- **Tokens and mixins:** `_tokens.scss` is injected into every SFC by Vite (`additionalData`). It provides
  `below($bp-md | $bp-sm)`, `touch`, `caption` and `card-title`.
- **Colours:** every colour is a CSS custom property in `_themes.scss`. **Add each new token to both `$dark` and
  `$light`.** The theme follows the system preference until the user picks one, with dark as the fallback.
- **Responsive:** two columns above 900px and one column below. The page must work at phone width with no
  horizontal scrolling. Container queries follow the card width, not the viewport: the capacity legend
  (4 → 2 × 2 → 1 columns) and the comparison table (compact rows below 40rem, 45rem with the IOPS column).
- **Icons:** hand-drawn single-path SVGs (24×24 viewBox, stroke 2, round caps) in `AppIcon.vue`. Add new ones there;
  there is no icon library.
- **Hatching:** reserved headroom uses a grey hatch and unusable space a yellow-tinted hatch, in the bar and in the
  comparison mini bars.

### State, links and storage
- **Shared links:** the whole configuration lives in the URL hash as base64url JSON (`#s=…`). Short keys are listed in
  `urlState.ts`: `v t b a d s f bf nf r p pt cu io`.
  - Clamp and validate on **both** encode and decode.
  - Share limits through constants, e.g. `CURRENCY_MAX_LENGTH`.
- **FAQ links** use `openFaq()`, not `#fragment` links, because the hash holds the configuration.
- **Per-viewer preferences** live in `localStorage`: `ceph-calculator-theme`, `ceph-calculator-unit` and
  `ceph-calculator-step-N` (collapsed steps; steps 2–5 start collapsed). Always wrap `localStorage` access in
  `try/catch`.

### Topology editor
- **"From Basic"** and the first switch to Advanced create one `host ×N`, not N separate hosts.
- **Splitting** creates at most `SPLIT_LIMIT` (500) entries. The remainder stays as a count on the last entry, so
  capacity is never lost.
- **Examples:** each entry in `TOPOLOGY_EXAMPLES` loads a complete setup: topology, failure domain, scheme and
  recovery reserve, with the default ratios. A test checks that every example gives a valid layout.

### Generated commands (`commands.ts`)
- **No `min_size` for EC pools:** Ceph already sets it on creation and the UI can't change it.
- **No empty sections:** push a section only when it has lines (e.g. "EC options", "Autoscaler hints").
- **Default names:**
  - CRUSH rules: `rep3_host`, `ec4-2_rack_nvme` (k and m separated, so EC 2+11 and EC 21+1 don't collide);
  - EC profiles: `ec-4-2-rack-nvme`.
- **EC techniques:** `TECHNIQUES_BY_PLUGIN` lists only what each plugin accepts (clay: no `liberation` and no
  `blaum_roth`).
- **`allow_ec_optimizations`:** emitted with a note (Tentacle or later, cannot be disabled). `poolIssues` flags
  plugins/techniques other than jerasure or isa with `reed_sol_van`, and a `stripe_unit` below 16K.

## Container, nginx and CI
- **Image:** multi-stage `Containerfile`. The Node 22 build stage runs on the build platform and runs the tests; the
  runtime is `nginx-unprivileged` on port **8080**, with `/healthz`.
- **Name:** `ceph-calc` everywhere: image, labels, package name and license path.
- **Open Graph:**
  - `index.html` uses the placeholder origin `https://ceph-calc.invalid` in `og:url` / `og:image`;
  - `nginx.conf` replaces it per request (`sub_filter`) with the request's scheme (`X-Forwarded-Proto`) and a
    whitelisted `Host`;
  - Vite leaves absolute URLs alone, so the placeholder survives the build;
  - **Don't write the placeholder string anywhere else in `index.html`**: nginx replaces every occurrence.
- **CI** (`.github/workflows/container.yml`) publishes `ghcr.io/<owner>/ceph-calc` for linux/amd64 and linux/arm64:
  - `latest` from `main`;
  - `X.Y.Z` from tags `vX.Y.Z`;
  - pull requests only build.

## Checking UI changes
- **Unit tests** cover `src/lib/` only. For UI changes, build and look at the page:
  - run `npm run build && npm run preview`;
  - load a state through the URL hash and take screenshots with headless Chromium, in both themes and at a few
    widths (about 1400, 1000 and 390 px).
- **Making a `#s=` state:** write a small script, run it with `npx vite-node`, and add the output to the URL as
  `#s=…`:
  ```ts
  import { defaultState, encodeState } from './src/lib/urlState'
  const s = defaultState(); s.basic = { hosts: 8, osdsPerHost: 4, osdSizeTB: 8 }; s.recoveryReserve = 2
  console.log(encodeState(s))
  ```
- **Theme and TB/TiB unit:** both come from `localStorage`, not the hash. A same-origin harness page (e.g. a
  temporary `dist/_check.html` that sets `localStorage` and loads the app in an iframe) can set them before the app
  starts. Delete it afterwards.

## Commits
- **One logical change per commit.** Write the message so it explains *why*.
- **Keep the docs in sync** in the same commit: README features and calculation model, FAQ texts, tests.
