<script setup lang="ts">
import NumberField from './NumberField.vue'
import type { BasicTopology } from '@/lib/topology'

defineProps<{ topology: BasicTopology }>()
</script>

<template>
  <div class="basic">
    <NumberField v-model="topology.hosts" label="OSD hosts" :min="1" :max="10000" />
    <NumberField v-model="topology.osdsPerHost" label="OSDs per host" :min="1" :max="200" />
    <NumberField
      v-model="topology.osdSizeTB"
      label="OSD size"
      unit="TB"
      :min="0.001"
      :max="200"
      :step="1"
      :precision="3"
      :decimals="3"
      :integer="false"
      snap
    />
  </div>
</template>

<style lang="scss" scoped>
.basic {
  display: grid;
  gap: 0.7rem;
}
</style>
