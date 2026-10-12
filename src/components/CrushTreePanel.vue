<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ToggleField from './ToggleField.vue'
import { copyText } from '@/lib/clipboard'
import {
  CRUSH_TREE_ROWS_PER_ROOT,
  crushLinePrefix,
  crushTreeColumns,
  crushTreeHeader,
  crushTreeLines,
  crushTreeRowCount,
  crushTreeText,
  moreLabel,
} from '@/lib/crushTree'
import { formatInt } from '@/lib/format'
import type { Topology } from '@/lib/topology'

/** The virtual `ceph osd crush tree` of the hardware (step 5 "Create virtual CRUSH map"). */
const props = defineProps<{ topology: Topology }>()

// A view option like the commands panel toggles: local, not in links.
const showShadow = ref(false)

const command = computed(() => `ceph osd crush tree${showShadow.value ? ' --show-shadow' : ''}`)
const lines = computed(() => crushTreeLines(props.topology, showShadow.value))
const columns = computed(() => crushTreeColumns(lines.value))
const truncated = computed(() => lines.value.some((l) => l.more !== undefined))

/** Above this many lines, copying asks first. */
const CONFIRM_COPY_ROWS = 250_000

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
// Copies the complete output, not only the rows shown.
async function copy() {
  const rows = crushTreeRowCount(props.topology, showShadow.value)
  // Lines take about 50–60 bytes (deeper trees and longer IDs more).
  const size = `about ${formatInt(Math.ceil((rows * 55) / 1e6))} MB`
  if (rows > CONFIRM_COPY_ROWS && !confirm(`Copy all ${formatInt(rows)} lines of the CRUSH tree (${size})?`)) return
  const all = crushTreeLines(props.topology, showShadow.value, Infinity)
  if (!(await copyText(`$ ${command.value}\n${crushTreeText(all)}`))) return
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1600)
}
</script>

<template>
  <section class="card crush-tree">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="hierarchy" :size="17" /></span>
      <h2>Virtual CRUSH map</h2>
      <div class="aside">
        <button type="button" class="btn" title="Copy the whole tree" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" :size="14" />
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
    </div>

    <div class="intro">
      <p>
        How Ceph would print this configuration once deployed. IDs and names follow the tree order, and every
        <code>×N</code> copy gets its own name. Weights are computed as Ceph does:
      </p>
      <pre class="formula">OSD    = ⌊round₄(size in TB × 10¹² ÷ 2⁴⁰) × 65536⌋ ÷ 65536
bucket = sum of its items' weights</pre>
      <p class="formula-note">
        The OSD registers its size in TiB with 4 decimals, and CRUSH stores it as 16.16 fixed point, truncated
        (in single precision); weights print with 5 decimals.<br />For example 8 TB: 7.27596 TiB → 7.2760 →
        ⌊476839.9⌋ = 476839 → 7.27599.
      </p>
      <ToggleField
        v-model="showShadow"
        label="Include shadow trees"
        code="--show-shadow"
        hint="One tree per device class, the part a class-restricted CRUSH rule uses"
      />
    </div>

    <div class="output" role="region" aria-label="CRUSH tree output">
      <pre><code><span class="prompt">$ {{ command }}</span>
<span class="heading">{{ crushTreeHeader(columns) }}</span>
<template v-for="(line, i) in lines" :key="i"><span v-if="line.more !== undefined" class="more">{{ crushLinePrefix(line, columns) }}{{ moreLabel(line.more) }}</span><template v-else><span class="cols">{{ crushLinePrefix(line, columns) }}</span><template v-if="line.type"><span class="type">{{ line.type }}</span> <span class="bucket">{{ line.name }}</span><span class="shadow">{{ line.shadow }}</span></template><span v-else class="osd">{{ line.name }}</span></template>
</template></code></pre>
    </div>
    <p v-if="truncated" class="note">
      Large trees show their first {{ formatInt(CRUSH_TREE_ROWS_PER_ROOT) }} rows each; “Copy” copies the whole tree.
    </p>
  </section>
</template>

<style lang="scss" scoped>
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
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

  code {
    font-family: $font-mono;
    font-size: 0.8rem;
  }

  .formula-note {
    font-size: 0.8rem;
    color: var(--text-faint);
  }
}

// Like the FAQ's formula blocks.
.formula {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: $radius-sm;
  background: var(--code-bg);
  color: var(--code-text);
  font-family: $font-mono;
  font-size: 0.8rem;
  white-space: pre-wrap;
}

.output {
  margin: 0 1.4rem 1.4rem;
  border-radius: $radius;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  overflow: hidden;
}

pre {
  margin: 0;
  padding: 0.85rem 1rem;
  max-height: 32rem;
  overflow: auto;
  font-family: $font-mono;
  font-size: 0.8rem;
  line-height: 1.55;
  color: var(--code-text);
}

.prompt,
.more {
  color: var(--code-comment);
}

.heading {
  font-weight: 600;
}

.type {
  color: var(--code-cmd);
}

.shadow {
  color: var(--code-key);
}

.note {
  margin: -0.8rem 1.4rem 1.2rem;
  color: var(--text-faint);
  font-size: 0.78rem;
}

@include below($bp-sm) {
  .intro {
    padding: 0.4rem 1rem 1rem;
  }

  .output {
    margin: 0 1rem 1rem;
  }

  .note {
    margin: -0.4rem 1rem 1rem;
  }
}
</style>
