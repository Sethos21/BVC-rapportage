import Decimal from "decimal.js";
import { BRON_TYPES, administratieConfigPad, dataRoot, lockPad, type BronType } from "./paths.js";
import { resolveAlleBronnen } from "./sourceResolver.js";
import { vervangBron, type VervangDoel } from "./replace.js";
import { rebuildCache } from "./rebuildCache.js";
import { genereerControlerapport } from "./genereerControlerapport.js";
import { genereerPlPeriode } from "./genereerPlPeriode.js";
import { genereerBalansPeriode } from "./genereerBalansPeriode.js";
import { genereerRapportPeriode } from "./genereerRapportPeriode.js";
import { genereerKasstroomPeriode } from "./genereerKasstroomPeriode.js";
import { genereerKasstroomManagementoverzicht } from "./genereerKasstroomManagementoverzicht.js";
import { genereerKasstroomTegenrekeningDiagnose } from "./genereerKasstroomTegenrekeningDiagnose.js";
import { genereerKasstroomRekeningActiviteit } from "./genereerKasstroomRekeningActiviteit.js";
import { genereerGrootboekInventarisatie } from "./genereerGrootboekInventarisatie.js";
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
      "  pl-periode <administratieId> --boekjaar N [--periodeVan P --periodeTotEnMet P] [--verwacht <pad-naar-json>] [--tolerantie N]",
      "      (P&L-berekening op de goedgekeurde grootboekmapping voor een expliciete periode; --verwacht vergelijkt automatisch met eerder gereconcilieerde bedragen)",
      "  balans-periode <administratieId> --boekjaar N --periodeTotEnMet P [--tolerantie N]",
      "      (Balans op een expliciete boekjaar+boekperiode-peildatum: beginbalans + boekingen t/m die periode, incl. aansluitingscontrole activa/passiva/resultaat)",
      "  rapport-periode <administratieId> --boekjaar N --periodeTotEnMet P [--tolerantie N]",
      "      (Resultatenrekening + balans van dezelfde periode in één HTML-rapport, geschreven naar rapporten/ — zelfde berekeningen als pl-periode/balans-periode)",
      "  kasstroom-periode <administratieId> --boekjaar N --periodeTotEnMet P",
      "      (Mutatie bankstand: beginbalans + boekingen t/m die periode, alleen voor rekeningen met bevestigde liquideMiddelen:true — eerste, eenvoudige kasstroomweergave)",
      "  kasstroom-managementoverzicht <administratieId> --boekjaar N --periodeTotEnMet P [--verwacht <pad-naar-json>] [--tolerantie N]",
      "      (Kasstroom-managementoverzicht: bankstand begin/eind, totale ontvangsten/uitgaven en netto kasstroom o.b.v. werkelijke mutaties op de liquide-middelenrekening(en), met eigenaaronttrekkingen (0840) als uitsplitsing binnen uitgaven en per kwartaal — HTML naar rapporten/; --verwacht vergelijkt automatisch met een eerder geverifieerd regressiepunt, bv. 070_Rooise_Zoom boekjaar 2026 t/m periode 06)",
      "  kasstroom-diagnose-tegenrekening <administratieId> --boekjaar N --periodeTotEnMet P --rekening <grootboekrekening>",
      "      (alleen-lezen: toont per boekstuk waarin de opgegeven rekening voorkomt of dat boekstuk vandaag meetelt als eigenaaronttrekking in kasstroom-managementoverzicht, en zo niet waarom niet — geen rapportbestand, alleen JSON op stdout)",
      "  kasstroom-diagnose-rekeningactiviteit <administratieId> --boekjaar N --periodeTotEnMet P --rekening <grootboekrekening>",
      "      (alleen-lezen: toont ALLE boekingen op de opgegeven rekening chronologisch, met boekstukSleutel/dagboeknr/bedrag/omschrijving en of het boekstuk kasstroom-relevant is — bouwstap om een keten zoals factuur (bv. 1506) -> crediteuren (1600) -> bank te kunnen beoordelen, matcht zelf niets automatisch)",
      "  grootboek-inventarisatie",
      "      (alleen-lezen: inventariseert grootboekrekeninggebruik over ALLE administraties in de gedeelde bron boekingen/balans_per_jaar — voorbereiding op een centrale mastermapping, past niets toe)",
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

  if (command === "pl-periode") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    if (!administratieId || !boekjaarStr) printGebruik();
    const tolerantieStr = parseFlag(rest, "tolerantie");
    const resultaat = genereerPlPeriode(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeVan: parseFlag(rest, "periodeVan"),
      boekperiodeTotEnMet: parseFlag(rest, "periodeTotEnMet"),
      verwachtePad: parseFlag(rest, "verwacht"),
      toleranceEuro: tolerantieStr ? new Decimal(tolerantieStr) : undefined,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.resultaat.controleVereist.length > 0) process.exitCode = 1;
    return;
  }

  if (command === "balans-periode") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet) printGebruik();
    const tolerantieStr = parseFlag(rest, "tolerantie");
    const resultaat = genereerBalansPeriode(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
      toleranceEuro: tolerantieStr ? new Decimal(tolerantieStr) : undefined,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.resultaat.controleVereist.length > 0 || !resultaat.resultaat.aansluiting.sluitBinnenTolerantie) process.exitCode = 1;
    return;
  }

  if (command === "rapport-periode") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet) printGebruik();
    const tolerantieStr = parseFlag(rest, "tolerantie");
    const resultaat = genereerRapportPeriode(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
      toleranceEuro: tolerantieStr ? new Decimal(tolerantieStr) : undefined,
    });
    console.log(`Rapport geschreven: ${resultaat.pad}`);
    if (resultaat.plResultaat.controleVereist.length > 0 || resultaat.balansResultaat.controleVereist.length > 0 || !resultaat.balansResultaat.aansluiting.sluitBinnenTolerantie) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "kasstroom-periode") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet) printGebruik();
    const resultaat = genereerKasstroomPeriode(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.resultaat.controleVereist.length > 0) process.exitCode = 1;
    return;
  }

  if (command === "kasstroom-managementoverzicht") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet) printGebruik();
    const tolerantieStr = parseFlag(rest, "tolerantie");
    const resultaat = genereerKasstroomManagementoverzicht(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
      verwachtePad: parseFlag(rest, "verwacht"),
      toleranceEuro: tolerantieStr ? new Decimal(tolerantieStr) : undefined,
    });
    console.log(`Rapport geschreven: ${resultaat.pad}`);
    if (resultaat.vergelijking) {
      console.log(JSON.stringify(resultaat.vergelijking, null, 2));
      if (!resultaat.vergelijking.alleSluitenBinnenTolerantie) process.exitCode = 1;
    }
    if (resultaat.resultaat.controleVereist.length > 0) process.exitCode = 1;
    return;
  }

  if (command === "kasstroom-diagnose-tegenrekening") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    const doelRekening = parseFlag(rest, "rekening");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet || !doelRekening) printGebruik();
    const resultaat = genereerKasstroomTegenrekeningDiagnose(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
      doelRekening,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "kasstroom-diagnose-rekeningactiviteit") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    const doelRekening = parseFlag(rest, "rekening");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet || !doelRekening) printGebruik();
    const resultaat = genereerKasstroomRekeningActiviteit(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
      doelRekening,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "grootboek-inventarisatie") {
    const resultaat = genereerGrootboekInventarisatie(root);
    console.error(
      `Ingelezen: ${resultaat.boekingenIssues.length} issues in boekingen, ${resultaat.balansIssues.length} issues in balans_per_jaar (zie stderr niet meegenomen in de JSON-uitvoer op stdout).`,
    );
    console.log(JSON.stringify(resultaat.inventarisatie, null, 2));
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
