# AGENTS.md

Guidance for developers and coding agents working on **ceph-calc**, *The ceph real net capacity calculator*: a
static Vue 3 single-page app that answers "how much data can this Ceph cluster really hold?". The
[README](README.md) covers the features and the calculation model. This file covers how the code is organised,
the conventions to follow, and the deliberate decisions that are easy to undo by accident.

**Status:**
- **Beta, not published yet.** There are no public links, users or stored state to stay compatible with, so
  **don't add migration or backward-compatibility code** for URL state or `localStorage`. Renaming or rescaling a
  field is fine. Revisit this once the site is live.
- **License:** AGPL-3.0-only.
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
    pricing.ts            price per TB, cost per usable TB/TiB, formatPrice, CURRENCY_MAX_LENGTH
    recommendations.ts    recommendations from the result (nearfull ratio for the recovery reserve), applied as overrides
    iops.ts               IOPS estimate: OSD ops per client op (opCosts), capacity-weighted OSD count, ceiling
    crushTree.ts          virtual `ceph osd crush tree` output of the topology (step 5 "Create virtual CRUSH map")
    faq.ts                FAQ anchor ids + openFaq()
  styles/                 _tokens.scss (breakpoints, fonts, mixins), _themes.scss (colour tokens), main.scss
  help/                   entry and styles of the help pages (main.ts, help.scss)
