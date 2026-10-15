import { afterEach, describe, expect, it } from 'vitest'
import { computeCapacity, type CapacityInput, type Scheme, type Tunables } from './ceph'
import { explainCalculation, type CalculationRow } from './calculation'
import { defaultPoolOptions } from './pool'
import { setCapacityUnit } from './units'

const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }
const ec42: Scheme = { kind: 'ec', k: 4, m: 2 }
const tunables = (recoveryReserve: number): Tunables => ({
  fullRatio: 0.95,
  backfillfullRatio: 0.9,
  nearfullRatio: 0.85,
  recoveryReserve,
})
// The FAQ's hosts of 20 + 10 + 10 + 10 TB.
const uneven: CapacityInput = { groups: [{ capTB: 20, mult: 1 }, { capTB: 10, mult: 3 }], unplacedTB: 0 }

const explain = (input: CapacityInput, scheme: Scheme, reserve: number, extra = {}) => {
  const t = tunables(reserve)
  return explainCalculation({ input, result: computeCapacity(input, scheme, t), scheme, tunables: t, domain: 'host', ...extra })
}
const row = (rows: CalculationRow[], label: string) => rows.find((r) => r.label === label)

afterEach(() => setCapacityUnit('TB'))

describe('explainCalculation', () => {
  it("spells out every step with the setup's numbers", () => {
    const c = explain(uneven, rep3, 1)
    expect(c.setup).toBe('Replication 3x across 4 hosts (1 × 20 TB + 3 × 10 TB), recovery reserve 1')
    expect(c.symbols).toBe('w = 3, f = 1/3, N = 1')
    expect(c.problem).toBeNull()
    expect(c.steps).toEqual([
      { label: 'Raw', formula: '1 × 20 TB + 3 × 10 TB', value: '50 TB' },
      { label: 'P', formula: 'no host holds more than P ÷ 3 = 15 TB', value: '45 TB' },
      { label: 'Stranded', formula: '50 TB − 45 TB', value: '5 TB' },
      { label: 'P_N', formula: 'P without the 1 largest (1 × 20 TB)', value: '30 TB' },
      { label: 'Recovery reserve', formula: '45 TB − 30 TB', value: '15 TB' },
      { label: 'Stored', formula: '30 TB × 0.85', value: '25.5 TB' },
      { label: 'Nearfull headroom', formula: '30 TB − 25.5 TB', value: '4.5 TB' },
      { label: 'Real net', formula: '25.5 TB × 1/3', value: '8.5 TB' },
      { label: 'Protection', formula: '25.5 TB − 8.5 TB', value: '17 TB' },
    ])
    expect(row(c.others, 'Healthy OSD fill')).toEqual({ label: 'Healthy OSD fill', formula: '25.5 TB ÷ 45 TB', value: '57%' })
    expect(row(c.others, '+X until backfillfull')).toMatchObject({ formula: '(40.5 TB − 25.5 TB) × 1/3', value: '5 TB' })
    expect(row(c.others, 'Storage efficiency')).toMatchObject({ formula: '8.5 TB ÷ 50 TB', value: '17%' })
    expect(row(c.others, 'Survives losing')).toMatchObject({ formula: 'size − 1 = 3 − 1', value: '2 hosts' })
    expect(row(c.others, 'Operational losing')).toMatchObject({ formula: 'w − min_size = 3 − 2', value: '1 host' })
    expect(row(c.others, 'Needs')).toMatchObject({ formula: 'w + N = 3 + 1', value: '4 hosts' })
    // Truncated, not formatPct: "57% rounded down" next to 0.56 would contradict itself.
    expect(row(c.others, 'Recommended nearfull ratio')).toMatchObject({ formula: '56.6% rounded down', value: '0.56' })
    // no price, no compression
    expect(row(c.others, 'Price')).toBeUndefined()
    expect(row(c.others, 'With compression')).toBeUndefined()
  })

  it('leaves out what the setup does not have', () => {
    const c = explain({ groups: [{ capTB: 40, mult: 6 }], unplacedTB: 0 }, ec42, 0)
    expect(c.problem).toBeNull()
    expect(c.symbols).toBe('w = 6, f = 4/6, N = 0')
    expect(c.steps.map((s) => s.label)).not.toContain('Stranded')
    expect(row(c.steps, 'P')?.formula).toBe('every host fills completely')
    expect(row(c.steps, 'P_N')?.formula).toBe('N = 0: the same as P')
    expect(row(c.others, 'Survives losing')).toMatchObject({ formula: 'm = 2', value: '2 hosts' })
    expect(row(c.others, 'Recommended nearfull ratio')).toBeUndefined()
  })

  it('counts hosts outside the failure domains', () => {
    const c = explain({ groups: [{ capTB: 10, mult: 4 }], unplacedTB: 5 }, rep3, 0)
    expect(row(c.steps, 'Raw')).toMatchObject({ formula: '4 × 10 TB + 5 TB outside', value: '45 TB' })
    expect(row(c.steps, 'Outside')).toMatchObject({ value: '5 TB' })
  })

  it('summarises many domain sizes', () => {
    const groups = [40, 30, 20, 10].map((capTB) => ({ capTB, mult: 2 }))
    const c = explain({ groups, unplacedTB: 0 }, rep3, 2)
    expect(c.setup).toContain('(2 × 40 TB + 2 × 30 TB + 4 more)')
    expect(row(c.steps, 'P_N')?.formula).toBe('P without the 2 largest (2 × 40 TB)')
  })

  it('adds the price and compression when set, per usable unit of the toggle', () => {
    setCapacityUnit('TiB')
    const pool = { ...defaultPoolOptions(), compressionMode: 'aggressive' as const, compressionRatio: 0.5 }
    const c = explain(uneven, rep3, 1, { pool, pricePerTB: 100, currency: '$' })
    expect(row(c.others, 'Price')).toMatchObject({ formula: '45.5 TiB × $100 per TB', value: '$5,000' })
    expect(row(c.others, 'Per usable TiB')?.formula).toBe('$5,000 ÷ 7.73 TiB')
    expect(row(c.others, 'With compression')).toMatchObject({ formula: '7.73 TiB ÷ 0.50', value: '15.5 TiB' })
  })

  it('explains why a setup cannot be placed instead of calculating', () => {
    const c = explain({ groups: [{ capTB: 10, mult: 3 }], unplacedTB: 0 }, rep3, 1)
    expect(c.problem).toBe('Not enough hosts: needs 3 hosts (+ 1 recovery reserve), you have 3.')
    expect(c.steps).toEqual([])
    expect(c.others).toEqual([])
  })
})
