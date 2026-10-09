// M0 probe: minimal stdio MCP "hello" server (also used for the Claude Desktop check).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'scaffold-hello', version: '0.0.1' });
server.registerTool('hello', {
  description: 'Say hello (Scaffold M0 probe)',
  inputSchema: { name: z.string().describe('Who to greet') },
}, async ({ name }) => ({ content: [{ type: 'text', text: `hello, ${name}` }] }));
await server.connect(new StdioServerTransport());
