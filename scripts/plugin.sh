#!/bin/sh
# Packs the ChatGPT and Codex plugin: plugin.json, mcp.json and the skill, at the archive's
# root. Its MCP server is recital from npm (npx), so the plugin needs Node, and keeps the demos
# in ~/Documents/Demos:
#   scripts/plugin.sh [out dir]   → <out dir>/recital-plugin.zip (dist/)
set -e
cd "$(dirname "$0")/.."
out=$(mkdir -p "${1:-dist}" && cd "${1:-dist}" && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/recital-plugin.XXXXXX")

# The plugin's version is the package's
node -e '
  const fs = require("fs");
  const plugin = JSON.parse(fs.readFileSync("plugin.json", "utf8"));
  plugin.version = require("./package.json").version;
  fs.writeFileSync(process.argv[1], `${JSON.stringify(plugin, null, 2)}\n`);
' "$stage/plugin.json"
cp mcp.json "$stage/"
cp -R skills "$stage/"

rm -f "$out/recital-plugin.zip"
(cd "$stage" && zip -qr "$out/recital-plugin.zip" .)
rm -rf "$stage"
echo "$out/recital-plugin.zip"
