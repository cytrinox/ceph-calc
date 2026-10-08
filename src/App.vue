<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import CapacitySummary from './components/CapacitySummary.vue'
import CommandsPanel from './components/CommandsPanel.vue'
import ConfigPanel from './components/ConfigPanel.vue'
import FaqPanel from './components/FaqPanel.vue'
import SchemeTable from './components/SchemeTable.vue'
import ShareButton from './components/ShareButton.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import UnitToggle from './components/UnitToggle.vue'
import { computeCapacity, placementMessage, ratiosOrdered, type Scheme } from './lib/ceph'
import { formatInt, formatPct, formatTB } from './lib/format'
import { formatCapacity } from './lib/units'
import { clusterPrice, formatPrice, pricePerUsableTB } from './lib/pricing'
import { compressedCapacityTB } from './lib/pool'
import AppIcon from './components/AppIcon.vue'
import { schemeLabel } from './lib/schemes'
import {
  buildBasicTopology,
  domainBalance,
  failureDomains,
  UNBALANCED_SPREAD,
  num,
  plural,
  presentTypes,
  topologyStats,
  type DomainType,
} from './lib/topology'
import { defaultState, readStateFromUrl, writeStateToUrl, type AppState } from './lib/urlState'

// Same calculator pictogram as the favicon (served from public/).
const logoUrl = `${import.meta.env.BASE_URL}favicon.svg`

const state = reactive<AppState>(readStateFromUrl() ?? defaultState())

// Seed the advanced tree from the basic settings the first time it is opened.
watch(
  () => state.tab,
  (tab) => {
    if (tab === 'advanced' && !state.advanced) state.advanced = buildBasicTopology(state.basic)
  },
  { immediate: true },
)

function resetFromBasic() {
  state.advanced = buildBasicTopology(state.basic)
}

const topology = computed(() =>
  state.tab === 'basic' ? buildBasicTopology(state.basic) : (state.advanced ?? []),
)

const stats = computed(() => topologyStats(topology.value))

const domainOptions = computed<DomainType[]>(() =>
  state.tab === 'basic' ? ['osd', 'host'] : ['osd', ...presentTypes(topology.value)],
)

watch(
  domainOptions,
  (options) => {
    if (!options.includes(state.failureDomain)) {
      state.failureDomain = options.includes('host') ? 'host' : options[0]
    }
  },
  { immediate: true },
)

const domains = computed(() => failureDomains(topology.value, state.failureDomain))
const input = computed(() => ({ groups: domains.value.groups, unplacedTB: domains.value.unplacedTB }))
const tunables = computed(() => ({
  fullRatio: num(state.fullRatio),
  backfillfullRatio: num(state.backfillfullRatio),
  nearfullRatio: num(state.nearfullRatio),
  recoveryReserve: num(state.recoveryReserve),
}))
const result = computed(() => computeCapacity(input.value, state.scheme, tunables.value))

const facts = computed(() => {
  const s = stats.value
  const fd = state.failureDomain
  const reserve = tunables.value.recoveryReserve
  const list =
    state.tab === 'basic'
      ? [`${formatInt(s.counts.host)} × ${state.basic.osdsPerHost} OSDs × ${formatTB(state.basic.osdSizeTB)}`]
      : [`${formatInt(s.counts.host)} ${plural('host', s.counts.host)}`, `${formatInt(s.counts.osd)} ${plural('osd', s.counts.osd)}`]
  if (fd !== 'host' && fd !== 'osd') list.push(`${formatInt(result.value.domainCount)} ${plural(fd, result.value.domainCount)}`)
  const r = result.value
  const nf = r.fillRatios.nearfull.toFixed(2)
  list.push(
    reserve > 0
      ? `below nearfull ${nf} even after recovering ${reserve} failed ${plural(fd, reserve)}`
      : `below nearfull ${nf}, no recovery reserve`,
  )
  if (r.valid) list.push(`healthy OSDs at most ${formatPct(r.healthyFill)} full`)
  return list
})

