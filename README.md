# The ceph real net capacity calculator

A Vue 3 web tool that calculates **usable capacity, protection overhead, reserved margins, efficiency,
tolerated failures and minimum failure domains** for a Ceph pool on a given topology.

Source: <https://github.com/cytrinox/ceph-calc>

- **Basic** topology: OSD hosts × OSDs per host × OSD size (failure domain `host` or `osd`).
- **Advanced** topology: a full CRUSH tree with every default bucket type
  (`host`, `chassis`, `rack`, `row`, `pdu`, `pod`, `room`, `datacenter`, `zone`, `region`).
  Every bucket has a `×N` multiplier for identical copies plus duplicate/split/remove actions, and
  hosts contain one or more OSD groups (`count × size`). Any bucket type can be the failure domain.
- Price: price per TB of raw drive capacity (default 500) with a free-text currency (`EUR`, `$`, `USD`, …);
  the Net capacity card shows the cluster's drive cost and the cost per usable TB.
- Pool schemes: replication (`size`, `min_size`) or erasure coding (`k`, `m`), with common presets.
- Headroom: recovery reserve (free space to recover the data of N failed failure domains, capped at the
  spare domains = domains − copies/shards per object) and the nearfull (0.85), backfillfull (0.90) and full
  (0.95) ratios.
- Pool configuration: pool name, application, CRUSH rule name, device class, EC profile and plugin,
  EC `technique` and `stripe_unit`, `allow_ec_overwrites`, `fast_read`, PG autoscaling, `pg_num` (with a
  suggested value), `bulk`, `target_size_ratio` / `target_size_bytes`,
  compression (with an expected compression ratio, default 0.90, shown as an effective-capacity badge), quotas, and the `nodelete` / `nosizechange` flags. Leave the rule or profile name empty to get a
  derived name such as `rep3_host` or `ec-4-2-rack-nvme`.
- Comparison table of all presets on the current topology, plus a chart: usable capacity as a line (TB on the
  left axis, efficiency as % of raw on the right; both are the same series since raw is shared) over stacked bars
  of survives / needs, with the available failure domains as a dashed line. Click a row or column to select it.
- Ceph commands panel: the full command sequence for the configuration (fill ratios, EC profile, CRUSH rule,
  pool create, size/min_size, EC flags, autoscaler hints, compression, quotas, application, protection flags),
  with copy-all, per-section copy and download as a shell script.
- Light/dark theme, responsive single-column layout on phones, and configuration stored in the URL hash;
  the **Share** button copies that link (or opens the native share sheet on phones).
- **TB / TiB** switch for all results (bar, tables, chart, warnings). Inputs such as OSD sizes stay in decimal TB,
  as drives are sold that way; TiB matches what `ceph df` reports.

## Calculation model

| Symbol | Meaning |
| --- | --- |
| `w` | shards per object: `size` (replicated) or `k+m` (EC) |
| `f` | data fraction: `1/size` or `k/(k+m)` |
| `N` | recovery reserve (failure domains whose capacity is kept free) |

1. **Raw** = sum of all OSD sizes.
2. **Recovery reserve**: the capacity of the `N` largest failure domains, which is the worst case to recover from.
3. **Placement limit (water-filling)**: every object stores exactly one shard in each of `w` distinct
   failure domains, so a domain can never hold more than `1/w` of the stored data. Space that oversized
   domains can never fill is reported as *stranded*. Capacity outside any bucket of the failure-domain
   type is reported as *outside failure domains*.
4. **Fill limit**: after losing the `N` largest failure domains and re-replicating their data onto the rest,
   the surviving OSDs must still be below **nearfull**: stored = `placeable after losing N × nearfull_ratio`.
   The nearfull headroom is never used to absorb recovery data, so every reserved domain costs capacity.
   `backfillfull_ratio` and `full_ratio` are operational limits above the plan; they appear as markers and in
   the generated commands.
5. **Usable** = stored × `f`. **Protection** = stored × `(1 − f)`. The triangles above the capacity bar mark where
   a healthy cluster reaches each ratio: `healthy placeable × ratio` as a share of raw.
6. **Reserved margins** = recovery reserve + stranded + nearfull headroom + outside. Usable + protection + reserved = raw.
7. **Efficiency** = usable / raw. **Failures tolerated** = `size − 1` or `m`
   (I/O continues through `size − min_size`; EC uses Ceph's default `min_size = k + min(1, m − 1)`, i.e. `k + 1`,
   or `k` when `m = 1`). **Min domains** = `w + N`.

For a uniform cluster this reduces to `raw × (D − N)/D × nearfull × f`, where `D` is the number of failure domains.

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
podman build -t ceph-calculator -f Containerfile .
podman run --rm -p 8080:8080 ceph-calculator
# open http://localhost:8080  (health check: /healthz)
```

`docker build -f Containerfile .` works the same way.

## Continuous integration

`.github/workflows/container.yml` builds the image with the `Containerfile` (the unit tests run inside the
build) and publishes it to the GitHub Container Registry as `ghcr.io/<owner>/ceph-calc`:

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
