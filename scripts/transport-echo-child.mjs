// Half of the worker-vs-child transport measurement: the forked-process side.
// Same module graph, same echo, so the only difference the parent times is the
// IPC pipe against an in-process structured clone.
import './../src/site-builder.mjs'

process.send({ ready: true })
process.once('message', (payload) => process.send({ files: payload.files.size }))
