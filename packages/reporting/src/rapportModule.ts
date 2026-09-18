import { escapeHtml, renderRapportDocument } from "./huisstijl.js";

/**
 * DELTA BUILD (2026-09-18) — "Selecteerbare samengestelde rapportgenerator
 * V1": de kleinst mogelijke, generieke bouwstenen om meerdere reeds
 * bestaande, ZELFSTANDIGE rapportmodules (Pure P&L, Balans,
 * Huurdersoverzicht — later eenvoudig uit te breiden) samen te voegen tot
 * één document, ZONDER dat deze laag ooit een financiële of operationele
 * waarde zelf berekent.
 *
 * Deze module kent GEEN specifieke rapportmodule (geen import van
 * `pnlPeriodeOrchestratie.ts`/`balansPeriodeBerekening.ts`/
 * `huurdersoverzicht.ts`) — ze weet uitsluitend hoe een reeds gerenderde
 * sectie-HTML-string, met een expliciete status, in één documentskelet
 * wordt geplaatst. De koppeling "welke module levert welke sectie" is de
 * verantwoordelijkheid van het module-REGISTER (`apps/worker`'s
 * `rapportModuleRegister.ts`) — bewust NIET hier, want dat register moet
 * I/O (bron/cache/mapping-database) aanroepen, wat deze package (pure
 * presentatielaag, CLAUDE.md §2) niet hoort te doen.
 *
 * VIJF EXPLICIET GESCHEIDEN STATUSSEN (nooit door elkaar gehaald):
 *  - `NIET_GESELECTEERD`: gebruikerskeuze — de module is niet uitgevoerd,
 *    draagt GEEN html, wordt door de renderer NIET getoond (maar blijft wel
 *    traceerbaar aanwezig in `SamengesteldRapport.secties`, zodat achteraf
 *    duidelijk is welke modules beschikbaar wáren).
 *  - `ONBESCHIKBAAR`: WEL geselecteerd, maar de module kon niet worden
 *    geleverd (bv. ontbrekende verplichte context) — nooit als €0/lege
 *    sectie gepresenteerd, altijd met een zichtbare, expliciete reden.
 *  - `FOUT`: technische generatie is mislukt (onverwachte uitzondering) —
 *    zelfde zichtbaarheidseis als ONBESCHIKBAAR, apart gelabeld zodat een
 *    "verwachte" onbeschikbaarheid nooit met een echte bug wordt verward.
 *  - `ONVOLLEDIG`: de module IS geleverd en gerenderd (html aanwezig), maar
 *    de module zelf meldt een inhoudelijke completeness-waarschuwing (bv.
 *    Pure P&L's `ebitda.volledigheid === "ONVOLLEDIG"`, Balans'
 *    `controleVereist`/`aansluiting`). De sectie-inhoud zelf toont dat detail
 *    al (bestaande renderers doen dat al) — deze status maakt het bovendien
 *    zichtbaar op rapportniveau, zonder de sectie te verbergen.
 *  - `OPGENOMEN`: geleverd, gerenderd, geen gemelde completeness-waarschuwing.
 *
 * Eén onbeschikbare/foutieve GESELECTEERDE module blokkeert de andere
 * geselecteerde modules NOOIT (`genereerSamengesteldRapport.ts` roept elke
 * module apart aan en vangt fouten per module af) — een echte inhoudelijke
 * afhankelijkheid tussen modules bestaat in V1 niet (P&L/Balans/Huurders
 * zijn onderling onafhankelijk, zie de architectuurinvariant).
 */

export const RAPPORT_MODULE_IDS = ["PNL", "BALANS", "HUURDERS", "KASSTROOM", "VASTGOED_KPI", "CONTROLES", "RENTROLL", "SERVICEKOSTEN"] as const;
export type RapportModuleId = (typeof RAPPORT_MODULE_IDS)[number];

export type RapportSectieStatus =
  | { status: "NIET_GESELECTEERD" }
  | { status: "ONBESCHIKBAAR"; reden: string }
  | { status: "FOUT"; foutmelding: string }
  | { status: "ONVOLLEDIG"; html: string; toelichting: string }
  | { status: "OPGENOMEN"; html: string };

export interface RapportSectie {
  id: RapportModuleId;
  naam: string;
  resultaat: RapportSectieStatus;
}

export interface SamengesteldRapportContext {
  administratieNaam: string;
  bedrijfsnr: string;
  gegenereerdOp: Date;
  /** Puur informatief voor de cover — de daadwerkelijke periode/peildatum per sectie staat (waar relevant) al in de sectie-inhoud zelf, nooit hier herhaald/afgeleid. */
  omschrijving: string;
}

export interface SamengesteldRapport {
  context: SamengesteldRapportContext;
  /** Vaste `RAPPORT_MODULE_IDS`-volgorde — NOOIT de volgorde waarin de gebruiker ze opgaf (dat zou dezelfde selectie in een andere volgorde een andere sectie-volgorde geven, niet deterministisch genoeg). */
  secties: readonly RapportSectie[];
}

function renderStatusblok(naam: string, tekst: string, klasse: string): string {
  return `<h2>${escapeHtml(naam)}</h2><div class="toelichting"><span class="${klasse}">${escapeHtml(tekst)}</span></div>`;
}

function renderSectie(sectie: RapportSectie): string {
  switch (sectie.resultaat.status) {
    case "NIET_GESELECTEERD":
      return ""; // bewust geen output — niet geselecteerd is geen rapportgebeurtenis om te tonen.
    case "ONBESCHIKBAAR":
      return renderStatusblok(sectie.naam, `Onbeschikbaar — ${sectie.resultaat.reden}`, "ernst-kritiek");
    case "FOUT":
      return renderStatusblok(sectie.naam, `Genereren mislukt — ${sectie.resultaat.foutmelding}`, "ernst-kritiek");
    case "ONVOLLEDIG":
      return `<div class="toelichting" style="margin-bottom:8px"><span class="ernst-waarschuwing">Onvolledig — ${escapeHtml(sectie.resultaat.toelichting)}</span></div>${sectie.resultaat.html}`;
    case "OPGENOMEN":
      return sectie.resultaat.html;
  }
}

/**
 * DE samengestelde renderer — plaatst uitsluitend de al-gerenderde
 * sectie-HTML's van geselecteerde/geslaagde modules in ÉÉN documentskelet
 * (hergebruikt `renderRapportDocument`, dezelfde huisstijl als elk
 * standalone rapport). Berekent, classificeert of herformatteert NOOIT
 * enige module-inhoud — puur samenvoegen.
 */
export function renderSamengesteldRapportHtml(rapport: SamengesteldRapport): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Samengesteld rapport</h1>
      <div class="object">${escapeHtml(rapport.context.administratieNaam)} (Bedrijfsnr ${escapeHtml(rapport.context.bedrijfsnr)})</div>
      <div class="periode">${escapeHtml(rapport.context.omschrijving)} — gegenereerd op ${escapeHtml(rapport.context.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  const body = rapport.secties.map(renderSectie).filter((html) => html.length > 0).join("\n");

  return renderRapportDocument(`Samengesteld rapport — ${rapport.context.administratieNaam}`, cover, body);
}
