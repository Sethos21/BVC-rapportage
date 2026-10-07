import type { IncomingMessage, ServerResponse } from "node:http";
import Decimal from "decimal.js";
import {
  leesAlgemeneKostenCategorieState,
  leesAlgemeneKostenRegels,
  leesBegrotingsversie,
  leesBegrotingsversiesVoorAdministratie,
  leesCorrectiefDagelijksOnderhoudBeoordeeld,
  leesCorrectiefDagelijksOnderhoudRegels,
  leesGemeentelijkeLastenModule,
  leesGemeentelijkeLastenRegels,
  leesGemeentelijkeLastenVoorstelStatus,
  leesGeplandOnderhoudActiviteiten,
  leesGeplandOnderhoudBeoordeeld,
  leesHuurBeoordeeld,
  leesHuurFictieveContracten,
  leesHuurMaandOverrides,
  leesLeegstandCategorieState,
  leesLeegstandRegels,
  leesLaatstAfgeslotenBoekperiode,
  leesModule1Aannames,
  leesModule1Overrides,
  leesModule1Snapshot,
  leesModule2Config,
  leesModule3Invoer,
  leesNietVerrekenbareBtwEstimatedVerwachting,
  leesNietVerrekenbareBtwRegels,
  leesNietVerrekenbareBtwState,
  leesPnLBronmappingRegels,
  leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie,
  leesRenteCategorieState,
  leesRenteEstimatedVerwachting,
  leesRenteRegels,
  leesVerborgenModules,
  leesVerzekeringBeoordeeld,
  leesVerzekeringRegels,
  leesWozHistorieCsv,
  leesWozObjecten,
  maakBegrotingsversie,
  neemWozVoorstelOver,
  openOrCreateDatabase,
  schrijfAlgemeneKostenCategorieState,
  schrijfAlgemeneKostenRegels,
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
  schrijfCorrectiefDagelijksOnderhoudRegels,
  schrijfGemeentelijkeLastenModule,
  schrijfGemeentelijkeLastenRegels,
  schrijfGeplandOnderhoudActiviteiten,
  schrijfGeplandOnderhoudBeoordeeld,
  schrijfHuurBeoordeeld,
  schrijfHuurMaandOverrides,
  schrijfLeegstandCategorieState,
  schrijfLeegstandRegels,
  schrijfModule1Aannames,
  schrijfModule1Overrides,
  schrijfModule1Snapshot,
  schrijfModule2Config,
  schrijfModule3Invoer,
  schrijfNietVerrekenbareBtwEstimatedVerwachting,
  schrijfNietVerrekenbareBtwRegels,
  schrijfNietVerrekenbareBtwState,
  schrijfRenteCategorieState,
  schrijfRenteEstimatedVerwachting,
  schrijfRenteRegels,
  schrijfVerzekeringBeoordeeld,
  schrijfVerzekeringRegels,
  schrijfWozObjecten,
  schrijfWozSetBevestigd,
  isModuleVerborgen,
  stelBegrotingVast,
  toonModule,
  verbergModule,
  verwijderConceptVersie,
  voegHuurFictiefContractToe,
  wijzigHuurFictiefContract,
  verwijderHuurFictiefContract,
  naarBgContractFeiten,
  VoorstelOvernameGeweigerdError,
  type AlgemeneKostenRegelInvoer,
  type Begrotingsversie,
  type BgHuurFictiefContract,
  type GemeentelijkeLastenRegelInvoer,
  type GeplandOnderhoudActiviteitInvoer,
  type LeegstandRegelInvoer,
  type VerzekeringRegelInvoer,
  type WozObjectInvoer,
} from "@bvc/begroting-data";
import {
  ALGEMENE_KOSTEN_CATEGORIEEN,
  berekenBegroteBeheersvergoeding,
  berekenBegroteHuuropbrengsten,
  berekenHuurKwartaalTotalen,
  berekenPnLBoom,
  berekenVerzekeringMaandverloop,
  somHuurKwartaalTotalen,
  LEEGSTAND_CATEGORIEEN,
  vergelijkPnLResultaten,
  type BgAlgemeneKostenCategorie,
  type BgBeheerComplexConfig,
  type BgContractFeiten,
  type BgContractMaandOverride,
  type BgContractOverride,
  type BgHuurKwartaalTotalen,
  type BgLeegstandCategorie,
  type BgManagementInvoer,
  type BgRenteCategorie,
} from "@bvc/reporting";
import { lijstAdministraties, leesAdministratieConfig } from "./administratie.js";
import { begrotingsversiesDatabasePad, pnlBronmappingDatabasePad } from "./paths.js";
import { leesBegrotingsWerkomgeving, leesOnderhoudTotaalVoorWerkomgeving } from "./begrotingWerkelijk.js";
import { leesBgContractFeitenVoorAdministratie } from "./contractenRentrollAdapter.js";
import { BOEKPERIODES } from "./serveUi.js";
import {
  renderAlgemeneKostenForm,
  renderBegrotingHoofdscherm,
  renderBegrotingKeuzeScherm,
  renderBeheerDetail,
  renderBtwForm,
  renderControlePagina,
  renderCorrectiefForm,
  renderFoutPagina,
  renderGemeentelijkeLastenForm,
  renderGeplandOnderhoudForm,
  renderHuurDetail,
  renderHuurMaandverloop,
  renderKiesBoekperiodeScherm,
  renderLeegstandForm,
  renderManagementForm,
  renderManagementVerbergenScherm,
  renderRenteForm,
  renderVerwijderBevestigingScherm,
  renderVerzekeringenForm,
  renderVerzekeringMaandverloop,
  type AlgemeneKostenCategorieOpties,
  type BeheerDetailRegel,
  type GemeentelijkeLastenRegelVeld,
  type GeplandOnderhoudRegelVeld,
  type ComplexHuurRegel,
  type HuurDetailRegel,
  type HuurFictiefContractFormulier,
  type HuurFictiefContractRegel,
  type HuurKwartaalVeld,
  type HuurMaandverloopRegel,
  type HuurSamenvattingVeld,
  type LeegstandCategorieOpties,
  moduleWerkomgevingPnLHtml,
  type OnderhoudTotaalSamenvattingVeld,
  type VerzekeringRegelVeld,
  type WozObjectVeld,
} from "./begrotingUi.js";

/**
 * TRANCHE 11 — routehandlers voor `/begroting/...`. Uitsluitend orchestratie: leest/schrijft via
 * de al bestaande, geaccepteerde `@bvc/begroting-data`-functies en de al bestaande productie-
 * Werkelijk-ophaal (`begrotingWerkelijk.ts`); introduceert zelf geen financiële logica.
 *
 * GEBOUWDE INVOERPAGINA'S IN DEZE TRANCHE: Managementvergoeding, Correctief/Dagelijks onderhoud,
 * Niet verrekenbare btw, Rente leningen, Opbrengst rente — de posten met de eenvoudigste,
 * reeds volledig vastgestelde invoerpatronen (UX_03/UX_05, Master Contract §7/§10). Alle andere
 * modules zijn deze tranche alleen-lezen in de vergelijkende P&L (zie het acceptatierapport).
 */

function stuurHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function stuurRedirect(res: ServerResponse, locatie: string): void {
  res.writeHead(302, { Location: locatie });
  res.end();
}

function leesBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString("utf-8")));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Nederlandse/internationale decimale invoer ("1.234,56" of "1234.56" of "1234,56") → `Decimal`. Leeg → `null`. Ongeldig → gooit. */
function parseGeld(waarde: string): Decimal | null {
  const tekst = waarde.trim();
  if (tekst.length === 0) return null;
  const genormaliseerd = tekst.replace(/\./g, "").replace(",", ".");
  const d = new Decimal(genormaliseerd);
  if (d.isNaN()) throw new Error(`Ongeldig bedrag: "${waarde}".`);
  return d;
}

function tekst(v: string | undefined): string {
  return (v ?? "").trim();
}
function tekstOfNull(v: string | undefined): string | null {
  const t = tekst(v);
  return t.length === 0 ? null : t;
}

const GELDIGE_PERIODES = new Set(BOEKPERIODES.map((p) => p.waarde));

/** UX-UITROL (2026-10-02): `null` wanneer de vergelijkende P&L (nog) niet kon worden berekend — het detailscherm werkt dan door zonder P&L-samenvattingspaneel. */
type Vergelijkend = ReturnType<typeof leesBegrotingsWerkomgeving> | null;

interface Geopend {
  root: string;
  administratieId: string;
  weergavenaam: string;
  bedrijfsnr: string;
  db: ReturnType<typeof openOrCreateDatabase>;
  versie: Begrotingsversie;
}

/** Opent de begrotingsdatabase van de administratie en leest de versie — `null` als iets niet bestaat (aanroeper stuurt dan een foutpagina). */
function open(root: string, administratieId: string, versieId: string): Geopend | null {
  let config;
  try {
    config = leesAdministratieConfig(root, administratieId);
  } catch {
    return null;
  }
  const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, administratieId));
  const versie = leesBegrotingsversie(db, versieId);
  if (versie === null) {
    db.close();
    return null;
  }
  return { root, administratieId, weergavenaam: config.weergavenaam, bedrijfsnr: config.bedrijfsnr, db, versie };
}

/**
 * Product-readiness fix (migratie 42): de autoritatieve laatst-afgesloten-boekperiode van een
 * REEDS GEOPENDE begrotingsversie — altijd de opgeslagen waarde (`begroting_aannames`), nooit een
 * eventueel aanwezige queryparameter. Die mag daarom nooit stilzwijgend een afwijkende opgeslagen
 * waarde introduceren: zodra er iets is opgeslagen, wint dat altijd. `null` = nog niets opgeslagen
 * (legacy-versie van vóór deze fix) — de aanroeper laat de gebruiker dan expliciet kiezen via
 * `renderKiesBoekperiodeScherm`/`POST .../boekperiode`, verzint zelf niets.
 */
function opgeslagenBoekperiode(g: Geopend): string | null {
  return leesLaatstAfgeslotenBoekperiode(g.db, g.versie.id);
}

function hoofdschermUrl(administratieId: string, versieId: string, laatstAfgeslotenBoekperiode: string, melding?: string): string {
  const basis = `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}`;
  return melding !== undefined ? `${basis}&melding=${encodeURIComponent(melding)}` : basis;
}

const BEOORDELING_BEOORDEELD = "Beoordeeld";
const BEOORDELING_NOG_BEOORDELEN = "Nog beoordelen";
const BEOORDELING_NIET_VAN_TOEPASSING = "Niet van toepassing";
const BEOORDELING_AUTOMATISCH = "Automatisch bijgewerkt";

/**
 * UX-UITROL (2026-10-06, mockup-actueel-aansluiting) — "Beoordeling in gewone gebruikerstaal"
 * (09_Begrotingsmodule_UX_Vastgesteld §3, punt 7): hergebruikt UITSLUITEND de bestaande, per-module
 * beoordeeld-vlaggen die `stelBegrotingVast`'s vaststel-gate ook al leest — geen nieuwe berekening,
 * geen tweede validatie, geen KRITIEK-herevaluatie (die blijft uitsluitend zichtbaar op de
 * detailschermen zelf). Huur/Beheer hebben in het bestaande contract geen beoordeeld-concept (geen
 * gate-check) en krijgen daarom het neutrale, eerlijke label "Automatisch bijgewerkt" — nooit een
 * verzonnen beoordeeld/nog-te-beoordelen-status voor een module die het contract niet kent.
 */
function leesBeoordelingPerRegel(g: Geopend): Record<string, string> {
  const labels: Record<string, string> = {
    HUUROPBRENGST_BELAST: BEOORDELING_AUTOMATISCH,
    HUUROPBRENGST_ONBELAST: BEOORDELING_AUTOMATISCH,
    VERLEENDE_HUURKORTING: BEOORDELING_AUTOMATISCH,
    BEHEERKOSTEN: BEOORDELING_AUTOMATISCH,
  };

  labels["MANAGEMENTVERGOEDING"] = isModuleVerborgen(g.db, g.bedrijfsnr, "MANAGEMENT")
    ? BEOORDELING_NIET_VAN_TOEPASSING
    : leesModule3Invoer(g.db, g.versie.id) !== null
      ? BEOORDELING_BEOORDEELD
      : BEOORDELING_NOG_BEOORDELEN;

  const geplandBeoordeeld = leesGeplandOnderhoudBeoordeeld(g.db, g.versie.id);
  const correctiefBeoordeeld = leesCorrectiefDagelijksOnderhoudBeoordeeld(g.db, g.versie.id);
  labels["ONDERHOUD"] = geplandBeoordeeld && correctiefBeoordeeld ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;

  labels["VERZEKERINGEN"] = leesVerzekeringBeoordeeld(g.db, g.versie.id) ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;

  labels["GEMEENTELIJKE_LASTEN"] = leesGemeentelijkeLastenModule(g.db, g.versie.id).beoordeeld ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;

  const akState = leesAlgemeneKostenCategorieState(g.db, g.versie.id);
  for (const categorie of ALGEMENE_KOSTEN_CATEGORIEEN) {
    labels[categorie] = akState[categorie].beoordeeld ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;
  }

  const leegstandState = leesLeegstandCategorieState(g.db, g.versie.id);
  labels["LEEGSTANDSKOSTEN"] = LEEGSTAND_CATEGORIEEN.every((categorie) => leegstandState[categorie].beoordeeld) ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;

  labels["NIET_VERREKENBARE_BTW"] = leesNietVerrekenbareBtwState(g.db, g.versie.id).beoordeeld ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;

  const renteState = leesRenteCategorieState(g.db, g.versie.id);
  labels["RENTEKOSTEN"] = renteState.RENTEKOSTEN.beoordeeld ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;
  labels["RENTE_OPBRENGSTEN"] = renteState.RENTE_OPBRENGSTEN.beoordeeld ? BEOORDELING_BEOORDEELD : BEOORDELING_NOG_BEOORDELEN;

  return labels;
}

async function toonHoofdscherm(res: ServerResponse, g: Geopend, laatstAfgeslotenBoekperiode: string, melding?: string): Promise<void> {
  try {
    const vergelijkend = leesBegrotingsWerkomgeving(g.root, g.administratieId, g.bedrijfsnr, g.db, g.versie, laatstAfgeslotenBoekperiode);
    const verborgenModules = leesVerborgenModules(g.db, g.bedrijfsnr);
    const beoordelingPerRegel = leesBeoordelingPerRegel(g);
    stuurHtml(
      res,
      200,
      renderBegrotingHoofdscherm({
        administratieId: g.administratieId,
        weergavenaam: g.weergavenaam,
        versie: g.versie,
        vergelijkend,
        laatstAfgeslotenBoekperiode,
        verborgenModules,
        beoordelingPerRegel,
        ...(melding !== undefined ? { melding } : {}),
      }),
    );
  } catch (error) {
    stuurHtml(res, 500, renderFoutPagina("Begroting kon niet worden geladen", error instanceof Error ? error.message : String(error), "/begroting"));
  } finally {
    g.db.close();
  }
}

