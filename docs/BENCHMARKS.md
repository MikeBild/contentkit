# Benchmarks

Contentkit ships a deterministic product-documentation benchmark. It builds
1,000 realistic Markdown documents in two locales, grouped into ten-document
navigation hierarchies with 200 protected documents. The same run measures 100,000
access-rule resolutions and one reader-password verification. A second,
separately timed corpus builds 50 reports containing 200 charts and 24 rows per
chart. It exercises all four chart types and both light/dark static SVG outputs
without changing the comparability of the 1,000-document result.

Run it locally:

```bash
npm run benchmark
```

Set `CONTENTKIT_BENCHMARK_DOCUMENTS` to change the corpus size. CI sets
`CONTENTKIT_BENCHMARK_ASSERT=1`, compares the result with
`benchmarks/budgets.json`, and uploads the JSON report as a build artifact.

## Reference result

The 1,000-document run on July 16, 2026 completed with:

| Metric | Result | CI budget |
|---|---:|---:|
| Static build | 1,708.54 ms | 6,000 ms maximum |
| Throughput | 585.30 documents/s | informational |
| Resident memory after build | 517.14 MiB | 1,024 MiB maximum |
| 50 reports / 200 charts | 1,387.66 ms | 8,000 ms maximum |
| Chart throughput | 144.13 charts/s | 25 charts/s minimum |
| Resident memory after report build | 582.13 MiB | 1,024 MiB maximum |
| Generated report SVG payload | 10,483,832 bytes | informational |
| 100,000 access resolutions | 139.39 ms | 600 ms maximum |
| One scrypt password verification | 42.24 ms | 250 ms maximum |

Performance depends on CPU, Node version, operating system, and background
load. The committed budgets are intentionally broader than this development
machine's result so CI detects major regressions without turning normal runner
variance into noise. Benchmark numbers are not production capacity promises;
measure the intended deployment hardware and content corpus before sizing a
service.
