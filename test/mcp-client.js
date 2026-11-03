// A minimal MCP client for the tests: starts `recital mcp` on a workspace and sends it requests.

import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function connect(workspace, env = {}) {
  const server = spawn(process.execPath, [path.join(ROOT, "src/bin.js"), "mcp", "-w", workspace], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  let id = 0;
  readline.createInterface({ input: server.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    init: init.result,
    request,
    call: async (name, args = {}) => (await request("tools/call", { name, arguments: args })).result,
    close: () => server.stdin.end(),
  };
}
