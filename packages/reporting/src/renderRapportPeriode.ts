import { escapeHtml, renderRapportDocument } from "./huisstijl.js";
import { renderBalansPeriodeBody } from "./renderBalansPeriode.js";
import { renderPlPeriodeBody } from "./renderPlPeriode.js";
import type { BalansPeriodeInvoer, PlPeriodeInvoer, RapportPeriodeInvoer } from "./types.js";

/**
 * Combineert de resultatenrekening (P&L) en de balans van dezelfde periode
 * in één rapport-HTML-document — de eerste "bruikbare" financiële
 * rapportage (geen losse CLI-JSON meer per onderdeel). Twee outputs van
 * dezelfde rekenlaag (`berekenPlPeriode`/`berekenBalansPeriode`,
 * CLAUDE.md §2), hier uitsluitend in de presentatielaag samengevoegd: geen
 * eigen berekening, geen eigen classificatie/tekenconventie. Hergebruikt
 * `renderPlPeriodeBody`/`renderBalansPeriodeBody` ongewijzigd — geen
 * gedupliceerde opmaaklogica, en de al-bewezen rekenlogica (zie de
 * 070_Rooise_Zoom-regressietest in `balansPeriodeBerekening.test.ts`) komt
 * hier niet in terecht.
 */
export function renderRapportPeriodeHtml(invoer: RapportPeriodeInvoer): string {
  const gedeeld = {
    administratieNaam: invoer.administratieNaam,
    bedrijfsnr: invoer.bedrijfsnr,
    boekjaar: invoer.boekjaar,
    boekperiodeTotEnMet: invoer.boekperiodeTotEnMet,
    gegenereerdOp: invoer.gegenereerdOp,
  };
  const plInvoer: PlPeriodeInvoer = { ...gedeeld, resultaat: invoer.plResultaat };
  const balansInvoer: BalansPeriodeInvoer = { ...gedeeld, resultaat: invoer.balansResultaat };

  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Financiële rapportage</h1>
      <div class="object">${escapeHtml(invoer.administratieNaam)} (Bedrijfsnr ${escapeHtml(invoer.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${invoer.boekjaar}, t/m periode ${escapeHtml(invoer.boekperiodeTotEnMet)} — gegenereerd op ${escapeHtml(invoer.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  const body = `
    <div class="sec-kicker">Onderdeel 1</div>
    <div class="sec-title">Resultatenrekening</div>
    ${renderPlPeriodeBody(plInvoer)}
    <div class="sec-kicker" style="margin-top:56px">Onderdeel 2</div>
    <div class="sec-title">Balans</div>
    ${renderBalansPeriodeBody(balansInvoer)}`;

  return renderRapportDocument(`Financiële rapportage — ${invoer.administratieNaam}`, cover, body);
}
