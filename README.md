# Rachis

A small TypeScript ORM for Bun + PostgreSQL. No decorators, no codegen, no magic.

[Usage](./docs/usage.md) • [Benchmark](./docs/benchmark.md) • [License](./LICENSE)

> v1 covers CRUD with AND/OR filters, ordering, and pagination on PostgreSQL.
> No joins, no relations yet.

## What's Rachis?

Rachis is an ORM the team wrote for itself after deciding Prisma and TypeORM
ship more than we use. The whole thing reads in a day. One Zod schema defines
a table, validates rows, and infers types. The query builder returns a SQL
string plus params and never touches the network. The executor runs them
through `Bun.sql`. Repositories wrap queries in methods shaped by each domain.

Four rules hold throughout: a small API, parameterized queries with whitelisted
identifiers, almost no dependencies, and nothing implicit.

The [usage guide](./docs/usage.md) walks through setup, queries, safety rules,
repositories, migrations, and tests. Measured numbers live in the
[benchmark](./docs/benchmark.md) note.

## Supported databases

- PostgreSQL, supported
- Everything else, not in v1

Bun works natively through `Bun.sql`. Node needs a small adapter wrapping `pg`
or `postgres-js` into the `Db` interface, about ten lines. The same shape fits
any API framework since Rachis never sees HTTP.

## v1 limits

`where` does AND only. An empty `IN ()` produces unusable SQL and fails loudly
at the database; a build-time guard is planned next.

## Contributing

Issues and PRs are welcome at
[github.com/DontSusMyAccount/rachis-orm](https://github.com/DontSusMyAccount/rachis-orm).
The attack suite in `tests/` stays green before a merge.

## License

MIT. See [LICENSE](./LICENSE). Copyright Oatthaphon Oiukrung.
