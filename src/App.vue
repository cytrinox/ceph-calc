<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import CapacitySummary from './components/CapacitySummary.vue'
import CommandsPanel from './components/CommandsPanel.vue'
import ConfigPanel from './components/ConfigPanel.vue'
import CrushTreePanel from './components/CrushTreePanel.vue'
import FaqPanel from './components/FaqPanel.vue'
import RecommendationsPanel from './components/RecommendationsPanel.vue'
import SchemeTable from './components/SchemeTable.vue'
import ShareButton from './components/ShareButton.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import UnitToggle from './components/UnitToggle.vue'
import { computeCapacity, emptyDomainsWarning, placementMessage, ratiosOrdered, schemeMinSize, type Scheme } from './lib/ceph'
import { CRUSH_WEIGHT_MAX, crushWeightOverflow, treeClasses } from './lib/crushTree'
import { formatInt, formatPct, formatTB } from './lib/format'
import { capacityUnit, formatCapacity, unitPerTB } from './lib/units'
import { clusterPrice, formatPrice, pricePerUsable } from './lib/pricing'
import { compressedCapacityTB } from './lib/pool'
import AppIcon from './components/AppIcon.vue'
import { schemeLabel } from './lib/schemes'
import {
  buildBasicTopology,
  DEFAULT_OSD_CLASS,
  deviceClassUsage,
  domainBalance,
  failureDomains,
  filterDeviceClass,
  sortDeviceClasses,
  UNBALANCED_SPREAD,
  num,
  plural,
  presentTypes,
  topologyStats,
  type DomainType,
} from './lib/topology'
import { defaultState, readStateFromUrl, writeStateToUrl, type AppState } from './lib/urlState'
import { channelTitle, versionLink } from './lib/version'
import { BASIC_IOPS, estimateIops, hasIops, iopsBasis } from './lib/iops'
import { recommendations, type SetupChange } from './lib/recommendations'
import { explainCalculation } from './lib/calculation'

// Same calculator pictogram as the favicon (served from public/).
const logoUrl = `${import.meta.env.BASE_URL}favicon.svg`
const appChannel = __APP_CHANNEL__
const appVersion = __APP_VERSION__
const appVersionLink = appVersion ? versionLink(appVersion) : null

const state = reactive<AppState>(readStateFromUrl() ?? defaultState())

// Seed the advanced tree from the basic settings the first time it is opened. Basic OSDs match the CRUSH rule's
// device class, so they keep matching it in the tree.
const seedFromBasic = () => buildBasicTopology(state.basic, state.pool.deviceClass || DEFAULT_OSD_CLASS)

// The Basic tab's IOPS have no device class; the seeded tree's OSDs get one, so they take the values over (unless
// that class has values already).
function carryBasicIops() {
  const basic = state.osdIops[BASIC_IOPS]
  const cls = state.pool.deviceClass || DEFAULT_OSD_CLASS
  if (basic && !state.osdIops[cls]) state.osdIops[cls] = { ...basic }
}

watch(
  () => state.tab,
  (tab) => {
    if (tab === 'advanced' && !state.advanced) {
      state.advanced = seedFromBasic()
      carryBasicIops()
    }
  },
  { immediate: true },
)

function resetFromBasic() {
  state.advanced = seedFromBasic()
  carryBasicIops()
}

// "Reset" in the Cluster setup panel: the first-visit defaults (the panel asks first).
function resetAll() {
  Object.assign(state, defaultState())
}

// Basic OSDs get the rule's device class (ssd for any), as when they seed the Advanced tab: they always match it.
const topology = computed(() => (state.tab === 'basic' ? seedFromBasic() : (state.advanced ?? [])))

const stats = computed(() => topologyStats(topology.value))

// Set when a CRUSH bucket would exceed its weight limit with Ceph's default weights (TiB).
const crushOverflow = computed(() => crushWeightOverflow(topology.value))

// A CRUSH rule restricted to a device class only uses those OSDs (Advanced tab; Basic OSDs always match).
const ruleClass = computed(() => (state.tab === 'advanced' ? state.pool.deviceClass : ''))
const poolTopology = computed(() =>
  ruleClass.value ? filterDeviceClass(topology.value, ruleClass.value) : topology.value,
)
const poolStats = computed(() => (ruleClass.value ? topologyStats(poolTopology.value) : stats.value))
// OSDs and TB per device class in the Advanced tree (built-in and custom classes).
const classUsage = computed(() => (state.tab === 'advanced' ? deviceClassUsage(topology.value) : {}))

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

