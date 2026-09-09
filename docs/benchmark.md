# Benchmark

`bench/bench.ts` compares Rachis against Drizzle and raw `Bun.sql` with mitata.

```bash
DATABASE_URL="<url>" bun bench/bench.ts
```

One measured run on a Ryzen 5 through a Neon pooler:

| workload | Rachis | Drizzle | raw Bun.sql |
|---|---|---|---|
| builder only, per call | 646 ns | 11.5 µs | — |
| select by pk | 38.9 ms | 73.5 ms | 36.9 ms |
| filtered select | 37.1 ms | 75.2 ms | 36.2 ms |
| insert + returning | 36.8 ms | 74.1 ms | 36.6 ms |

Round trips include network latency, so they read as relative only. That
Drizzle run also used the `postgres-js` driver while Rachis used `Bun.sql`.
