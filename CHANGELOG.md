# Changelog

All notable changes to Rachis are recorded here. Versioning is manual:
bump `packages/rachis/package.json`, update this file, then tag `vX.Y.Z`.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-09-09

First usable release. Schema-first ORM for Bun + PostgreSQL: Zod tables,
chainable query builder emitting `{ sql, params }`, executor over `Bun.sql`,
repository-shaped usage.

### Features

- Schema layer with camelCase to snake_case auto-map and per-field overrides
- Select with AND filters, parenthesized OR groups, explicit flat joins,
  order, limit, and offset
- Insert, update, and delete with full-table guards
- Limited `raw()` escape hatch with token and placeholder checks
- `transaction()` helper with commit on return and rollback on throw
- `withLogging()` observability wrapper recording SQL, params, and duration
- Migration runner with `new`, `generate` from Zod schemas, `push`,
  `status`, and tracked `up` runs
- Todo mini-API example and mitata benchmark suite

### Fixes

- Where operators validated against an allowlist at build time
- Empty `IN` / `NOT IN` lists rejected instead of emitting `IN ()`
- Raw fragments require the exact placeholder set `$1..$max`
- Update returns affected rows through `RETURNING *`

### Security

- Parameterized values everywhere, whitelisted identifiers on all paths
- Adversarial unit suite plus live attack runs against real PostgreSQL