const domains = computed(() => failureDomains(poolTopology.value, state.failureDomain))
const input = computed(() => ({
  groups: domains.value.groups,
  unplacedTB: domains.value.unplacedTB,
  emptyDomains: domains.value.emptyDomains,
}))
const tunables = computed(() => ({
  fullRatio: num(state.fullRatio),
  backfillfullRatio: num(state.backfillfullRatio),
  nearfullRatio: num(state.nearfullRatio),
  recoveryReserve: num(state.recoveryReserve),
}))
const result = computed(() => computeCapacity(input.value, state.scheme, tunables.value))

// IOPS estimate (opt-in): per device class of the OSDs the rule uses, its per-OSD IOPS and its largest OSD.
// Step 5 has a tab for every class in the Advanced tree; the Basic tab has one set of values without a class.
const iopsClasses = computed(() => (state.tab === 'advanced' ? treeClasses(topology.value) : []))
const iopsOf = (cls: string) => ({ read: num(state.osdIops[cls]?.read), write: num(state.osdIops[cls]?.write) })
const iops = computed(() => {
  const placedTB = poolStats.value.rawTB - domains.value.unplacedTB
  if (state.tab === 'basic') {
    const osd = iopsOf(BASIC_IOPS)
    const basic = [{ cls: BASIC_IOPS, osd, largestOsdTB: poolStats.value.largestOsdTB }]
    return iopsBasis(basic, placedTB, state.ioSizeKiB, hasIops(osd), state.objectSizeKiB)
  }
  const usage = deviceClassUsage(poolTopology.value)
  const classes = sortDeviceClasses(Object.keys(usage))
    .filter((cls) => usage[cls].osds > 0)
    .map((cls) => ({ cls, osd: iopsOf(cls), largestOsdTB: usage[cls].largestTB }))
  const entered = iopsClasses.value.some((cls) => hasIops(iopsOf(cls)))
  return iopsBasis(classes, placedTB, state.ioSizeKiB, entered, state.objectSizeKiB)
})
const iopsEstimate = computed(() => (iops.value ? estimateIops(iops.value, state.scheme, state.pool) : null))

