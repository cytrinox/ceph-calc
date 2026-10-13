<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ToggleField from './ToggleField.vue'
import type { Scheme, Tunables } from '@/lib/ceph'
import { copyText } from '@/lib/clipboard'
import { buildCommands, commandsToScript, type CommandSection } from '@/lib/commands'
import { poolIssues, type PoolOptions } from '@/lib/pool'
import { isApplicable, type Recommendation } from '@/lib/recommendations'
import type { DomainType } from '@/lib/topology'

const props = defineProps<{
  pool: PoolOptions
  scheme: Scheme
  domain: DomainType
  tunables: Tunables
  /** Message when the layout cannot be placed on the topology. */
  placementProblem?: string
  recommendations: Recommendation[]
  /** mon_target_pg_per_osd (step 5); set on the cluster when it differs from Ceph's default. */
  pgTargetPerOsd: number
  /** RADOS object size (step 5); the RBD / CephFS examples set it when it isn't 4M. */
  objectSizeKiB: number
}>()

const includeClusterSettings = ref(true)

// Recommendations that change the commands are opt-in; once applied, each can still be switched off on its own.
// (Recommendations that change the setup are adopted in their panel instead.)
const applicable = computed(() => props.recommendations.filter(isApplicable))
const applyRecommendations = ref(false)
const skipped = ref<string[]>([])
const applied = computed(() =>
  applyRecommendations.value ? applicable.value.filter((r) => !skipped.value.includes(r.id)) : [],
)

function setApplied(id: string, on: boolean) {
  skipped.value = on ? skipped.value.filter((s) => s !== id) : [...skipped.value, id]
}

const sections = computed(() =>
  buildCommands({
    pool: props.pool,
    scheme: props.scheme,
    domain: props.domain,
    tunables: props.tunables,
    includeClusterSettings: includeClusterSettings.value,
    pgTargetPerOsd: props.pgTargetPerOsd,
    objectSizeKiB: props.objectSizeKiB,
    ratioOverrides: Object.assign({}, ...applied.value.map((r) => r.ratios ?? {})),
    configSettings: applied.value.flatMap((r) => r.config ?? []),
  }),
)

const problems = computed(() => {
  const list = poolIssues(props.pool, props.scheme)
  if (props.placementProblem) list.unshift(props.placementProblem)
  return list
})

type Token = { text: string; kind: 'cmd' | 'key' | 'value' | 'flag' | 'plain' }

/** Light-weight shell highlighting for display only. */
function tokenize(part: string, first: boolean): Token[] {
  return part.split(/(\s+)/).map((text, i) => {
    if (/^\s+$/.test(text)) return { text, kind: 'plain' }
    if (first && i === 0) return { text, kind: 'cmd' }
    if (text.startsWith('--')) return { text, kind: 'flag' }
    if (text.includes('=')) return { text, kind: 'key' }
    return { text, kind: 'plain' }
  })
}

const copied = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copy(text: string, id: string) {
  if (!(await copyText(text))) return
  copied.value = id
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = null), 1600)
}

function copySection(section: CommandSection) {
  copy(commandsToScript([section]), section.id)
}