const warnings = computed(() => {
  const list: string[] = []
  const s = state.scheme
  const r = result.value
  const fd = state.failureDomain
  if (s.kind === 'replicated') {
    if (s.size === 1) list.push('size 1 keeps a single copy: any failure loses data.')
    else if (s.minSize === 1) list.push('min_size 1 accepts writes with a single copy left; this risks data loss.')
  } else if (s.m === 1) {
    list.push(
      'm = 1: Ceph sets min_size = k, so after one failure the pool keeps accepting writes with no redundancy left; a second failure loses data.',
    )
  }
  if (fd === 'osd' && stats.value.counts.host === 1) {
    list.push('Single host: OSD as failure domain only protects against drive failures; losing the host takes all data offline.')
  } else if (fd === 'osd' && stats.value.counts.host > 1) {
    list.push('Failure domain osd: one host failure can take out several copies of the same object.')
  }
  if (r.valid && r.reserved.strandedTB > r.rawTB * 0.01) {
    list.push(
      `${formatCapacity(r.reserved.strandedTB)} stranded: the largest ${plural(fd, 1)} is too big relative to the others for a ${r.width}-wide scheme.`,
    )
  }
  const balance = domainBalance(domains.value.groups)
  if (balance && balance.spread > UNBALANCED_SPREAD) {
    const reserve = tunables.value.recoveryReserve
    const reserveCost =
      reserve > 0
        ? ` The recovery reserve must cover the largest ${plural(fd, 1)}: ${formatCapacity((balance.largestTB - balance.averageTB) * reserve)} more than for average-sized ones.`
        : ''
    list.push(
      `Unbalanced ${plural(fd)}: ${formatCapacity(balance.smallestTB)} to ${formatCapacity(balance.largestTB)} (average ${formatCapacity(balance.averageTB)}).${reserveCost} CRUSH also spreads data less evenly across uneven ${plural(fd)}.`,
    )
  }
  if (domains.value.unplacedTB > 0) {
    const n = domains.value.unplacedHosts
    list.push(
      `${formatInt(n)} ${plural('host', n)} (${formatCapacity(domains.value.unplacedTB)}) are not inside any ${fd} and cannot be used by this rule.`,
    )
  }
  if (state.tab === 'advanced' && stats.value.emptyBuckets > 0) {
    list.push('Some buckets contain no OSDs.')
  }
  if (!ratiosOrdered(tunables.value)) {
    list.push('Ratios out of order: Ceph requires nearfull ≤ backfillfull ≤ full.')
  }
  if (tunables.value.fullRatio > 0.95) {
    list.push('Full ratio above the Ceph default 0.95 leaves very little room for recovery.')
  }
  return list
})

const placementProblem = computed(() => placementMessage(result.value, state.failureDomain) ?? undefined)

// Effective capacity when the pool compresses data (only with compression enabled).
const compression = computed(() => {
  const r = result.value
  if (!r.valid) return null
  const effectiveTB = compressedCapacityTB(r.usableTB, state.pool)
  if (effectiveTB === null) return null
  const ratio = state.pool.compressionRatio
  return {
    effective: formatCapacity(effectiveTB),
    detail: `${formatCapacity(r.usableTB)} usable ÷ ${ratio.toFixed(2)} expected compression ratio (${state.pool.compressionAlgorithm}, ${state.pool.compressionMode})`,
  }
})

const price = computed(() => {
  const perTB = num(state.pricePerTB)
  if (perTB <= 0) return null
  const r = result.value
  const total = clusterPrice(r.rawTB, perTB)
  const perUsable = r.valid ? pricePerUsableTB(total, r.usableTB) : null
  return {
    total: formatPrice(total, state.currency),
    perUsableTB: perUsable === null ? null : formatPrice(perUsable, state.currency),
    detail: `${formatTB(r.rawTB)} raw × ${formatPrice(perTB, state.currency)} per TB`,
  }
})

function selectScheme(scheme: Scheme) {
  state.scheme = scheme
}

