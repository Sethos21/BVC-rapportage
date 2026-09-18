import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RAPPORT_MODULE_IDS, renderSamengesteldRapportHtml, type RapportModuleId, type RapportSectie, type SamengesteldRapport } from "@bvc/reporting";
import { leesAdministratieConfig } from "./administratie.js";
import { administratieRapportenDir } from "./paths.js";
import { RAPPORT_MODULE_REGISTER, type RapportGenereerContext } from "./rapportModuleRegister.js";

/**
 * DELTA BUILD (2026-09-18) — "Selecteerbare samengestelde rapportgenerator
 * V1": de generieke ORCHESTRATIE — SELECTIE → module uitvoeren → bestaand
 * module-resultaat ontvangen → bestaande Body-renderer laten renderen →
 * secties samenvoegen. Bevat GEEN financiële/operationele berekening: elke
 * `genereer(...)`-aanroep gaat naar `RAPPORT_MODULE_REGISTER` (het ene
 * centrale uitbreidingspunt), dat op zijn beurt de bestaande, ongewijzigde
 * calculators/renderers aanroept.
 *
 * VOLGORDE IS ALTIJD `RAPPORT_MODULE_IDS` (registervolgorde), NOOIT de
 * volgorde waarin de gebruiker `--modules` opgaf — anders zou dezelfde
 * selectie in een andere geschreven volgorde een andere sectie-volgorde
 * opleveren, wat niet deterministisch genoeg is (sectie 5 van de opdracht).
 *
 * FOUT VS. ONBESCHIKBAAR: `RAPPORT_MODULE_REGISTER[id].genereer(...)` geeft
 * zelf `ONBESCHIKBAAR` terug voor een voorzienbaar ontbrekende verplichte
 * context — deze functie vangt daarnaast, PER MODULE APART, elke
 * ONVERWACHTE exceptie op (bv. ontbrekend cachebestand) als `FOUT`. Eén
 * mislukte/onbeschikbare GESELECTEERDE module stopt de andere geselecteerde
 * modules nooit (geen gedeelde try/catch over alle modules heen).
 */

export interface GenereerSamengesteldRapportOpties extends RapportGenereerContext {
  modules: readonly string[];
}

export interface GenereerSamengesteldRapportResultaat {
  html: string;
  pad: string;
  rapport: SamengesteldRapport;
}

function isRapportModuleId(waarde: string): waarde is RapportModuleId {
  return (RAPPORT_MODULE_IDS as readonly string[]).includes(waarde);
}

export function genereerSamengesteldRapport(root: string, administratieId: string, opties: GenereerSamengesteldRapportOpties): GenereerSamengesteldRapportResultaat {
  if (opties.modules.length === 0) {
    throw new Error("Minimaal één module selecteren via --modules (bv. --modules pnl,balans,huurders).");
  }

  const onbekend = opties.modules.filter((m) => !isRapportModuleId(m.toUpperCase()));
  if (onbekend.length > 0) {
    throw new Error(`Onbekende module-id('s): ${onbekend.join(", ")} — geldige waarden: ${RAPPORT_MODULE_IDS.join(", ").toLowerCase()}.`);
  }

  // Set dedupliceert automatisch een dubbele selectie (bv. "pnl,pnl,balans") — geen dubbele sectie.
  const geselecteerd = new Set<RapportModuleId>(opties.modules.map((m) => m.toUpperCase() as RapportModuleId));

  const config = leesAdministratieConfig(root, administratieId);
  const context: RapportGenereerContext = {
    boekjaar: opties.boekjaar,
    boekperiodeVan: opties.boekperiodeVan,
    boekperiodeTotEnMet: opties.boekperiodeTotEnMet,
    huurdersPeildatum: opties.huurdersPeildatum,
  };

  const secties: RapportSectie[] = RAPPORT_MODULE_IDS.map((id) => {
    const definitie = RAPPORT_MODULE_REGISTER[id];
    if (!geselecteerd.has(id)) {
      return { id, naam: definitie.naam, resultaat: { status: "NIET_GESELECTEERD" } };
    }
    try {
      const uitkomst = definitie.genereer(root, administratieId, context);
      if (uitkomst.status === "ONBESCHIKBAAR") {
        return { id, naam: definitie.naam, resultaat: { status: "ONBESCHIKBAAR", reden: uitkomst.reden } };
      }
      return uitkomst.onvolledig
        ? { id, naam: definitie.naam, resultaat: { status: "ONVOLLEDIG", html: uitkomst.html, toelichting: uitkomst.toelichting ?? "" } }
        : { id, naam: definitie.naam, resultaat: { status: "OPGENOMEN", html: uitkomst.html } };
    } catch (error) {
      return { id, naam: definitie.naam, resultaat: { status: "FOUT", foutmelding: error instanceof Error ? error.message : String(error) } };
    }
  });

  const periodeOmschrijving =
    opties.boekjaar !== undefined && opties.boekperiodeTotEnMet !== undefined
      ? `Boekjaar ${opties.boekjaar}${opties.boekperiodeVan !== undefined ? `, periode ${opties.boekperiodeVan} t/m ${opties.boekperiodeTotEnMet}` : `, t/m periode ${opties.boekperiodeTotEnMet}`}`
      : "Geen boekjaar/periode opgegeven — uitsluitend momentopname-modules kunnen dan beschikbaar zijn";

  const rapport: SamengesteldRapport = {
    context: { administratieNaam: config.weergavenaam, bedrijfsnr: config.bedrijfsnr, gegenereerdOp: new Date(), omschrijving: periodeOmschrijving },
    secties,
  };

  const html = renderSamengesteldRapportHtml(rapport);
  const rapportenDir = administratieRapportenDir(root, administratieId);
  mkdirSync(rapportenDir, { recursive: true });
  const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
  const periodeSuffix = opties.boekjaar !== undefined && opties.boekperiodeTotEnMet !== undefined ? `${opties.boekjaar}-${opties.boekperiodeTotEnMet}-` : "";
  const pad = join(rapportenDir, `rapport-samengesteld-${periodeSuffix}${tijdstempel}.html`);
  writeFileSync(pad, html, "utf-8");

  return { html, pad, rapport };
}
