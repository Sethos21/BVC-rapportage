import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lijstAdministraties, type AdministratieListItem } from "./administratie.js";
import { genereerManagementRapport } from "./genereerManagementRapport.js";
import { BOEKPERIODES, renderFoutPagina, renderSelectieScherm } from "./serveUi.js";

/**
 * Lokale webservermodus (`bvc-worker.exe serve`, v1, 2026-08-26) — dezelfde
 * standalone executable, geen Node/pnpm/runtime nodig op de doelmachine
 * (CLAUDE.md §5b). Orchestreert alleen: leest de administratielijst,
 * valideert server-side invoer, en roept voor rapportgeneratie RECHTSTREEKS
 * dezelfde `genereerManagementRapport()` aan die het CLI-commando
 * `management-rapport` ook gebruikt — geen tweede aanroeppad, geen nieuwe
 * financiële/vastgoed-/huur-/kasstroomlogica.
 *
 * Route-ontwerp met het oog op een latere geïntegreerde rapportageomgeving
 * (dashboard/V&W/balans/kasstroom/vastgoed&huur/controle-vereist als tabs):
 * `/rapport/management` is bewust NIET de enige mogelijke vorm — een
 * toekomstig rapportonderdeel krijgt een eigen sibling-route
 * (`/rapport/plperiode`, `/rapport/balans`, ...) volgens hetzelfde patroon,
 * zonder dat deze module herstructureerd hoeft te worden. Nog GEEN
 * navigatiebalk/tabs in v1 — terugnavigeren gaat via de browser (Terug-
 * knop of de link op de foutpagina), met opzet simpel gehouden.
 */

export interface ServeOpties {
  poort: number;
}

export interface RapportInvoerVelden {
  administratieId?: string;
  boekjaar?: string;
  boekperiodeTotEnMet?: string;
}

export type RapportInvoerValidatie =
  | { ok: true; administratieId: string; boekjaar: number; boekperiodeTotEnMet: string }
  | { ok: false; fouten: string[] };

const GELDIGE_PERIODES = new Set(BOEKPERIODES.map((p) => p.waarde));

/**
 * Server-side validatie — een ongeldige administratie/boekjaar/periode
 * bereikt `genereerManagementRapport()` nooit. Puur validatie, geen
 * berekening.
 */
export function valideerRapportInvoer(velden: RapportInvoerVelden, administraties: readonly AdministratieListItem[]): RapportInvoerValidatie {
  const fouten: string[] = [];

  const administratieId = (velden.administratieId ?? "").trim();
  if (!administratieId) {
    fouten.push("Kies een administratie.");
  } else if (!administraties.some((a) => a.administratieId === administratieId)) {
    fouten.push(`Onbekende administratie "${administratieId}".`);
  }

  const boekjaarStr = (velden.boekjaar ?? "").trim();
  const boekjaar = Number(boekjaarStr);
  if (!boekjaarStr || !Number.isInteger(boekjaar) || boekjaar < 2000 || boekjaar > 2100) {
    fouten.push("Boekjaar moet een geldig jaartal zijn (2000 t/m 2100).");
  }

  const boekperiodeTotEnMet = (velden.boekperiodeTotEnMet ?? "").trim();
  if (!GELDIGE_PERIODES.has(boekperiodeTotEnMet)) {
    fouten.push('Periode t/m moet "01" t/m "12" zijn.');
  }

  if (fouten.length > 0) return { ok: false, fouten };
  return { ok: true, administratieId, boekjaar, boekperiodeTotEnMet };
}

function leesBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf-8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function stuurHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handleRequest(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/") {
    stuurHtml(res, 200, renderSelectieScherm(lijstAdministraties(root)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/rapport/management") {
    const body = await leesBody(req);
    const velden = Object.fromEntries(new URLSearchParams(body)) as RapportInvoerVelden;
    const administraties = lijstAdministraties(root);
    const validatie = valideerRapportInvoer(velden, administraties);

    if (!validatie.ok) {
      stuurHtml(res, 400, renderSelectieScherm(administraties, { fouten: validatie.fouten, ingevoerd: velden }));
      return;
    }

    try {
      const resultaat = genereerManagementRapport(root, validatie.administratieId, {
        boekjaar: validatie.boekjaar,
        boekperiodeTotEnMet: validatie.boekperiodeTotEnMet,
      });
      stuurHtml(res, 200, resultaat.html);
    } catch (error) {
      stuurHtml(res, 500, renderFoutPagina("Rapport kon niet worden gegenereerd", error instanceof Error ? error.message : String(error)));
    }
    return;
  }

  stuurHtml(res, 404, renderFoutPagina("Niet gevonden", `Onbekende pagina: ${req.method ?? "GET"} ${url.pathname}`));
}

/** Bouwt de server (nog niet luisterend) — apart van `startServeServer` zodat tests een willekeurige/ephemere poort kunnen kiezen. */
export function maakServeServer(root: string): Server {
  return createServer((req, res) => {
    void handleRequest(root, req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) stuurHtml(res, 500, renderFoutPagina("Onverwachte fout", error instanceof Error ? error.message : String(error)));
    });
  });
}

function openBrowser(url: string): void {
  const commando =
    process.platform === "win32" ? (["cmd", ["/c", "start", "", url]] as const) : process.platform === "darwin" ? (["open", [url]] as const) : (["xdg-open", [url]] as const);
  execFile(commando[0], commando[1], () => {
    // Browser niet kunnen openen is geen fatale fout — de URL staat al in de consolemelding hierboven.
  });
}

/** Start de server op `127.0.0.1` (NOOIT `0.0.0.0`/alle interfaces — uitsluitend lokaal bereikbaar), opent de browser, en sluit netjes af op Ctrl+C (SIGINT). */
export function startServeServer(root: string, opties: ServeOpties): Server {
  const server = maakServeServer(root);
  server.listen(opties.poort, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${opties.poort}`;
    console.log(`BVC-rapportage draait op ${url} — sluit dit venster of druk Ctrl+C om te stoppen.`);
    openBrowser(url);
  });
  process.on("SIGINT", () => {
    console.log("\nAfsluiten…");
    server.close(() => process.exit(0));
  });
  return server;
}
