// Half of the worker-vs-child transport measurement: loads the same module
// graph a real build worker loads, says it is ready, then echoes one payload
// back so the parent can time a structured-clone round trip.
import { parentPort } from 'node:worker_threads'
import './../src/site-builder.mjs'

parentPort.postMessage({ ready: true })
parentPort.once('message', (payload) => parentPort.postMessage({ files: payload.files.size }))
