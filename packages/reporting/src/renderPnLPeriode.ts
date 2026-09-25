import type Decimal from "decimal.js";
import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import type { PnLBronBijdrage, PnLDekkingReden, PurePnLBovenEbitdaRegel, PurePnLOnderEbitdaRegel, PurePnLResultaat, PurePnLSubtotaal } from "./pnlEngine.js";
import type { PnLNietMeegenomenGroep } from "./pnlPeriodeOrchestratie.js";
import type { PnLEconomischeModule } from "./pnlBronmapping.js";

/**
 * DELTA BUILD (2026-09-18) — "Pure P&L → Worker + Renderer": DE HTML-
 * renderer voor `PurePnLResultaat` (`pnlEngine.ts`, commit d25783e) +
 * `berekenPnLPeriode`'s (`pnlPeriodeOrchestratie.ts`) diagnostische
 * `nietMeegenomen`-lijst. Rendert UITSLUITEND de al-berekende uitkomst —
 * GEEN eigen optelling, GEEN eigen classificatie, GEEN herberekening van
 * Totaal opbrengsten/Totaal kosten/EBITDA (die komen 1-op-1 uit
 * `resultaat.totaalOpbrengsten`/`resultaat.totaalKosten`/`resultaat.ebitda`).
 * Zelfde architectuurprincipe als de bestaande `renderPlPeriode.ts`
 * ("rekenlaag los van renderer/UI"), en hergebruikt dezelfde huisstijl-
 * primitieven (`escapeHtml`/`formatBedragHtml`/`renderRapportDocument`).
 *
 * PRESENTATIELABELS (Laag C, zie `pnlEngine.ts`'s moduledoc: "bestaat hier
 * NIET" — deze renderer is de EERSTE, minimale plek die canon-`regelSleutel`
 * naar een leesbaar label vertaalt). `LABEL_PER_REGELSLEUTEL` dekt de
 * regelSleutels van de acht bestaande productieketens; een onbekende sleutel
 * krijgt een gehumaniseerde fallback (underscores -> spaties, title case) —
 * NOOIT een lege/verborgen regel, want een regel die de Pure P&L Engine wél
 * teruggeeft moet altijd zichtbaar blijven, ook zonder mooi label.
 *
 * COMPLETENESS/UNKNOWN (CLAUDE.md §6, GAT-001B §5): een `ONBEKEND`-regel
 * wordt NOOIT als €0 of als lege cel getoond — altijd expliciet
 * "Onbekend" + de `toelichting`. Een subtotaal met `volledigheid.status
 * === "ONVOLLEDIG"` toont een aparte, duidelijke waarschuwing bovenop het
 * "beste weten"-totaal — dat totaal wordt nooit stilzwijgend gepresenteerd
 * als "het" volledige bedrag.
 *
 * `nietMeegenomen` (boekingen buiten de acht productieketens — niet-gemapt
 * of een wel bestaand maar nog niet aangesloten hoofddomein zoals Rente/
 * BTW/Waardering) krijgt een eigen, aparte sectie NA de P&L-boom — NOOIT
 * verwerkt als een fictieve boven/onder-EBITDA-regel (de orchestratielaag
 * construeert die immers zelf ook niet, zie `pnlPeriodeOrchestratie.ts`).
 * Alleen getoond als de lijst niet leeg is.
 */

const LABEL_PER_REGELSLEUTEL: Record<string, string> = {
  HUUROPBRENGST_BELAST: "Huuropbrengst belast",
  HUUROPBRENGST_ONBELAST: "Huuropbrengst onbelast",
  VERLEENDE_HUURKORTING: "Verleende huurkorting",
  BEHEERKOSTEN: "Beheer",
  MANAGEMENTVERGOEDING: "Management",
  MANAGEMENT_NIET_GECLASSIFICEERD: "Management — niet geclassificeerd",
  ONDERHOUD_GEBOUWEN: "Onderhoud gebouwen",
  ONDERHOUD_TERREIN: "Onderhoud terrein",
  ONDERHOUD_INSTALLATIES: "Onderhoud installaties",
  ONDERHOUD_NIET_GECLASSIFICEERD: "Onderhoud — niet geclassificeerd",
  SERVICEKOSTEN_EIGENAAR_REGULIER: "Servicekosten eigenaar",
  SERVICEKOSTEN_LEEGSTAND: "Servicekosten eigenaar — leegstand",
  SERVICEKOSTEN_EIGENAAR_NIET_GECLASSIFICEERD: "Servicekosten eigenaar — niet geclassificeerd",
  BRAND_OPSTALVERZEKERING: "Verzekeringen (brand-/opstalverzekering)",
  VERZEKERINGEN_NIET_GECLASSIFICEERD: "Verzekeringen — niet geclassificeerd",
  GEMEENTELIJKE_LASTEN: "Gemeentelijke lasten",
  GEMEENTELIJKE_LASTEN_NIET_GECLASSIFICEERD: "Gemeentelijke lasten — niet geclassificeerd",
  ACCOUNTANT: "Algemene kosten — accountant",
  ALGEMENE_KOSTEN: "Algemene kosten — overig",
  JURIDISCHE_KOSTEN: "Algemene kosten — juridische kosten",
  MAKELAARSKOSTEN: "Algemene kosten — makelaarskosten",
  BANKKOSTEN: "Algemene kosten — bankkosten",
};

