import { escapeHtml, formatBedragHtml } from "./huisstijl.js";
import type { DebiteurenAansluitingResultaat } from "./debiteurenAansluiting.js";

/**
 * Body-renderer voor de Debiteuren/Ouderdomsanalyse-sectie — rendert
 * UITSLUITEND een reeds aansluitende `DebiteurenAansluitingResultaat`
 * (zie `debiteurenAansluiting.ts`'s moduledoc: de Worker-registratie roept
 * dit alleen aan wanneer `sluitBinnenTolerantie` al `true` is; een niet-
 * aansluitende uitkomst toont deze sectie helemaal niet). Berekent zelf
 * niets, rendert puur.
 */
function renderKpiKaart(label: string, waardeHtml: string): string {
  return `
    <div class="card card-pad">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-val">${waardeHtml}</div>
    </div>`;
}

export function renderDebiteurenAansluitingBody(resultaat: DebiteurenAansluitingResultaat): string {
  const b = resultaat.buckets;
  return `
    <h2>Debiteuren / Ouderdomsanalyse</h2>
    <div class="toelichting" style="margin-bottom:16px">
      Ouderdomsanalyse-specificatie (bron: saldo_huurders) — getoond omdat het totaal aansluit op de balanspost
      Debiteuren binnen de bestaande tolerantie. De balans blijft financieel leidend; deze specificatie is
      uitsluitend een onderliggende controle.
    </div>
    <div class="grid g4">
      ${renderKpiKaart("Balans — Debiteuren", formatBedragHtml(resultaat.balansBedrag))}
      ${renderKpiKaart("Ouderdomsanalyse — totaal", formatBedragHtml(resultaat.ouderdomsanalyseBedrag))}
      ${renderKpiKaart("Verschil", formatBedragHtml(resultaat.verschil))}
    </div>
    <h3 class="serif" style="margin-top:24px">Ouderdomsopbouw (saldo_huurders)</h3>
    <table>
      <thead><tr><th>T/m 30 dagen</th><th>T/m 60 dagen</th><th>T/m 90 dagen</th><th>90+ dagen</th><th>Vooruitbetaling</th></tr></thead>
      <tbody>
        <tr>
          <td>${formatBedragHtml(b.tm30)}</td>
          <td>${formatBedragHtml(b.tm60)}</td>
          <td>${formatBedragHtml(b.tm90)}</td>
          <td>${formatBedragHtml(b.negentigPlus)}</td>
          <td>${formatBedragHtml(b.vooruitbetaling)}</td>
        </tr>
      </tbody>
    </table>`;
}
