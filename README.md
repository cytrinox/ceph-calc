# The ceph real net capacity calculator

A Vue 3 web tool that calculates the **real net capacity** of a Ceph pool on a given topology: the data you
can store while every OSD stays below the nearfull ratio, even after recovering from failures. It also shows
**protection overhead, reserved and unusable space, efficiency, tolerated failures and minimum failure domains**.

Source: <https://github.com/cytrinox/ceph-calc>

- **Basic** topology: OSD hosts × OSDs per host × OSD size (failure domain `host` or `osd`).
- **Advanced** topology: a full CRUSH tree with every default bucket type
  (`host`, `chassis`, `rack`, `row`, `pdu`, `pod`, `room`, `datacenter`, `zone`, `region`).
  Every bucket has a `×N` multiplier for identical copies plus duplicate/split/remove actions, and
  hosts contain one or more OSD groups (`count × size`, with a device class: hdd, ssd or nvme, default ssd, or a
  custom class name). Any bucket type can be the failure domain. When the CRUSH rule is restricted to a device class (step 4), only OSDs of
  that class and the buckets containing them count; the others are named in a callout. The Basic topology has no
  device class: its OSDs always match the rule.
  **Examples** (from a small 4-host cluster to two datacenters) load a complete setup: topology, failure domain,
  pool layout, recovery reserve and Ceph's default fill ratios.
- Miscellaneous (step 5, optional): a price per TB of raw drive capacity, empty by default, with a free-text
  currency that starts as the browser locale's symbol (`€`, `$`, `£`, `CHF`, …); once a price is set, the Real net
  capacity card shows the cluster's drive cost and the cost per usable TB. The PG target per OSD
  (`mon_target_pg_per_osd`, default 100 like Ceph) drives the pg_num recommendation and is set on the cluster when
  changed. "Create virtual CRUSH map" adds a panel below the layout comparison with the output `ceph osd crush tree`
  would print for the hardware: every `×N` copy and OSD as its own item with Ceph-style IDs, names and weights
  (TiB), optionally with the shadow trees per device class (`--show-shadow`), and a button that copies the whole
  tree. Large trees show their first 500 rows each. A CRUSH bucket weighs at most 65,536 TiB (32-bit fixed point);
  when the hardware exceeds that with Ceph's default weights (TiB), a warning appears and the recommendations
  suggest `osd_crush_initial_weight = 1`.
- Pool schemes: replication (`size`, `min_size`) or erasure coding (`k`, `m`, and `min_size`, which defaults to
  Ceph's `k + min(1, m − 1)`), with common presets.
- Headroom: recovery reserve (free space to recover the data of N failed failure domains, capped at the
  spare domains = domains − copies/shards per object) and the nearfull (0.85), backfillfull (0.90) and full
  (0.95) ratios. The ratios stay in order: raising one raises the ones above it, lowering one lowers the ones
  below it.
- Pool configuration: pool name, application, CRUSH rule name, device class (built-in, used in the tree, or custom),
  EC profile and plugin, EC `technique` and `stripe_unit`, `allow_ec_overwrites`, `fast_read`,
  `allow_ec_optimizations` (Ceph Tentacle), PG autoscaling, `pg_num` for the autoscaler off or in warn mode (default
  32 like Ceph; the recommendations suggest the value the autoscaler would aim for), `bulk`, `target_size_ratio` /
  `target_size_bytes`, compression (with an expected compression ratio, default 0.90, shown as an effective-capacity
  badge), quotas, and the `nodelete` / `nosizechange` flags. Leave the rule or profile name empty to get a derived
  name such as `rep3_host` or `ec-4-2-rack-nvme`.
- IOPS (also step 5, optional): a client I/O size (4K–1M) and, on the Advanced tab in one tab per device class of
  the tree (custom classes included; the Basic tab has one set without tabs), the random read and write IOPS of one
  OSD at that size give an estimated cluster ceiling for the selected layout (result card, with the arithmetic in
  the tooltip) and for every preset (comparison table).
- Raw data distribution bar: usable data, protection overhead, reserved headroom (kept free on purpose) and,
  when there is any, unusable space (yellow; can never be filled), with markers where a healthy cluster
  reaches the nearfull, backfillfull and full ratios. Below the usable share, `+X until backfillfull` /
  `+X until full` shows how much more data fits before those limits.
- Comparison table of all presets on the current topology, plus a chart: usable capacity as a line (TB on the
  left axis, efficiency as % of raw on the right; both are the same series since raw is shared) over stacked bars
  of survives / needs, with the available failure domains as a dashed line. Click a row or column to select it.
- Recommendations panel (shown only when there is one; each recommendation starts collapsed to its headline and
  expands on click): with a recovery reserve, the planned data fills healthy OSDs well below the planning nearfull
  ratio, so it recommends setting Ceph's `nearfull_ratio` to that level (e.g. 0.68 instead of 0.85 for 5 hosts and
  reserve 1). Ceph then warns as soon as more data is stored than planned, while a failure can still be recovered
  below 0.85. For replication with size 1 it lists the settings Ceph needs: `mon_allow_pool_size_one` (always part
  of the commands) and `mon_warn_on_pool_no_redundancy false` against the permanent HEALTH_WARN. The commands panel
  applies these with an "Apply recommendations" toggle, one toggle per recommendation. Recommendations that change
  the setup itself (a recovery reserve of 1 instead of 0, 3 copies instead of 1, hosts instead of OSDs as failure
  domain, each with its cost in real net capacity; EC optimizations for an EC pool, with what they save in OSD
  operations and IOPS, Ceph Tentacle or later; the pg_num the autoscaler would aim for when the pool sets its own)
  have an "Adopt recommendation" button: it changes the inputs, and the recommendation is replaced by a short
  "Adopted" note that fades out.
