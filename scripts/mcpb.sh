#!/bin/sh
# Packs the Claude Desktop extension: the npm package (its `files`), its dependencies, and
# ffmpeg and ffprobe, so it needs nothing installed. The setup tool gets the browser (or uses Chrome),
# the voice on the first narration. ffmpeg's binaries are this machine's, so the bundle is for
# this platform and architecture:
#   scripts/mcpb.sh [out dir]   → <out dir>/recital-<platform>-<arch>.mcpb (dist/)
# The name has no version (the manifest has it), so the latest release's stays the same to link to
set -e
cd "$(dirname "$0")/.."
out=$(mkdir -p "${1:-dist}" && cd "${1:-dist}" && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/recital-mcpb.XXXXXX")
trap 'rm -rf "$stage"' EXIT

# The manifest's tools, which Claude Desktop lists, are the server's: the same names, in order
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node src/bin.js mcp -w "$stage" | node -e '
  const fs = require("fs");
  const served = JSON.parse(fs.readFileSync(0, "utf8")).result.tools.map((t) => t.name).join(", ");
  const listed = JSON.parse(fs.readFileSync("mcpb/manifest.json", "utf8")).tools.map((t) => t.name).join(", ");
  if (served !== listed) {
    console.error(`mcpb/manifest.json lists ${listed}\nthe server has ${served}`);
    process.exit(1);
  }
'

npm pack --silent --pack-destination "$stage" >/dev/null
tar -xzf "$stage"/recitaljs-*.tgz -C "$stage"
cp mcpb/icon.png "$stage/package/"
# mcpb leaves out *.d.ts, but types.d.ts is the scenario format the guide tool reads
echo '!/types.d.ts' > "$stage/package/.mcpbignore"
cd "$stage/package"
version=$(node -p 'require("./package.json").version')
target=$(node -p 'process.platform + "-" + process.arch')
node -e '
  const fs = require("fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  manifest.version = process.argv[2];
  manifest.compatibility.platforms = [process.platform];
  fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));
' "$OLDPWD/mcpb/manifest.json" "$version"

npm install --omit=dev --no-audit --no-fund ffmpeg-static @ffprobe-installer/ffprobe
# onnxruntime, which voices the narration, comes with every platform's binaries: this one's do
keep=node_modules/onnxruntime-node/bin/napi-v3/$(node -p 'process.platform + "/" + process.arch')
for dir in node_modules/onnxruntime-node/bin/napi-v3/*/*; do
  [ "$dir" = "$keep" ] || rm -rf "$dir"
done
npx -y @anthropic-ai/mcpb pack . "$out/recital-$target.mcpb"