const facts = computed(() => {
  const s = poolStats.value
  const fd = state.failureDomain
  const reserve = tunables.value.recoveryReserve
  const list =
    state.tab === 'basic'
      ? [`${formatInt(s.counts.host)} × ${state.basic.osdsPerHost} OSDs × ${formatTB(state.basic.osdSizeTB)}`]
      : [`${formatInt(s.counts.host)} ${plural('host', s.counts.host)}`, `${formatInt(s.counts.osd)} ${plural('osd', s.counts.osd)}`]
  if (ruleClass.value) list.push(`device class ${ruleClass.value}`)
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
  } else if (schemeMinSize(s) === s.k) {
    list.push(
      s.m === 1 && s.minSize === undefined
        ? 'm = 1: Ceph sets min_size = k, so after one failure the pool keeps accepting writes with no redundancy left; a second failure loses data.'
        : `min_size = k: after ${s.m} ${s.m === 1 ? 'failure' : 'failures'} the pool keeps accepting writes with no redundancy left; one more failure loses data.`,
    )
  }
  if (ruleClass.value) {
    const usage = classUsage.value
    const others = sortDeviceClasses(Object.keys(usage)).filter((c) => c !== ruleClass.value && usage[c].osds > 0)
    const osds = others.reduce((n, c) => n + usage[c].osds, 0)
    if (osds > 0) {
      const byClass = others.map((c) => `${formatInt(usage[c].osds)} ${c}`).join(', ')
      const tb = others.reduce((sum, c) => sum + usage[c].tb, 0)
      list.push(
        `The CRUSH rule only uses ${ruleClass.value} OSDs: ${formatInt(osds)} ${plural('osd', osds)} of other device classes (${byClass}; ${formatCapacity(tb)}) are left out.`,
      )
    }
  }
  if (fd === 'osd' && poolStats.value.counts.host === 1) {
    list.push('Single host: OSD as failure domain only protects against drive failures; losing the host takes all data offline.')
  } else if (fd === 'osd' && poolStats.value.counts.host > 1) {
    list.push('Failure domain osd: one host failure can take out several copies of the same object.')
  }
  if (r.valid && r.unusable.strandedTB > r.rawTB * 0.01) {
    list.push(
      `${formatCapacity(r.unusable.strandedTB)} stranded: the largest ${plural(fd, 1)} is too big relative to the others for a ${r.width}-wide scheme.`,
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
  if (domains.value.emptyDomains > 0) {
    list.push(emptyDomainsWarning(fd, domains.value.emptyDomains))
  } else if (state.tab === 'advanced' && stats.value.emptyBuckets > 0) {
    list.push('Some buckets contain no OSDs.')
  }
  if (crushOverflow.value) {
    const { rootWeight, buckets } = crushOverflow.value
    const tib = (fixed: number) => `${formatInt(Math.round(fixed / 0x10000))} TiB`
    const others = buckets.map((b) => `${formatInt(b.count)} ${plural(b.type, b.count)}`).join(', ')
    list.push(
      `CRUSH weights overflow: with Ceph's default weights (TiB), root default would weigh ${tib(rootWeight)}` +
        `${others ? ` (${others} too)` : ''}, but a CRUSH bucket weighs at most ${tib(CRUSH_WEIGHT_MAX + 1)}. Ceph ` +
        `refuses further OSDs once a bucket overflows; see the recommendation for osd_crush_initial_weight.`,
    )
  }
  if (!ratiosOrdered(tunables.value)) {
    list.push('Ratios out of order: Ceph expects nearfull ≤ backfillfull ≤ full and reports HEALTH_ERR (OSD_OUT_OF_ORDER_FULL) otherwise.')
  }
  if (tunables.value.fullRatio > 0.95) {
    list.push('Full ratio above the Ceph default 0.95 leaves very little room for recovery.')
  }
  return list
})

const placementProblem = computed(() => placementMessage(result.value, state.failureDomain) ?? undefined)

// Shown in their own panel (only when there are any) and optionally applied to the commands.
const recommendationList = computed(() =>
  recommendations({
    input: input.value,
    result: result.value,
    tunables: tunables.value,
    scheme: state.scheme,
    domain: state.failureDomain,
    // While spreading across OSDs: the same topology spread across hosts, for the failure-domain recommendation.
    hostInput: state.failureDomain === 'osd' ? failureDomains(poolTopology.value, 'host') : undefined,
    crushOverflow: crushOverflow.value,
    pool: state.pool,
    ioSizeKiB: state.ioSizeKiB,
    objectSizeKiB: state.objectSizeKiB,
    iops: iops.value,
    osdCount: poolStats.value.counts.osd,
    pgTargetPerOsd: state.pgTargetPerOsd,
    // Recommendations can add hosts only on the Basic tab.
    basic: state.tab === 'basic' ? state.basic : undefined,
  }),
)

// "Adopt recommendation": take over its setup change; the recommendation then no longer applies and vanishes.
function adoptRecommendation(setup: SetupChange) {
  if (setup.recoveryReserve !== undefined) state.recoveryReserve = setup.recoveryReserve
  if (setup.scheme) state.scheme = { ...setup.scheme }
  if (setup.failureDomain) state.failureDomain = setup.failureDomain
  if (setup.pool) Object.assign(state.pool, setup.pool)
  if (setup.basic) Object.assign(state.basic, setup.basic)
}

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
  // Per usable TB or TiB, following the unit toggle like the other outputs. The input stays per decimal TB of raw
  // drive capacity (drives are sold that way), and so does the total's arithmetic in the tooltip.
  const perUsable = r.valid ? pricePerUsable(total, r.usableTB * unitPerTB()) : null
  return {
    total: formatPrice(total, state.currency),
    perUsable: perUsable === null ? null : formatPrice(perUsable, state.currency),
    unit: capacityUnit.value,
    detail: `${formatTB(r.rawTB)} raw × ${formatPrice(perTB, state.currency)} per TB`,
  }
})

