---
title: What's changed – Changelog
description: What each version of the calculator added, changed and fixed.
order: 0
author: Daniel Vogelbacher (cytrinox)
author-link: https://www.chaospixel.com
published: 2026-10-14
revised: 2026-10-17
---

## v0.4.0 · 17 October 2026

- Show bar percentages with one decimal when whole ones don't add up
- Recommend 3 copies for replication size 1 and 2, with the hosts to add

## v0.3.0 · 15 October 2026

- New FAQ entry **"How is this calculated?"**: the capacity model step by step, each formula worked through with
  the numbers of your current setup. The example updates as you change the cluster.
- The FAQ no longer lists the help documents; the Help button in the header leads to them directly.

## v0.2.1 · 13 October 2026

- All FAQ answers start folded.
- For erasure-coded pools, the folded pool configuration (step 4) shows the `stripe_unit`.

## v0.2.0 · 13 October 2026

- New **Recommendations** panel. It suggests settings that make the cluster safer or faster, such as a recovery
  reserve, more than one copy, hosts instead of OSDs as failure domain, EC optimizations, a 16K `stripe_unit`, the
  number of PGs or a lower nearfull ratio. "Adopt recommendation" takes a suggestion over; settings for Ceph can be
  added to the generated commands.
- **Device classes** (hdd, ssd, nvme or your own name) for every OSD group in the Advanced tab. The CRUSH rule can
  be limited to one class, and the IOPS estimate takes the values of each class.
- **Virtual CRUSH map:** shows what `ceph osd crush tree` would print for your hardware, including the weights. Very
  large clusters get a warning when the CRUSH weights would overflow.
- With the PG autoscaler off or only warning, you set the number of PGs yourself; a recommendation says what Ceph's
  autoscaler would pick.
- The IOPS estimate knows the object size: a request larger than one object costs one operation per object. The
  commands panel shows examples for RBD images and CephFS directories.
- With TiB selected, the price is shown per usable TiB.
- A reset button for the whole cluster setup.
- Help documents, starting with how EC pools store data and how the IOPS are estimated.
- Changing one fill ratio moves the others along, so nearfull ≤ backfillfull ≤ full always holds.
- Fixes: bucket names and OSD counts after changing a bucket's type; `fast_read` now counts as reading all shards on
  optimized EC pools too; the PG suggestion stays within Ceph's limits; a warning when Ceph would silently enlarge
  the `stripe_unit`; a clearer note on fill ratios out of order.
- The calculator is now licensed under the GNU AGPL v3.0.

## v0.1.0 · 9 October 2026

- A failure domain without OSDs is reported as such, instead of "not enough hosts".
- App icons and a web manifest, so the calculator can be added to a phone's home screen.
- Unknown addresses show a real "page not found".

## v0.0.1 · 9 October 2026

The first version.

- Calculates the **real net capacity**: how much data fits while every OSD stays below the nearfull ratio, after
  replication or erasure coding, and with room to recover from failed hosts (recovery reserve).
- Basic tab for identical hosts, Advanced tab for a CRUSH tree with racks, rows and datacenters, with examples.
- Replication and erasure coding, with presets and your own `size`, `min_size`, k and m.
- The capacity bar shows where the raw space goes: your data, protection, reserved headroom, and space that uneven
  failure domains can never fill.
- A table and a chart compare all layouts on your hardware.
- The Ceph commands to create the pool: EC profile, CRUSH rule and pool options.
- Optional: a drive price per TB for the cost per usable TB, and an IOPS estimate from the IOPS of one OSD.
- Links that restore the whole configuration, a dark and a light theme, TB or TiB.
