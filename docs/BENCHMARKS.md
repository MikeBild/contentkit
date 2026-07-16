# Benchmarks

Contentkit ships a deterministic product-documentation benchmark. It builds
1,000 realistic Markdown documents in two locales, grouped into ten-document
navigation hierarchies with 200 protected documents. The same run measures 100,000
access-rule resolutions and one reader-password verification.

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
| 100,000 access resolutions | 139.39 ms | 600 ms maximum |
| One scrypt password verification | 42.24 ms | 250 ms maximum |

Performance depends on CPU, Node version, operating system, and background
load. The committed budgets are intentionally broader than this development
machine's result so CI detects major regressions without turning normal runner
variance into noise. Benchmark numbers are not production capacity promises;
measure the intended deployment hardware and content corpus before sizing a
service.
