import Decimal from "decimal.js";
import { BRON_TYPES, administratieConfigPad, dataRoot, lockPad, type BronType } from "./paths.js";
import { resolveAlleBronnen } from "./sourceResolver.js";
import { vervangBron, type VervangDoel } from "./replace.js";
import { rebuildCache } from "./rebuildCache.js";
import { genereerControlerapport } from "./genereerControlerapport.js";
import { genereerPlPeriode } from "./genereerPlPeriode.js";
import { genereerBalansPeriode } from "./genereerBalansPeriode.js";
import { genereerRapportPeriode } from "./genereerRapportPeriode.js";
import { genereerKerncijfers } from "./genereerKerncijfers.js";
import { genereerVastgoedKerncijfers } from "./genereerVastgoedKerncijfers.js";
import { genereerRentrollDiagnose } from "./genereerRentrollDiagnose.js";
import { genereerServicekostenBronKolommenDiagnose } from "./genereerServicekostenBronKolommenDiagnose.js";
import { genereerServicekostenAfrekeningDiagnose } from "./genereerServicekostenAfrekeningDiagnose.js";
import { genereerServicekostenGrootboekReconciliatieDiagnose } from "./genereerServicekostenGrootboekReconciliatieDiagnose.js";
import { genereerServicekostenPositie } from "./genereerServicekostenPositie.js";
import { genereerHuurKerncijfers } from "./genereerHuurKerncijfers.js";
import { genereerManagementRapport } from "./genereerManagementRapport.js";
import { genereerKasstroomPeriode } from "./genereerKasstroomPeriode.js";
import { genereerKasstroomManagementoverzicht } from "./genereerKasstroomManagementoverzicht.js";
import { genereerKasstroomTegenrekeningDiagnose } from "./genereerKasstroomTegenrekeningDiagnose.js";
import { genereerKasstroomRekeningActiviteit } from "./genereerKasstroomRekeningActiviteit.js";
import { genereerGrootboekInventarisatie } from "./genereerGrootboekInventarisatie.js";
import { withLock } from "./lock.js";
import { AdministratieBestaatAlError, initAdministratie } from "./administratie.js";
import { startServeServer } from "./serveServer.js";

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
      "  kerncijfers <administratieId> --boekjaar N --periodeTotEnMet P [--tolerantie N]",
      "      (TIJDELIJK, v1: compact Management-KPI-overzicht dat uitsluitend al-bewezen berekeningen samenstelt — totale opbrengsten/kosten + resultaat huidig boekjaar (pl-periode), bankstand einde periode/netto kasstroom/eigenaaronttrekkingen (kasstroom-managementoverzicht) en balansSluitBinnenTolerantie als datakwaliteitsindicator (balans-periode) — plus een aparte 'vastgoed'-sectie (totale/verhuurde/leegstand VVO, bezettingsgraad, leegstandspercentage, bronPeildatum, controleVereist) van vastgoed-kerncijfers: een ONAFHANKELIJKE, actuele momentopname, GEEN periodegebonden cijfer en nooit meegeteld in de financiële velden — geen renderer/HTML, alleen JSON op stdout, geen nieuwe financiële of vastgoed-rekenlogica)",
      "  vastgoed-kerncijfers <administratieId>",
      "      (TIJDELIJK, v1: vastgoed-KPI's — bezettingsgraad/leegstand per complex + portefeuille, bottom-up uit units (totale VVO) en rentroll (verhuurde VVO, regels >0 m²) — STRIKT GESCHEIDEN van de financiële berekeningen, geen boekjaar/periode: dit is een actuele bronstand, geen periodegebonden cijfer. complex_totalen is uitsluitend een onafhankelijke controlebron; afwijkingen komen in controleVereist, worden nooit stilzwijgend gecorrigeerd. Geen renderer/HTML, alleen JSON op stdout, nog niet gekoppeld aan kerncijfers)",
      "  rentroll-diagnose <administratieId>",
      "      (TIJDELIJK, alleen-lezen: toont per rentroll-regel contractnummer/complexnr/unitnr/Vorderingsoort/prolongatie_bedrag_jaar/korting_bedrag_jaar/gehuurd_oppervlak/rapportage_datum, plus — uitsluitend bij een eenduidige (1-op-1) match op contractnummer — ingangsdatum/afloopdatum/expiratiedatum/check_lopend_contract uit contracten (geen match of meerdere matches wordt expliciet gemeld, nooit gegokt). Ook: aantal regels/som prolongatie_bedrag_jaar/som gehuurd_oppervlak/aantal unieke contracten per Vorderingsoort, en onverwachte Vorderingsoort-waarden. Geen huur-KPI, geen renderer, alleen JSON op stdout — bouwstap om te bepalen hoe Vorderingsoort 01/12/13 zich in de echte data gedraagt vóór een huur-KPI-module wordt ontworpen)",
      "  servicekosten-bronkolommen <administratieId>",
      "      (TIJDELIJK, alleen-lezen: leest het RUWE servicekosten-bronbestand rechtstreeks (niet de cache, niet het geparste schema) en toont ELKE kolomnaam die erin voorkomt — inclusief kolommen die nog niet in ServicekostenregelBronSchema staan — met aantal niet-lege waarden en max. 5 voorbeeldwaarden per kolom. Bouwstap om te bepalen of de bron een apart grootboekrekening/rekeningnummer-veld bevat vóórdat daar iets structureels mee gebouwd wordt. Geen KPI, geen classificatie, alleen JSON op stdout)",
      "  servicekosten-afrekening-diagnose <administratieId>",
      "      (TIJDELIJK, alleen-lezen: leest het RUWE servicekosten-bronbestand en analyseert Kostensoort_Soort (Kosten/Voorschotten/Nvt) + acht afrekeningsvelden (Jaar_Afrekening, Jaar_SV_Afrekening, Per_SV_Afrekening, Periode_Afrekening, SV_Afrekening_Soort(+Omschrijving/Vlgnr), Vdsrt_Opbrengsten(+Omschr)) + Service_Boeking_Saldo vs. herberekend saldo — per Kostensoort_Soort, apart voor kostensoort 9600 (nooit automatisch uit kosten/voorschotten gefilterd), met tekenpatroon-onderzoek. Geen KPI, geen classificatie, geen cache/rebuildCache-aanraking, alleen JSON op stdout)",
      "  servicekosten-grootboek-reconciliatie <administratieId> --boekjaar N [--periodeVan P] --periodeTotEnMet P --rekeningen <lijst>",
      "      (TIJDELIJK, alleen-lezen: reconcilieert de servicekosten-afrekeningsbron (Kostensoort_Soort Kosten/Voorschotten/Nvt) tegen de opgegeven grootboekrekeningen (kommagescheiden, bv. 1711,1712) uit de al-herbouwde cache `boekingen`. Koppelt uitsluitend op de natuurlijke sleutel boekjaar+dagboek+boekstuk+volgnummer — GEEN bedrag-matching. Toont per stroom welke grootboekrekening(en) daadwerkelijk gevonden zijn, een onafhankelijke grootboeksaldo-vs-gekoppeld-servicekostensaldo-vergelijking per doelrekening en per boekperiode, en houdt kostensoort 9600 altijd apart zichtbaar. Geen KPI, geen mapping, geen cache/rebuildCache-wijziging, geen koppeling aan management-rapport, alleen JSON op stdout)",
      "  servicekosten-positie <administratieId> --boekjaar N [--periodeVan P] --periodeTotEnMet P --rekeningen <lijst>",
      "      (v1: definitieve servicekostenmodule — A. actuele positie (werkelijke kosten + voorschotten in de gekozen periode, actueelSaldo = kostenSaldo + voorschottenSaldo, NOOIT aftrekken), B. afrekening voorgaand jaar (config-gestuurd uitgesloten kostensoorten, bv. 9600, altijd apart, nooit in de actuele positie), C. financiële reconciliatie tegen de opgegeven doelrekeningen (kommagescheiden, bv. 1711,1712 — PARAMETER, geen hardcoded aanname). Kostenallocatie per huurder wordt bewust NIET gebouwd (kosten zijn overwegend complexbreed); voorschotten/afrekening per contract-huurder waar rechtstreeks bewezen. Geen renderer, geen koppeling aan management-rapport, alleen JSON op stdout)",
      "  huur-kerncijfers <administratieId>",
      "      (TIJDELIJK, v1: bruto/netto jaarhuur, huurkortingen, verhuurde VVO en huur per m², per complex + portefeuille — Vorderingsoort 01=huur/13=korting (Vorderingsoort 12 en onverwachte waarden genegeerd+gemeld), alleen regels met een deterministische, op bronPeildatum geldige contractkoppeling tellen mee. STRIKT ZELFSTANDIG van vastgoed-kerncijfers/kerncijfersManagement/@bvc/domain/vastgoed.ts, geen boekjaar/periode: actuele bronstand. Geen renderer/HTML, alleen JSON op stdout)",
      "  management-rapport <administratieId> --boekjaar N [--periodeVan P] --periodeTotEnMet P [--tolerantie N]",
      "      (TIJDELIJK, v1: eerste gecombineerde managementrapportage — bundelt kerncijfers (financieel+vastgoed), huur-kerncijfers en het volledige kasstroom-managementoverzicht in één HTML-rapport, geschreven naar rapporten/. Rekent zelf niets uit, presenteert alleen de al-bewezen module-uitkomsten. --periodeVan (standaard 01) bepaalt uitsluitend de V&W-/kasstroomperiode ('Periode'-groep); balans, resultaat-huidig-boekjaar-YTD ('Stand/YTD'-groep) en vastgoed/huur (momentopname met bronPeildatum) blijven altijd een stand per einde --periodeTotEnMet, ongeacht --periodeVan)",
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
      "  serve [--poort N]",
      "      (TIJDELIJK, v1: lokaal invoerscherm — start een webserver op 127.0.0.1 (standaard poort 8787, nooit op het netwerk bereikbaar), opent de browser automatisch. Administratie/boekjaar/periode kiezen -> 'Managementrapport openen' roept rechtstreeks dezelfde genereerManagementRapport() aan als het CLI-commando management-rapport, geen nieuwe reken-/reportinglogica. Administratielijst dynamisch uit BVC_DATA_ROOT/administraties, server-side validatie. Ctrl+C sluit netjes af)",
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

  if (command === "kerncijfers") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet) printGebruik();
    const tolerantieStr = parseFlag(rest, "tolerantie");
    const resultaat = genereerKerncijfers(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeTotEnMet,
      toleranceEuro: tolerantieStr ? new Decimal(tolerantieStr) : undefined,
    });
    console.log(JSON.stringify(resultaat, null, 2));
    if (!resultaat.balansSluitBinnenTolerantie) process.exitCode = 1;
    return;
  }

  if (command === "vastgoed-kerncijfers") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const resultaat = genereerVastgoedKerncijfers(root, administratieId);
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.controleVereist.some((i) => i.ernst === "KRITIEK")) process.exitCode = 1;
    return;
  }

  if (command === "rentroll-diagnose") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const resultaat = genereerRentrollDiagnose(root, administratieId);
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "servicekosten-bronkolommen") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const resultaat = genereerServicekostenBronKolommenDiagnose(root, administratieId);
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "servicekosten-afrekening-diagnose") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const resultaat = genereerServicekostenAfrekeningDiagnose(root, administratieId);
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "servicekosten-positie") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    const rekeningenStr = parseFlag(rest, "rekeningen");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet || !rekeningenStr) printGebruik();
    const resultaat = genereerServicekostenPositie(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeVan: parseFlag(rest, "periodeVan"),
      boekperiodeTotEnMet,
      doelrekeningen: rekeningenStr.split(",").map((r) => r.trim()).filter((r) => r.length > 0),
    });
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.controleVereist.some((i) => i.ernst === "KRITIEK")) process.exitCode = 1;
    return;
  }

  if (command === "servicekosten-grootboek-reconciliatie") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    const rekeningenStr = parseFlag(rest, "rekeningen");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet || !rekeningenStr) printGebruik();
    const resultaat = genereerServicekostenGrootboekReconciliatieDiagnose(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeVan: parseFlag(rest, "periodeVan"),
      boekperiodeTotEnMet,
      doelrekeningen: rekeningenStr.split(",").map((r) => r.trim()).filter((r) => r.length > 0),
    });
    console.log(JSON.stringify(resultaat, null, 2));
    return;
  }

  if (command === "huur-kerncijfers") {
    const [administratieId] = rest;
    if (!administratieId) printGebruik();
    const resultaat = genereerHuurKerncijfers(root, administratieId);
    console.log(JSON.stringify(resultaat, null, 2));
    if (resultaat.controleVereist.some((i) => i.ernst === "KRITIEK")) process.exitCode = 1;
    return;
  }

  if (command === "management-rapport") {
    const [administratieId] = rest;
    const boekjaarStr = parseFlag(rest, "boekjaar");
    const boekperiodeTotEnMet = parseFlag(rest, "periodeTotEnMet");
    if (!administratieId || !boekjaarStr || !boekperiodeTotEnMet) printGebruik();
    const tolerantieStr = parseFlag(rest, "tolerantie");
    const resultaat = genereerManagementRapport(root, administratieId, {
      boekjaar: Number(boekjaarStr),
      boekperiodeVan: parseFlag(rest, "periodeVan"),
      boekperiodeTotEnMet,
      toleranceEuro: tolerantieStr ? new Decimal(tolerantieStr) : undefined,
    });
    console.log(`Managementrapport geschreven: ${resultaat.pad}`);
    if (resultaat.resultaat.controleVereist.some((i) => i.ernst === "KRITIEK")) process.exitCode = 1;
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

  if (command === "serve") {
    const poortStr = parseFlag(rest, "poort");
    const poort = poortStr ? Number(poortStr) : 8787;
    if (!Number.isInteger(poort) || poort < 1 || poort > 65535) printGebruik();
    startServeServer(root, { poort });
    return; // proces blijft leven zolang de server luistert — geen expliciete "wacht" nodig.
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
