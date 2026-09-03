#!/usr/bin/env node
/**
 * Bouwt de Worker als standalone Windows-executable (`dist/bvc-worker.exe`),
 * via Node's Single Executable Applications (SEA) — geen Node/pnpm-
 * installatie nodig op de doelmachine (CLAUDE.md §3, "bedrijfsomgeving
 * staat Node/pnpm-installatie op de server niet toe").
 *
 * Werking:
 *  1. esbuild bundelt cli.ts (incl. alle @bvc/*-workspacepakketten) tot één
 *     CommonJS-bestand — SEA vereist een bundel, geen los node_modules-boom.
 *  2. `node --experimental-sea-config` genereert de SEA-blob uit die bundel.
 *  3. Een officiële win-x64 node.exe (zelfde versie als de lokale Node,
 *     gedownload van nodejs.org, gecachet in .cache/) dient als drager.
 *  4. `postject` injecteert de blob in een kopie van die node.exe.
 *
 * Node/pnpm blijven nodig om dít te bouwen (ontwikkelmachine) — de output
 * (`bvc-worker.exe`) heeft op de doelmachine niets anders nodig.
 *
 * Let op: injectie maakt de Authenticode-signature van node.exe ongeldig.
 * Windows kan daardoor een SmartScreen-waarschuwing tonen bij de eerste
 * uitvoering, en een streng AppLocker/WDAC-beleid dat ondertekende
 * executables afdwingt kan het bestand blokkeren — dat is bij dit type
 * SEA-build niet te voorkomen zonder zelf te (laten) ondertekenen.
 */
import { build } from "esbuild";
import { inject } from "postject";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(__dirname, "..");
const distDir = join(workerRoot, "dist");
const cacheDir = join(workerRoot, ".cache");

// Node's huidige SEA-sentinel (zie nodejs.org/api/single-executable-applications.html) —
// geen publieke API om deze op te vragen, dus als letterlijke constante volgens de officiële docs.
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const nodeVersion = process.version; // bv. "v22.22.2" — blob en drager-node.exe moeten dezelfde versie zijn.

async function main() {
  mkdirSync(distDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  console.log(`[1/4] Bundelen (esbuild, ${nodeVersion}) …`);
  const bundlePad = join(distDir, "worker-bundle.cjs");
  await build({
    entryPoints: [join(workerRoot, "src", "cli.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: bundlePad,
    external: ["node:sqlite"],
  });

  console.log("[2/4] SEA-blob genereren …");
  const seaConfigPad = join(distDir, "sea-config.json");
  const blobPad = join(distDir, "worker-sea-blob.blob");
  writeFileSync(
    seaConfigPad,
    JSON.stringify({ main: bundlePad, output: blobPad, disableExperimentalSEAWarning: true }, null, 2),
  );
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPad], { stdio: "inherit" });

  console.log("[3/4] Windows node.exe ophalen (gecachet) …");
  const nodeExeCachePad = join(cacheDir, `node-${nodeVersion}-win-x64.exe`);
  if (!existsSync(nodeExeCachePad)) {
    const url = `https://nodejs.org/dist/${nodeVersion}/win-x64/node.exe`;
    console.log(`  downloaden: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Kon win-x64 node.exe niet downloaden (${response.status}): ${url}`);
    }
    writeFileSync(nodeExeCachePad, Buffer.from(await response.arrayBuffer()));
  } else {
    console.log(`  uit cache: ${nodeExeCachePad}`);
  }

  console.log("[4/4] Injecteren (postject) …");
  const exePad = join(distDir, "bvc-worker.exe");
  copyFileSync(nodeExeCachePad, exePad);
  await inject(exePad, "NODE_SEA_BLOB", readFileSync(blobPad), {
    sentinelFuse: SEA_FUSE,
    overwrite: true,
  });

  console.log(`\nKlaar: ${exePad}`);
  console.log("Testen op Windows: bvc-worker.exe status <administratieId> (met BVC_DATA_ROOT gezet).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