// Keep the URL hash in sync so a configuration can be shared as a link.
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  state,
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => writeStateToUrl(state), 300)
  },
  { deep: true },
)
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <img class="logo" :src="logoUrl" alt="" width="44" height="44" />
        <div>
          <h1>
            The ceph real net capacity
            <span class="nowrap">calculator<span
                class="beta"
                title="Experimental: results are estimates, please verify them before ordering hardware"
              >beta</span
            ></span>
          </h1>
          <p>Calculate the storage size of your future ceph cluster.</p>
        </div>
      </div>
      <div class="top-actions">
        <UnitToggle />
        <ShareButton :state="state" />
        <ThemeToggle />
      </div>
    </header>

    <main class="layout" :class="{ advanced: state.tab === 'advanced' }">
      <ConfigPanel
        :state="state"
        :domain-options="domainOptions"
        :osd-count="stats.counts.osd"
        :domain-count="result.domainCount"
        :width="result.width"
        @reset-from-basic="resetFromBasic"
      />
      <div class="results">
        <CapacitySummary
          :result="result"
          :scheme-name="schemeLabel(state.scheme)"
          :facts="facts"
          :price="price"
          :compression="compression"
          :domain="state.failureDomain"
          :recovery-reserve="tunables.recoveryReserve"
          :warnings="warnings"
        />
        <SchemeTable
          :input="input"
          :tunables="tunables"
          :current="state.scheme"
          :domain="state.failureDomain"
          @select="selectScheme"
        />
        <CommandsPanel
          :pool="state.pool"
          :scheme="state.scheme"
          :domain="state.failureDomain"
          :tunables="tunables"
          :placement-problem="placementProblem"
        />
        <FaqPanel />
      </div>
    </main>

    <footer class="page-foot">
      <p>
        <AppIcon name="pulse" :size="14" />
        <span>
          Estimates assume a well-balanced CRUSH map; actual MAX AVAIL in <code>ceph df</code> follows the fullest OSD.
        </span>
      </p>
      <p class="disclaimer">
        <AppIcon name="alert" :size="14" />
        <span>
          <strong>Disclaimer:</strong> this calculator is in beta. All results are estimates, provided without any
          warranty. Please verify them before ordering hardware or changing a production cluster, and review the
          generated commands before running them.
        </span>
      </p>
      <p class="license">
        Free software, licensed under the
        <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU GPL v3.0</a>
        ·
        <a href="https://github.com/cytrinox/ceph-calc" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </p>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.app {
  max-width: 1300px;
  margin: 0 auto;
  padding: 1.5rem 1.5rem 2rem;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;

  h1 {
    margin: 0;
    font-family: $font-display;
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  p {
    margin: 0.15rem 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  // Keeps the beta badge on the same line as the last word.
  .nowrap {
    white-space: nowrap;
  }

  .beta {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--warning) 60%, transparent);
    border-radius: 999px;
    background: var(--warning-soft);
    color: var(--warning);
    font-family: $font-mono;
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    vertical-align: 0.3em;
    cursor: help;
  }
}

.logo {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
}

.layout {
  display: grid;
  grid-template-columns: minmax(340px, 390px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;

  &.advanced {
    grid-template-columns: minmax(380px, 480px) minmax(0, 1fr);
  }
}

.results {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}

.page-foot {
  display: grid;
  justify-items: center;
  gap: 0.45rem;
  margin-top: 2rem;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-faint);
  text-align: center;

  p {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
  }

  .disclaimer {
    max-width: 62rem;
    align-items: flex-start;

    svg {
      flex: 0 0 auto;
      margin-top: 0.15rem;
    }

    strong {
      color: var(--text-muted);
      font-weight: 600;
    }
  }

  // Plain inline text, so the link and the full stop are not spaced apart like flex items.
  p.license {
    display: block;
  }

  code {
    font-family: $font-mono;
  }

  a {
    color: var(--text-muted);
    white-space: nowrap;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;

    &:hover {
      color: var(--accent-text);
    }
  }
}

@include below($bp-md) {
  .app {
    padding: 1rem $gutter 1.5rem;
  }

  .layout,
  .layout.advanced {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  .results {
    gap: 1rem;
  }
}

@include below($bp-sm) {
  // Title on its own row, controls right-aligned below it.
  .topbar {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .brand {
    flex: 1 1 100%;
  }

  .top-actions {
    margin-left: auto;
  }

  .brand {
    h1 {
      font-size: 1.2rem;
    }

    p {
      font-size: 0.8rem;
    }
  }

  .logo {
    width: 38px;
    height: 38px;
  }

  .page-foot {
    justify-items: start;
    text-align: left;

    p {
      align-items: flex-start;
    }

    svg {
      flex: 0 0 auto;
      margin-top: 0.15rem;
    }
  }
}
</style>
