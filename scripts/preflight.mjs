// Build preflight: fails FAST and LOUD when the installed node_modules tree
// is stale or incomplete, instead of letting `tsc`/`next build` drown the log
// in hundreds of misleading "Cannot find name 'process'" errors.
//
// Why this exists: hosts that cache node_modules between builds (e.g. Render)
// can restore a cache from before a dependency change; a plain `npm install`
// then reports "up to date" without actually installing the new packages.
// This script catches that class of failure at the very top of the build.
//
// Run automatically via the root `npm run build`. Zero dependencies.
import { createRequire } from "node:module";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// 1. Node version — the repo requires >= 20 (see package.json engines).
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  problems.push(`Node ${process.versions.node} is too old — this repo requires Node >= 20.`);
}

// 2. Every workspace must be able to resolve its critical build-time deps.
//    "@types/node" is the canary: when a cached/stale node_modules predates
//    the lockfile, TypeScript fails everywhere with "Cannot find name
//    'process'/'Buffer'" — this turns that into one clear message.
const workspaceDirs = [];
for (const group of ["apps", "packages"]) {
  const groupDir = path.join(root, group);
  if (!existsSync(groupDir)) continue;
  for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(groupDir, entry.name, "package.json"))) {
      workspaceDirs.push(path.join(groupDir, entry.name));
    }
  }
}

const checks = [
  { dir: root, deps: ["typescript", "@types/node/package.json"] },
  ...workspaceDirs.map((dir) => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const deps = ["typescript", "@types/node/package.json"].filter((d) =>
      d.startsWith("@types/node") ? "@types/node" in declared : d in declared
    );
    return { dir, deps };
  }),
];

for (const { dir, deps } of checks) {
  const req = createRequire(path.join(dir, "package.json"));
  for (const dep of deps) {
    try {
      req.resolve(dep);
    } catch {
      problems.push(`${path.relative(root, dir) || "."}: cannot resolve "${dep}" from its node_modules.`);
    }
  }
}

if (problems.length > 0) {
  console.error("\n============================= BUILD PREFLIGHT FAILED =============================");
  for (const p of problems) console.error(" - " + p);
  console.error(`
Your node_modules tree is stale or incomplete (a cached install from before a
dependency change will do this: "npm install" happily reports "up to date").

Fix: run a clean, lockfile-exact install from the repo root:

    npm ci

On Render: set the Build Command to  "npm ci && npm run build"  (npm ci wipes
node_modules and reinstalls exactly from package-lock.json, which defeats any
stale build cache), or clear the service's build cache once and redeploy.
==================================================================================
`);
  process.exit(1);
}

console.log(`[preflight] OK — node ${process.versions.node}, ${workspaceDirs.length} workspaces, @types/node + typescript resolvable everywhere.`);
