import type { IncomingMessage, ServerResponse } from "node:http";
import Decimal from "decimal.js";
import {
  leesBegrotingsversie,
  leesBegrotingsversiesVoorAdministratie,
  leesCorrectiefDagelijksOnderhoudBeoordeeld,
  leesCorrectiefDagelijksOnderhoudRegels,
  leesModule3Invoer,
  leesNietVerrekenbareBtwEstimatedVerwachting,
  leesNietVerrekenbareBtwRegels,
  leesNietVerrekenbareBtwState,
  leesRenteCategorieState,
  leesRenteEstimatedVerwachting,
  leesRenteRegels,
  maakBegrotingsversie,
  openOrCreateDatabase,
  schrijfCorrectiefDagelijksOnderhoudBeoordeeld,
  schrijfCorrectiefDagelijksOnderhoudRegels,
  schrijfModule1Aannames,
  schrijfModule1Snapshot,
  schrijfModule3Invoer,
  schrijfNietVerrekenbareBtwEstimatedVerwachting,
  schrijfNietVerrekenbareBtwRegels,
  schrijfNietVerrekenbareBtwState,
  schrijfRenteCategorieState,
  schrijfRenteEstimatedVerwachting,
  schrijfRenteRegels,
  stelBegrotingVast,
  type Begrotingsversie,
} from "@bvc/begroting-data";
import { berekenPnLBoom, vergelijkPnLResultaten, type BgManagementInvoer, type BgRenteCategorie } from "@bvc/reporting";
import { lijstAdministraties, leesAdministratieConfig } from "./administratie.js";
import { begrotingsversiesDatabasePad } from "./paths.js";
import { leesBegrotingsWerkomgeving } from "./begrotingWerkelijk.js";
import { BOEKPERIODES } from "./serveUi.js";
import {
  renderBegrotingHoofdscherm,
  renderBegrotingKeuzeScherm,
  renderBtwForm,
  renderControlePagina,
  renderCorrectiefForm,
  renderFoutPagina,
  renderManagementForm,
  renderRenteForm,
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

function laatstAfgeslotenBoekperiodeUitQuery(url: URL): string | null {
  const waarde = url.searchParams.get("laatstAfgeslotenBoekperiode") ?? "";
  return GELDIGE_PERIODES.has(waarde) ? waarde : null;
}

function hoofdschermUrl(administratieId: string, versieId: string, laatstAfgeslotenBoekperiode: string): string {
  return `/begroting/${encodeURIComponent(administratieId)}/${encodeURIComponent(versieId)}?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}`;
}

async function toonHoofdscherm(res: ServerResponse, g: Geopend, laatstAfgeslotenBoekperiode: string, melding?: string): Promise<void> {
  try {
    const vergelijkend = leesBegrotingsWerkomgeving(g.root, g.administratieId, g.bedrijfsnr, g.db, g.versie, laatstAfgeslotenBoekperiode);
    stuurHtml(
      res,
      200,
      renderBegrotingHoofdscherm({
        administratieId: g.administratieId,
        weergavenaam: g.weergavenaam,
        versie: g.versie,
        vergelijkend,
        laatstAfgeslotenBoekperiode,
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
      stuurHtml(res, 200, renderBegrotingKeuzeScherm(administraties, { ingevoerd: { administratieId }, bestaandeVersies: versies }));
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
      // Module-1-aannames kan de vergelijkende P&L (`herberekenBegroting`) nog niet rekenen. Module-1-contractsnapshot
      // (echte rentroll-/contractdata) is in deze tranche nog niet aangesloten — zie het acceptatierapport.
      schrijfModule1Snapshot(db, versie.id, []);
      schrijfModule1Aannames(db, versie.id, { begrotingsjaar, indexatiePercentage: indexatiePercentage! });
      stuurRedirect(res, hoofdschermUrl(administratieId, versie.id, laatstAfgeslotenBoekperiode));
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
    const laatstAfgeslotenBoekperiode = laatstAfgeslotenBoekperiodeUitQuery(url);
    if (laatstAfgeslotenBoekperiode === null) {
      g.db.close();
      stuurRedirect(res, `/begroting?administratieId=${encodeURIComponent(administratieId)}`);
      return true;
    }
    await toonHoofdscherm(res, g, laatstAfgeslotenBoekperiode);
    return true;
  }

  // GET/POST /begroting/{administratieId}/{versieId}/controle
  if (segmenten.length === 4 && segmenten[3] === "controle") {
    const g = open(root, administratieId, versieId);
    if (g === null) {
      stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
      return true;
    }
    const laatstAfgeslotenBoekperiode = laatstAfgeslotenBoekperiodeUitQuery(url) ?? "12";
    try {
      const vergelijkend = leesBegrotingsWerkomgeving(g.root, g.administratieId, g.bedrijfsnr, g.db, g.versie, laatstAfgeslotenBoekperiode);
      const vergelijking = vergelijkend.estimated !== null ? vergelijkPnLResultaten(vergelijkend.estimated, vergelijkend.jouwBegroting) : null;
      stuurHtml(res, 200, renderControlePagina({ administratieId, weergavenaam: g.weergavenaam, versie: g.versie, laatstAfgeslotenBoekperiode, vergelijking }));
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
    const laatstAfgeslotenBoekperiode = laatstAfgeslotenBoekperiodeUitQuery(url) ?? "12";
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

  // GET/POST /begroting/{administratieId}/{versieId}/module/{moduleKey}
  if (segmenten.length === 5 && segmenten[3] === "module") {
    const moduleKey = segmenten[4]!;
    return handleModuleRoute(root, req, res, url, administratieId, versieId, moduleKey);
  }

  return false;
}

async function handleModuleRoute(root: string, req: IncomingMessage, res: ServerResponse, url: URL, administratieId: string, versieId: string, moduleKey: string): Promise<boolean> {
  const g = open(root, administratieId, versieId);
  if (g === null) {
    stuurHtml(res, 404, renderFoutPagina("Niet gevonden", "Deze begrotingsversie of administratie bestaat niet."));
    return true;
  }
  const laatstAfgeslotenBoekperiode = laatstAfgeslotenBoekperiodeUitQuery(url) ?? "12";
  const terugUrl = hoofdschermUrl(administratieId, versieId, laatstAfgeslotenBoekperiode);
  const actieUrl = `${url.pathname}?laatstAfgeslotenBoekperiode=${encodeURIComponent(laatstAfgeslotenBoekperiode)}`;

  if (g.versie.status !== "CONCEPT") {
    g.db.close();
    stuurHtml(res, 400, renderFoutPagina("Niet meer wijzigbaar", "Deze begrotingsversie is vastgesteld en is alleen-lezen.", terugUrl));
    return true;
  }

  try {
    if (moduleKey === "management") return await handleManagement(req, res, g, actieUrl, terugUrl);
    if (moduleKey === "correctief") return await handleCorrectief(req, res, g, actieUrl, terugUrl);
    if (moduleKey === "btw") return await handleBtw(req, res, g, actieUrl, terugUrl);
    if (moduleKey === "rente-leningen") return await handleRente(req, res, g, actieUrl, terugUrl, "RENTEKOSTEN");
    if (moduleKey === "rente-opbrengst") return await handleRente(req, res, g, actieUrl, terugUrl, "RENTE_OPBRENGSTEN");
    stuurHtml(res, 404, renderFoutPagina("Onbekend onderdeel", `Onbekend begrotingsonderdeel "${moduleKey}".`, terugUrl));
    return true;
  } finally {
    g.db.close();
  }
}

async function handleManagement(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string): Promise<boolean> {
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
    stuurHtml(res, 200, renderManagementForm({ actieUrl, terugUrl, huidig: form }));
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

async function handleCorrectief(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string): Promise<boolean> {
  if (req.method === "GET") {
    const regels = leesCorrectiefDagelijksOnderhoudRegels(g.db, g.versie.id);
    const beoordeeld = leesCorrectiefDagelijksOnderhoudBeoordeeld(g.db, g.versie.id);
    stuurHtml(
      res,
      200,
      renderCorrectiefForm({
        actieUrl,
        terugUrl,
        beoordeeld,
        regels: regels.map((r) => ({ id: r.id, omschrijving: r.omschrijving, complexnummer: r.complexnummer ?? "", grootboekrekening: r.grootboekrekening, ogbKostensoort: r.ogbKostensoort ?? "", jaarbedrag: r.jaarbedrag?.toString() ?? "" })),
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

async function handleBtw(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string): Promise<boolean> {
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

async function handleRente(req: IncomingMessage, res: ServerResponse, g: Geopend, actieUrl: string, terugUrl: string, categorie: BgRenteCategorie): Promise<boolean> {
  const isOpbrengst = categorie === "RENTE_OPBRENGSTEN";

  if (req.method === "GET") {
    const regels = leesRenteRegels(g.db, g.versie.id).filter((r) => r.categorie === categorie);
    const categorieState = leesRenteCategorieState(g.db, g.versie.id);
    const resterendeVerwachting = leesRenteEstimatedVerwachting(g.db, g.versie.id)[categorie];
    const bestaandeRegel = regels[0];
    // Ruwe conventie: Rente opbrengsten wordt intern negatief bewaard; de gebruiker ziet en voert altijd een positief bedrag in (Tranche 11 §11).
    const begrotingsbedrag = bestaandeRegel?.begrotingsbedrag !== null && bestaandeRegel?.begrotingsbedrag !== undefined ? (isOpbrengst ? bestaandeRegel.begrotingsbedrag.negated() : bestaandeRegel.begrotingsbedrag).toString() : "";
    const verwachtingWeergave = resterendeVerwachting !== null ? (isOpbrengst ? resterendeVerwachting.negated() : resterendeVerwachting).toString() : "";
    stuurHtml(res, 200, renderRenteForm({ categorie, actieUrl, terugUrl, begrotingsbedrag, beoordeeld: categorieState[categorie].beoordeeld, resterendeVerwachting: verwachtingWeergave }));
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
