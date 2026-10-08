<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { FAQ_IDS } from '@/lib/faq'
</script>

<template>
  <section class="card faq">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="help" :size="17" /></span>
      <h2>FAQ</h2>
    </div>

    <div class="items">
      <details :id="FAQ_IDS.realNet" class="item" open>
        <summary>
          <AppIcon name="chevron" :size="14" class="caret" />
          <span>Why is the real net capacity lower than the capacity on other Ceph calculators?</span>
        </summary>
        <div class="answer">
          <p>
            Most calculators show the <strong>full net capacity</strong>: raw capacity divided by the number of
            replicas (or multiplied by k/(k+m) for erasure coding). That is how much data fits if every OSD is
            filled to 100%, which a real cluster never does:
          </p>
          <ul>
            <li>at the <strong>nearfull ratio</strong> (default 0.85) Ceph raises <code>HEALTH_WARN</code>,</li>
            <li>at the <strong>backfillfull ratio</strong> (0.90) recovery and backfill stop,</li>
            <li>at the <strong>full ratio</strong> (0.95) the cluster refuses writes.</li>
          </ul>
          <p>
            This calculator shows the <strong>real net capacity</strong> instead: the data you can store while every
            OSD stays below the nearfull ratio, even after recovering from the failures covered by the recovery
            reserve. Space that uneven failure domains can never fill is left out as well.
          </p>
          <p class="example-title">How the calculator computes it</p>
          <pre class="formula">real net = placeable(domains − N largest) × nearfull × f</pre>
          <dl class="terms">
            <dt><code>N largest</code></dt>
            <dd>
              The recovery reserve: the N largest failure domains are taken out, as the worst case to recover from.
            </dd>
            <dt><code>placeable(…)</code></dt>
            <dd>
              Capacity of the remaining domains that can actually be filled. Every object puts one copy or shard on
              each of w different domains, so no domain can hold more than 1/w of the data; space beyond that in an
              oversized domain is stranded. With equal domains this is simply the sum.
            </dd>
            <dt><code>f</code></dt>
            <dd>Data fraction: 1/size for replication, k/(k+m) for erasure coding.</dd>
          </dl>
          <p>
            The full net capacity is the same formula with all ratios at 1.00 and no recovery reserve.
          </p>

          <p class="example-title">Example: 4 hosts × 10 TB, replication 3x</p>
          <table class="example">
            <tbody>
              <tr>
                <th scope="row">Full net capacity</th>
                <td><code>placeable(4 × 10 TB) × 1.00 × 1/3</code></td>
                <td class="num">13.3 TB</td>
              </tr>
              <tr>
                <th scope="row">Real net capacity</th>
                <td><code>placeable(4 × 10 TB) × 0.85 × 1/3</code></td>
                <td class="num">11.3 TB</td>
              </tr>
              <tr>
                <th scope="row">… with recovery reserve 1</th>
                <td><code>placeable(4 × 10 TB − 1 × 10 TB) × 0.85 × 1/3</code></td>
                <td class="num">8.5 TB</td>
              </tr>
            </tbody>
          </table>
          <p>
            Storing more than 11.3 TB puts the cluster into health warnings. With a recovery reserve of one host,
            stay below 8.5 TB: then the data of a failed host can be re-replicated onto the remaining three hosts
            and they still stay below the nearfull ratio.
          </p>

          <p class="example-title">Example: hosts of 20 + 10 + 10 + 10 TB, replication 3x</p>
          <table class="example">
            <tbody>
              <tr>
                <th scope="row">Full net capacity</th>
                <td><code>placeable(50 TB) = 45 TB × 1.00 × 1/3</code></td>
                <td class="num">15 TB</td>
              </tr>
              <tr>
                <th scope="row">Real net capacity</th>
                <td><code>45 TB × 0.85 × 1/3</code></td>
                <td class="num">12.75 TB</td>
              </tr>
              <tr>
                <th scope="row">… with recovery reserve 1</th>
                <td><code>placeable(50 TB − 1 × 20 TB) = 30 TB × 0.85 × 1/3</code></td>
                <td class="num">8.5 TB</td>
              </tr>
            </tbody>
          </table>
          <p>
            The 20 TB host may hold at most a third of the data, so 5 TB of it can never be filled, and the recovery
            reserve takes out the 20 TB host as the largest one. A simplified formula
            (<code>raw ÷ replicas × ratio</code>, minus an average host for the reserve) would claim 14.2 TB and
            10.6 TB here.
          </p>
          <p class="tip">
            <AppIcon name="sparkle" :size="14" />
            <span>
              To see the full net capacity here, set the nearfull, backfillfull and full ratios to
              <code>1.00</code> and the recovery reserve to <code>0</code> (step 3, Headroom).
            </span>
          </p>
        </div>
      </details>

      <details :id="FAQ_IDS.recoveryReserve" class="item">
        <summary>
          <AppIcon name="chevron" :size="14" class="caret" />
          <span>What is the recovery reserve, and why should it be at least 1?</span>
        </summary>
        <div class="answer">
          <p>
            When a host (or another failure domain) fails, Ceph re-creates the lost copies or shards on the remaining
            hosts. It starts this automatically once the OSDs have been down for
            <code>mon_osd_down_out_interval</code> (10 minutes by default). That only works if the remaining hosts have
            enough free space. The <strong>recovery reserve</strong> keeps that space free: it is the number of
            failure domains whose data must fit on the rest, while every OSD stays below the nearfull ratio.
          </p>
          <p>
            With a reserve of <code>0</code>, the calculator assumes a healthy cluster may be filled right up to
            nearfull. After a failure there is no room to recover: backfill stops at the backfillfull ratio, the
            affected placement groups stay degraded with fewer copies, and the cluster cannot heal itself until
            hardware is replaced. A further failure in that window can make data unavailable or lose it.
          </p>

          <p class="example-title">Example: 5 hosts × 40 TB, replication 3x, one host fails</p>
          <table class="example">
            <tbody>
              <tr>
                <th scope="row">Reserve 0</th>
                <td><code>placeable(5 × 40 TB) × 0.85 × 1/3</code></td>
                <td class="num">56.7 TB</td>
              </tr>
              <tr>
                <th scope="row">Reserve 1</th>
                <td><code>placeable(5 × 40 TB − 1 × 40 TB) × 0.85 × 1/3</code></td>
                <td class="num">45.3 TB</td>
              </tr>
            </tbody>
          </table>
          <ul>
            <li>
              <strong>Reserve 0:</strong> the hosts hold 170 TB of raw data (56.7 TB × 3). After one host fails, 170 TB
              must fit on 160 TB. Recovery stops at backfillfull (0.90 × 160 TB = 144 TB), so 26 TB of copies stay
              missing.
            </li>
            <li>
              <strong>Reserve 1:</strong> the hosts hold 136 TB of raw data. After one host fails it fits on the
              remaining 160 TB at 85%: recovery completes and every object has 3 copies again.
            </li>
          </ul>

          <p class="example-title">How large should it be?</p>
          <ul>
            <li>
              <strong>At least 1</strong> for any production cluster, so a single failed host is healed automatically.
            </li>
            <li>
              <strong>2 or more</strong> for large clusters where several failures can overlap, or when replacing
              hardware takes long.
            </li>
            <li>
              The reserve is counted in failure domains. With <em>rack</em> as failure domain, a reserve of 1 keeps
              the capacity of one rack (the largest) free, spread across all racks.
            </li>
          </ul>
        </div>
      </details>

      <details :id="FAQ_IDS.iops" class="item">
        <summary>
          <AppIcon name="chevron" :size="14" class="caret" />
          <span>How are the IOPS estimated?</span>
        </summary>
        <div class="answer">
          <p>
            From the random read and write IOPS of a single OSD at the chosen client I/O size (step 5), the calculator
            estimates how many client operations per second the pool handles before its busiest OSDs are saturated.
            Each client operation costs OSD operations, depending on the pool layout:
          </p>
          <table class="costs">
            <thead>
              <tr>
                <th scope="col">Layout</th>
                <th scope="col">Client read</th>
                <th scope="col">Client write</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Replication, size n</th>
                <td>1 read (primary)</td>
                <td>n writes</td>
              </tr>
              <tr>
                <th scope="row">EC k+m</th>
                <td>k reads (k+m with <code>fast_read</code>)</td>
                <td>k reads + k+m writes</td>
              </tr>
              <tr>
                <th scope="row">EC k+m, optimized</th>
                <td>d reads</td>
                <td>min(d+m, k−d) reads + d+m writes</td>
              </tr>
              <tr>
                <th scope="row">EC, whole stripes</th>
                <td></td>
                <td>k+m writes, no reads</td>
              </tr>
            </tbody>
          </table>
          <p>
            Classic EC reads the whole stripe and rewrites all shards on a small write (read-modify-write). With
            <code>allow_ec_optimizations</code> (step 4, Ceph Tentacle or later) Ceph reads only the shards holding
            the data and updates just the changed data shards and the parity shards, using whichever of parity-delta
            or partial writes reads less.
          </p>
          <p>
            <code>fast_read</code> lowers the latency of single reads (any k of the k+m replies are enough) but costs m
            extra OSD reads per request, so the IOPS ceiling drops. With EC optimizations the estimate ignores it.
          </p>
          <p>
            <code>d</code> is the number of data shards a request touches: ⌈I/O size ÷ <code>stripe_unit</code>⌉, at
            most k. A 4K request always fits into one strip (<code>d</code> = 1); a 64K request with a 16K
            <code>stripe_unit</code> touches 4 shards. A request covering whole stripes (a multiple of
            k × <code>stripe_unit</code>) is written without reading. That is why Ceph recommends a
            <code>stripe_unit</code> of at least 16K with EC optimizations: medium-sized requests touch fewer shards.
          </p>

          <p class="example-title">How the calculator computes it</p>
          <pre class="formula">N_eff = capacity of all OSDs ÷ capacity of the largest OSD
