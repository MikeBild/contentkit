// Deterministic "missing capability" cell: a real SDK client that initializes
// WITHOUT any elicitation capability and calls the confirm-gated delete_draft
// tool. Expected: the tool result is an error mentioning form elicitation
// support, no elicitation/create is ever received, and the draft survives.
// Usage: node nocap-client.mjs <engine_url> <api_key> <site_id> <item_id> <out_dir>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const [engineUrl, apiKey, siteId, itemId, outDir] = process.argv.slice(2)
if (!engineUrl || !apiKey || !siteId || !itemId || !outDir) {
  console.error('usage: nocap-client.mjs <engine_url> <api_key> <site_id> <item_id> <out_dir>')
  process.exit(2)
}

const transcript = []
const log = (entry) => transcript.push(entry)
let elicitationReceived = false

const client = new Client({ name: 'nocap-matrix-client', version: '1.0.0' }, { capabilities: {} })
client.fallbackRequestHandler = async (request) => {
  log({ direction: 'server->client request', request })
  if (request.method === 'elicitation/create') elicitationReceived = true
  return { action: 'cancel' }
}

const transport = new StreamableHTTPClientTransport(new URL(`${engineUrl}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
})

let verdict
try {
  await client.connect(transport)
  log({ note: 'connected without elicitation capability' })
  const result = await client.callTool({
    name: 'contentkit_content',
    arguments: { action: 'delete_draft', site: siteId, item_id: itemId },
  })
  log({ direction: 'tool result', result })
  const text = JSON.stringify(result)
  if (elicitationReceived) {
    verdict = 'FAIL: server sent elicitation/create to a client without the capability'
  } else if (result.isError && /elicitation/i.test(text)) {
    verdict = `PASS: capability-less client got a clear elicitation error, no elicitation/create sent (${
      result.content?.[0]?.text?.slice(0, 200) ?? text.slice(0, 200)
    })`
  } else {
    verdict = `FAIL: unexpected tool result: ${text.slice(0, 300)}`
  }
} catch (error) {
  log({ error: String(error) })
  verdict = `FAIL: transport error: ${String(error).slice(0, 300)}`
} finally {
  await client.close().catch(() => {})
}

writeFileSync(join(outDir, 'scripted-nocap-transcript.txt'), `${transcript.map((e) => JSON.stringify(e)).join('\n')}\n`)
writeFileSync(join(outDir, 'scripted-nocap.verdict'), `${verdict}\n`)
console.log(verdict)
process.exit(verdict.startsWith('PASS') ? 0 : 1)