// The FAQ entry "How is this calculated?" works through the current setup.
const calculation = computed(() =>
  explainCalculation({
    input: input.value,
    result: result.value,
    scheme: state.scheme,
    tunables: tunables.value,
    domain: state.failureDomain,
    pool: state.pool,
    pricePerTB: num(state.pricePerTB),
    currency: state.currency,
  }),
)

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
            <span class="nowrap">calculator<span class="channel" :title="channelTitle(appChannel)">{{ appChannel }}</span
              ><a
                v-if="appVersionLink"
                class="version"
                :href="appVersionLink.url"
                :title="appVersionLink.title"
                target="_blank"
                rel="noopener noreferrer"
                >{{ appVersion }}</a
            ></span>
          </h1>
          <p>Calculate the storage size of your future ceph cluster.</p>
        </div>
      </div>
      <div class="top-actions">
        <UnitToggle />
        <ShareButton :state="state" />
        <a class="help-button" href="/help/" title="Help documents" aria-label="Help documents">
          <AppIcon name="help" :size="16" />
          <span class="text">Help</span>
        </a>
        <ThemeToggle />
      </div>
    </header>

    <main class="layout" :class="{ advanced: state.tab === 'advanced' }">
      <ConfigPanel
        :state="state"
        :domain-options="domainOptions"
        :osd-count="stats.counts.osd"
        :tree-classes="Object.keys(classUsage)"
        :iops-classes="iopsClasses"
        :domain-count="result.domainCount"
        :width="result.width"
        @reset-from-basic="resetFromBasic"
        @reset="resetAll"
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
          :iops="iopsEstimate"
        />
        <SchemeTable
          :input="input"
          :tunables="tunables"
          :current="state.scheme"
          :domain="state.failureDomain"
          :iops="iops"
          :pool="state.pool"
          @select="selectScheme"
        />
        <CrushTreePanel v-if="state.crushMap" :topology="topology" />
        <RecommendationsPanel :recommendations="recommendationList" :result="result" @adopt="adoptRecommendation" />
        <CommandsPanel
          :pool="state.pool"
          :scheme="state.scheme"
          :domain="state.failureDomain"
          :tunables="tunables"
          :placement-problem="placementProblem"
          :recommendations="recommendationList"
          :pg-target-per-osd="state.pgTargetPerOsd"
          :objectSizeKiB="state.objectSizeKiB"
        />
        <FaqPanel :calculation="calculation" />
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
          <strong>Disclaimer:</strong> all results are estimates, provided without any warranty. Please verify them before ordering hardware or changing a production cluster, and review the
          generated commands before running them.
        </span>
      </p>
      <p class="license">
        <AppIcon name="scale" :size="14" />
        <span>
          Free software, licensed under the
          <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU AGPL v3.0</a>
          ·
          <a href="https://github.com/cytrinox/ceph-calc" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        </span>
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

// Like the Share button next to it: icon only on phones.
.help-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 42px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
  font-weight: 500;
  font-size: 0.88rem;
  white-space: nowrap;
  text-decoration: none;
  transition: border-color 0.15s, color 0.15s;

  svg {
    color: var(--accent-text);
  }

  &:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  @include touch {
    height: 44px;
  }

  @include below($bp-sm) {
    width: 44px;
    padding: 0;
    justify-content: center;

    .text {
      display: none;
    }
  }
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

  // Keeps the channel badge on the same line as the last word.
  .nowrap {
    white-space: nowrap;
  }

  .channel {
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

  // Build version (git tag or CEPH_CALC_VERSION): a neutral pill beside the channel badge.
  .version {
    display: inline-block;
    margin-left: 0.35rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    color: var(--text-muted);
    font-family: $font-mono;
    font-size: 0.68rem;
    font-weight: 500;
    vertical-align: 0.3em;
    text-decoration: none;

    &:hover {
      border-color: var(--accent);
      color: var(--accent-text);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
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

  // Notes that wrap keep their icon next to the first line.
  .disclaimer,
  .license {
    align-items: flex-start;

    svg {
      flex: 0 0 auto;
      margin-top: 0.15rem;
    }
  }

  .disclaimer {
    max-width: 62rem;

    strong {
      color: var(--text-muted);
      font-weight: 600;
    }
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