IOPS  = N_eff ÷ (reads ÷ R + writes ÷ W)</pre>
          <dl class="terms">
            <dt><code>R</code>, <code>W</code></dt>
            <dd>Random read and write IOPS of one OSD at the chosen I/O size.</dd>
            <dt><code>reads</code>, <code>writes</code></dt>
            <dd>OSD operations per client operation, from the table above. Reads and writes share the OSD's time.</dd>
            <dt><code>N_eff</code></dt>
            <dd>
              CRUSH spreads data, and with it the I/O, by capacity, so the largest OSDs get the most requests and
              saturate first. With equal OSDs this is simply the number of OSDs.
            </dd>
          </dl>

          <p class="example-title">Example: 12 OSDs, each 200 read and 200 write IOPS at 4K</p>
          <table class="example">
            <tbody>
              <tr>
                <th scope="row">Replication 3x</th>
                <td><code>12 × 200 ÷ 1</code> · <code>12 ÷ (3 ÷ 200)</code></td>
                <td class="num">2,400 / 800</td>
              </tr>
              <tr>
                <th scope="row">EC 4+2</th>
                <td><code>12 × 200 ÷ 4</code> · <code>12 ÷ (4 ÷ 200 + 6 ÷ 200)</code></td>
                <td class="num">600 / 240</td>
              </tr>
              <tr>
                <th scope="row">EC 4+2, optimized</th>
                <td><code>12 × 200 ÷ 1</code> · <code>12 ÷ (3 ÷ 200 + 3 ÷ 200)</code></td>
                <td class="num">2,400 / 400</td>
              </tr>
            </tbody>
          </table>

          <p class="example-title">Assumptions</p>
          <ul>
            <li>
              the per-OSD IOPS are measured on an OSD at the chosen I/O size (e.g. fio, or
              <code>ceph tell osd.N bench</code> for writes), so BlueStore overhead is included;
            </li>
            <li>
              requests are aligned to their size; strips of one shard that a request touches count as one operation,
              and shard operations smaller than the request count as full operations (slightly conservative).
            </li>
          </ul>

          <p class="example-title">Not included</p>
          <ul>
            <li>network bandwidth and latency, and the CPU of the OSD hosts;</li>
            <li>
              single-client performance: a client that waits for each request (queue depth 1) is limited by latency,
              not by these numbers;
            </li>
            <li>recovery, backfill and scrubbing, which compete for the same OSDs.</li>
          </ul>
          <p>
            The estimate assumes the drives are the limit. That makes the numbers for optimized EC pools an upper bound:
            with partial reads a small read touches one OSD instead of k, so the model predicts up to k times more read
            IOPS. Ceph's own Tentacle benchmarks measured 2–3× faster small reads for EC 6+2, because CPU and network
            become the limit first.
          </p>
          <p class="tip">
            <AppIcon name="sparkle" :size="14" />
            <span>
              EC optimizations need the jerasure or isa plugin with <code>reed_sol_van</code> and cannot be disabled
              once set. Ceph recommends a <code>stripe_unit</code> of at least 16K for such pools.
            </span>
          </p>
        </div>
      </details>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.items {
  display: grid;
  gap: 0.6rem;
  padding: 0.6rem 1.4rem 1.4rem;
}