- Ceph commands panel: the full command sequence for the configuration (fill ratios, EC profile, CRUSH rule,
  pool create, size/min_size (replicated), EC options, autoscaler hints, compression, quotas, application,
  protection flags), with copy-all, per-section copy and download as a shell script. EC pools only get a
  `min_size` command when it differs from the default Ceph sets on creation.
- Light/dark theme, responsive single-column layout on phones, and configuration stored in the URL hash;
  the **Share** button copies that link (or opens the native share sheet on phones). The reset button in the Cluster setup
  panel brings every setting back to its default (after asking; theme, unit and open steps stay).
- Link previews (Open Graph / X card) with a screenshot of the calculator.
- **TB / TiB** switch for all results (bar, tables, chart, warnings). Inputs such as OSD sizes stay in decimal TB,
  as drives are sold that way; TiB matches what `ceph df` reports.
- FAQ panel: why the real net capacity is lower than on other calculators (with the formula and worked
  examples) and what the recovery reserve is for. The **?** buttons next to the Real net capacity heading
  and the recovery reserve field jump to the matching answer.
- A release channel badge next to the title (`dev` by default, `beta` in GitHub builds) and a footer disclaimer
  that all results are estimates.

## Calculation model

| Symbol | Meaning |
| --- | --- |
| `w` | shards per object: `size` (replicated) or `k+m` (EC) |
| `f` | data fraction: `1/size` or `k/(k+m)` |
| `N` | recovery reserve (failure domains whose capacity is kept free) |

1. **Raw** = sum of all OSD sizes.
2. **Placement limit (water-filling)**: every object stores exactly one shard in each of `w` distinct
   failure domains, so a domain can never hold more than `1/w` of the stored data. Space that oversized
   domains can never fill, even in a healthy cluster, is reported as *stranded*. Capacity outside any bucket
   of the failure-domain type is reported as *outside failure domains*. Both are **unusable**.
3. **Recovery reserve**: the `N` largest failure domains are taken out, as the worst case to recover from. The
   reserve is the fillable capacity this gives up: `healthy placeable − placeable after losing N` (for equal
   domains simply the capacity of `N` domains).
4. **Fill limit**: after losing the `N` largest failure domains and re-replicating their data onto the rest,
   the surviving OSDs must still be below **nearfull**: stored = `placeable after losing N × nearfull_ratio`.
   The nearfull headroom is never used to absorb recovery data, so every reserved domain costs capacity.
   `backfillfull_ratio` and `full_ratio` are operational limits above the plan; they appear as markers and in
   the generated commands.
5. **Usable** = stored × `f`. **Protection** = stored × `(1 − f)`. The triangles above the capacity bar mark where
   a healthy cluster reaches each ratio: `healthy placeable × ratio` as a share of raw.
6. **Reserved headroom** = recovery reserve + nearfull headroom (kept free on purpose).
   **Unusable** = stranded + outside failure domains (can never be filled).
   Usable + protection + reserved + unusable = raw.
7. **Efficiency** = usable / raw. **Failures tolerated** = `size − 1` or `m`
   (I/O continues through `size − min_size`; EC defaults to Ceph's `min_size = k + min(1, m − 1)`, i.e. `k + 1`,
   or `k` when `m = 1`, and can be set between `k` and `k + m`). **Min domains** = `w + N`.

For a uniform cluster this reduces to `raw × (D − N)/D × nearfull × f`, where `D` is the number of failure domains.

### IOPS estimate

OSD operations per client operation, with `d = min(k, ⌈I/O size ÷ stripe_unit⌉)` data shards touched
(requests aligned to their size):

