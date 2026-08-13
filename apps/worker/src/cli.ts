import { BRON_TYPES, administratieConfigPad, dataRoot, lockPad, type BronType } from "./paths.js";
import { resolveAlleBronnen } from "./sourceResolver.js";
import { vervangBron, type VervangDoel } from "./replace.js";
import { rebuildCache } from "./rebuildCache.js";
import { genereerControlerapport } from "./genereerControlerapport.js";
import { withLock } from "./lock.js";
import { AdministratieBestaatAlError, initAdministratie } from "./administratie.js";

function printGebruik(): never {
  console.error(
    [
      "Gebruik:",
      "  init-administratie <administratieId> <bedrijfsnr> <weergavenaam>  (bv. init-administratie 070_Fergagne 070 \"Fergagne BV\")",
      "  status <administratieId>",
      "  replace <bronType> <gedeeld|administratieId> <bestandspad> [--boekjaar N --boekperiode P]",
      "  rebuild-cache <administratieId> [--boekjaar N --boekperiode P]  (boekjaar/boekperiode alleen nodig als ouderdomsanalyse aanwezig is)",
      "  controlerapport <administratieId>  (rauw brondata-overzicht uit de cache, ter vergelijking met een bestaande rapportage)",
      "",
      `bronType is één van: ${BRON_TYPES.join(", ")}`,
      "Vereist BVC_DATA_ROOT.",
    ].join("\n"),
  );
  process.exit(1);
}

function parseFlag(args: string[], naam: string): string | undefined {
  const index = args.indexOf(`--${naam}`);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const root = dataRoot();

  if (command === "init-administratie") {
    const [administratieId, bedrijfsnr, ...weergavenaamDelen] = rest;
    const weergavenaam = weergavenaamDelen.join(" ");
    if (!administratieId || !bedrijfsnr || !weergavenaam) printGebruik();
    try {
      const config = initAdministratie(root, administratieId, bedrijfsnr, weergavenaam);
      console.log(`Administratie "${administratieId}" aangemaakt (${administratieConfigPad(root, administratieId)}):`);
      console.log(JSON.stringify(config, null, 2));
    } catch (error) {
      if (error instanceof AdministratieBestaatAlError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    return;
  }

  if (command === "status") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    for (const bron of resolveAlleBronnen(root, administratieId)) {
      console.log(`${bron.bronType.padEnd(20)} ${bron.locatie.padEnd(8)} ${bron.bestaat ? "aanwezig" : "Bron ontbreekt"}  (${bron.pad})`);
    }
    return;
  }

  if (command === "replace") {
    const [bronTypeArg, doelArg, bestandspad] = rest;
    if (!bronTypeArg || !doelArg || !bestandspad || !BRON_TYPES.includes(bronTypeArg as BronType)) printGebruik();
    const doel: VervangDoel = doelArg === "gedeeld" ? { type: "gedeeld" } : { type: "eigen", administratieId: doelArg };
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiode = parseFlag(rest, "boekperiode");

    await withLock(lockPad(root), () => {
      const resultaat = vervangBron({
        root,
        bronType: bronTypeArg as BronType,
        doel,
        kandidaatBestandspad: bestandspad,
        gebruiker: process.env["USER"] ?? process.env["USERNAME"] ?? "onbekend",
        context: {
          boekjaar: boekjaarStr ? Number(boekjaarStr) : undefined,
          boekperiode,
          peildatum: boekjaarStr && boekperiode ? laatsteDagVanBoekperiode(Number(boekjaarStr), boekperiode) : undefined,
        },
      });
      console.log(JSON.stringify(resultaat, null, 2));
      if (resultaat.uitkomst === "GEBLOKKEERD") process.exitCode = 1;
    });
    return;
  }

  if (command === "rebuild-cache") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiode = parseFlag(rest, "boekperiode");
    const resultaat = rebuildCache({
      root,
      administratieId,
      ouderdomsanalyseMetadata:
        boekjaarStr && boekperiode ? { boekjaar: Number(boekjaarStr), boekperiode, peildatum: laatsteDagVanBoekperiode(Number(boekjaarStr), boekperiode) } : undefined,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "controlerapport") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const resultaat = genereerControlerapport(root, administratieId);
    console.log(`Controlerapport geschreven: ${resultaat.pad}`);
    return;
  }

  printGebruik();
}

/** Boekperiode "01".."12" = kalendermaand; peildatum is de laatste dag van die maand. */
function laatsteDagVanBoekperiode(boekjaar: number, boekperiode: string): Date {
  const maand = Number(boekperiode);
  return new Date(Date.UTC(boekjaar, maand, 0));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