.item {
  scroll-margin-top: 1rem;
  border: 1px solid var(--border);
  border-radius: $radius;
  background: var(--panel-alt);

  summary {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    padding: 0.8rem 0.95rem;
    cursor: pointer;
    list-style: none;
    font-weight: 600;

    &::-webkit-details-marker {
      display: none;
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
      border-radius: $radius;
    }
  }

  .caret {
    flex: 0 0 auto;
    margin-top: 0.25rem;
    color: var(--text-muted);
    transition: transform 0.15s;
  }

  &[open] .caret {
    transform: rotate(90deg);
  }

  // Briefly highlighted after a "?" help button jumped here.
  &.flash {
    animation: faq-flash 1.6s ease-out;
  }
}

@keyframes faq-flash {
  0%,
  40% {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--focus);
  }
  100% {
    box-shadow: 0 0 0 3px transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .item.flash {
    animation: none;
    border-color: var(--accent);
  }
}

.answer {
  padding: 0 0.95rem 0.95rem 2.2rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.55;

  p {
    margin: 0 0 0.7rem;
  }

  strong {
    color: var(--text);
    font-weight: 600;
  }

  ul {
    margin: 0 0 0.7rem;
    padding-left: 1.2rem;
  }

  code {
    font-family: $font-mono;
    font-size: 0.82em;
    color: var(--text);
  }
}

