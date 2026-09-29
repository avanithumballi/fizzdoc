// Entry point: serves Fizzdoc's tools over stdio. stdout carries the protocol, so the only
// human-readable output goes to stderr, where MCP clients show it in their logs.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { REPO, createServer } from './server';

await createServer().connect(new StdioServerTransport());
console.error(`Fizzdoc MCP server is running. Your files stay on this computer.\n⭐ Like it? Star it on GitHub: ${REPO}`);
