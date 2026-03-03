#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPT_URL =
  "https://raw.githubusercontent.com/tuantaotis/MirrorAI/main/scripts/install.sh";

const args = process.argv.slice(2);
const quickMode = args.includes("--quick");
const helpMode = args.includes("--help") || args.includes("-h");

if (helpMode) {
  console.log(`
  🪞 MirrorAI Installer

  Usage:
    npx mirrorai-install           # Full install (10-60 min)
    npx mirrorai-install --quick   # Quick install (3-5 min)

  Quick mode installs core tools only. Run 'mirrorai setup full' after to complete.

  More info: https://github.com/tuantaotis/MirrorAI
`);
  process.exit(0);
}

if (os.platform() !== "darwin") {
  console.error("  ✗ MirrorAI installer currently supports macOS only.");
  console.error("  ℹ Linux/Windows support coming soon.");
  process.exit(1);
}

console.log("");
console.log("  🪞 MirrorAI — Downloading installer...");
console.log(`  Mode: ${quickMode ? "⚡ Quick (~3-5 min)" : "Full (~10-60 min)"}`);
console.log("");

const tmpFile = path.join(os.tmpdir(), `mirrorai-install-${Date.now()}.sh`);

const file = fs.createWriteStream(tmpFile);

https
  .get(SCRIPT_URL, (res) => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      https.get(res.headers.location, (r) => r.pipe(file));
    } else {
      res.pipe(file);
    }

    file.on("finish", () => {
      file.close();
      fs.chmodSync(tmpFile, 0o755);

      const bashArgs = [tmpFile];
      if (quickMode) bashArgs.push("--quick");

      const child = spawn("/bin/bash", bashArgs, {
        stdio: "inherit",
        env: { ...process.env, NONINTERACTIVE: "1" },
      });

      child.on("close", (code) => {
        try {
          fs.unlinkSync(tmpFile);
        } catch {}
        process.exit(code || 0);
      });
    });
  })
  .on("error", (e) => {
    console.error(`  ✗ Download failed: ${e.message}`);
    console.error("  ℹ Check internet connection and retry.");
    process.exit(1);
  });
