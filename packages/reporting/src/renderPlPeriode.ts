import type Decimal from "decimal.js";
import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import type { PlPeriodePost } from "./plPeriodeBerekening.js";
import type { PlPeriodeInvoer } from "./types.js";

/**
 * HTML-renderer voor de resultatenrekening-periodesectie. Rendert
 * uitsluitend de al-berekende `PlPeriodeResultaat` (plPeriodeBerekening.ts)
 * — geen eigen berekeningen, geen eigen classificatie (CLAUDE.md, "rekenlaag
 * los van renderer/UI"). Rapportagecategorieën zijn vrije tekst (zie
 * `plPeriodeBerekening.ts`'s moduledoc: welke categorieën er zijn is niet
 * hardcoded) — er verschijnt daarom één tabel per categorie zoals
 * `categorieTotalen` die aanlevert, in die volgorde, nooit een aanname over
 * een vaste "Kosten"/"Opbrengsten"-indeling. Plus een altijd zichtbare
 * "Controle vereist"-sectie — nooit stilzwijgend weggelaten.
 */

function renderPostenTabel(categorie: string, posten: readonly PlPeriodePost[], totaal: Decimal): string {
  if (posten.length === 0) {
    return `
    <h2>${escapeHtml(categorie)}</h2>
    <div class="toelichting">Geen posten voor ${escapeHtml(categorie)} in deze periode.</div>`;
  }
  const rijen = posten.map((p) => `<tr><td>${escapeHtml(p.rapportagepost)}</td><td>${formatBedragHtml(p.bedrag)}</td></tr>`).join("");
  return `
    <h2>${escapeHtml(categorie)}</h2>
    <table>
      <thead><tr><th>Rapportagepost</th><th>Bedrag</th></tr></thead>
      <tbody>${rijen}<tr class="totaalrij"><td>Totaal ${escapeHtml(categorie)}</td><td>${formatBedragHtml(totaal)}</td></tr></tbody>
    </table>`;
}

function renderControleVereist(invoer: PlPeriodeInvoer): string {
  const { controleVereist } = invoer.resultaat;
  if (controleVereist.length === 0) {
    return `<div class="toelichting"><strong>Controle vereist:</strong> geen — alle rekeningen met een niet-nul saldo in deze periode zijn gemapt en verwerkt.</div>`;
  }
  const rijen = controleVereist
    .map((c) => `<tr><td>${escapeHtml(c.grootboekrekening)}</td><td>${formatBedragHtml(c.saldo)}</td><td>${escapeHtml(c.reden)}</td></tr>`)
    .join("");
  return `
    <h2>Controle vereist</h2>
    <div class="toelichting">
      Rekeningen met een niet-nul saldo in deze periode die (nog) niet volledig verwerkt konden worden in de
      resultatenrekening hierboven — nooit stilzwijgend weggelaten, ongemapte of onvolledige rekeningen blokkeren
      geen rapportage maar blijven zichtbaar.
    </div>
    <table>
      <thead><tr><th>Grootboekrekening</th><th>Saldo</th><th>Reden</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

/**
 * De resultatenrekening-sectie-HTML zonder document-skelet (geen
 * `<html>`/cover) — apart geëxporteerd zodat een gecombineerd rapport
 * (`renderRapportPeriode.ts`) deze sectie kan hergebruiken zonder de
 * opmaaklogica te dupliceren.
 */
export function renderPlPeriodeBody(invoer: PlPeriodeInvoer): string {
  const { categorieTotalen, posten } = invoer.resultaat;
  const tabellen =
    categorieTotalen.length === 0
      ? `<div class="toelichting">Geen resultaatposten in deze periode.</div>`
      : categorieTotalen
          .map((c) => renderPostenTabel(c.rapportagecategorie, posten.filter((p) => p.rapportagecategorie === c.rapportagecategorie), c.bedrag))
          .join("");

  return `
    <div class="toelichting" style="margin-bottom:24px">
      Resultatenrekening boekjaar ${invoer.boekjaar}, t/m boekperiode ${escapeHtml(invoer.boekperiodeTotEnMet)}: som van alle boekingen
      in deze periode per rapportagepost, op de goedgekeurde master+override-grootboekmapping.
    </div>
    ${tabellen}
    ${renderControleVereist(invoer)}`;
}

export function renderPlPeriodeHtml(invoer: PlPeriodeInvoer): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Resultatenrekening</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${invoer.boekjaar}, t/m periode ${escapeHtml(invoer.boekperiodeTotEnMet)} — gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  return renderRapportDocument(`Resultatenrekening — ${invoer.administratieNaam}`, cover, renderPlPeriodeBody(invoer));
}
