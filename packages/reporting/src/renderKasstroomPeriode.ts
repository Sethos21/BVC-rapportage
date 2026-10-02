import { escapeHtml, formatBedragHtml, renderRapportDocument } from "./huisstijl.js";
import type { KasstroomPeriodeInvoer } from "./types.js";

/**
 * HTML-renderer voor de kasstroom-periodesectie (eerste, eenvoudige versie:
 * alleen mutatie bankstand). Rendert uitsluitend de al-berekende
 * `KasstroomPeriodeResultaat` (kasstroomBerekening.ts) — geen eigen
 * berekening, geen eigen classificatie. Toont per liquide-middelen-
 * rekening beginstand/mutatie/eindstand, de totalen, en een altijd
 * zichtbare "Controle vereist"-sectie — nooit stilzwijgend weggelaten.
 */

function renderControleVereist(invoer: KasstroomPeriodeInvoer): string {
  const { controleVereist } = invoer.resultaat;
  if (controleVereist.length === 0) {
    return `<div class="toelichting"><strong>Controle vereist:</strong> geen — alle rekeningen met een niet-nul mutatie in deze periode zijn als liquide middelen of bewust niet-liquide verwerkt.</div>`;
  }
  const rijen = controleVereist
    .map((c) => `<tr><td>${escapeHtml(c.grootboekrekening)}</td><td>${formatBedragHtml(c.saldo)}</td><td>${escapeHtml(c.reden)}</td></tr>`)
    .join("");
  return `
    <h2>Controle vereist</h2>
    <div class="toelichting">
      Rekeningen met een niet-nul mutatie in deze periode die (nog) niet als liquide middelen verwerkt konden worden
      — nooit stilzwijgend weggelaten, ongemapte of onvolledige rekeningen blokkeren geen rapportage maar blijven zichtbaar.
    </div>
    <table>
      <thead><tr><th>Grootboekrekening</th><th>Mutatie in periode</th><th>Reden</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

export function renderKasstroomPeriodeBody(invoer: KasstroomPeriodeInvoer): string {
  const { rekeningen, beginstandTotaal, mutatieTotaal, eindstandTotaal } = invoer.resultaat;

  const tabel =
    rekeningen.length === 0
      ? `<div class="toelichting">Geen liquide-middelen-rekeningen bevestigd voor deze periode.</div>`
      : `
    <table>
      <thead><tr><th>Grootboekrekening</th><th>Omschrijving</th><th>Beginstand</th><th>Mutatie</th><th>Eindstand</th></tr></thead>
      <tbody>${rekeningen
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.grootboekrekening)}</td><td>${escapeHtml(r.omschrijving ?? "–")}</td><td>${formatBedragHtml(r.beginbalans)}</td><td>${formatBedragHtml(r.mutatie)}</td><td>${formatBedragHtml(r.eindstand)}</td></tr>`,
        )
        .join("")}<tr class="totaalrij"><td colspan="2">Totaal liquide middelen</td><td>${formatBedragHtml(beginstandTotaal)}</td><td>${formatBedragHtml(mutatieTotaal)}</td><td>${formatBedragHtml(eindstandTotaal)}</td></tr></tbody>
    </table>`;

  return `
    <div class="toelichting" style="margin-bottom:24px">
      Mutatie bankstand boekjaar ${invoer.boekjaar}, t/m boekperiode ${escapeHtml(invoer.boekperiodeTotEnMet)}: beginbalans + boekingen
      t/m die periode, uitsluitend voor rekeningen die expliciet als liquide middelen bevestigd zijn. Een eerste, eenvoudige
      kasstroomweergave — nog geen volledige indirecte kasstroomopbouw uit resultaat en mutaties.
    </div>
    ${tabel}
    ${renderControleVereist(invoer)}`;
}

export function renderKasstroomPeriodeHtml(invoer: KasstroomPeriodeInvoer): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Kasstroom</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${invoer.boekjaar}, t/m periode ${escapeHtml(invoer.boekperiodeTotEnMet)} — gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  return renderRapportDocument(`Kasstroom — ${invoer.administratieNaam}`, cover, renderKasstroomPeriodeBody(invoer));
}