const LABEL_PER_ECONOMISCHE_MODULE: Record<PnLEconomischeModule, string> = {
  HUUR: "Huur",
  BEHEER: "Beheer",
  MANAGEMENT: "Management",
  ONDERHOUD: "Onderhoud",
  LEEGSTAND: "Leegstand",
  SERVICEKOSTEN_EIGENAAR: "Servicekosten eigenaar",
  VERZEKERINGEN: "Verzekeringen",
  GEMEENTELIJKE_LASTEN: "Gemeentelijke lasten",
  ALGEMENE_KOSTEN: "Algemene kosten",
  RENTE: "Rente",
  VERKOOP: "Verkoop",
  NIET_VERREKENBARE_BTW: "Niet-verrekenbare btw",
  WAARDERING: "Waardering",
  ADMINISTRATIEKOSTEN_DOORBELASTING: "Administratiekosten-doorbelasting",
};

function humaniseer(regelSleutel: string): string {
  return regelSleutel
    .toLowerCase()
    .split("_")
    .map((deel) => deel.charAt(0).toUpperCase() + deel.slice(1))
    .join(" ");
}

function label(regelSleutel: string): string {
  return LABEL_PER_REGELSLEUTEL[regelSleutel] ?? humaniseer(regelSleutel);
}

const DEKKING_REDEN_TEKST: Record<PnLDekkingReden, string> = {
  NIET_GEMAPT: "niet gemapt",
  TECHNISCH_NIET_ONDERSTEUND: "technisch nog niet ondersteund",
  GEEN_BEOORDELING: "brondekking niet bevestigd",
};

function renderBedragCel(waarde: PnLBronBijdrage): string {
  if (waarde.status === "ONBEKEND") {
    return `<span class="negatief">Onbekend (${escapeHtml(DEKKING_REDEN_TEKST[waarde.dekkingReden])})</span>`;
  }
  return formatBedragHtml(waarde.bedrag);
}

function renderRegelsTabel(regels: readonly (PurePnLBovenEbitdaRegel | PurePnLOnderEbitdaRegel)[]): string {
  if (regels.length === 0) {
    return `<div class="toelichting">Geen posten.</div>`;
  }
  const rijen = regels.map((r) => `<tr><td>${escapeHtml(label(r.regelSleutel))}</td><td>${renderBedragCel(r.waarde)}</td></tr>`).join("");
  return `<table><tbody>${rijen}</tbody></table>`;
}