| Layout | Client read | Client write |
| --- | --- | --- |
| Replication, `size` n | 1 read | n writes |
| EC k+m | k reads (k+m with `fast_read`) | k reads + k+m writes (read-modify-write) |
| EC k+m with `allow_ec_optimizations` | d reads | min(d+m, k−d) reads + d+m writes |
| EC, whole stripes (a multiple of k × `stripe_unit`) | | k+m writes, no reads |

With `R` / `W` the per-OSD read / write IOPS at the I/O size, `N_eff = placed capacity ÷ largest OSD` (CRUSH spreads I/O by
capacity, so the largest OSDs saturate first; equal OSDs give the OSD count) and `IOPS = N_eff ÷ (reads ÷ R +
writes ÷ W)`. With several device classes in the pool (a rule for any class), CRUSH spreads the I/O by capacity
over all of them and each class's largest OSD saturates at its own rate: `IOPS = min over classes c of N_eff,c ÷
(reads ÷ R_c + writes ÷ W_c)` with `N_eff,c = placed capacity ÷ largest OSD of class c`, so the slowest class limits
the pool. A rule restricted to one class uses only its OSDs and values. It is a ceiling for a healthy cluster with many parallel requests; network, CPU, latency, recovery
and scrubbing are not modelled.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
```

## Container image

The image is built with a multi-stage `Containerfile`: Node builds the app, and
`nginx-unprivileged` serves it as a non-root user (UID 101) on port 8080.

```sh
podman build -t ceph-calc -f Containerfile .
podman run --rm -p 8080:8080 ceph-calc
# open http://localhost:8080  (health check: /healthz)
```

`docker build -f Containerfile .` works the same way.

### Icons, manifest and 404s

`favicon.ico` (16/32/48 px), `apple-touch-icon.png` and the web-manifest icons (`icon-192.png`, `icon-512.png`,
`icon-maskable-512.png`) are rendered from `public/favicon.svg` during every build (`build/icons.ts`, also in the
container build), so they always match the SVG; `public/site.webmanifest` lists them. The app keeps its state in the
URL hash and has no other routes, so nginx answers unknown paths with a real 404.

### Channel badge and version label

The badge next to the title shows the release channel from `CEPH_CALC_CHANNEL` (`alpha`, `beta`, `stable` or any
other text); without it, `dev`. GitHub builds pass `beta`.

A label such as `v1.2.3` next to the channel badge shows the nearest git tag matching `vX.Y.Z` (an optional
pre-release suffix like `-rc.1` is allowed); builds after the tag add the commit distance (`v1.2.3+5`). Without a
matching tag there is no label. `CEPH_CALC_VERSION` overrides it at build time:

```sh
npm run build                              # badge "dev", nearest tag via git describe
CEPH_CALC_VERSION=v2.0.0-beta npm run build    # fixed label
CEPH_CALC_CHANNEL=stable npm run build         # badge "stable"
```

The container build has no `.git`, so pass the tag information as a build argument:

```sh
podman build -t ceph-calc -f Containerfile \
  --build-arg CEPH_CALC_GIT_DESCRIBE="$(git describe --tags --long --match 'v[0-9]*.[0-9]*.[0-9]*')" .
podman build -t ceph-calc -f Containerfile --build-arg CEPH_CALC_VERSION=v1.2.3 --build-arg CEPH_CALC_CHANNEL=beta .
```

The link-preview tags (`og:url`, `og:image`) need absolute URLs; nginx fills in the scheme and host of each request.
Behind a reverse proxy, pass the original `Host` header (the default in Traefik, Caddy and ingress-nginx; plain
nginx needs `proxy_set_header Host $host`) and `X-Forwarded-Proto` for https.

## Continuous integration

`.github/workflows/container.yml` builds the image with the `Containerfile` (the unit tests run inside the
build) and publishes it to the GitHub Container Registry as `ghcr.io/<owner>/ceph-calc`, for `linux/amd64`
and `linux/arm64`:

| Trigger | Image tag |
| --- | --- |
| push to `main` | `latest` |
| git tag `vX.Y.Z` | `X.Y.Z` |
| pull request | build only, nothing is pushed |

The workflow checks out the full history and passes `git describe` to the build, so the image shows its version
label (`v1.2.3` for a tag build, `v1.2.3+5` for a later build of `main`).

```sh
git tag v1.0.0 && git push origin v1.0.0     # publishes ghcr.io/<owner>/ceph-calc:1.0.0
podman run --rm -p 8080:8080 ghcr.io/cytrinox/ceph-calc:latest
```

The same tag push also runs `.github/workflows/release.yml`: it creates a **release draft** `v1.0.0` listing the
merged pull requests and all commits since the previous version tag (`.github/scripts/release-notes.sh`; run it
locally to preview the commit list). Review and publish the draft on GitHub; the version label in the page links
to it.

## License

This project is licensed under the GNU General Public License v3.0 (`GPL-3.0-only`). See [LICENSE](LICENSE).
