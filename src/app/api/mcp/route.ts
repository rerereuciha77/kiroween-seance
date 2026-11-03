import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createSeanceServer } from '@/lib/mcp-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, MCP-Protocol-Version',
}

/**
 * Streamable HTTP MCP endpoint (JSON responses, stateless).
 * A fresh server + transport per request keeps the route free of session state,
 * which is what serverless deployment expects.
 */
async function handle(req: Request): Promise<Response> {
  const server = createSeanceServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  })

  await server.connect(transport)

  const response = await transport.handleRequest(req)
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value)

  return new Response(response.body, { status: response.status, headers })
}

export async function POST(req: Request): Promise<Response> {
  return handle(req)
}

export async function GET(req: Request): Promise<Response> {
  return handle(req)
}

export async function DELETE(req: Request): Promise<Response> {
  return handle(req)
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS })
}