.example-title {
  margin-top: 1.1rem !important;
  color: var(--text);
  font-weight: 600;
}

.formula {
  margin: 0 0 0.6rem;
  padding: 0.6rem 0.8rem;
  border-radius: $radius-sm;
  background: var(--code-bg);
  color: var(--code-text);
  font-family: $font-mono;
  font-size: 0.82rem;
  white-space: pre-wrap;
}

.terms {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.35rem 0.9rem;
  margin: 0 0 0.7rem;

  dt {
    white-space: nowrap;
  }

  dd {
    margin: 0;
  }
}

.example {
  width: 100%;
  margin: 0 0 0.7rem;
  border-collapse: collapse;
  font-size: 0.86rem;

  th,
  td {
    padding: 0.45rem 0.6rem;
    border-top: 1px solid var(--border);
    text-align: left;
    font-weight: 400;
  }

  th {
    color: var(--text);
    white-space: nowrap;
  }

  .num {
    text-align: right;
    font-family: $font-display;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
  }
}

.costs {
  width: 100%;
  margin: 0 0 0.7rem;
  border-collapse: collapse;
  font-size: 0.84rem;

  th,
  td {
    padding: 0.4rem 0.5rem;
    border-top: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
    font-weight: 400;
  }

  thead th {
    border-top: 0;
    @include caption;
    font-size: 0.74rem;
  }

  tbody th {
    color: var(--text);
  }
}

.tip {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: $radius-sm;
  background: var(--accent-soft);
  color: var(--text);

  svg {
    flex: 0 0 auto;
    margin-top: 0.2rem;
    color: var(--accent-text);
  }
}

@include below($bp-sm) {
  .items {
    padding: 0.5rem 1rem 1rem;
  }

  .answer {
    padding-left: 0.95rem;
  }

  .terms {
    grid-template-columns: 1fr;

    dd {
      margin-bottom: 0.4rem;
    }
  }

  // Stack the example rows: label, formula and result on separate lines.
  .example tr {
    display: grid;
    grid-template-columns: 1fr auto;
    border-top: 1px solid var(--border);
    padding: 0.4rem 0;
  }

  .example th,
  .example td {
    border-top: 0;
    padding: 0.1rem 0.2rem;
  }

  .example td:not(.num) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
