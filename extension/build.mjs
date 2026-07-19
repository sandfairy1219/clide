import * as esbuild from "esbuild";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** resolve react/jsx-runtime etc from root node_modules */
const rootNodeModules = join(__dirname, "..", "node_modules");

async function main() {
  const watch = process.argv.includes("--watch");
  const opts = {
    logLevel: "info",
    external: ["vscode"],
    bundle: true,
    sourcemap: watch ? "inline" : false,
    minify: !watch,
  };

  // extension host (CommonJS for VS Code)
  const ctx1 = await esbuild.context({
    ...opts,
    entryPoints: [join(__dirname, "src", "extension.ts")],
    outfile: join(__dirname, "dist", "extension.js"),
    platform: "node",
    format: "cjs",
    nodePaths: [rootNodeModules],
  });

  // webview (ESM for browser)
  const ctx2 = await esbuild.context({
    ...opts,
    entryPoints: [join(__dirname, "webview", "main.tsx")],
    outfile: join(__dirname, "dist", "webview.js"),
    platform: "browser",
    format: "iife",
    globalName: "clideWebview",
    nodePaths: [rootNodeModules],
    define: {
      "process.env.NODE_ENV": watch ? '"development"' : '"production"',
    },
  });

  if (watch) {
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log("watching…");
  } else {
    await Promise.all([ctx1.rebuild(), ctx2.rebuild()]);
    await Promise.all([ctx1.dispose(), ctx2.dispose()]);
    console.log("build complete");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