function download() {
  const blob = new Blob([commandsToScript(sections.value, true)], { type: 'text/x-shellscript' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `create-pool-${props.pool.name || 'data'}.sh`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="card commands">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="terminal" :size="17" /></span>
      <h2>Ceph commands</h2>
      <div class="aside actions">
        <button type="button" class="btn" @click="copy(commandsToScript(sections), 'all')">
          <AppIcon :name="copied === 'all' ? 'check' : 'copy'" :size="14" />
          {{ copied === 'all' ? 'Copied' : 'Copy all' }}
        </button>
        <button type="button" class="btn" title="Download as shell script" @click="download">
          <AppIcon name="download" :size="14" /> .sh
        </button>
      </div>
    </div>

    <div class="intro">
      <p>Run these in order on a node with an admin keyring. They follow the settings from steps 2–4.</p>
      <ToggleField
        v-model="includeClusterSettings"
        label="Include cluster-wide settings"
        hint="the fill ratios and the PG target apply to all pools"
      />
      <template v-if="applicable.length">
        <ToggleField
          v-model="applyRecommendations"
          label="Apply recommendations"
          :hint="`${applicable.length} ${applicable.length === 1 ? 'recommendation' : 'recommendations'} from the panel above`"
        />
        <div v-if="applyRecommendations" class="recommendation-toggles">
          <ToggleField
            v-for="rec in applicable"
            :key="rec.id"
            :model-value="!skipped.includes(rec.id)"
            :label="rec.toggleLabel ?? rec.title"
            :hint="rec.title"
            @update:model-value="(on: boolean) => setApplied(rec.id, on)"
          />
        </div>
      </template>
    </div>

    <ul v-if="problems.length" class="problems">
      <li v-for="p in problems" :key="p"><AppIcon name="alert" :size="14" /> {{ p }}</li>
    </ul>

    <div class="script" role="region" aria-label="Generated commands">
      <div v-for="(section, si) in sections" :key="section.id" class="section">
        <button
          type="button"
          class="copy-section"
          :title="`Copy “${section.title}”`"
          :aria-label="`Copy ${section.title} commands`"
          @click="copySection(section)"
        >
          <AppIcon :name="copied === section.id ? 'check' : 'copy'" :size="13" />
        </button>
        <pre><code><span class="comment"># {{ si + 1 }}. {{ section.title }}</span>
<template v-if="section.note"><span class="comment"># {{ section.note }}</span>
</template><template v-for="(line, li) in section.lines" :key="li"><span v-if="line.example" class="comment"># {{ line.parts.join(' ') }}<template v-if="line.note">  # {{ line.note }}</template></span><template v-else><template v-for="(part, pi) in line.parts" :key="pi"><template v-if="pi > 0"> \
    </template><span v-for="(tok, ti) in tokenize(part, pi === 0)" :key="ti" :class="tok.kind">{{ tok.text }}</span></template><span v-if="line.note" class="comment">  # {{ line.note }}</span></template>
</template></code></pre>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.actions {
  display: flex;
  gap: 0.4rem;
}

.commands :deep(.card-head) {
  flex-wrap: wrap;

  h2 {
    white-space: nowrap;
  }
}

.btn {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--panel-alt);
  color: var(--text);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0 0.8rem;
  min-height: 32px;
  cursor: pointer;

  &:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  @include touch {
    min-height: 44px;
  }
}

.intro {
  display: grid;
  gap: 0.6rem;
  padding: 0.4rem 1.4rem 1rem;

  p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.86rem;
  }
}

// One toggle per recommendation, indented under "Apply recommendations".
.recommendation-toggles {
  display: grid;
  gap: 0.4rem;
  margin-left: 0.2rem;
  padding-left: 0.9rem;
  border-left: 2px solid var(--border-strong);
}

.problems {
  list-style: none;
  margin: 0 1.4rem 1rem;
  padding: 0.7rem 0.9rem;
  display: grid;
  gap: 0.3rem;
  border-radius: $radius;
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  color: var(--warning);
  font-size: 0.82rem;

  li {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;

    svg {
      flex: 0 0 auto;
      margin-top: 0.2rem;
    }
  }
}

.script {
  margin: 0 1.4rem 1.4rem;
  border-radius: $radius;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  overflow: hidden;
}

.section {
  position: relative;

  & + & {
    border-top: 1px solid var(--code-border);
  }

  &:hover .copy-section,
  .copy-section:focus-visible {
    opacity: 1;
  }
}

pre {
  margin: 0;
  padding: 0.85rem 1rem;
  overflow-x: auto;
  font-family: $font-mono;
  font-size: 0.8rem;
  line-height: 1.65;
  color: var(--code-text);
}

.comment {
  color: var(--code-comment);
}

.cmd {
  color: var(--code-cmd);
  font-weight: 500;
}

.key {
  color: var(--code-key);
}

.flag {
  color: var(--code-flag);
}

.copy-section {
  position: absolute;
  top: 0.55rem;
  right: 0.55rem;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--code-border);
  border-radius: $radius-sm;
  background: var(--code-bg);
  color: var(--code-comment);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;

  &:hover {
    color: var(--code-cmd);
  }

  @media (hover: none) {
    opacity: 1;
  }
}

@include below($bp-sm) {
  .intro {
    padding: 0.3rem 1rem 0.9rem;
  }

  .problems,
  .script {
    margin-left: 1rem;
    margin-right: 1rem;
  }

  .script {
    margin-bottom: 1rem;
  }

  pre {
    font-size: 0.74rem;
    padding: 0.75rem 0.8rem;
  }

  .btn {
    padding: 0 0.6rem;
  }
}
</style>
