# The ceph real net capacity calculator

A Vue 3 web tool that calculates the **real net capacity** of a Ceph pool on a given topology: the data you
can store while every OSD stays below the nearfull ratio, even after recovering from failures. It also shows
**protection overhead, reserved and unusable space, efficiency, tolerated failures and minimum failure domains**.

Source: <https://github.com/cytrinox/ceph-calc>

- **Basic** topology: OSD hosts × OSDs per host × OSD size (failure domain `host` or `osd`).
- **Advanced** topology: a full CRUSH tree with every default bucket type
  (`host`, `chassis`, `rack`, `row`, `pdu`, `pod`, `room`, `datacenter`, `zone`, `region`).
  Every bucket has a `×N` multiplier for identical copies plus duplicate/split/remove actions, and
  hosts contain one or more OSD groups (`count × size`). Any bucket type can be the failure domain.
  **Examples** (from a small 4-host cluster to two datacenters) load a complete setup: topology, failure domain,
  pool layout, recovery reserve and Ceph's default fill ratios.
- Price: price per TB of raw drive capacity (default 500) with a free-text currency (`EUR`, `$`, `USD`, …);
  the Real net capacity card shows the cluster's drive cost and the cost per usable TB.
- Pool schemes: replication (`size`, `min_size`) or erasure coding (`k`, `m`), with common presets.
- Headroom: recovery reserve (free space to recover the data of N failed failure domains, capped at the
  spare domains = domains − copies/shards per object) and the nearfull (0.85), backfillfull (0.90) and full
  (0.95) ratios.
- Pool configuration: pool name, application, CRUSH rule name, device class, EC profile and plugin,
  EC `technique` and `stripe_unit`, `allow_ec_overwrites`, `fast_read`, `allow_ec_optimizations` (Ceph
  Tentacle), PG autoscaling, `pg_num` (with a
  suggested value), `bulk`, `target_size_ratio` / `target_size_bytes`, compression (with an expected
  compression ratio, default 0.90, shown as an effective-capacity badge), quotas, and the `nodelete` /
  `nosizechange` flags. Leave the rule or profile name empty to get a derived name such as `rep3_host`
  or `ec-4-2-rack-nvme`.
- IOPS (step 5, optional): 4k random read and write IOPS per OSD give an estimated cluster ceiling for the
  selected layout (result card) and for every preset (comparison table).
- Raw data distribution bar: usable data, protection overhead, reserved headroom (kept free on purpose) and,
  when there is any, unusable space (yellow; can never be filled), with markers where a healthy cluster
  reaches the nearfull, backfillfull and full ratios. Below the usable share, `+X until backfillfull` /
  `+X until full` shows how much more data fits before those limits.
- Comparison table of all presets on the current topology, plus a chart: usable capacity as a line (TB on the
  left axis, efficiency as % of raw on the right; both are the same series since raw is shared) over stacked bars
  of survives / needs, with the available failure domains as a dashed line. Click a row or column to select it.
- Ceph commands panel: the full command sequence for the configuration (fill ratios, EC profile, CRUSH rule,
  pool create, size/min_size (replicated), EC options, autoscaler hints, compression, quotas, application,
  protection flags), with copy-all, per-section copy and download as a shell script. EC pools keep the
  `min_size` Ceph sets on creation.
- Light/dark theme, responsive single-column layout on phones, and configuration stored in the URL hash;
  the **Share** button copies that link (or opens the native share sheet on phones).
- Link previews (Open Graph / X card) with a screenshot of the calculator.
- **TB / TiB** switch for all results (bar, tables, chart, warnings). Inputs such as OSD sizes stay in decimal TB,
  as drives are sold that way; TiB matches what `ceph df` reports.
- FAQ panel: why the real net capacity is lower than on other calculators (with the formula and worked
  examples) and what the recovery reserve is for. The **?** buttons next to the Real net capacity heading
  and the recovery reserve field jump to the matching answer.
- The site is marked **beta** in the title; a footer disclaimer notes that all results are estimates.

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
   (I/O continues through `size − min_size`; EC uses Ceph's default `min_size = k + min(1, m − 1)`, i.e. `k + 1`,
   or `k` when `m = 1`). **Min domains** = `w + N`.

For a uniform cluster this reduces to `raw × (D − N)/D × nearfull × f`, where `D` is the number of failure domains.

### IOPS estimate

OSD operations per 4k client operation:

| Layout | Client read | Client write |
| --- | --- | --- |
| Replication, `size` n | 1 read | n writes |
| EC k+m | k reads (k+m with `fast_read`) | k reads + k+m writes (read-modify-write) |
| EC k+m with `allow_ec_optimizations` | 1 read | min(1+m, k−1) reads + 1+m writes |

With `R` / `W` the per-OSD read / write IOPS, `N_eff = placed capacity ÷ largest OSD` (CRUSH spreads I/O by
capacity, so the largest OSDs saturate first; equal OSDs give the OSD count) and `IOPS = N_eff ÷ (reads ÷ R +
writes ÷ W)`. It is a ceiling for a healthy cluster with many parallel requests; network, CPU, latency, recovery
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

```sh
git tag v1.0.0 && git push origin v1.0.0     # publishes ghcr.io/<owner>/ceph-calc:1.0.0
podman run --rm -p 8080:8080 ghcr.io/cytrinox/ceph-calc:latest
```

## License

This project is licensed under the GNU General Public License v3.0 (`GPL-3.0-only`). See [LICENSE](LICENSE).