help/
  index.html              help page template and overview (/help/), a second Vite entry
  docs/                   help documents: <name>.md (one page each) and img/*.svg figures
build/
  icons.ts / help.ts      Vite plugins: raster icons from favicon.svg; help pages from help/docs
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
  - EC defaults to Ceph's `k + min(1, m − 1)` (`defaultEcMinSize`) and can be changed between k and k+m. The scheme
    only carries `minSize` when it differs from the default (`customEcMinSize`), so presets still match and links
    stay short. Always read it through `schemeMinSize()`.
- **Device classes** (Advanced tab only): OSD groups carry `deviceClass`: one of `OSD_CLASSES` (default ssd) or a
  custom name (`isValidDeviceClass`: CRUSH name characters, no leading "-", at most 32). `DeviceClassSelect` offers
  the built-in classes, custom ones already in the tree, and "custom…", which turns the dropdown into a text field
  in place (Enter or blur turns it back, Escape cancels); step 4 uses it too, with "Any device". Links only keep valid names (else ssd, or any for the pool). A CRUSH rule
  restricted to a class (step 4) computes on `filterDeviceClass()`: hosts keep only that class's OSDs, and buckets
  that lose all their capacity through the filter are dropped (Ceph's empty shadow buckets). Buckets that were empty
  already stay, so the filter never adds empty-domain warnings. Facts, IOPS and the pg_num recommendation use the
  filtered tree; step 1's summary and the failure-domain options use the whole tree. Basic OSDs always match the
  rule (no filter).
- **"Not enough failure domains" wording** comes from `placementHint()` / `placementMessage()` only (e.g. "needs 8
  hosts (+ 2 recovery reserve)"). Don't build such sentences elsewhere.
- **First visit:** Replication 3x, recovery reserve 0, ratios 0.85 / 0.90 / 0.95, no price and no IOPS (step 5
  "Miscellaneous"; empty `NumberField`s with `blank-zero` mean "not set"). The currency starts as the browser
  locale's symbol (`localCurrency()` in `pricing.ts`).

## Recommendations (`src/lib/recommendations.ts`)

- **Pure functions:** `recommendations({ input, result, tunables, scheme, domain, hostInput })` returns a list
  (`hostInput`: the same topology spread across hosts, passed only while spreading across OSDs). The Recommendations
  panel is rendered only when it isn't empty. The commands panel applies the switched-on ones (opt-in "Apply
  recommendations" toggle, one toggle each, local state, not in links): `ratios` become `ratioOverrides`, `config`
  entries become `ceph config set global …` lines in a "Recommended settings" section.
- **Nearfull ratio:** with a recovery reserve, recommend `floor(healthyFill × 100) / 100` as Ceph's `nearfull_ratio`.
  That is the healthy fill at the planned data, so Ceph warns when the plan is exceeded while a failure is still
  recoverable below the planning nearfull. An applied override is emitted even without the other cluster-wide ratios.
  Not offered when the layout tolerates no failure (size 1): nothing can be recovered.
- **CRUSH weight limit:** `crushWeightOverflow()` (crushTree.ts) reports when a bucket would exceed `CRUSH_WEIGHT_MAX`
  (`__u32` 16.16 fixed point, 65,536 TiB) with Ceph's default weights; `App.vue` adds a warning, and the applied
  recommendation sets `osd_crush_initial_weight` to 1 (smaller beyond 65,535 OSDs, `initialWeightFor`), with a caveat
  for mixed OSD sizes. Checked whether or not the CRUSH map panel is shown.
- **Single-copy pools (replication size 1):** `mon_allow_pool_size_one true` is required and always in the commands;
  the recommendation adds `mon_warn_on_pool_no_redundancy false` against the permanent `HEALTH_WARN`.
- **Distribution bar:** `DistributionBar.vue` draws the raw data distribution with its ratio markers. The result card
  (`CapacityBar.vue`, which adds the legend) and the recommendations (with a 30 % larger `recommended` marker via
  `recommendedNearfull`) both use it; change the bar only there, so both stay identical.
- **Two kinds:** *applied* recommendations change the generated commands (`ratios`, `config`; `isApplicable()`), and
  only these get toggles in the commands panel. *Adopted* ones change the calculator's inputs (`adopt.setup`, a
  `SetupChange`). The panel's "Adopt recommendation" button emits it, `App.vue` applies it, and because the
  recommendation's condition no longer holds it vanishes; the panel shows an "Adopted: …" note in its place that
  fades out (`ADOPTED_MS`, matching the CSS animation). Current adopted kinds, each showing its cost in real net
  capacity:
  - recovery reserve 0 → 1 (only with a spare domain);
  - replication size 1 → 3 (or 2 with only two domains);
  - failure domain OSDs → hosts (with several hosts). It keeps the recovery reserve, or lowers it as far as needed
    when there are too few hosts for it;
  - `allow_ec_optimizations` for EC pools without it (jerasure/isa with reed_sol_van only), raising `stripe_unit` to
    16K; the change rows show the OSD operations per client op and, with IOPS set, the estimate. The details say
    Tentacle (v20) or later and that it cannot be switched off. Adopted pool options are a `SetupChange.pool`;
  - `pg_num` for pools that set their own (autoscaler off or warn) whenever it differs from `suggestPgNum()`. The
    details add when Ceph would warn (more than `PG_AUTOSCALE_THRESHOLD` = 3× off, warn mode) or refuse the pool
    (more than `MAX_PG_PER_OSD` = 250 PG replicas per OSD);
  - `stripe_unit` 16K for EC pools with EC optimizations and a smaller one; the change row compares the OSD
    operations at the client I/O size or 16K, whichever is larger.
- **Severity:** `critical` (red warning sign before the headline) only when the current setup risks data loss, e.g.
  replication size 1; everything else is `info` (light bulb, the panel's colour).
- **Collapsed by default:** each recommendation shows only its pictogram, headline, adopt button and chevron; the
  headline (a button with `aria-expanded`) or the chevron expands the rest. The open state is local, not in links.
- **New kinds:** add them to `recommendations()` with their own tests. Keep the texts in the `Recommendation` fields so
  the panel stays generic. Settings a recommendation changes are `changes` ("parameter: from → to"), rendered by the
  generic `SettingChange.vue` (not as KPI-like tiles, which show outcomes). A calculated value shows its calculation
  in `formula` (a formula block below the changes: the general form, the numbers, the result), not only in prose.

## IOPS estimate (`src/lib/iops.ts`)

```
N_eff,c = placed capacity / largest OSD of class c   (CRUSH weights I/O by capacity; equal OSDs = OSD count)
IOPS    = min over the pool's classes c of N_eff,c / (reads / R_c + writes / W_c)
          (R_c, W_c = per-OSD read / write IOPS of class c at the client I/O size, step 5)
```

- **Device classes:** on the Advanced tab step 5 has one tab per class in the tree (`treeClasses`). The Basic tab
  shows no tabs: its OSDs have no class of their own, so its values live under `BASIC_IOPS` ('') and don't change
  with the rule's class; seeding the tree ("From Basic", first switch) copies them to the seeded class unless it has
  values. `osdIops` maps class → values; classes without values have no entry (link key `io`:
  `[sizeKiB, { class: [read, write] }]`, '' allowed). The basis takes the classes of the OSDs the rule uses (`poolTopology`) with
  their largest OSD (`deviceClassUsage().largestTB`); the lowest class ceiling wins (`estimateOp`), and the tooltip
  names that class.

- **Objects:** a RADOS operation addresses one object, so a request larger than the object size (step 5,
  `objectSizeKiB`, default 4M; link `io[2]` when not 4M) costs one per-object request per object (`opCosts`
  multiplies; `costs.objects`). Aligned power-of-two sizes never straddle objects. Client sizes go up to 8M.
- **OSD operations per client op** (`opCosts`; d = min(k, ⌈I/O size / stripe_unit⌉), requests aligned to their size):
  - replication: 1 read / n writes;
  - classic EC: k reads (k+m with `fast_read`) / k reads + k+m writes;
  - `allow_ec_optimizations` (Tentacle): d reads (k+m with `fast_read`, which reads every shard in both paths) /
    min(d+m, k−d) reads + d+m writes;
  - whole stripes (a multiple of k × stripe_unit): k+m writes and no reads; a remainder is a partial stripe.
- **Checked against Ceph's FastEC table** (6+2, stripe_unit 16K: 4–16K writes 3r+3w, 32K writes 4r+4w); keep those
  test cases.
- **Opt-in:** while no class has values the result card's IOPS row and the table's IOPS column are hidden. A value an
  operation needs but that is missing for a class the pool uses shows "—" ("needs read IOPS for hdd").
- **Scope:** a healthy-cluster ceiling only. Keep it that way unless the model is extended deliberately (network,
  CPU, latency and recovery are out of scope).

## Virtual CRUSH map (`src/lib/crushTree.ts`)

- **What:** the text `ceph osd crush tree [--show-shadow]` would print once the hardware is deployed, shown in its own
  panel when step 5's "Create virtual CRUSH map" is on (`crushMap`, link key `cm`). "Include shadow trees" is a local
  view option.
- **Format** (Ceph's TextTable): columns ID / CLASS / WEIGHT right-aligned under left-aligned headings, two spaces
  apart; TYPE NAME indented 4 spaces per level; OSDs print only their name. Tests pin the exact text.
- **IDs:** buckets in tree order, each followed by its shadow buckets (root default -1, default~hdd -2, first host
  -3, …), OSDs from 0. Roots print in ascending ID order, so the shadow trees come first.
- **Weights** (checked against Ceph's source, bit-exact): the OSD registers `"%.4lf"` of max(0.00001, bytes ÷ 2^40)
  (`OSD::update_crush_location`), CRUSH stores `(int)(weight * (float)0x10000)` (`osdCrushWeight`), buckets sum
  their items, and `weightf_t` prints the single-precision value with 5 decimals, 0 as "0" (`formatCrushWeight`).
  `printfFixed` rounds like glibc (exact value, ties to even), not like `toFixed`. The panel shows the formula. Shadow
  trees contain every bucket, with only their class's OSDs.
- **Names:** `×N` copies get the next free name (host01 → host02), like splitting, through a per-prefix cursor so
  huge trees stay fast. The Basic tab's OSDs get the rule's class (as when seeding the Advanced tab).
- **Size:** weights and row counts come from the compact tree; each tree renders at most
  `CRUSH_TREE_ROWS_PER_ROOT` (500) rows and counts the rest ("… N more"). "Copy" generates the complete output on
  click (`rowsPerRoot = Infinity`) and asks first above 250,000 lines (`crushTreeRowCount`, without expanding).

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
- **Formatting numbers:** use `formatCapacity()` for every displayed capacity (it follows the TB/TiB toggle; values
  per capacity, like the cost per usable TB/TiB, convert with `unitPerTB()` and name `capacityUnit`),
  `formatInt` / `formatPct` / `formatPrice` for the rest, and `plural(type, n)` for bucket names. Don't format by
  hand.
- **Numeric inputs:** these are text inputs with `inputmode`, never `type="number"` (`NumberField`, `MiniStepper`).
  They accept a comma or a dot and step with the arrow keys. `NumberField` updates its model on every key and emits
  `commit` for a finished change (blur, −/+ buttons, arrow keys, the default link). React to `commit` when a change
  moves other fields: the fill ratios are linked that way (`linkRatios`), because typing 0.97 passes through 0.

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
- **Favicon and app icons:** `public/favicon.svg` is the only source. `build/icons.ts` (a Vite plugin using
  `@resvg/resvg-js`) renders `favicon.ico`, `apple-touch-icon.png` and the manifest icons at build time and serves
  them in `npm run dev`. Keep the SVG free of `<text>` (outline lettering as paths): the build has no fonts.
- **Hatching:** reserved headroom uses a grey hatch and unusable space a yellow-tinted hatch, in the bar and in the
  comparison mini bars.

### State, links and storage
- **Shared links:** the whole configuration lives in the URL hash as base64url JSON (`#s=…`). Short keys are listed in
  `urlState.ts`: `v t b a d s f bf nf r p pt cu io cm pg`. OSD groups in the tree pack as `[count, sizeTB]`, plus the
  device class when it isn't ssd (`[8, 16, 'hdd']`).
  - Clamp and validate on **both** encode and decode.
  - Share limits through constants, e.g. `CURRENCY_MAX_LENGTH`.
- **FAQ links** use `openFaq()`, not `#fragment` links, because the hash holds the configuration.
- **Reset** (Cluster setup header) assigns `defaultState()`; it is disabled while the state already encodes like the
  defaults. The hash is replaced, not pushed, so there is no undo: it asks first.
- **Per-viewer preferences** live in `localStorage`: `ceph-calculator-theme`, `ceph-calculator-unit` and
  `ceph-calculator-step-N` (collapsed steps; steps 2–5 start collapsed). Always wrap `localStorage` access in
  `try/catch`.

### Topology editor
- **"From Basic"** and the first switch to Advanced create one `host ×N`, not N separate hosts. Its OSD group gets
  the CRUSH rule's device class (ssd for "Any device"), so the result doesn't change with the tab.
- **Splitting** creates at most `SPLIT_LIMIT` (500) entries. The remainder stays as a count on the last entry, so
  capacity is never lost.
- **Examples:** each entry in `TOPOLOGY_EXAMPLES` loads a complete setup: topology, failure domain, scheme and
  recovery reserve, with the default ratios. A test checks that every example gives a valid layout.

### Placement groups (`pool.ts`)
- **Like Ceph's autoscaler** (checked in its source): `suggestPgNum()` = OSDs × `mon_target_pg_per_osd` ÷ pool width,
  rounded with `nearestPowerOfTwo()` (Ceph's `nearest_power_of_two`). The target is a step 5 setting
  (`pgTargetPerOsd`, default 100 like every Ceph release up to Tentacle; Ceph's development branch raises it to 200
  and `mon_max_pg_per_osd` from 250 to 500, commit d34fa3316f. Link key `pg`).
- **`pg_num`** (default 32, Ceph's `osd_pool_default_pg_num`) is used and shown with the autoscaler off or in warn
  mode (`usesPgNum`); "on" creates the pool with `AUTOSCALE_START_PG`.

### Generated commands (`commands.ts`)
- **EC `min_size` only when changed:** Ceph sets the default on creation, so `min_size` is emitted for EC pools only
  when the user picked a different value.
- **Cluster-wide settings** (switch "Include cluster-wide settings", `includeClusterSettings`): the fill ratios and,
  when it isn't 100, `mon_target_pg_per_osd`. Applied recommendation ratios are emitted even with the switch off.
- **No empty sections:** push a section only when it has lines (e.g. "EC options", "Autoscaler hints").
- **Examples** (`usageExamples`): commented-out lines (`CommandLine.example`, rendered and scripted as `# …`) for
  RBD (`rbd create`, `--data-pool` for EC) and CephFS (`ceph fs new`, or `add_data_pool` plus a directory layout for
  EC). The object size is a client setting, not a pool one: with anything but 4M they add `--object-size` (RBD) or
  `setfattr ceph.dir.layout.*` (CephFS, `stripe_unit` first when the object size is smaller than 4M).
- **Default names:**
  - CRUSH rules: `rep3_host`, `ec4-2_rack_nvme` (k and m separated, so EC 2+11 and EC 21+1 don't collide);
  - EC profiles: `ec-4-2-rack-nvme`.
- **EC techniques:** `TECHNIQUES_BY_PLUGIN` lists only what each plugin accepts (clay: no `liberation` and no
  `blaum_roth`).
- **`allow_ec_optimizations`:** emitted with a note (Tentacle or later, cannot be disabled). `poolIssues` flags
  plugins/techniques other than jerasure or isa with `reed_sol_van`. A `stripe_unit` below 16K is not an issue but
  a recommendation (`stripeUnitRecommendation`, adoptable).

## Help documents (`help/`, `build/help.ts`)

- **Add a document:** drop `help/docs/<name>.md` (lowercase, dashes) with a frontmatter of `title`, `description`,
  `author`, `published` (YYYY-MM-DD) and optionally `author-link` (http/https), `revised` (not before `published`; set
  it when changing a document's content) and `order` (lower first). The byline below the title reads "by Author,
  published 13 October 2026 · revised …" (no revised date when it equals `published`); invalid dates or links fail the build. Nothing else to register: it becomes `/help/<name>/`, appears on `/help/` and in
  the FAQ entry "What help documents are available?" (`virtual:help-docs`). Tests render every document.
- **Markdown** (markdown-it): headings get ids (deep links; the h2s form the table of contents), ```` ```formula ````
  fences become formula blocks, tables work. Keep the house style of the FAQ.
- **Figures:** `![Caption](img/x.svg)` on its own line inlines the SVG as a `<figure>` with the alt text as
  caption, so its shapes can use the theme through classes (`canvas`, `box`, `data`, `parity`, `line`,
  `accent-line`, `highlight`, `label`, `title`, `muted`, `on-data`, `on-parity`, `warning-text`; styled in
  `src/help/help.scss`). Give every shape a fallback colour as attribute, use no ids (several figures share a page)
  and keep text short: figures keep a minimum width and scroll sideways on phones. A missing figure fails the build.
- **Pages:** `help/index.html` is a Vite entry (fonts, themes, `main.scss` + `help.scss` via `src/help/main.ts`) and
  the template with `<!--help:title|description|content-->` placeholders. The build fills it as the overview and
  emits `help/<name>/index.html` per document (`generateBundle`); dev renders `/help/<name>/` on request and
  reloads on edits. Links in pages are absolute. Navigation is buttons with icon and caption (`navButton`):
  "Back to the calculator" and "Help" in the header (icons only on phones), "All help documents" and "Back to the
  calculator" at the end of a page. The header also has the calculator's `ThemeToggle`, mounted by
  `src/help/main.ts` (same saved setting; Vue is a chunk shared with the app). The calculator's header links here
  with a "Help" button left of its theme toggle (`App.vue`; icon only on phones, like Share). nginx redirects
  `/help/<name>` to `/help/<name>/`; keep `absolute_redirect off` in `nginx.conf`, or the redirect points at the
  container's own port 8080.
- **Numbers in documents** come from the model: a test checks the ones in `ec-sharding-and-iops.md` against
  `estimateIops`. Update the document when the model changes.

## Container, nginx and CI
- **Image:** multi-stage `Containerfile`. The Node 22 build stage runs on the build platform and runs the tests; the
  runtime is `nginx-unprivileged` on port **8080**, with `/healthz`. Unknown paths are real 404s (`try_files … =404`):
  the app has no routes besides `/`, so don't add an `index.html` fallback.
- **Name:** `ceph-calc` everywhere: image, labels, package name and license path.
- **Version label:** `vite.config.ts` defines `__APP_VERSION__` from `versionLabel()` (`src/lib/version.ts`):
  `CEPH_CALC_VERSION` wins as-is, else `git describe --tags --long` (or `CEPH_CALC_GIT_DESCRIBE`, for builds without
  `.git` such as the container) gives `v1.2.3` / `v1.2.3+5`; no matching tag means no label. CI fetches full history
  and passes the describe output as a build argument.
  The channel badge works the same way: `__APP_CHANNEL__` from `channelLabel(CEPH_CALC_CHANNEL)`, "dev" when unset;
  CI passes `CEPH_CALC_CHANNEL=beta`.
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

  A tag `vX.Y.Z` also creates a GitHub **release draft** (`.github/workflows/release.yml`) with GitHub's generated
  PR list plus all non-merge commits since the previous version tag (`.github/scripts/release-notes.sh`). Re-runs
  leave an existing release alone.

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