export async function handleBegrotingRequest(root: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const segmenten = url.pathname.split("/").filter((s) => s.length > 0); // "" | "begroting" | ...

  if (segmenten[0] !== "begroting") return false;

  // GET /begroting
  if (req.method === "GET" && segmenten.length === 1) {
    const administraties = lijstAdministraties(root);
    const administratieId = url.searchParams.get("administratieId") ?? "";
    if (administratieId.length === 0) {
      stuurHtml(res, 200, renderBegrotingKeuzeScherm(administraties));
      return true;
    }
    let config;
    try {
      config = leesAdministratieConfig(root, administratieId);
    } catch {
      stuurHtml(res, 200, renderBegrotingKeuzeScherm(administraties, { fouten: [`Onbekende administratie "${administratieId}".`] }));
      return true;
    }
    const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, administratieId));
    try {
      const versies = leesBegrotingsversiesVoorAdministratie(db, config.bedrijfsnr);
      const melding = url.searchParams.get("melding");
      stuurHtml(
        res,
        200,
        renderBegrotingKeuzeScherm(administraties, { ingevoerd: { administratieId }, bestaandeVersies: versies, ...(melding !== null ? { melding } : {}) }),
      );
    } finally {
      db.close();
    }
    return true;
  }

  // POST /begroting/nieuw
  if (req.method === "POST" && segmenten.length === 2 && segmenten[1] === "nieuw") {
    const body = await leesBody(req);
    const velden = Object.fromEntries(new URLSearchParams(body));
    const administraties = lijstAdministraties(root);
    const administratieId = tekst(velden["administratieId"]);
    const begrotingsjaarStr = tekst(velden["begrotingsjaar"]);
    const begrotingsjaar = Number(begrotingsjaarStr);
    const laatstAfgeslotenBoekperiode = tekst(velden["laatstAfgeslotenBoekperiode"]);
    const indexatiePercentageStr = tekst(velden["indexatiePercentage"]);
    const fouten: string[] = [];
    if (!administraties.some((a) => a.administratieId === administratieId)) fouten.push("Kies een geldige administratie.");
    if (!begrotingsjaarStr || !Number.isInteger(begrotingsjaar) || begrotingsjaar < 2000 || begrotingsjaar > 2100) fouten.push("Begrotingsjaar moet een geldig jaartal zijn.");
    if (!GELDIGE_PERIODES.has(laatstAfgeslotenBoekperiode)) fouten.push("Kies een geldige laatst afgesloten boekperiode.");
    let indexatiePercentage: Decimal | null = null;
    try {
      indexatiePercentage = parseGeld(indexatiePercentageStr);
    } catch {
      fouten.push("Het huurindexatiepercentage is geen geldig getal.");
    }
    if (indexatiePercentage === null && fouten.length === 0) fouten.push("Vul het algemeen verwachte huurindexatiepercentage in.");
    if (fouten.length > 0) {
      stuurHtml(res, 400, renderBegrotingKeuzeScherm(administraties, { fouten, ingevoerd: { administratieId, begrotingsjaar: begrotingsjaarStr, laatstAfgeslotenBoekperiode, indexatiePercentage: indexatiePercentageStr } }));
      return true;
    }
    const config = leesAdministratieConfig(root, administratieId);
    const db = openOrCreateDatabase(begrotingsversiesDatabasePad(root, administratieId));
    try {
      const versie = maakBegrotingsversie(db, { originType: "NIEUW", bedrijfsnr: config.bedrijfsnr, begrotingsjaar, bronPeildatum: new Date() });
      // UX §2 punt 2 / §4: het algemeen indexatiepercentage is het enige vooraf vastgestelde uitgangspunt — zonder deze
      // Module-1-aannames kan de vergelijkende P&L (`herberekenBegroting`) nog niet rekenen.
      // Tranche 12: de Module-1-contractsnapshot komt nu uit de echte, bewezen Contracten/RentRoll-bron (zie
      // contractenRentrollAdapter.ts) — bevroren op het moment van aanmaken (UX/FO: "actuele contract-/RentRoll-
      // snapshot bij het starten"), niet ververst zodra de bron later wijzigt (OB-017).
      const contractenResultaat = leesBgContractFeitenVoorAdministratie(root, administratieId, config.bedrijfsnr, versie.bronPeildatum);
      schrijfModule1Snapshot(db, versie.id, contractenResultaat.contracten);
      // Product-readiness fix (migratie 42): de gekozen laatst afgesloten boekperiode is hierboven al
      // gevalideerd (GELDIGE_PERIODES) en wordt nu direct persistent vastgelegd bij deze versie — de
      // URL/querystring is daarna niet langer de enige bron van waarheid (zie opgeslagenBoekperiode()).
      schrijfModule1Aannames(db, versie.id, { begrotingsjaar, indexatiePercentage: indexatiePercentage! }, laatstAfgeslotenBoekperiode);
      const melding = contractenResultaat.bronBeschikbaar
        ? `Contractbasis geladen: ${contractenResultaat.contracten.length} contract(en) uit Contracten/RentRoll (${contractenResultaat.aantalContractenNaFilter} van ${contractenResultaat.aantalRuweContractenRegels} contractregels na administratiefilter).`
        : "Geen Contracten- en/of RentRoll-bronbestand gevonden voor deze administratie — Huur/Beheer starten leeg (onbekend), niet als bevestigde €0.";
      stuurRedirect(res, hoofdschermUrl(administratieId, versie.id, laatstAfgeslotenBoekperiode, melding));
    } finally {
      db.close();
    }
    return true;
  }

  if (segmenten.length < 3) return false;
  const administratieId = decodeURIComponent(segmenten[1]!);
  const versieId = decodeURIComponent(segmenten[2]!);

  // GET /begroting/{administratieId}/{versieId}
  if (req.method === "GET" && segmenten.length === 3) {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
    if (laatstAfgeslotenBoekperiode === null) {
      // Product-readiness fix (migratie 42): geen opgeslagen periode voor deze versie (legacy, van
      // vóór deze fix) — nooit verzinnen/afleiden, de gebruiker kiest hem hier expliciet eenmalig.
      stuurHtml(res, 200, renderKiesBoekperiodeScherm({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie }));
      g.db.close();
      return true;
    }
    const melding = url.searchParams.get("melding");
    await toonHoofdscherm(res, g, laatstAfgeslotenBoekperiode, melding ?? undefined);
    return true;
  }

  // POST /begroting/{administratieId}/{versieId}/boekperiode — legacy-versie zonder opgeslagen
  // periode: expliciete, eenmalige keuze die daarna persistent bij de versie wordt vastgelegd.
  if (req.method === "POST" && segmenten.length === 4 && segmenten[3] === "boekperiode") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    if (g.versie.status !== "CONCEPT") {
      g.db.close();
      stuurHtml(
        res,
        400,
        renderFoutPagina(
          "Boekperiode kan niet worden vastgelegd",
          "Deze begrotingsversie is al vastgesteld (immutable) en heeft geen opgeslagen laatst afgesloten boekperiode. Dit is een bekend, nog niet opgelost architectuurpunt voor vastgestelde legacy-versies zonder deze waarde.",
          "/begroting",
        ),
      );
      return true;
    }
    const body = await leesBody(req);
    const velden = Object.fromEntries(new URLSearchParams(body));
    const gekozenPeriode = tekst(velden["laatstAfgeslotenBoekperiode"]);
    if (!GELDIGE_PERIODES.has(gekozenPeriode)) {
      stuurHtml(
        res,
        400,
        renderKiesBoekperiodeScherm({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie, fouten: ["Kies een geldige laatst afgesloten boekperiode."] }),
      );
      g.db.close();
      return true;
    }
    const bestaandeAannames = leesModule1Aannames(g.db, g.versie.id);
    if (bestaandeAannames === null) {
      g.db.close();
      stuurHtml(res, 500, renderFoutPagina("Boekperiode kan niet worden vastgelegd", `Begrotingsversie ${versieId} heeft nog geen Module-1-aannames.`, "/begroting"));
      return true;
    }
    schrijfModule1Aannames(g.db, g.versie.id, bestaandeAannames, gekozenPeriode);
    g.db.close();
    stuurRedirect(res, hoofdschermUrl(administratieId, versieId, gekozenPeriode));
    return true;
  }

  // GET /begroting/{administratieId}/{versieId}/verwijderen — toont het bevestigingsscherm.
  // Uitsluitend voor CONCEPT; voor VASTGESTELD wordt het scherm nooit getoond, ook niet via een
  // directe URL (een actieve verwijdermogelijkheid mag voor VASTGESTELD nooit zichtbaar worden).
  if (req.method === "GET" && segmenten.length === 4 && segmenten[3] === "verwijderen") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    if (g.versie.status !== "CONCEPT") {
      g.db.close();
      stuurHtml(res, 400, renderFoutPagina("Kan niet worden verwijderd", "Een vastgestelde begrotingsversie is immutable en kan nooit worden verwijderd.", `/begroting?administratieId=${encodeURIComponent(administratieId)}`));
      return true;
    }
    stuurHtml(res, 200, renderVerwijderBevestigingScherm({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie }));
    g.db.close();
    return true;
  }

  // POST /begroting/{administratieId}/{versieId}/verwijderen — definitieve verwijdering, uitsluitend
  // na exacte bevestiging ("VERWIJDEREN", server-side gevalideerd). Status wordt hier opnieuw, vers
  // gecontroleerd (niet vertrouwd op wat het bevestigingsscherm ooit toonde) — geen directe route mag
  // een VASTGESTELDE versie alsnog verwijderen. De daadwerkelijke verwijdering loopt via de bestaande,
  // al geteste `verwijderConceptVersie` (cascade via bestaande foreign keys, geen losse SQL hier).
  if (req.method === "POST" && segmenten.length === 4 && segmenten[3] === "verwijderen") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    if (g.versie.status !== "CONCEPT") {
      g.db.close();
      stuurHtml(res, 400, renderFoutPagina("Kan niet worden verwijderd", "Een vastgestelde begrotingsversie is immutable en kan nooit worden verwijderd.", `/begroting?administratieId=${encodeURIComponent(administratieId)}`));
      return true;
    }
    const body = await leesBody(req);
    const velden = Object.fromEntries(new URLSearchParams(body));
    // Bewust GEEN `tekst()` (die trimt) — "exact VERWIJDEREN" betekent ook geen toegestane
    // voorloop-/naloopspaties; een onbekend formulierveld levert een lege string op, nooit een match.
    const bevestiging = velden["bevestiging"] ?? "";
    if (bevestiging !== "VERWIJDEREN") {
      stuurHtml(
        res,
        400,
        renderVerwijderBevestigingScherm({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie, fouten: ['Typ exact "VERWIJDEREN" (hoofdletters, geen spaties ervoor/erna) om te bevestigen.'] }),
      );
      g.db.close();
      return true;
    }
    // `g.db.close()` loopt bewust via `finally` en exact één keer, losgekoppeld van welk antwoord
    // wordt verstuurd: de vorige vorm sloot de database zowel in het succes- als in het catch-pad
    // apart, dus een close()-fout ná een geslaagde verwijdering kon de redirect naar het
    // versieoverzicht laten mislukken — de browser bleef dan op de POST-URL (.../verwijderen)
    // staan met een generieke foutpagina i.p.v. de bedoelde navigatie terug (zie oplevering).
    let foutmelding: string | null = null;
    try {
      verwijderConceptVersie(g.db, g.versie.id);
    } catch (error) {
      foutmelding = error instanceof Error ? error.message : String(error);
    } finally {
      g.db.close();
    }
    if (foutmelding === null) {
      stuurRedirect(res, `/begroting?administratieId=${encodeURIComponent(administratieId)}&melding=${encodeURIComponent(`Conceptbegroting ${g.versie.begrotingsjaar} is verwijderd.`)}`);
    } else {
      stuurHtml(res, 400, renderFoutPagina("Verwijderen is mislukt", foutmelding, `/begroting?administratieId=${encodeURIComponent(administratieId)}`));
    }
    return true;
  }

  // GET/POST /begroting/{administratieId}/{versieId}/controle
  if (segmenten.length === 4 && segmenten[3] === "controle") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
    if (laatstAfgeslotenBoekperiode === null) {
      g.db.close();
      stuurRedirect(res, `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}`);
      return true;
    }
    try {
      const vergelijkend = leesBegrotingsWerkomgeving(g.root, g.administratieId, g.bedrijfsnr, g.db, g.versie, laatstAfgeslotenBoekperiode);
      const vergelijking = vergelijkend.estimated !== null ? vergelijkPnLResultaten(vergelijkend.estimated, vergelijkend.jouwBegroting) : null;
      const verborgenModules = leesVerborgenModules(g.db, g.bedrijfsnr);
      const beoordelingPerRegel = leesBeoordelingPerRegel(g);
      stuurHtml(res, 200, renderControlePagina({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie, laatstAfgeslotenBoekperiode, vergelijking, verborgenModules, beoordelingPerRegel }));
    } catch (error) {
      stuurHtml(res, 500, renderFoutPagina("Controlepagina kon niet worden geladen", error instanceof Error ? error.message : String(error)));
    } finally {
      g.db.close();
    }
    return true;
  }

  // POST /begroting/{administratieId}/{versieId}/vaststellen
  if (req.method === "POST" && segmenten.length === 4 && segmenten[3] === "vaststellen") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    await leesBody(req); // bevestigingsveld wordt niet inhoudelijk gebruikt — de checkbox dwingt de bevestigingsklik af (UX_12)
    const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
    if (laatstAfgeslotenBoekperiode === null) {
      g.db.close();
      stuurRedirect(res, `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}`);
      return true;
    }
    try {
      stelBegrotingVast(g.db, g.versie.id, new Date());
      g.db.close();
      stuurRedirect(res, hoofdschermUrl(administratieId, versieId, laatstAfgeslotenBoekperiode));
    } catch (error) {
      try {
        const vergelijkend = leesBegrotingsWerkomgeving(g.root, g.administratieId, g.bedrijfsnr, g.db, g.versie, laatstAfgeslotenBoekperiode);
        const vergelijking = vergelijkend.estimated !== null ? vergelijkPnLResultaten(vergelijkend.estimated, vergelijkend.jouwBegroting) : null;
        stuurHtml(
          res,
          400,
          renderControlePagina({
            administratieId,
            weergavenaam: g.weergavenaam,
            versie: g.versie,
            laatstAfgeslotenBoekperiode,
            vergelijking,
            vaststelFout: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        g.db.close();
      }
    }
    return true;
  }

  // GET /begroting/{administratieId}/{versieId}/module/gemeentelijke-lasten/woz-historie.csv (UX §9.2: WOZ-historie-export)
  if (req.method === "GET" && segmenten.length === 6 && segmenten[3] === "module" && segmenten[4] === "gemeentelijke-lasten" && segmenten[5] === "woz-historie.csv") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    try {
      const complexnummer = url.searchParams.get("complex");
      const aanslagjaarVanStr = url.searchParams.get("aanslagjaarVan");
      const aanslagjaarTotStr = url.searchParams.get("aanslagjaarTot");
      const resultaat = leesWozHistorieCsv(g.db, g.versie.id, {
        ...(complexnummer !== null && complexnummer.length > 0 ? { complexnummer } : {}),
        ...(aanslagjaarVanStr !== null && aanslagjaarVanStr.length > 0 ? { aanslagjaarVan: Number(aanslagjaarVanStr) } : {}),
        ...(aanslagjaarTotStr !== null && aanslagjaarTotStr.length > 0 ? { aanslagjaarTot: Number(aanslagjaarTotStr) } : {}),
      });
      if (!resultaat.beschikbaar) {
        const terugUrl = hoofdschermUrl(administratieId, versieId, opgeslagenBoekperiode(g) ?? "");
        stuurHtml(res, 400, renderFoutPagina("Export nog niet beschikbaar", "De WOZ-set is nog niet bevestigd als compleet — bevestig eerst de set op het Gemeentelijke-lasten-scherm.", terugUrl));
        return true;
      }
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="woz-historie-${encodeURIComponent(g.versie.bedrijfsnr)}-${encodeURIComponent(g.versie.begrotingsjaar)}.csv"` });
      res.end(resultaat.csv);
      return true;
    } finally {
      g.db.close();
    }
  }

  // GET /begroting/{administratieId}/{versieId}/module/verzekeringen/maandverloop?polisId=<id> (UX §9.1: Maandverloop, controle-informatie)
  if (req.method === "GET" && segmenten.length === 6 && segmenten[3] === "module" && segmenten[4] === "verzekeringen" && segmenten[5] === "maandverloop") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    try {
      const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
      const terugUrl = `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}/module/verzekeringen${laatstAfgeslotenBoekperiode !== null ? `?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}` : ""}`;
      const polisIdStr = url.searchParams.get("polisId");
      const regel = polisIdStr !== null ? leesVerzekeringRegels(g.db, g.versie.id).find((r) => r.id === Number(polisIdStr)) : undefined;
      if (regel === undefined) {
        stuurHtml(res, 404, renderFoutPagina("Polis niet gevonden", "Deze polis bestaat niet (meer) in deze begrotingsversie.", terugUrl));
        return true;
      }
      const verloop = berekenVerzekeringMaandverloop(
        { complexnummer: regel.complexnummer, verzekeraar: regel.verzekeraar, grootboekrekening: regel.grootboekrekening, ogbKostensoort: regel.ogbKostensoort, ingangsdatum: regel.ingangsdatum, looptijdMaanden: regel.looptijdMaanden, bedrag: regel.bedrag, indexPercentage: regel.indexPercentage, handmatigBegrootOverride: regel.handmatigBegrootOverride },
        g.versie.begrotingsjaar,
      );
      stuurHtml(
        res,
        200,
        renderVerzekeringMaandverloop({
          terugUrl,
          verzekeraar: regel.verzekeraar,
          complexnummer: regel.complexnummer,
          maanden: verloop ? verloop.maanden.map((m) => ({ maand: m.maand, maandNaam: MAAND_NAMEN[m.maand - 1]!, bedrag: fmtBedragKort(m.bedrag), status: m.status, isEersteIndexatiemaand: m.isEersteIndexatiemaand })) : null,
          kwartalen: verloop ? [fmtBedragKort(verloop.kwartalen[0]), fmtBedragKort(verloop.kwartalen[1]), fmtBedragKort(verloop.kwartalen[2]), fmtBedragKort(verloop.kwartalen[3])] : null,
          effectiefJaarbedrag: verloop ? fmtBedragKort(verloop.effectiefJaarbedrag) : null,
          bron: verloop?.bron ?? null,
        }),
      );
      return true;
    } finally {
      g.db.close();
    }
  }

  // GET/POST /begroting/{administratieId}/{versieId}/module/management/verbergen (UX_10, CONTRACTCONFLICT-besluit 2026-10-06)
  if (segmenten.length === 6 && segmenten[3] === "module" && segmenten[4] === "management" && segmenten[5] === "verbergen") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    try {
      const managementUrl = `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}/module/management`;
      const verbergenUrl = `${managementUrl}/verbergen`;
      if (g.versie.status !== "CONCEPT") {
        stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", managementUrl));
        return true;
      }
      const bestaandeInvoer = leesModule3Invoer(g.db, g.versie.id);
      if (req.method === "GET") {
        stuurHtml(res, 200, renderManagementVerbergenScherm({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie, heeftBestaandeInvoer: bestaandeInvoer !== null, actieUrl: verbergenUrl, terugUrl: managementUrl }));
        return true;
      }
      if (req.method === "POST") {
        if (bestaandeInvoer !== null) {
          // Punt 7 (CONTRACTCONFLICT-besluit): een bestaand bedrag mag nooit onzichtbaar uit de P&L verdwijnen — verbergen wordt hier hard geweigerd, ongeacht wat de POST-body beweert.
          stuurHtml(
            res,
            400,
            renderFoutPagina(
              "Verbergen niet mogelijk",
              "Er is al invoer vastgelegd voor Managementvergoeding bij deze administratie — verbergen is pas mogelijk nadat die invoer is verwijderd op het Managementvergoeding-scherm.",
              managementUrl,
            ),
          );
          return true;
        }
        const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
        if (tekst(velden["bevestiging"]) !== "1") {
          stuurHtml(
            res,
            400,
            renderManagementVerbergenScherm({
              administratieId,
              weergavenaam: g.weergavenaam,
              versie: g.versie,
              heeftBestaandeInvoer: false,
              actieUrl: verbergenUrl,
              terugUrl: managementUrl,
              fouten: ["Bevestig expliciet dat Managementvergoeding voor deze administratie niet van toepassing is."],
            }),
          );
          return true;
        }
        verbergModule(g.db, g.bedrijfsnr, "MANAGEMENT");
        const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
        stuurRedirect(res, laatstAfgeslotenBoekperiode !== null ? hoofdschermUrl(administratieId, versieId, laatstAfgeslotenBoekperiode, "Managementvergoeding is gemarkeerd als niet van toepassing.") : managementUrl);
        return true;
      }
      return false;
    } finally {
      g.db.close();
    }
  }

  // POST /begroting/{administratieId}/{versieId}/module/management/weergeven (UX_10: herstellen)
  if (req.method === "POST" && segmenten.length === 6 && segmenten[3] === "module" && segmenten[4] === "management" && segmenten[5] === "weergeven") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    try {
      const managementUrl = `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}/module/management`;
      if (g.versie.status !== "CONCEPT") {
        stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", managementUrl));
        return true;
      }
      toonModule(g.db, g.bedrijfsnr, "MANAGEMENT");
      const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
      stuurRedirect(res, laatstAfgeslotenBoekperiode !== null ? hoofdschermUrl(administratieId, versieId, laatstAfgeslotenBoekperiode, "Managementvergoeding is weer zichtbaar.") : managementUrl);
      return true;
    } finally {
      g.db.close();
    }
  }

  // GET/POST /begroting/{administratieId}/{versieId}/module/huur/maandverloop?contractnummer=... (besluit 07-10-2026 §9)
  if (segmenten.length === 6 && segmenten[3] === "module" && segmenten[4] === "huur" && segmenten[5] === "maandverloop") {
    return handleHuurMaandverloop(req, res, url, root, administratieId, versieId);
  }

  // POST /begroting/{administratieId}/{versieId}/module/huur/contracten (besluit 07-10-2026 §11, toevoegen)
  if (req.method === "POST" && segmenten.length === 6 && segmenten[3] === "module" && segmenten[4] === "huur" && segmenten[5] === "contracten") {
    return handleHuurContractToevoegen(req, res, url, root, administratieId, versieId);
  }

  // POST /begroting/{administratieId}/{versieId}/module/huur/contracten/{contractnummer}/verwijderen
  if (req.method === "POST" && segmenten.length === 8 && segmenten[3] === "module" && segmenten[4] === "huur" && segmenten[5] === "contracten" && segmenten[7] === "verwijderen") {
    return handleHuurContractVerwijderen(req, res, url, root, administratieId, versieId, segmenten[6]!);
  }

  // POST /begroting/{administratieId}/{versieId}/module/huur/contracten/{contractnummer} (wijzigen)
  if (req.method === "POST" && segmenten.length === 7 && segmenten[3] === "module" && segmenten[4] === "huur" && segmenten[5] === "contracten") {
    return handleHuurContractWijzigen(req, res, url, root, administratieId, versieId, segmenten[6]!);
  }

  // GET/POST /begroting/{administratieId}/{versieId}/module/{moduleKey}
  if (segmenten.length === 5 && segmenten[3] === "module") {
    const moduleKey = segmenten[4]!;
    return handleModuleRoute(root, req, res, url, administratieId, versieId, moduleKey);
  }

  return false;
}

/** Leest/parst de fictief-contract-formuliervelden, gedeeld tussen toevoegen en wijzigen — zelfde validatie, geen duplicate businesslogica. */
function parseHuurFictiefContractVelden(velden: Record<string, string>): { huurderNaam: string; complexnummer: string | null; ingangsdatum: Date; brutoJaarhuur: Decimal; belastOnbelast: "BELAST" | "ONBELAST"; kortingJaar: Decimal } {
  const huurderNaam = tekst(velden["huurderNaam"]);
  if (huurderNaam.length === 0) throw new Error("Huurder-/contractnaam is verplicht.");
  const complexnummerTekst = tekst(velden["complexnummer"]);
  const ingangsdatumTekst = tekst(velden["ingangsdatum"]);
  if (ingangsdatumTekst.length === 0) throw new Error("Ingangsdatum is verplicht.");
  const brutoJaarhuur = parseGeld(tekst(velden["brutoJaarhuur"]));
  if (brutoJaarhuur === null) throw new Error("Huurprijs is verplicht en moet een geldig bedrag zijn.");
  const belastOnbelast = tekst(velden["belastOnbelast"]) === "ONBELAST" ? "ONBELAST" : "BELAST";
  const kortingTekst = tekst(velden["kortingJaar"]);
  const kortingJaar = kortingTekst.length === 0 ? new Decimal(0) : parseGeld(kortingTekst);
  if (kortingJaar === null) throw new Error("Huurkorting moet een geldig bedrag zijn.");
  return { huurderNaam, complexnummer: complexnummerTekst.length > 0 ? complexnummerTekst : null, ingangsdatum: new Date(`${ingangsdatumTekst}T00:00:00.000Z`), brutoJaarhuur, belastOnbelast, kortingJaar };
}

function huurUrlVoor(administratieId: string, versieId: string, laatstAfgeslotenBoekperiode: string): string {
  return `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}/module/huur?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}&weergave=contract`;
}

/** Besluit 07-10-2026 §11 ("Contract toevoegen") — maakt uitsluitend een fictief contract binnen de begroting; raakt de bronadministratie nooit. */
async function handleHuurContractToevoegen(req: IncomingMessage, res: ServerResponse, url: URL, root: string, administratieId: string, versieId: string): Promise<boolean> {
  const g = open(root, administratieId, versieId);
  if (g === null) {
    stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
    return true;
  }
  const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g) ?? "";
  const huurUrl = huurUrlVoor(administratieId, versieId, laatstAfgeslotenBoekperiode);
  try {
    if (g.versie.status !== "CONCEPT") {
      stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", huurUrl));
      return true;
    }
    const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
    const invoer = parseHuurFictiefContractVelden(velden);
    voegHuurFictiefContractToe(g.db, g.versie.id, invoer);
    schrijfHuurBeoordeeld(g.db, g.versie.id, false);
    stuurRedirect(res, huurUrl);
    return true;
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Contract kon niet worden toegevoegd", error instanceof Error ? error.message : String(error), huurUrl));
    return true;
  } finally {
    g.db.close();
  }
}

/** Besluit 07-10-2026 §11 — wijzigt een bestaand fictief contract (volledige vervanging van de bewerkbare velden). */
async function handleHuurContractWijzigen(req: IncomingMessage, res: ServerResponse, url: URL, root: string, administratieId: string, versieId: string, contractnummer: string): Promise<boolean> {
  const g = open(root, administratieId, versieId);
  if (g === null) {
    stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
    return true;
  }
  const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g) ?? "";
  const huurUrl = huurUrlVoor(administratieId, versieId, laatstAfgeslotenBoekperiode);
  try {
    if (g.versie.status !== "CONCEPT") {
      stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", huurUrl));
      return true;
    }
    const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
    const invoer = parseHuurFictiefContractVelden(velden);
    wijzigHuurFictiefContract(g.db, g.versie.id, contractnummer, invoer);
    schrijfHuurBeoordeeld(g.db, g.versie.id, false);
    stuurRedirect(res, huurUrl);
    return true;
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Contract kon niet worden gewijzigd", error instanceof Error ? error.message : String(error), huurUrl));
    return true;
  } finally {
    g.db.close();
  }
}

/** Besluit 07-10-2026 §11 — verwijdert een fictief contract. Geen bevestigingsscherm (eenvoudig, raakt uitsluitend begrotingsdata die de gebruiker zelf heeft toegevoegd, nooit een bronfeit). */
async function handleHuurContractVerwijderen(req: IncomingMessage, res: ServerResponse, url: URL, root: string, administratieId: string, versieId: string, contractnummer: string): Promise<boolean> {
  const g = open(root, administratieId, versieId);
  if (g === null) {
    stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
    return true;
  }
  const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g) ?? "";
  const huurUrl = huurUrlVoor(administratieId, versieId, laatstAfgeslotenBoekperiode);
  try {
    if (g.versie.status !== "CONCEPT") {
      stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", huurUrl));
      return true;
    }
    verwijderHuurFictiefContract(g.db, g.versie.id, contractnummer);
    schrijfHuurBeoordeeld(g.db, g.versie.id, false);
    stuurRedirect(res, huurUrl);
    return true;
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Contract kon niet worden verwijderd", error instanceof Error ? error.message : String(error), huurUrl));
    return true;
  } finally {
    g.db.close();
  }
}

/**
 * Maandverloop (besluit 07-10-2026 §9) — januari t/m december voor ÉÉN contract (bronfeit of
 * fictief, zelfde behandeling), rechtstreeks uit `berekenHuurContext`'s bestaande maandregels.
 * POST voegt een nieuwe Maandverloop-override toe (laag 3) voor dit contract vanaf de gekozen
 * maand — vervangt een eventuele eerdere override voor exact dezelfde (contract, vanafMaand)-
 * combinatie, laat overrides van andere maanden/contracten ongewijzigd.
 */
async function handleHuurMaandverloop(req: IncomingMessage, res: ServerResponse, url: URL, root: string, administratieId: string, versieId: string): Promise<boolean> {
  const g = open(root, administratieId, versieId);
  if (g === null) {
    stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
    return true;
  }
  const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g) ?? "";
  const huurUrl = huurUrlVoor(administratieId, versieId, laatstAfgeslotenBoekperiode);
  const contractnummer = url.searchParams.get("contractnummer") ?? "";
  const alleenLezen = g.versie.status !== "CONCEPT";
  try {
    if (contractnummer.length === 0) {
      stuurHtml(res, 400, renderFoutPagina("Onbekend contract", "Geen contractnummer opgegeven.", huurUrl));
      return true;
    }

    // Zelfde generieke lifecycle-regel als `handleModuleRoute`'s guard: Terugkijken blijft leesbaar
    // (GET), uitsluitend schrijfacties worden op een niet-CONCEPT-versie geweigerd.
    if (req.method !== "GET" && alleenLezen) {
      stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", huurUrl));
      return true;
    }

    if (req.method === "POST" && !alleenLezen) {
      const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
      try {
        const vanafMaand = Number(tekst(velden["vanafMaand"]));
        if (!Number.isInteger(vanafMaand) || vanafMaand < 1 || vanafMaand > 12) throw new Error("Kies een geldige maand (1 t/m 12).");
        const nieuwePrijsTekst = tekst(velden["nieuweBrutoHuurPerMaand"]);
        const nieuweKortingTekst = tekst(velden["nieuweKortingPerMaand"]);
        const nieuweBrutoHuurPerMaand = nieuwePrijsTekst.length > 0 ? parseGeld(nieuwePrijsTekst) : null;
        const nieuweKortingPerMaand = nieuweKortingTekst.length > 0 ? parseGeld(nieuweKortingTekst) : null;
        if (nieuwePrijsTekst.length > 0 && nieuweBrutoHuurPerMaand === null) throw new Error("Nieuwe huurprijs moet een geldig bedrag zijn.");
        if (nieuweKortingTekst.length > 0 && nieuweKortingPerMaand === null) throw new Error("Nieuwe huurkorting moet een geldig bedrag zijn.");
        if (nieuweBrutoHuurPerMaand === null && nieuweKortingPerMaand === null) throw new Error("Vul minstens een nieuwe huurprijs of een nieuwe korting in.");

        const bestaande = leesHuurMaandOverrides(g.db, g.versie.id);
        const overig = bestaande.filter((o) => !(o.contractnummer === contractnummer && o.vanafMaand === vanafMaand));
        const nieuw: BgContractMaandOverride = { contractnummer, vanafMaand, nieuweBrutoHuurPerMaand, nieuweKortingPerMaand };
        schrijfHuurMaandOverrides(g.db, g.versie.id, [...overig, nieuw]);
        schrijfHuurBeoordeeld(g.db, g.versie.id, false);
        stuurRedirect(res, `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}/module/huur/maandverloop?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}&contractnummer=${encodeURIComponent(contractnummer)}`);
        return true;
      } catch (error) {
        stuurHtml(res, 400, renderFoutPagina("Wijziging kon niet worden opgeslagen", error instanceof Error ? error.message : String(error), huurUrl));
        return true;
      }
    }

    let context: ReturnType<typeof berekenHuurContext>;
    try {
      context = berekenHuurContext(g);
    } catch (error) {
      stuurHtml(res, 500, renderFoutPagina("Huur kon niet worden berekend", error instanceof Error ? error.message : String(error), huurUrl));
      return true;
    }
    if (context === null) {
      stuurHtml(res, 400, renderFoutPagina("Nog niet mogelijk", "Er zijn nog geen Module-1-aannames (algemeen indexatiepercentage) voor deze begroting vastgelegd.", huurUrl));
      return true;
    }
    const contract = context.module1.contracten.find((c) => c.contractnummer === contractnummer);
    if (contract === undefined) {
      stuurHtml(res, 404, renderFoutPagina("Onbekend contract", `Contract ${contractnummer} bestaat niet (meer) binnen deze begroting.`, huurUrl));
      return true;
    }

    const regels: HuurMaandverloopRegel[] = contract.regels.map((r) => ({
      maand: `${MAAND_NAMEN[r.maand - 1]}`,
      huurprijs: fmtBedragKort(r.brutoHuurMetIndexatie),
      korting: fmtBedragKort(r.huurkorting),
      netto: fmtBedragKort(r.nettoHuur),
      heeftToekomstigePrijsregel: r.kortingswijzigingToegepast !== null,
      heeftHandmatigeOverride: r.prijsOverrideActief || r.kortingOverrideActief,
    }));
    const bestaandeOverrides = context.maandOverrides
      .filter((o) => o.contractnummer === contractnummer)
      .sort((a, b) => a.vanafMaand - b.vanafMaand)
      .map((o) => ({
        vanafMaand: MAAND_NAMEN[o.vanafMaand - 1]!,
        nieuweBrutoHuurPerMaand: o.nieuweBrutoHuurPerMaand !== null ? fmtBedragKort(o.nieuweBrutoHuurPerMaand) : null,
        nieuweKortingPerMaand: o.nieuweKortingPerMaand !== null ? fmtBedragKort(o.nieuweKortingPerMaand) : null,
      }));

    stuurHtml(
      res,
      200,
      renderHuurMaandverloop({
        terugUrl: huurUrl,
        actieUrl: `${url.pathname}?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}&contractnummer=${encodeURIComponent(contractnummer)}`,
        alleenLezen,
        fragment: isFragmentVerzoek(req),
        contractnummer,
        huurderNaam: contract.huurderNaam,
        regels,
        bestaandeOverrides,
      }),
    );
    return true;
  } finally {
    g.db.close();
  }
}

async function handleModuleRoute(root: string, req: IncomingMessage, res: ServerResponse, url: URL, administratieId: string, versieId: string, moduleKey: string): Promise<boolean> {
  const g = open(root, administratieId, versieId);
  if (g === null) {
    stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
    return true;
  }
  const laatstAfgeslotenBoekperiode = opgeslagenBoekperiode(g);
  if (laatstAfgeslotenBoekperiode === null) {
    g.db.close();
    stuurRedirect(res, `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}`);
    return true;
  }
  const terugUrl = hoofdschermUrl(administratieId, versieId, laatstAfgeslotenBoekperiode);
  const actieUrl = `${url.pathname}?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}`;

  // TRANCHE 14 — generieke read-only lifecycle: ELKE detailpagina blijft leesbaar (GET) op een
  // VASTGESTELDE versie (UX_13 Terugkijken: onderbouwing blijft overal zichtbaar); uitsluitend
  // schrijfacties (niet-GET) blijven op niet-CONCEPT geblokkeerd. Dezelfde render-functie/route
  // wordt hergebruikt — geen tweede read-only UI, zie `moduleFormShell`'s fieldset-mechanisme.
  if (g.versie.status !== "CONCEPT" && req.method !== "GET") {
    g.db.close();
    stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", terugUrl));
    return true;
  }

  // UX-UITROL (2026-10-02, generieke regel): elk detailscherm toont dezelfde vergelijkende-P&L-
  // rij(en) die ook op het hoofdscherm staan (09_Begrotingsmodule_UX_Vastgesteld §3/§10) — hier
  // ÉÉN KEER berekend (zelfde bestaande keten als `toonHoofdscherm`) en als kant-en-klaar
  // `VergelijkendeBegrotingsPnLResultaat` doorgegeven, zodat geen enkele handler dit zelf opnieuw
  // hoeft te berekenen. Faalt deze ophaal (bv. nog geen boekingen.xlsx), dan blijft het detailscherm
  // zelf gewoon werken — de samenvatting wordt dan stil weggelaten (`vergelijkend = null`).
  let vergelijkend: ReturnType<typeof leesBegrotingsWerkomgeving> | null = null;
  try {
    vergelijkend = leesBegrotingsWerkomgeving(g.root, g.administratieId, g.bedrijfsnr, g.db, g.versie, laatstAfgeslotenBoekperiode);
  } catch {
    vergelijkend = null;
  }

  try {
    if (moduleKey === "huur") return await handleHuur(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "beheer") return await handleBeheer(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "management") return await handleManagement(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "correctief") return await handleCorrectief(req, res, g, actieUrl, terugUrl, laatstAfgeslotenBoekperiode);
    if (moduleKey === "btw") return await handleBtw(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "rente-leningen") return await handleRente(req, res, g, actieUrl, terugUrl, "RENTEKOSTEN", vergelijkend);
    if (moduleKey === "rente-opbrengst") return await handleRente(req, res, g, actieUrl, terugUrl, "RENTE_OPBRENGSTEN", vergelijkend);
    if (moduleKey === "leegstand") return await handleLeegstand(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "algemene-kosten") return await handleAlgemeneKosten(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "verzekeringen") return await handleVerzekeringen(req, res, g, actieUrl, terugUrl, vergelijkend);
    if (moduleKey === "gepland-onderhoud") return await handleGeplandOnderhoud(req, res, g, actieUrl, terugUrl, laatstAfgeslotenBoekperiode);
    if (moduleKey === "gemeentelijke-lasten") return await handleGemeentelijkeLasten(req, res, g, root, actieUrl, terugUrl, vergelijkend);
    stuurHtml(res, 404, renderFoutPagina("Onbekend onderdeel", `Onbekend begrotingsonderdeel "${moduleKey}".`, terugUrl));
    return true;
  } finally {
    g.db.close();
  }
}

function fmtBedragKort(d: Decimal): string {
  const negatief = d.isNegative();
  const [geheel, decimalen] = d.abs().toFixed(2).split(".");
  const geheelMetPunten = geheel!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (negatief ? "-€ " : "€ ") + geheelMetPunten + "," + decimalen;
}

/** UX-UITROL (2026-10-02, Sectie 3) — formatteert het bestaande `OnderhoudTotaalResultaat` (geen herberekening) voor de gedeelde samenvatting op de Gepland-/Correctief-detailschermen. */
function bouwOnderhoudTotaalSamenvatting(resultaat: ReturnType<typeof leesOnderhoudTotaalVoorWerkomgeving>): OnderhoudTotaalSamenvattingVeld {
  return {
    begrotingGepland: fmtBedragKort(resultaat.gepland.begrotingTotaal),
    begrotingCorrectief: fmtBedragKort(resultaat.correctiefDagelijks.begrotingTotaal),
    begrotingTotaal: fmtBedragKort(resultaat.begrotingOnderhoudTotaal),
    werkelijkTotaal: fmtBedragKort(resultaat.werkelijk.totaalTotAfgeslotenPeriode),
    resterendeVerwachtingTotaal: fmtBedragKort(resultaat.resterendeVerwachtingOnderhoudTotaal),
    estimatedTotaal: fmtBedragKort(resultaat.estimatedOnderhoudTotaal),
    verschilEstimatedVsBegroting: fmtBedragKort(resultaat.verschilEstimatedVsBegrotingBedrag),
  };
}

const MAAND_NAMEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/**
 * UX-UITROL (2026-10-06, ARCHITECTUURPUNT-besluit) — `?fragment=1` vraagt om uitsluitend de
 * formulierinhoud (zie `moduleFormShell`'s `fragment`-optie), zonder het paginaskelet. Dit is de
 * server-kant van het hoofdscherm se inline-uitklapbare detailweergave (UX_01/prototype): dezelfde
 * route, dezelfde handler, dezelfde data — uitsluitend minder omringende HTML in de respons.
 */
function isFragmentVerzoek(req: IncomingMessage): boolean {
  return new URL(req.url ?? "", "http://localhost").searchParams.get("fragment") === "1";
}

function fmtPercentageVeld(d: Decimal): string {
  return d.toString();
}

function fmtDatumVeld(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Besluit 07-10-2026 ("Huur naar vastgestelde UX") — DE ENE plek die bronfeit-contracten (Module-1-
 * snapshot) en fictieve begrotingscontracten (§11) samenvoegt vóór de aanroep van de ONGEWIJZIGDE
 * pure `berekenBegroteHuuropbrengsten`, inclusief de bestaande overrides (laag 1, indexatiepercentage)
 * én de nieuwe Maandverloop-overrides (laag 3). Gebruikt door `handleHuur`, `handleBeheer` (de
 * variabele-vergoeding-grondslag moet exact dezelfde netto huur gebruiken) en de nieuwe Maandverloop-/
 * Contracten-handlers — zodat deze module-brede uitkomst overal consistent is, zelfde eis als
 * `herberekenen.ts`'s ene gedeelde leespad.
 */
function berekenHuurContext(g: Geopend): {
  module1: ReturnType<typeof berekenBegroteHuuropbrengsten>;
  aannames: ReturnType<typeof leesModule1Aannames>;
  overrides: readonly BgContractOverride[];
  maandOverrides: readonly BgContractMaandOverride[];
  fictieveContracten: readonly BgHuurFictiefContract[];
  fictieveContractnummers: ReadonlySet<string>;
} | null {
  const aannames = leesModule1Aannames(g.db, g.versie.id);
  if (aannames === null) return null;
  const echteContracten = leesModule1Snapshot(g.db, g.versie.id);
  const fictieveContracten = leesHuurFictieveContracten(g.db, g.versie.id);
  const alleContracten: BgContractFeiten[] = [...echteContracten, ...fictieveContracten.map((fc) => naarBgContractFeiten(fc, g.bedrijfsnr))];
  const overrides = leesModule1Overrides(g.db, g.versie.id);
  const maandOverrides = leesHuurMaandOverrides(g.db, g.versie.id);
  const module1 = berekenBegroteHuuropbrengsten(alleContracten, overrides, aannames, g.versie.bronPeildatum, maandOverrides);
  return { module1, aannames, overrides, maandOverrides, fictieveContracten, fictieveContractnummers: new Set(fictieveContracten.map((fc) => fc.contractnummer)) };
}

function fmtHuurKwartalen(k: BgHuurKwartaalTotalen): HuurKwartaalVeld {
  return { q1: fmtBedragKort(k.q1.nettoHuur), q2: fmtBedragKort(k.q2.nettoHuur), q3: fmtBedragKort(k.q3.nettoHuur), q4: fmtBedragKort(k.q4.nettoHuur), jaar: fmtBedragKort(k.jaartotaal.nettoHuur) };
}

/**
 * Huur-detailweergave (UX_01, Tranche 12, §9/§10/§22; besluit 07-10-2026 "Huur naar vastgestelde
 * UX"): roept de ongewijzigde pure `berekenBegroteHuuropbrengsten` aan met de bevroren Module-1-
 * snapshot + fictieve contracten + overrides + Maandverloop-overrides (`berekenHuurContext`) —
 * exact dezelfde berekening als de vergelijkende P&L, hier uitsluitend uitgesplitst per contract.
 * Blijft leesbaar (GET) na vaststellen; schrijven (POST) is uitsluitend op CONCEPT mogelijk (zie
 * `handleModuleRoute`'s guard).
 */
async function handleHuur(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  const alleenLezen = g.versie.status !== "CONCEPT";
  const contracten = leesModule1Snapshot(g.db, g.versie.id);
  const laatstAfgeslotenBoekperiode = new URL(actieUrl, "http://localhost").searchParams.get("laatstAfgeslotenBoekperiode") ?? "";

  if (req.method === "POST" && !alleenLezen) {
    const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
    try {
      // Besluit 07-10-2026 §12: "Voorstel overnemen" is een afzonderlijke actie, los van opslaan/
      // beoordelen — neemt de berekende voorstelwaarde over door de handmatige lagen (indexatie-
      // override + Maandverloop-override) te wissen; fictieve contracten blijven onaangeroerd (dat
      // is toegevoegde data, geen afwijking-van-voorstel). Beoordeling vervalt (relevante wijziging).
      if (tekst(velden["actie"]) === "voorstelOvernemen") {
        schrijfModule1Overrides(g.db, g.versie.id, []);
        schrijfHuurMaandOverrides(g.db, g.versie.id, []);
        schrijfHuurBeoordeeld(g.db, g.versie.id, false);
        stuurRedirect(res, terugUrl);
        return true;
      }

      const overrides: BgContractOverride[] = [];
      for (const contract of contracten) {
        const ingevoerd = tekst(velden[`override_${contract.contractnummer}`]);
        if (ingevoerd.length === 0) continue;
        const percentage = parseGeld(ingevoerd);
        if (percentage === null) continue;
        overrides.push({ contractnummer: contract.contractnummer, indexatiePercentage: percentage, scope: "VERSIE" });
      }
      schrijfModule1Overrides(g.db, g.versie.id, overrides);
      schrijfHuurBeoordeeld(g.db, g.versie.id, tekst(velden["beoordeeld"]) === "1");
      stuurRedirect(res, terugUrl);
      return true;
    } catch (error) {
      stuurHtml(res, 400, renderFoutPagina("Overrides konden niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
      return true;
    }
  }

  let context: ReturnType<typeof berekenHuurContext>;
  try {
    context = berekenHuurContext(g);
  } catch (error) {
    stuurHtml(res, 500, renderFoutPagina("Huur kon niet worden berekend", error instanceof Error ? error.message : String(error), terugUrl));
    return true;
  }
  if (context === null) {
    stuurHtml(res, 400, renderFoutPagina("Nog niet mogelijk", "Er zijn nog geen Module-1-aannames (algemeen indexatiepercentage) voor deze begroting vastgelegd.", terugUrl));
    return true;
  }
  const { module1, aannames, overrides, fictieveContracten, fictieveContractnummers } = context;

  const einddatumPerContract = new Map(contracten.map((c) => [c.contractnummer, c.einddatum]));
  const weergave0 = new URL(req.url ?? "", "http://localhost").searchParams.get("weergave");
  const weergave = weergave0 === "contract" ? "contract" : "complex"; // besluit §3: "Per complex standaard actief"
  const fragment = isFragmentVerzoek(req);
  const weergaveSuffix = fragment ? "&fragment=1" : "";

  const regels: HuurDetailRegel[] = module1.contracten.map((c) => {
    const einddatum = einddatumPerContract.get(c.contractnummer) ?? null;
    return {
      contractnummer: c.contractnummer,
      huurderNaam: c.huurderNaam,
      complexnummer: c.complexnummer,
      belastOnbelast: c.belastOnbelast === "BELAST" ? "Belast" : c.belastOnbelast === "ONBELAST" ? "Onbelast" : "Onbekend",
      indexatiePercentageGebruikt: fmtPercentageVeld(c.indexatiePercentageGebruikt),
      indexatiePercentageBron: c.indexatiePercentageBron,
      effectieveIndexatiedatum: c.effectieveIndexatiedatum ? fmtDatumVeld(c.effectieveIndexatiedatum) : null,
      bruto: fmtBedragKort(c.jaartotaal.brutoHuurMetIndexatie),
      korting: fmtBedragKort(c.jaartotaal.huurkorting),
      netto: fmtBedragKort(c.jaartotaal.nettoHuur),
      overrideWaarde: overrides.find((o) => o.contractnummer === c.contractnummer)?.indexatiePercentage.toString() ?? "",
      // UX §4: "de contractweergave toont herkenbaar welke contracten in het begrotingsjaar aflopen" — puur presentatie-join op de al-bestaande snapshotdatum, geen nieuwe business­regel.
      looptAfDitJaar: einddatum !== null && einddatum.getUTCFullYear() === g.versie.begrotingsjaar,
      einddatum: einddatum ? fmtDatumVeld(einddatum) : null,
      kwartalen: fmtHuurKwartalen(berekenHuurKwartaalTotalen(c.regels)),
      heeftToekomstigePrijsregel: c.regels.some((r) => r.kortingswijzigingToegepast !== null),
      heeftHandmatigeMaandoverride: c.regels.some((r) => r.prijsOverrideActief || r.kortingOverrideActief),
      isFictief: fictieveContractnummers.has(c.contractnummer),
      maandverloopUrl: `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/huur/maandverloop?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}&contractnummer=${encodeURIComponent(c.contractnummer)}`,
    };
  });

  const portefeuilleNetto = module1.portefeuilleTotalen.nettoHuurBelast.plus(module1.portefeuilleTotalen.nettoHuurOnbelast).plus(module1.portefeuilleTotalen.nettoHuurOnbekendeBtw);

  // UX §4: "de gebruiker kan wisselen tussen een complexweergave en een contractweergave" — server-rendered toggle via query param, geen client-side state nodig. Zuivere aggregatie van de al-berekende Decimal-/kwartaaltotalen per complex — geen nieuwe berekening.
  const complexGroepen = new Map<string, { bruto: Decimal; korting: Decimal; netto: Decimal; aantal: number; kwartalen: BgHuurKwartaalTotalen[] }>();
  for (const c of module1.contracten) {
    const key = c.complexnummer ?? "Onbekend";
    const bestaand = complexGroepen.get(key) ?? { bruto: new Decimal(0), korting: new Decimal(0), netto: new Decimal(0), aantal: 0, kwartalen: [] };
    bestaand.kwartalen.push(berekenHuurKwartaalTotalen(c.regels));
    complexGroepen.set(key, {
      bruto: bestaand.bruto.plus(c.jaartotaal.brutoHuurMetIndexatie),
      korting: bestaand.korting.plus(c.jaartotaal.huurkorting),
      netto: bestaand.netto.plus(c.jaartotaal.nettoHuur),
      aantal: bestaand.aantal + 1,
      kwartalen: bestaand.kwartalen,
    });
  }
  const complexRegels: ComplexHuurRegel[] = [...complexGroepen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([complexnummer, t]) => ({
      complexnummer,
      aantalContracten: t.aantal,
      bruto: fmtBedragKort(t.bruto),
      korting: fmtBedragKort(t.korting),
      netto: fmtBedragKort(t.netto),
      kwartalen: fmtHuurKwartalen(somHuurKwartaalTotalen(t.kwartalen)),
    }));

  // Besluit §2: bruto belast/onbelast — zuivere aggregatie van de al-berekende per-contractjaartotalen, geen nieuwe berekening.
  const brutoBelast = som(module1.contracten.filter((c) => c.belastOnbelast === "BELAST").map((c) => c.jaartotaal.brutoHuurMetIndexatie));
  const brutoOnbelast = som(module1.contracten.filter((c) => c.belastOnbelast === "ONBELAST").map((c) => c.jaartotaal.brutoHuurMetIndexatie));
  const moduleKwartalen = somHuurKwartaalTotalen(module1.contracten.map((c) => berekenHuurKwartaalTotalen(c.regels)));

  // Besluit §11: "+ Contract toevoegen" — bewerkbaar formulier, vooraf ingevuld bij `?wijzigFictief=<nr>`.
  const wijzigFictiefNr = new URL(req.url ?? "", "http://localhost").searchParams.get("wijzigFictief");
  const teWijzigen = wijzigFictiefNr !== null ? fictieveContracten.find((fc) => fc.contractnummer === wijzigFictiefNr) ?? null : null;
  const contractFormulier: HuurFictiefContractFormulier | null =
    teWijzigen !== null
      ? {
          contractnummer: teWijzigen.contractnummer,
          huurderNaam: teWijzigen.huurderNaam,
          complexnummer: teWijzigen.complexnummer ?? "",
          ingangsdatum: fmtDatumVeld(teWijzigen.ingangsdatum),
          brutoJaarhuur: fmtBedragKort(teWijzigen.brutoJaarhuur),
          belastOnbelast: teWijzigen.belastOnbelast,
          kortingJaar: fmtBedragKort(teWijzigen.kortingJaar),
        }
      : null;
  const fictieveContractenVeld: HuurFictiefContractRegel[] = fictieveContracten.map((fc) => ({
    contractnummer: fc.contractnummer,
    huurderNaam: fc.huurderNaam,
    complexnummer: fc.complexnummer,
    ingangsdatum: fmtDatumVeld(fc.ingangsdatum),
    brutoJaarhuur: fmtBedragKort(fc.brutoJaarhuur),
    belastOnbelast: fc.belastOnbelast,
    kortingJaar: fmtBedragKort(fc.kortingJaar),
    wijzigenUrl: `${actieUrl}&weergave=contract&wijzigFictief=${encodeURIComponent(fc.contractnummer)}`,
    verwijderenUrl: `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/huur/contracten/${encodeURIComponent(fc.contractnummer)}/verwijderen?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}`,
  }));

  // FASE 2 (Master Contract §18): compacte, module-eigen samenvatting i.p.v. de volledige
  // vergelijkende P&L — uitsluitend reeds betrouwbaar beschikbare velden van de ongewijzigde pure
  // Huur-motor. De Werkelijk/Estimated-waarden voor "Verleende huurkorting" komen uit dezelfde,
  // bestaande canon-regel die ook het hoofdscherm gebruikt (`vergelijkend.regels`).
  const kortingRegel = vergelijkend?.regels.find((r) => r.regelSleutel === "VERLEENDE_HUURKORTING") ?? null;
  const samenvatting: HuurSamenvattingVeld = {
    contracthuurVoorIndexatie: fmtBedragKort(module1.portefeuilleTotalen.brutoHuurZonderIndexatie),
    indexatieEffect: fmtBedragKort(module1.portefeuilleTotalen.indexatieEffect),
    brutoBelast: fmtBedragKort(brutoBelast),
    brutoOnbelast: fmtBedragKort(brutoOnbelast),
    korting: fmtBedragKort(module1.portefeuilleTotalen.huurkorting),
    nettoHuur: fmtBedragKort(module1.portefeuilleTotalen.nettoHuur),
    nettoHuurBelast: fmtBedragKort(module1.portefeuilleTotalen.nettoHuurBelast),
    nettoHuurOnbelast: fmtBedragKort(module1.portefeuilleTotalen.nettoHuurOnbelast),
    kwartalen: fmtHuurKwartalen(moduleKwartalen),
    kortingWerkelijk: kortingRegel?.werkelijk ?? null,
    kortingEstimated: kortingRegel?.estimated ?? null,
  };

  stuurHtml(
    res,
    200,
    renderHuurDetail({
      administratieId: g.administratieId,
      versieId: g.versie.id,
      terugUrl,
      actieUrl,
      weergave,
      contractWeergaveUrl: `${actieUrl}&weergave=contract${weergaveSuffix}`,
      complexWeergaveUrl: `${actieUrl}&weergave=complex${weergaveSuffix}`,
      begrotingsjaar: g.versie.begrotingsjaar,
      alleenLezen,
      algemeenIndexatiePercentage: fmtPercentageVeld(aannames!.indexatiePercentage),
      bronPeildatum: fmtDatumVeld(module1.bronPeildatum),
      aantalContracten: module1.contracten.length,
      regels,
      complexRegels,
      // Besluit 07-10-2026 §3: "Verwijder de huidige technische/grote meldingenweergave uit de
      // primaire UX." INFORMATIEF-meldingen (bv. "indexatiedatum ligt ná het begrotingsjaar — geen
      // indexatie toegepast") zijn routinematige, verwachte uitleg per contract, geen uitzondering —
      // die blijven daarom hier bewust ongetoond (geen nieuwe plek verzonnen om ze te "verbergen";
      // ze blijven gewoon in `module1.controleVereist` beschikbaar voor eventuele latere, compacte
      // weergave per contract). Alleen echte uitzonderingen (WAARSCHUWING/KRITIEK) blijven zichtbaar.
      controleVereist: module1.controleVereist.filter((c) => c.ernst !== "INFORMATIEF").map((c) => `${c.contractnummer ?? "Algemeen"}: ${c.bericht}`),
      portefeuilleNetto: fmtBedragKort(portefeuilleNetto),
      samenvatting,
      beoordeeld: leesHuurBeoordeeld(g.db, g.versie.id),
      fictieveContracten: fictieveContractenVeld,
      contractToevoegenUrl: `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/huur/contracten?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}`,
      contractFormulier,
      fragment,
    }),
  );
  return true;
}

/**
 * Beheersvergoeding-detailweergave (UX_02, Tranche 12, §14/§23): gebruikt de Module-1-uitkomst
 * (mét overrides) als variabele huurgrondslag — exact het bestaande contract, nu voor het eerst
 * gevoed vanuit de echte contractbasis. Complexen komen uit de Module-1-contracten (elk complex
 * dat in de contractbasis voorkomt), niet uit een los complexenregister.
 */
async function handleBeheer(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  const alleenLezen = g.versie.status !== "CONCEPT";
  // Besluit 07-10-2026: dezelfde gedeelde context als `handleHuur` (`berekenHuurContext`) — de
  // variabele beheersvergoeding moet exact dezelfde netto-huur-grondslag gebruiken, inclusief
  // fictieve contracten en Maandverloop-overrides, anders lopen Huur en Beheer financieel uiteen.
  let context: ReturnType<typeof berekenHuurContext>;
  try {
    context = berekenHuurContext(g);
  } catch (error) {
    stuurHtml(res, 500, renderFoutPagina("Huur kon niet worden berekend", error instanceof Error ? error.message : String(error), terugUrl));
    return true;
  }
  if (context === null) {
    stuurHtml(res, 400, renderFoutPagina("Nog niet mogelijk", "Er zijn nog geen Module-1-aannames (algemeen indexatiepercentage) voor deze begroting vastgelegd.", terugUrl));
    return true;
  }
  const module1 = context.module1;
  const complexnummers = [...new Set(module1.contracten.map((c) => c.complexnummer).filter((c): c is string => c !== null))].sort();

  if (req.method === "POST" && !alleenLezen) {
    const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
    try {
      const configs: BgBeheerComplexConfig[] = [];
      for (let i = 0; i < complexnummers.length; i++) {
        const complexnummer = tekst(velden[`complexnummer_${i}`]);
        if (complexnummer.length === 0) continue;
        const vastBedrag = parseGeld(tekst(velden[`vastBedrag_${i}`]));
        const vastIndex = parseGeld(tekst(velden[`vastIndex_${i}`]));
        const vastIndexDatumStr = tekst(velden[`vastIndexDatum_${i}`]);
        const variabelPercentage = parseGeld(tekst(velden[`variabelPercentage_${i}`]));
        configs.push({
          complexnummer,
          vastBedragJaar: vastBedrag,
          vastIndexatiePercentage: vastIndex,
          vastIndexatiedatum: vastIndexDatumStr.length > 0 ? new Date(`${vastIndexDatumStr}T00:00:00.000Z`) : null,
          variabelPercentage,
        });
      }
      schrijfModule2Config(g.db, g.versie.id, configs);
      stuurRedirect(res, terugUrl);
      return true;
    } catch (error) {
      stuurHtml(res, 400, renderFoutPagina("Configuratie kon niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
      return true;
    }
  }

  const configs = leesModule2Config(g.db, g.versie.id);
  let module2;
  try {
    module2 = berekenBegroteBeheersvergoeding(module1, configs);
  } catch (error) {
    stuurHtml(res, 500, renderFoutPagina("Beheersvergoeding kon niet worden berekend", error instanceof Error ? error.message : String(error), terugUrl));
    return true;
  }

  const regels: BeheerDetailRegel[] = complexnummers.map((complexnummer, i) => {
    const uitkomst = module2.complexen.find((c) => c.complexnummer === complexnummer);
    const config = configs.find((c) => c.complexnummer === complexnummer);
    return {
      complexnummer,
      vastToegepast: uitkomst?.vastToegepast ?? false,
      variabelToegepast: uitkomst?.variabelToegepast ?? false,
      variabelPercentageGebruikt: uitkomst?.variabelPercentageGebruikt !== null && uitkomst?.variabelPercentageGebruikt !== undefined ? fmtPercentageVeld(uitkomst.variabelPercentageGebruikt) : null,
      nettoHuurGrondslag: fmtBedragKort(uitkomst?.jaartotaal.nettoHuurGrondslag ?? new Decimal(0)),
      vastNaIndexatie: fmtBedragKort(uitkomst?.jaartotaal.vastNaIndexatie ?? new Decimal(0)),
      variabeleVergoeding: fmtBedragKort(uitkomst?.jaartotaal.variabeleVergoeding ?? new Decimal(0)),
      totaleVergoeding: fmtBedragKort(uitkomst?.jaartotaal.totaleVergoeding ?? new Decimal(0)),
      vastBedragJaarInvoer: config?.vastBedragJaar?.toString() ?? "",
      vastIndexatiePercentageInvoer: config?.vastIndexatiePercentage?.toString() ?? "",
      vastIndexatiedatumInvoer: config?.vastIndexatiedatum ? fmtDatumVeld(config.vastIndexatiedatum) : "",
      variabelPercentageInvoer: config?.variabelPercentage?.toString() ?? "",
      // index i hergebruikt de positie van complexnummers voor het formulier; complexnummer_i wordt als hidden veld meegegeven.
    };
  });

  stuurHtml(
    res,
    200,
    renderBeheerDetail({
      terugUrl,
      actieUrl,
      alleenLezen,
      regels,
      controleVereist: module2.controleVereist.map((c) => `${c.complexnummer ?? "Algemeen"}: ${c.bericht}`),
      portefeuilleTotaal: fmtBedragKort(module2.portefeuilleTotalen.totaleVergoeding),
      pnlHtml: vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["BEHEERKOSTEN"]) : "",
      fragment: isFragmentVerzoek(req),
    }),
  );
  return true;
}

async function handleManagement(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  if (req.method === "GET") {
    const huidig = leesModule3Invoer(g.db, g.versie.id);
    const leeg = { wijze: "NIEUWE_VERGOEDING", bedrag: "", eenheid: "MAAND", ingangsdatum: "", bestaandBedrag: "", bestaandEenheid: "MAAND", indexatiePercentage: "", indexatiedatum: "", nieuwBedrag: "", nieuweEenheid: "MAAND" };
    const form =
      huidig === null
        ? leeg
        : huidig.wijze === "NIEUWE_VERGOEDING"
          ? { ...leeg, wijze: huidig.wijze, bedrag: huidig.bedrag.toString(), eenheid: huidig.eenheid, ingangsdatum: huidig.ingangsdatum ? huidig.ingangsdatum.toISOString().slice(0, 10) : "" }
          : huidig.wijze === "INDEXEER_BESTAAND"
            ? { ...leeg, wijze: huidig.wijze, bestaandBedrag: huidig.bestaandBedrag.toString(), bestaandEenheid: huidig.eenheid, indexatiePercentage: huidig.indexatiePercentage.toString(), indexatiedatum: huidig.indexatiedatum.toISOString().slice(0, 10) }
            : { ...leeg, wijze: huidig.wijze, nieuwBedrag: huidig.nieuwBedrag.toString(), nieuweEenheid: huidig.nieuweEenheid };
    const pnlHtml = vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["MANAGEMENTVERGOEDING"]) : "";
    const verborgen = isModuleVerborgen(g.db, g.bedrijfsnr, "MANAGEMENT");
    const verbergenUrl = `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/management/verbergen`;
    const weergevenUrl = `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/management/weergeven`;
    stuurHtml(
      res,
      200,
      renderManagementForm({
        actieUrl,
        terugUrl,
        huidig: form,
        alleenLezen: g.versie.status !== "CONCEPT",
        pnlHtml,
        fragment: isFragmentVerzoek(req),
        verborgen,
        verbergenUrl,
        weergevenUrl,
      }),
    );
    return true;
  }

  if (isModuleVerborgen(g.db, g.bedrijfsnr, "MANAGEMENT")) {
    stuurHtml(
      res,
      400,
      renderFoutPagina(
        "Niet van toepassing",
        "Managementvergoeding is voor deze administratie gemarkeerd als niet van toepassing — maak het onderdeel eerst weer zichtbaar voordat je invoer opslaat.",
        terugUrl,
      ),
    );
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  const wijze = tekst(velden["wijze"]);
  try {
    let invoer: BgManagementInvoer;
    if (wijze === "NIEUWE_VERGOEDING") {
      const bedrag = parseGeld(tekst(velden["bedrag"]));
      if (bedrag === null) throw new Error("Vul een bedrag in.");
      const ingangsdatumStr = tekst(velden["ingangsdatum"]);
      invoer = { wijze, bedrag, eenheid: tekst(velden["eenheid"]) === "JAAR" ? "JAAR" : "MAAND", ingangsdatum: ingangsdatumStr.length > 0 ? new Date(`${ingangsdatumStr}T00:00:00.000Z`) : null };
    } else if (wijze === "INDEXEER_BESTAAND") {
      const bestaandBedrag = parseGeld(tekst(velden["bestaandBedrag"]));
      const indexatiePercentage = parseGeld(tekst(velden["indexatiePercentage"]));
      const indexatiedatumStr = tekst(velden["indexatiedatum"]);
      if (bestaandBedrag === null || indexatiePercentage === null || indexatiedatumStr.length === 0) throw new Error("Vul bestaand bedrag, indexatiepercentage en indexatiedatum in.");
      invoer = { wijze, bestaandBedrag, eenheid: tekst(velden["bestaandEenheid"]) === "JAAR" ? "JAAR" : "MAAND", indexatiePercentage, indexatiedatum: new Date(`${indexatiedatumStr}T00:00:00.000Z`) };
    } else if (wijze === "WIJZIG_BESTAAND_BEDRAG") {
      const bestaandBedrag = parseGeld(tekst(velden["bestaandBedrag"]));
      const nieuwBedrag = parseGeld(tekst(velden["nieuwBedrag"]));
      const indexatiedatumStr = tekst(velden["indexatiedatum"]);
      if (bestaandBedrag === null || nieuwBedrag === null || indexatiedatumStr.length === 0) throw new Error("Vul bestaand bedrag, nieuw bedrag en ingangsdatum in.");
      invoer = {
        wijze,
        bestaandBedrag,
        bestaandEenheid: tekst(velden["bestaandEenheid"]) === "JAAR" ? "JAAR" : "MAAND",
        nieuwBedrag,
        nieuweEenheid: tekst(velden["nieuweEenheid"]) === "JAAR" ? "JAAR" : "MAAND",
        ingangsdatum: new Date(`${indexatiedatumStr}T00:00:00.000Z`),
      };
    } else {
      throw new Error("Kies één van de drie situaties.");
    }
    schrijfModule3Invoer(g.db, g.versie.id, invoer);
    stuurRedirect(res, terugUrl);
  } catch (error) {
    stuurHtml(
      res,
      400,
      renderManagementForm({
        actieUrl,
        terugUrl,
        fouten: [error instanceof Error ? error.message : String(error)],
        huidig: {
          wijze,
          bedrag: tekst(velden["bedrag"]),
          eenheid: tekst(velden["eenheid"]) || "MAAND",
          ingangsdatum: tekst(velden["ingangsdatum"]),
          bestaandBedrag: tekst(velden["bestaandBedrag"]),
          bestaandEenheid: tekst(velden["bestaandEenheid"]) || "MAAND",
          indexatiePercentage: tekst(velden["indexatiePercentage"]),
          indexatiedatum: tekst(velden["indexatiedatum"]),
          nieuwBedrag: tekst(velden["nieuwBedrag"]),
          nieuweEenheid: tekst(velden["nieuweEenheid"]) || "MAAND",
        },
      }),
    );
  }
  return true;
}

const MAX_REGELS = 8;

async function handleCorrectief(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, laatstAfgeslotenBoekperiode: string): Promise<boolean> {
  if (req.method === "GET") {
    const regels = leesCorrectiefDagelijksOnderhoudRegels(g.db, g.versie.id);
    const beoordeeld = leesCorrectiefDagelijksOnderhoudBeoordeeld(g.db, g.versie.id);
    const onderhoudTotaal = bouwOnderhoudTotaalSamenvatting(leesOnderhoudTotaalVoorWerkomgeving(g.root, g.administratieId, g.db, g.versie, laatstAfgeslotenBoekperiode));
    stuurHtml(
      res,
      200,
      renderCorrectiefForm({
        actieUrl,
        terugUrl,
        beoordeeld,
        regels: regels.map((r) => ({ id: r.id, omschrijving: r.omschrijving, complexnummer: r.complexnummer ?? "", grootboekrekening: r.grootboekrekening, ogbKostensoort: r.ogbKostensoort ?? "", jaarbedrag: r.jaarbedrag?.toString() ?? "" })),
        alleenLezen: g.versie.status !== "CONCEPT",
        onderhoudTotaal,
        fragment: isFragmentVerzoek(req),
      }),
    );
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const regels = [];
    for (let i = 0; i < MAX_REGELS; i++) {
      const omschrijving = tekst(velden[`omschrijving_${i}`]);
      const jaarbedragStr = tekst(velden[`jaarbedrag_${i}`]);
      if (omschrijving.length === 0 && jaarbedragStr.length === 0) continue;
      if (omschrijving.length === 0) throw new Error(`Regel ${i + 1}: omschrijving is verplicht.`);
      const grootboekrekening = tekst(velden[`grootboekrekening_${i}`]);
      if (grootboekrekening.length === 0) throw new Error(`Regel ${i + 1} (${omschrijving}): grootboekrekening is verplicht.`);
      const idStr = tekst(velden[`id_${i}`]);
      regels.push({
        id: idStr.length > 0 ? Number(idStr) : null,
        omschrijving,
        complexnummer: tekstOfNull(velden[`complexnummer_${i}`]),
        grootboekrekening,
        ogbKostensoort: tekstOfNull(velden[`ogbKostensoort_${i}`]),
        jaarbedrag: parseGeld(jaarbedragStr),
      });
    }
    schrijfCorrectiefDagelijksOnderhoudRegels(g.db, g.versie.id, regels);
    schrijfCorrectiefDagelijksOnderhoudBeoordeeld(g.db, g.versie.id, tekst(velden["beoordeeld"]) === "1");
    stuurRedirect(res, terugUrl);
  } catch (error) {
    const regelsVoorForm = [];
    for (let i = 0; i < MAX_REGELS; i++) {
      const omschrijving = tekst(velden[`omschrijving_${i}`]);
      const jaarbedragStr = tekst(velden[`jaarbedrag_${i}`]);
      if (omschrijving.length === 0 && jaarbedragStr.length === 0 && tekst(velden[`complexnummer_${i}`]).length === 0 && tekst(velden[`grootboekrekening_${i}`]).length === 0) continue;
      regelsVoorForm.push({
        id: tekst(velden[`id_${i}`]).length > 0 ? Number(tekst(velden[`id_${i}`])) : null,
        omschrijving,
        complexnummer: tekst(velden[`complexnummer_${i}`]),
        grootboekrekening: tekst(velden[`grootboekrekening_${i}`]),
        ogbKostensoort: tekst(velden[`ogbKostensoort_${i}`]),
        jaarbedrag: jaarbedragStr,
      });
    }
    stuurHtml(res, 400, renderCorrectiefForm({ actieUrl, terugUrl, fouten: [error instanceof Error ? error.message : String(error)], beoordeeld: tekst(velden["beoordeeld"]) === "1", regels: regelsVoorForm }));
  }
  return true;
}

async function handleBtw(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  if (req.method === "GET") {
    const regels = leesNietVerrekenbareBtwRegels(g.db, g.versie.id);
    const state = leesNietVerrekenbareBtwState(g.db, g.versie.id);
    const resterendeVerwachting = leesNietVerrekenbareBtwEstimatedVerwachting(g.db, g.versie.id);
    stuurHtml(
      res,
      200,
      renderBtwForm({
        actieUrl,
        terugUrl,
        beoordeeld: state.beoordeeld,
        resterendeVerwachting: resterendeVerwachting?.toString() ?? "",
        regels: regels.map((r) => ({ id: r.id, omschrijving: r.omschrijving, complexnummer: r.complexnummer ?? "", jaarbedrag: r.jaarbedrag?.toString() ?? "" })),
        alleenLezen: g.versie.status !== "CONCEPT",
        pnlHtml: vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["NIET_VERREKENBARE_BTW"]) : "",
        fragment: isFragmentVerzoek(req),
      }),
    );
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const regels = [];
    for (let i = 0; i < MAX_REGELS; i++) {
      const omschrijving = tekst(velden[`omschrijving_${i}`]);
      const jaarbedragStr = tekst(velden[`jaarbedrag_${i}`]);
      if (omschrijving.length === 0 && jaarbedragStr.length === 0) continue;
      if (omschrijving.length === 0) throw new Error(`Regel ${i + 1}: omschrijving is verplicht.`);
      const idStr = tekst(velden[`id_${i}`]);
      regels.push({ id: idStr.length > 0 ? Number(idStr) : null, omschrijving, complexnummer: tekstOfNull(velden[`complexnummer_${i}`]), jaarbedrag: parseGeld(jaarbedragStr) });
    }
    schrijfNietVerrekenbareBtwRegels(g.db, g.versie.id, regels);
    const bestaandeState = leesNietVerrekenbareBtwState(g.db, g.versie.id);
    schrijfNietVerrekenbareBtwState(g.db, g.versie.id, { beoordeeld: tekst(velden["beoordeeld"]) === "1", vorigJaarWerkelijk: bestaandeState.vorigJaarWerkelijk });
    schrijfNietVerrekenbareBtwEstimatedVerwachting(g.db, g.versie.id, parseGeld(tekst(velden["resterendeVerwachting"])));
    stuurRedirect(res, terugUrl);
  } catch (error) {
    const regelsVoorForm = [];
    for (let i = 0; i < MAX_REGELS; i++) {
      const omschrijving = tekst(velden[`omschrijving_${i}`]);
      const jaarbedragStr = tekst(velden[`jaarbedrag_${i}`]);
      if (omschrijving.length === 0 && jaarbedragStr.length === 0) continue;
      regelsVoorForm.push({ id: tekst(velden[`id_${i}`]).length > 0 ? Number(tekst(velden[`id_${i}`])) : null, omschrijving, complexnummer: tekst(velden[`complexnummer_${i}`]), jaarbedrag: jaarbedragStr });
    }
    stuurHtml(res, 400, renderBtwForm({ actieUrl, terugUrl, fouten: [error instanceof Error ? error.message : String(error)], beoordeeld: tekst(velden["beoordeeld"]) === "1", resterendeVerwachting: tekst(velden["resterendeVerwachting"]), regels: regelsVoorForm }));
  }
  return true;
}

async function handleRente(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, categorie: BgRenteCategorie, vergelijkend: Vergelijkend): Promise<boolean> {
  const isOpbrengst = categorie === "RENTE_OPBRENGSTEN";

  if (req.method === "GET") {
    const regels = leesRenteRegels(g.db, g.versie.id).filter((r) => r.categorie === categorie);
    const categorieState = leesRenteCategorieState(g.db, g.versie.id);
    const resterendeVerwachting = leesRenteEstimatedVerwachting(g.db, g.versie.id)[categorie];
    const bestaandeRegel = regels[0];
    // Ruwe conventie: Rente opbrengsten wordt intern negatief bewaard; de gebruiker ziet en voert altijd een positief bedrag in (Tranche 11 §11).
    const begrotingsbedrag = bestaandeRegel?.begrotingsbedrag !== null && bestaandeRegel?.begrotingsbedrag !== undefined ? (isOpbrengst ? bestaandeRegel.begrotingsbedrag.negated() : bestaandeRegel.begrotingsbedrag).toString() : "";
    const verwachtingWeergave = resterendeVerwachting !== null ? (isOpbrengst ? resterendeVerwachting.negated() : resterendeVerwachting).toString() : "";
    const pnlHtml = vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, [categorie]) : "";
    stuurHtml(res, 200, renderRenteForm({ categorie, actieUrl, terugUrl, begrotingsbedrag, beoordeeld: categorieState[categorie].beoordeeld, resterendeVerwachting: verwachtingWeergave, alleenLezen: g.versie.status !== "CONCEPT", pnlHtml, fragment: isFragmentVerzoek(req) }));
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const ingevoerdBedrag = parseGeld(tekst(velden["begrotingsbedrag"]));
    if (isOpbrengst && ingevoerdBedrag !== null && ingevoerdBedrag.isNegative()) throw new Error("Voer de renteopbrengst als positief bedrag in.");
    const begrotingsbedrag = ingevoerdBedrag !== null && isOpbrengst ? ingevoerdBedrag.negated() : ingevoerdBedrag;

    const bestaande = leesRenteRegels(g.db, g.versie.id);
    const andereCategorie = bestaande.filter((r) => r.categorie !== categorie).map((r) => ({ id: r.id, categorie: r.categorie, omschrijving: r.omschrijving, complexnummer: r.complexnummer, ogbReferentie: r.ogbReferentie, laatstBekendSaldo: r.laatstBekendSaldo, rentepercentage: r.rentepercentage, begrotingsbedrag: r.begrotingsbedrag }));
    const dezeCategorieBestaand = bestaande.find((r) => r.categorie === categorie);
    schrijfRenteRegels(g.db, g.versie.id, [
      ...andereCategorie,
      {
        id: dezeCategorieBestaand?.id ?? null,
        categorie,
        omschrijving: categorie === "RENTEKOSTEN" ? "Rente leningen" : "Opbrengst rente",
        complexnummer: null,
        ogbReferentie: null,
        laatstBekendSaldo: null,
        rentepercentage: null,
        begrotingsbedrag,
      },
    ]);

    const bestaandeState = leesRenteCategorieState(g.db, g.versie.id);
    schrijfRenteCategorieState(g.db, g.versie.id, { ...bestaandeState, [categorie]: { beoordeeld: tekst(velden["beoordeeld"]) === "1" } });

    const ingevoerdeVerwachting = parseGeld(tekst(velden["resterendeVerwachting"]));
    if (isOpbrengst && ingevoerdeVerwachting !== null && ingevoerdeVerwachting.isNegative()) throw new Error("Voer de verwachte renteopbrengst als positief bedrag in.");
    const verwachting = ingevoerdeVerwachting !== null && isOpbrengst ? ingevoerdeVerwachting.negated() : ingevoerdeVerwachting;
    const bestaandeVerwachting = leesRenteEstimatedVerwachting(g.db, g.versie.id);
    schrijfRenteEstimatedVerwachting(g.db, g.versie.id, { ...bestaandeVerwachting, [categorie]: verwachting });

    stuurRedirect(res, terugUrl);
  } catch (error) {
    stuurHtml(
      res,
      400,
      renderRenteForm({
        categorie,
        actieUrl,
        terugUrl,
        fouten: [error instanceof Error ? error.message : String(error)],
        begrotingsbedrag: tekst(velden["begrotingsbedrag"]),
        beoordeeld: tekst(velden["beoordeeld"]) === "1",
        resterendeVerwachting: tekst(velden["resterendeVerwachting"]),
      }),
    );
  }
  return true;
}

function som(waarden: readonly (Decimal | null)[]): Decimal {
  return waarden.reduce((totaal: Decimal, w) => (w !== null ? totaal.plus(w) : totaal), new Decimal(0));
}

const LEEGSTAND_PREFIXEN: Record<BgLeegstandCategorie, string> = { NUTS_LEEGSTAND: "nuts", SERVICEKOSTEN_LEEGSTAND: "service", OVERIGE_LEEGSTANDSKOSTEN: "overige" };
const LEEGSTAND_TITELS: Record<BgLeegstandCategorie, string> = { NUTS_LEEGSTAND: "Nuts leegstand", SERVICEKOSTEN_LEEGSTAND: "Servicekosten leegstand", OVERIGE_LEEGSTANDSKOSTEN: "Overige leegstandskosten" };
const MAX_REGELS_LEEGSTAND = 6;

/** Leegstandskosten (OB-031, Tranche 13): drie categorieën, elk het bestaande complete-list-save-patroon. */
async function handleLeegstand(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  if (req.method === "GET") {
    const state = leesLeegstandCategorieState(g.db, g.versie.id);
    const regels = leesLeegstandRegels(g.db, g.versie.id);
    const categorieen: LeegstandCategorieOpties[] = LEEGSTAND_CATEGORIEEN.map((categorie) => ({
      categorie,
      titel: LEEGSTAND_TITELS[categorie],
      beoordeeld: state[categorie].beoordeeld,
      regels: regels.filter((r) => r.categorie === categorie).map((r) => ({ id: r.id, complexnummer: r.complexnummer ?? "", omschrijving: r.omschrijving, q1: r.q1?.toString() ?? "", q2: r.q2?.toString() ?? "", q3: r.q3?.toString() ?? "", q4: r.q4?.toString() ?? "" })),
    }));
    const totaal = som(regels.flatMap((r) => [r.q1, r.q2, r.q3, r.q4]));
    const pnlHtml = vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["LEEGSTANDSKOSTEN"]) : "";
    stuurHtml(res, 200, renderLeegstandForm({ actieUrl, terugUrl, categorieen, portefeuilleTotaal: fmtBedragKort(totaal), alleenLezen: g.versie.status !== "CONCEPT", pnlHtml, fragment: isFragmentVerzoek(req) }));
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const alleRegels: LeegstandRegelInvoer[] = [];
    const nieuweState: Record<string, { beoordeeld: boolean; laatstBekendServicekostenvoorschotJaar: Decimal | null; laatstBekendServicekostenvoorschotJaarHerkomst: null; verwachteLeegstandsperiodeMaanden: null }> = {};
    const bestaandeState = leesLeegstandCategorieState(g.db, g.versie.id);
    for (const categorie of LEEGSTAND_CATEGORIEEN) {
      const prefix = LEEGSTAND_PREFIXEN[categorie];
      for (let i = 0; i < MAX_REGELS_LEEGSTAND; i++) {
        const omschrijving = tekst(velden[`${prefix}_omschrijving_${i}`]);
        const heeftBedrag = ["q1", "q2", "q3", "q4"].some((q) => tekst(velden[`${prefix}_${q}_${i}`]).length > 0);
        if (omschrijving.length === 0 && !heeftBedrag) continue;
        if (omschrijving.length === 0) throw new Error(`${LEEGSTAND_TITELS[categorie]} regel ${i + 1}: omschrijving is verplicht.`);
        alleRegels.push({
          id: tekst(velden[`${prefix}_id_${i}`]).length > 0 ? Number(tekst(velden[`${prefix}_id_${i}`])) : null,
          categorie,
          complexnummer: tekstOfNull(velden[`${prefix}_complex_${i}`]),
          complexomschrijving: null,
          omschrijving,
          q1: parseGeld(tekst(velden[`${prefix}_q1_${i}`])),
          q2: parseGeld(tekst(velden[`${prefix}_q2_${i}`])),
          q3: parseGeld(tekst(velden[`${prefix}_q3_${i}`])),
          q4: parseGeld(tekst(velden[`${prefix}_q4_${i}`])),
        });
      }
      nieuweState[categorie] = { beoordeeld: tekst(velden[`${prefix}_beoordeeld`]) === "1", laatstBekendServicekostenvoorschotJaar: bestaandeState[categorie].laatstBekendServicekostenvoorschotJaar, laatstBekendServicekostenvoorschotJaarHerkomst: null, verwachteLeegstandsperiodeMaanden: null };
    }
    schrijfLeegstandRegels(g.db, g.versie.id, alleRegels);
    schrijfLeegstandCategorieState(g.db, g.versie.id, nieuweState as never);
    stuurRedirect(res, terugUrl);
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Leegstandskosten konden niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
  }
  return true;
}

const ALGEMENE_KOSTEN_PREFIXEN: Record<BgAlgemeneKostenCategorie, string> = { ACCOUNTANT: "accountant", JURIDISCHE_KOSTEN: "juridisch", MAKELAARSKOSTEN: "makelaar", ALGEMENE_KOSTEN: "algemeen", BANKKOSTEN: "bank" };
const ALGEMENE_KOSTEN_TITELS: Record<BgAlgemeneKostenCategorie, string> = { ACCOUNTANT: "Accountantkosten", JURIDISCHE_KOSTEN: "Juridische kosten", MAKELAARSKOSTEN: "Makelaar- en taxatiekosten", ALGEMENE_KOSTEN: "Overige algemene kosten", BANKKOSTEN: "Bankkosten" };
const MAX_REGELS_AK = 5;

/** Algemene kosten (OB-035/036, Tranche 13): vijf categorieën met hetzelfde regelmodel; Accountant/Bank tonen het bestaande informatieve vorig-jaar-voorstel. */
async function handleAlgemeneKosten(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  if (req.method === "GET") {
    const state = leesAlgemeneKostenCategorieState(g.db, g.versie.id);
    const regels = leesAlgemeneKostenRegels(g.db, g.versie.id);
    const categorieen: AlgemeneKostenCategorieOpties[] = ALGEMENE_KOSTEN_CATEGORIEEN.map((categorie) => ({
      categorie,
      titel: ALGEMENE_KOSTEN_TITELS[categorie],
      beoordeeld: state[categorie].beoordeeld,
      vorigJaarBedrag: state[categorie].vorigJaarBedrag?.toString() ?? "",
      verwachteVerhogingPercentage: state[categorie].verwachteVerhogingPercentage?.toString() ?? "",
      toonVoorstelVelden: categorie === "ACCOUNTANT" || categorie === "BANKKOSTEN",
      regels: regels.filter((r) => r.categorie === categorie).map((r) => ({ id: r.id, omschrijving: r.omschrijving, complexnummer: r.complexnummer ?? "", ogbKostensoortCode: r.ogbKostensoortCode ?? "", jaarbedrag: r.jaarbedrag?.toString() ?? "" })),
    }));
    const totaal = som(regels.map((r) => r.jaarbedrag));
    const pnlHtml = vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["ACCOUNTANT", "JURIDISCHE_KOSTEN", "MAKELAARSKOSTEN", "ALGEMENE_KOSTEN", "BANKKOSTEN"]) : "";
    stuurHtml(res, 200, renderAlgemeneKostenForm({ actieUrl, terugUrl, categorieen, portefeuilleTotaal: fmtBedragKort(totaal), alleenLezen: g.versie.status !== "CONCEPT", pnlHtml, fragment: isFragmentVerzoek(req) }));
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const alleRegels: AlgemeneKostenRegelInvoer[] = [];
    const nieuweState: Record<string, { beoordeeld: boolean; vorigJaarBedrag: Decimal | null; verwachteVerhogingPercentage: Decimal | null }> = {};
    for (const categorie of ALGEMENE_KOSTEN_CATEGORIEEN) {
      const prefix = ALGEMENE_KOSTEN_PREFIXEN[categorie];
      for (let i = 0; i < MAX_REGELS_AK; i++) {
        const omschrijving = tekst(velden[`${prefix}_omschrijving_${i}`]);
        const jaarbedragStr = tekst(velden[`${prefix}_jaarbedrag_${i}`]);
        if (omschrijving.length === 0 && jaarbedragStr.length === 0) continue;
        if (omschrijving.length === 0) throw new Error(`${ALGEMENE_KOSTEN_TITELS[categorie]} regel ${i + 1}: omschrijving is verplicht.`);
        alleRegels.push({
          id: tekst(velden[`${prefix}_id_${i}`]).length > 0 ? Number(tekst(velden[`${prefix}_id_${i}`])) : null,
          categorie,
          ogbKostensoortCode: tekstOfNull(velden[`${prefix}_ogb_${i}`]),
          omschrijving,
          complexnummer: tekstOfNull(velden[`${prefix}_complex_${i}`]),
          jaarbedrag: parseGeld(jaarbedragStr),
        });
      }
      nieuweState[categorie] = { beoordeeld: tekst(velden[`${prefix}_beoordeeld`]) === "1", vorigJaarBedrag: parseGeld(tekst(velden[`${prefix}_vorigJaar`])), verwachteVerhogingPercentage: parseGeld(tekst(velden[`${prefix}_verhoging`])) };
    }
    schrijfAlgemeneKostenRegels(g.db, g.versie.id, alleRegels);
    schrijfAlgemeneKostenCategorieState(g.db, g.versie.id, nieuweState as never);
    stuurRedirect(res, terugUrl);
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Algemene kosten konden niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
  }
  return true;
}

const MAX_REGELS_VERZEKERING = 8;

/** Verzekeringen (UX_06, OB-032, Tranche 13): bestaand polisregelmodel, module-brede beoordeeld-vlag. Actual per polis blijft BRONGAT — niet gemaskeerd. */
async function handleVerzekeringen(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  if (req.method === "GET") {
    const regels = leesVerzekeringRegels(g.db, g.versie.id);
    const beoordeeld = leesVerzekeringBeoordeeld(g.db, g.versie.id);
    const veldRegels: VerzekeringRegelVeld[] = regels.map((r) => ({
      id: r.id,
      complexnummer: r.complexnummer ?? "",
      verzekeraar: r.verzekeraar ?? "",
      grootboekrekening: r.grootboekrekening,
      ogbKostensoort: r.ogbKostensoort ?? "",
      ingangsdatum: r.ingangsdatum ? fmtDatumVeld(r.ingangsdatum) : "",
      looptijdMaanden: r.looptijdMaanden?.toString() ?? "",
      bedrag: r.bedrag?.toString() ?? "",
      indexPercentage: r.indexPercentage?.toString() ?? "",
      handmatigBegrootOverride: r.handmatigBegrootOverride?.toString() ?? "",
    }));
    const totaal = som(regels.map((r) => r.handmatigBegrootOverride ?? r.bedrag));
    const pnlHtml = vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["VERZEKERINGEN"]) : "";
    const maandverloopUrl = (polisId: number) => `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/verzekeringen/maandverloop?polisId=${polisId}`;
    stuurHtml(res, 200, renderVerzekeringenForm({ actieUrl, terugUrl, regels: veldRegels, beoordeeld, portefeuilleTotaal: fmtBedragKort(totaal), alleenLezen: g.versie.status !== "CONCEPT", pnlHtml, maandverloopUrl, fragment: isFragmentVerzoek(req) }));
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const regels: VerzekeringRegelInvoer[] = [];
    for (let i = 0; i < MAX_REGELS_VERZEKERING; i++) {
      const verzekeraar = tekst(velden[`verzekeraar_${i}`]);
      const grootboekrekening = tekst(velden[`grootboekrekening_${i}`]);
      const bedragStr = tekst(velden[`bedrag_${i}`]);
      if (verzekeraar.length === 0 && grootboekrekening.length === 0 && bedragStr.length === 0) continue;
      if (grootboekrekening.length === 0) throw new Error(`Regel ${i + 1}: grootboekrekening is verplicht.`);
      const ingangsdatumStr = tekst(velden[`ingangsdatum_${i}`]);
      regels.push({
        id: tekst(velden[`id_${i}`]).length > 0 ? Number(tekst(velden[`id_${i}`])) : null,
        complexnummer: tekstOfNull(velden[`complex_${i}`]),
        verzekeraar: tekstOfNull(velden[`verzekeraar_${i}`]),
        grootboekrekening,
        ogbKostensoort: tekstOfNull(velden[`ogb_${i}`]),
        ingangsdatum: ingangsdatumStr.length > 0 ? new Date(`${ingangsdatumStr}T00:00:00.000Z`) : null,
        looptijdMaanden: tekst(velden[`looptijd_${i}`]).length > 0 ? Number(tekst(velden[`looptijd_${i}`])) : null,
        bedrag: parseGeld(bedragStr),
        indexPercentage: parseGeld(tekst(velden[`index_${i}`])),
        handmatigBegrootOverride: parseGeld(tekst(velden[`override_${i}`])),
      });
    }
    schrijfVerzekeringRegels(g.db, g.versie.id, regels);
    schrijfVerzekeringBeoordeeld(g.db, g.versie.id, tekst(velden["beoordeeld"]) === "1");
    stuurRedirect(res, terugUrl);
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Verzekeringen konden niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
  }
  return true;
}

const MAX_REGELS_GEPLAND = 6;

/** Gepland onderhoud (UX_04, OB-027, Tranche 13): handmatige activiteiten. Werkelijk/Estimated blijven op Onderhoud-totaalniveau (§16/§17) — bewust geen fictieve waarde per activiteit. */
async function handleGeplandOnderhoud(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, laatstAfgeslotenBoekperiode: string): Promise<boolean> {
  if (req.method === "GET") {
    const activiteiten = leesGeplandOnderhoudActiviteiten(g.db, g.versie.id);
    const beoordeeld = leesGeplandOnderhoudBeoordeeld(g.db, g.versie.id);
    const onderhoudTotaal = bouwOnderhoudTotaalSamenvatting(leesOnderhoudTotaalVoorWerkomgeving(g.root, g.administratieId, g.db, g.versie, laatstAfgeslotenBoekperiode));
    const regels: GeplandOnderhoudRegelVeld[] = activiteiten.map((a) => ({
      id: a.id,
      complexnummer: a.complexnummer,
      omschrijving: a.omschrijving,
      grootboekrekening: a.grootboekrekening,
      ogbKostensoort: a.ogbKostensoort ?? "",
      aanleidingType: a.aanleidingType ?? "",
      aanleidingToelichting: a.aanleidingToelichting,
      q1: a.q1.toString(),
      q2: a.q2.toString(),
      q3: a.q3.toString(),
      q4: a.q4.toString(),
      status: a.status,
      leverancier: a.leverancier ?? "",
      offertebedrag: a.offertebedrag?.toString() ?? "",
      notitie: a.notitie ?? "",
    }));
    const jaartotaal = activiteiten.reduce((t, a) => t.plus(a.q1).plus(a.q2).plus(a.q3).plus(a.q4), new Decimal(0));
    stuurHtml(res, 200, renderGeplandOnderhoudForm({ actieUrl, terugUrl, regels, beoordeeld, jaartotaal: fmtBedragKort(jaartotaal), alleenLezen: g.versie.status !== "CONCEPT", onderhoudTotaal, fragment: isFragmentVerzoek(req) }));
    return true;
  }

  const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));
  try {
    const activiteiten: GeplandOnderhoudActiviteitInvoer[] = [];
    for (let i = 0; i < MAX_REGELS_GEPLAND; i++) {
      const omschrijving = tekst(velden[`omschrijving_${i}`]);
      const grootboekrekening = tekst(velden[`grootboekrekening_${i}`]);
      const heeftQ = ["q1", "q2", "q3", "q4"].some((q) => tekst(velden[`${q}_${i}`]).length > 0);
      if (omschrijving.length === 0 && grootboekrekening.length === 0 && !heeftQ) continue;
      const complexnummer = tekst(velden[`complex_${i}`]);
      if (complexnummer.length === 0) throw new Error(`Regel ${i + 1}: complex is verplicht.`);
      if (omschrijving.length === 0) throw new Error(`Regel ${i + 1}: omschrijving is verplicht.`);
      if (grootboekrekening.length === 0) throw new Error(`Regel ${i + 1}: grootboekrekening is verplicht.`);
      const geldigeAanleiding = ["MJOP", "INSPECTIE", "OFFERTE", "OVERIG"];
      const aanleidingType = tekst(velden[`aanleiding_${i}`]);
      const geldigeStatussen = ["GEPLAND", "IN_UITVOERING", "UITGESTELD", "VERVALLEN", "AFGEROND", "ONVOORZIEN"];
      const status = tekst(velden[`status_${i}`]) || "GEPLAND";
      if (!geldigeStatussen.includes(status)) throw new Error(`Regel ${i + 1}: ongeldige status "${status}".`);
      activiteiten.push({
        id: tekst(velden[`id_${i}`]).length > 0 ? Number(tekst(velden[`id_${i}`])) : null,
        complexnummer,
        omschrijving,
        grootboekrekening,
        ogbKostensoort: tekstOfNull(velden[`ogb_${i}`]),
        aanleidingType: geldigeAanleiding.includes(aanleidingType) ? aanleidingType : null,
        aanleidingToelichting: tekst(velden[`toelichting_${i}`]),
        q1: parseGeld(tekst(velden[`q1_${i}`])) ?? new Decimal(0),
        q2: parseGeld(tekst(velden[`q2_${i}`])) ?? new Decimal(0),
        q3: parseGeld(tekst(velden[`q3_${i}`])) ?? new Decimal(0),
        q4: parseGeld(tekst(velden[`q4_${i}`])) ?? new Decimal(0),
        status,
        leverancier: tekstOfNull(velden[`leverancier_${i}`]),
        offertebedrag: parseGeld(tekst(velden[`offertebedrag_${i}`])),
        notitie: tekstOfNull(velden[`notitie_${i}`]),
      });
    }
    schrijfGeplandOnderhoudActiviteiten(g.db, g.versie.id, activiteiten);
    schrijfGeplandOnderhoudBeoordeeld(g.db, g.versie.id, tekst(velden["beoordeeld"]) === "1");
    stuurRedirect(res, terugUrl);
  } catch (error) {
    stuurHtml(res, 400, renderFoutPagina("Gepland onderhoud kon niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
  }
  return true;
}

const MAX_REGELS_GL = 3;
const MAX_REGELS_WOZ = 4;

/** Gemeentelijke lasten / WOZ (UX_08, OB-033, Tranche 13): GL-regels + WOZ-historie + aannames + "Voorstel overnemen" — allemaal bestaande, ongewijzigde functionaliteit. */
async function handleGemeentelijkeLasten(req: IncomingMessage, res: ServerResponse, g: Geopend, root: string, actieUrl: string, terugUrl: string, vergelijkend: Vergelijkend): Promise<boolean> {
  const mappingDb = openOrCreateDatabase(pnlBronmappingDatabasePad(root, g.administratieId));
  let relevanteGrootboeken: string[];
  try {
    relevanteGrootboeken = leesRelevanteGemeentelijkeLastenGrootboekenVoorAdministratie(mappingDb, g.bedrijfsnr, g.versie.begrotingsjaar).map((gl) => gl.grootboekrekening);
  } finally {
    mappingDb.close();
  }

  if (req.method === "POST") {
    const velden = Object.fromEntries(new URLSearchParams(await leesBody(req)));

    if (tekst(velden["actie"]) === "voorstelOvernemen") {
      try {
        neemWozVoorstelOver(g.db, g.versie.id);
        stuurRedirect(res, terugUrl);
      } catch (error) {
        stuurHtml(res, 400, renderFoutPagina("Voorstel kon niet worden overgenomen", error instanceof VoorstelOvernameGeweigerdError ? error.message : error instanceof Error ? error.message : String(error), terugUrl));
      }
      return true;
    }

    try {
      const glRegels: GemeentelijkeLastenRegelInvoer[] = [];
      for (let i = 0; i < MAX_REGELS_GL; i++) {
        const grootboekrekening = tekst(velden[`gl_grootboekrekening_${i}`]);
        const jaarbedragStr = tekst(velden[`gl_jaarbedrag_${i}`]);
        if (grootboekrekening.length === 0 && jaarbedragStr.length === 0) continue;
        if (grootboekrekening.length === 0) throw new Error(`GL-regel ${i + 1}: grootboekrekening is verplicht.`);
        glRegels.push({ id: tekst(velden[`gl_id_${i}`]).length > 0 ? Number(tekst(velden[`gl_id_${i}`])) : null, grootboekrekening, ogbKostensoort: tekstOfNull(velden[`gl_ogb_${i}`]), jaarbedrag: parseGeld(jaarbedragStr) });
      }
      const wozObjecten: WozObjectInvoer[] = [];
      for (let i = 0; i < MAX_REGELS_WOZ; i++) {
        const complexnummer = tekst(velden[`woz_complex_${i}`]);
        const werkelijkStr = tekst(velden[`woz_werkelijk_${i}`]);
        if (complexnummer.length === 0 && werkelijkStr.length === 0) continue;
        if (complexnummer.length === 0) throw new Error(`WOZ-regel ${i + 1}: complex is verplicht.`);
        const aanslagjaarStr = tekst(velden[`woz_aanslagjaar_${i}`]);
        const waardepeildatumStr = tekst(velden[`woz_waardepeildatum_${i}`]);
        const werkelijkeWoz = parseGeld(werkelijkStr);
        if (werkelijkeWoz === null || werkelijkeWoz.isNegative()) throw new Error(`WOZ-regel ${i + 1}: werkelijke WOZ is verplicht en moet positief zijn.`);
        wozObjecten.push({
          id: tekst(velden[`woz_id_${i}`]).length > 0 ? Number(tekst(velden[`woz_id_${i}`])) : null,
          complexnummer,
          objectType: tekst(velden[`woz_objectType_${i}`]) || "GEHEEL_COMPLEX",
          unitnummer: tekstOfNull(velden[`woz_unit_${i}`]),
          aanslagjaar: aanslagjaarStr.length > 0 ? Number(aanslagjaarStr) : null,
          waardepeildatum: waardepeildatumStr.length > 0 ? new Date(`${waardepeildatumStr}T00:00:00.000Z`) : null,
          werkelijkeWoz,
          verwachteWozOverride: parseGeld(tekst(velden[`woz_override_${i}`])),
        });
      }
      schrijfGemeentelijkeLastenRegels(g.db, g.versie.id, glRegels);
      schrijfWozObjecten(g.db, g.versie.id, wozObjecten);
      schrijfGemeentelijkeLastenModule(g.db, g.versie.id, {
        werkelijkeGemeentelijkeLasten: parseGeld(tekst(velden["werkelijkeLasten"])),
        wozStijgingPercentage: parseGeld(tekst(velden["wozStijging"])),
        lastenPercentageStijging: parseGeld(tekst(velden["lastenStijging"])),
        begrotingsPercentageOverride: parseGeld(tekst(velden["percentageOverride"])),
        beoordeeld: tekst(velden["beoordeeld"]) === "1",
      });
      schrijfWozSetBevestigd(g.db, g.versie.id, tekst(velden["wozSetBevestigd"]) === "1");
      stuurRedirect(res, terugUrl);
      return true;
    } catch (error) {
      stuurHtml(res, 400, renderFoutPagina("Gemeentelijke lasten konden niet worden opgeslagen", error instanceof Error ? error.message : String(error), terugUrl));
      return true;
    }
  }

  const glRegels = leesGemeentelijkeLastenRegels(g.db, g.versie.id);
  const wozObjecten = leesWozObjecten(g.db, g.versie.id);
  const moduleInvoer = leesGemeentelijkeLastenModule(g.db, g.versie.id);
  const voorstelStatus = leesGemeentelijkeLastenVoorstelStatus(g.db, g.versie.id);
  const glVelden: GemeentelijkeLastenRegelVeld[] = glRegels.map((r) => ({ id: r.id, grootboekrekening: r.grootboekrekening, ogbKostensoort: r.ogbKostensoort ?? "", jaarbedrag: r.jaarbedrag?.toString() ?? "" }));
  const wozVelden: WozObjectVeld[] = wozObjecten.map((w) => ({
    id: w.id,
    complexnummer: w.complexnummer ?? "",
    objectType: w.objectType ?? "GEHEEL_COMPLEX",
    unitnummer: w.unitnummer ?? "",
    aanslagjaar: w.aanslagjaar?.toString() ?? "",
    waardepeildatum: w.waardepeildatum ? fmtDatumVeld(w.waardepeildatum) : "",
    werkelijkeWoz: w.werkelijkeWoz?.toString() ?? "",
    verwachteWozOverride: w.verwachteWozOverride?.toString() ?? "",
  }));
  const totaal = som(glRegels.map((r) => r.jaarbedrag));
  stuurHtml(
    res,
    200,
    renderGemeentelijkeLastenForm({
      actieUrl,
      terugUrl,
      relevanteGrootboeken,
      glRegels: glVelden,
      wozObjecten: wozVelden,
      wozStijgingPercentage: moduleInvoer.wozStijgingPercentage?.toString() ?? "",
      lastenPercentageStijging: moduleInvoer.lastenPercentageStijging?.toString() ?? "",
      begrotingsPercentageOverride: moduleInvoer.begrotingsPercentageOverride?.toString() ?? "",
      werkelijkeGemeentelijkeLasten: moduleInvoer.werkelijkeGemeentelijkeLasten?.toString() ?? "",
      beoordeeld: moduleInvoer.beoordeeld,
      wozSetBevestigd: moduleInvoer.wozSetBevestigd,
      voorstelMogelijk: voorstelStatus.mogelijk,
      voorstelReden: voorstelStatus.reden,
      portefeuilleTotaal: fmtBedragKort(totaal),
      alleenLezen: g.versie.status !== "CONCEPT",
      pnlHtml: vergelijkend !== null ? moduleWerkomgevingPnLHtml(vergelijkend, ["GEMEENTELIJKE_LASTEN"]) : "",
      wozHistorieCsvUrl: `/begroting/${encodeURIComponent(g.administratieId)}/${encodeURIComponent(g.versie.id)}/module/gemeentelijke-lasten/woz-historie.csv`,
      fragment: isFragmentVerzoek(req),
    }),
  );
  return true;
}