function renderVolledigheidWaarschuwing(subtotaal: PurePnLSubtotaal): string {
  if (subtotaal.volledigheid.status === "VOLLEDIG") return "";
  const rijen = subtotaal.volledigheid.ontbrekend
    .map((o) => `<tr><td>${escapeHtml(label(o.regelSleutel))}</td><td>${escapeHtml(DEKKING_REDEN_TEKST[o.reden])}</td><td>${escapeHtml(o.toelichting)}</td></tr>`)
    .join("");
  return `
    <div class="toelichting"><strong>Let op — dit subtotaal is ONVOLLEDIG:</strong> het bedrag hierboven is uitsluitend de som van de BEKENDE posten ("beste weten"-som), NOOIT het volledige, gegarandeerde totaal.</div>
    <table>
      <thead><tr><th>Post</th><th>Reden</th><th>Toelichting</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderSubtotaalRij(label_: string, subtotaal: PurePnLSubtotaal): string {
  const cel =
    subtotaal.volledigheid.status === "ONVOLLEDIG"
      ? `<span class="negatief">Onvolledig — beste weten: ${formatBedragHtml(subtotaal.besteWetenSom)}</span>`
      : formatBedragHtml(subtotaal.besteWetenSom);
  return `<tr class="totaalrij"><td>${escapeHtml(label_)}</td><td>${cel}</td></tr>`;
}

function renderNietMeegenomen(nietMeegenomen: readonly PnLNietMeegenomenGroep[]): string {
  if (nietMeegenomen.length === 0) return "";
  const rijen = nietMeegenomen
    .map((g) => {
      const omschrijving = g.economischeModule === null ? "Niet gemapt (grootboekrekening/OGB-kostensoort onbekend bij de centrale mapping)" : `${escapeHtml(LABEL_PER_ECONOMISCHE_MODULE[g.economischeModule])} — wel gemapt, nog geen productie-adapter in dit rapport`;
      return `<tr><td>${omschrijving}</td><td>${formatBedragHtml(g.totaal)}</td><td>${g.aantalBoekingen}</td></tr>`;
    })
    .join("");
  return `
    <h2>Niet meegenomen in dit rapport</h2>
    <div class="toelichting">
      Deze boekingen zijn WEL in de bron aangetroffen, maar (nog) niet in de resultatenrekening hierboven verwerkt —
      nooit stilzwijgend weggelaten of als €0 behandeld. Dit blokkeert de rapportage niet, maar maakt de P&L
      hierboven per definitie niet 100% dekkend voor de volledige bron.
    </div>
    <table>
      <thead><tr><th>Categorie</th><th>Totaal saldo</th><th>Aantal boekingen</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

export interface PnLPeriodeRenderInvoer {
  administratieNaam: string;
  bedrijfsnr: string;
  boekjaar: number;
  boekperiodeVan?: string;
  boekperiodeTotEnMet: string;
  gegenereerdOp: Date;
  resultaat: PurePnLResultaat;
  nietMeegenomen: readonly PnLNietMeegenomenGroep[];
}

export function renderPnLPeriodeBody(invoer: PnLPeriodeRenderInvoer): string {
  const { resultaat } = invoer;

  return `
    <div class="toelichting" style="margin-bottom:24px">
      Winst- en verliesrekening (Pure P&L Engine), boekjaar ${invoer.boekjaar}${invoer.boekperiodeVan ? `, periode ${escapeHtml(invoer.boekperiodeVan)} t/m ${escapeHtml(invoer.boekperiodeTotEnMet)}` : `, t/m boekperiode ${escapeHtml(invoer.boekperiodeTotEnMet)}`}:
      som van reeds economisch geclassificeerde boekingen per canon-P&L-post. Waardesoort: ${escapeHtml(resultaat.waardesoort)}.
    </div>

    <h2>Opbrengsten</h2>
    ${renderRegelsTabel(resultaat.totaalOpbrengsten.regels)}
    <table><tbody>${renderSubtotaalRij("Totaal exploitatie-opbrengsten", resultaat.totaalOpbrengsten)}</tbody></table>
    ${renderVolledigheidWaarschuwing(resultaat.totaalOpbrengsten)}

    <h2>Exploitatiekosten</h2>
    ${renderRegelsTabel(resultaat.totaalKosten.regels)}
    <table><tbody>${renderSubtotaalRij("Totaal exploitatiekosten", resultaat.totaalKosten)}</tbody></table>
    ${renderVolledigheidWaarschuwing(resultaat.totaalKosten)}

    <h2>EBITDA</h2>
    <table><tbody><tr class="totaalrij"><td>EBITDA</td><td>${resultaat.ebitda.volledigheid.status === "ONVOLLEDIG" ? `<span class="negatief">Onvolledig — beste weten: ${formatBedragHtml(resultaat.ebitda.bedrag)}</span>` : formatBedragHtml(resultaat.ebitda.bedrag)}</td></tr></tbody></table>
    ${resultaat.ebitda.volledigheid.status === "ONVOLLEDIG" ? `<div class="toelichting"><strong>Let op:</strong> EBITDA hierboven is een "beste weten"-EBITDA — Totaal opbrengsten en/of Totaal kosten zijn (nog) niet volledig, zie de waarschuwingen hierboven.</div>` : ""}

    <h2>Onder EBITDA</h2>
    ${renderRegelsTabel(resultaat.onderEbitda)}

    ${renderNietMeegenomen(invoer.nietMeegenomen)}`;
}

export function renderPnLPeriodeHtml(invoer: PnLPeriodeRenderInvoer): string {
  const periodeTekst = invoer.boekperiodeVan ? `periode ${invoer.boekperiodeVan} t/m ${invoer.boekperiodeTotEnMet}` : `t/m periode ${invoer.boekperiodeTotEnMet}`;
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Winst- en verliesrekening</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${invoer.boekjaar}, ${escapeHtml(periodeTekst)} — gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  return renderRapportDocument(`Winst- en verliesrekening — ${invoer.administratieNaam}`, cover, renderPnLPeriodeBody(invoer));
}
