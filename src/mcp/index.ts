#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, parseServerArgs } from './server.js';

// stdout carries the MCP protocol; diagnostics go to stderr only.
const { server } = createServer(parseServerArgs(process.argv.slice(2)));
await server.connect(new StdioServerTransport());
process.stderr.write('scaffold-mcp ready\n');
