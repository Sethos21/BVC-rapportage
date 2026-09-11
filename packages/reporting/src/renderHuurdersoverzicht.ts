import Decimal from "decimal.js";
import type { OnbekendOf } from "@bvc/domain";
import { escapeHtml, formatBedragHtml, formatM2Html, formatOnbekendOfHtml, renderRapportDocument } from "./huisstijl.js";
import type { ContracteindeStatus, HoLaatsteIndexatie, HoOpenstaandeCredit, HoVervallenPost, HuurdersoverzichtContractRegel, HuurdersoverzichtControleErnst, HuurdersoverzichtResultaat } from "./huurdersoverzicht.js";

/**
 * HTML-renderer voor Huurdersoverzicht v1 (2026-08-27) — rendert
 * UITSLUITEND het al-samengestelde `HuurdersoverzichtResultaat`
 * (`huurdersoverzicht.ts`), geen enkele berekening hier. Zelfstandig
 * document (eigen `renderHuurdersoverzichtHtml`), bewust GEEN onderdeel
 * van `renderManagementRapport.ts` en bewust GEEN gebruik van de grote
 * `.cover`-titelpagina-conventie van de lange rapporten — nog niet
 * besloten of dit later een sectie in het managementrapport wordt of een
 * aparte "Huurders"-tab, dus geen van beide aannames vastbakken.
 *
 * Twee presentatiekeuzes die zuivere weergave-logica zijn (geen nieuwe
 * business-/contractregel, werken uitsluitend op al-berekende velden):
 * - Resterende looptijd: `restlooptijdDagen` (bron, ongewijzigd) wordt
 *   getoond als `dagen / 365.25` afgerond op 1 decimaal ("3,4 jr"), met de
 *   exacte dagen als tooltip.
 * - Bruto €/m² is primair in de hoofdtabel; netto €/m² verschijnt alleen
 *   als kleine tweede regel wanneer de huurkorting > 0 is (bij 070: 2 van
 *   de 12 contracten).
 *
 * Complexomschrijving verschijnt uitsluitend als kleine, gedempte
 * aanduiding onder het complexnummer — nooit gebruikt om te sorteren of
 * te groeperen (complexnummer blijft de sorteersleutel).
 *
 * "Contractinformatie" (tweede tabel, 2026-08-28): Huurder/Unit/
 * Ingangsdatum/Waarborgsom/Laatste indexatie/Volgende indexeringsdatum.
 * "Laatste indexatie" toont compact `"pp-jjjj · +x,xx%"` (bv.
 * "07-2026 · +2,68%") — periode-jaar, NOOIT een dag-van-de-maand
 * verzinnen, en het al-berekende `effectiefPercentage` uit
 * `HuurdersoverzichtContractRegel.laatsteIndexatie` (nooit hier
 * herberekend). `"niet beschikbaar"` bij `laatsteIndexatie === null` — bv.
 * contract 0000000052, dat bewust geen historie van een ander
 * contractnummer overneemt. Contractnummer/huurdernummer/methode/
 * percentageconfiguratie/indextabel staan bewust NIET meer in deze tabel.
 *
 * **Openstaand-kolom (2026-09-01)** — hoofdtabel, laatste kolom:
 * `regel.openstaandSaldo` (al berekend in `huurdersoverzicht.ts`, UITSLUITEND
 * de som van dat ene contract se `Vordering_openstaand`, nooit het
 * huurderniveau-`saldo_huurders.Saldo`). `0`/geen openstaande posten toont
 * een rustige `—`; een credit (negatief saldo) via `formatBedragHtml`
 * (nooit `Math.abs()`). Geen uitgeklapte postenlijst in deze fase — alleen
 * het bedrag, met het aantal posten als tooltip.
 *
 * **Vervallen posten / Openstaande credits (2026-09-01)** — twee nieuwe
 * secties ONDER Contractinformatie, rendert uitsluitend resultaat.vervallenPosten/
 * resultaat.openstaandeCredits (al gesorteerd/geclassificeerd in
 * huurdersoverzicht.ts, geen logica hier). "Vervallen posten" toont altijd
 * de sectie, met een rustige melding bij een lege lijst (geen lege tabel).
 * "Openstaande credits" verschijnt UITSLUITEND als de lijst niet leeg is
 * (geen kopje, geen tabel bij nul credits). De gebruikte peildatum
 * (resultaat.vervallenPeildatum) staat expliciet bij "Vervallen posten" —
 * bewust een ander veld dan de Momentopname-badge hierboven (die toont
 * bronPeildatum, een andere bronstand, zie moduledoc huurdersoverzicht.ts).
 * Contractnummer/complex staan niet als kolom (compact houden) maar blijven
 * in het domeinresultaat voor een latere drill-down.
 */

function formatEurPerM2(waarde: Decimal): string {
  return `${formatBedragHtml(waarde)}/m²`;
}

function renderMomentopnameBadge(bronPeildatum: Date | null): string {
  const peildatumTekst = bronPeildatum ? escapeHtml(bronPeildatum.toISOString().slice(0, 10)) : "onbekend — geen eenduidige bronrapportagedatum";
  return `<span class="badge badge-momentopname" title="Actuele bronstand, geen boekjaar/periode-gebonden cijfer">Momentopname — bronPeildatum: ${peildatumTekst}</span>`;
}

function renderKpiKaart(label: string, waardeHtml: string): string {
  return `<div class="card card-pad"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-val">${waardeHtml}</div></div>`;
}

function renderRestlooptijdHtml(waarde: OnbekendOf<number>): string {
  if (waarde.type === "onbekend") {
    return `<span class="controle-vereist" title="${escapeHtml(waarde.reden)}">Controle vereist</span>`;
  }
  const jaren = (waarde.waarde / 365.25).toFixed(1).replace(".", ",");
  return `<span title="${waarde.waarde} dagen">${escapeHtml(jaren)} jr</span>`;
}

function renderStatusHtml(status: ContracteindeStatus): string {
  if (status === "GEEN_URGENTIE") return `<span class="badge badge-status-geen-urgentie">Geen urgentie</span>`;
  if (status === "AANDACHT") return `<span class="badge badge-status-aandacht">Aandacht</span>`;
  if (status === "VERLOOPT_BINNENKORT") return `<span class="badge badge-status-verloopt-binnenkort">Verloopt binnenkort</span>`;
  if (status === "EXPIRATIEDATUM_GEPASSEERD") {
    return `<span class="controle-vereist" title="Betekent NIET automatisch dat het contract is beëindigd — kan een optie-/verlengingspunt zijn, controle vereist.">Expiratiedatum gepasseerd</span>`;
  }
  return `<span class="ernst-informatief">Onbekend</span>`;
}

function renderComplexHtml(complexnummer: string | null, objectomschrijving: string | null): string {
  const nummer = complexnummer ? escapeHtml(complexnummer) : "—";
  const aanduiding = objectomschrijving ? `<div class="subtekst">${escapeHtml(objectomschrijving)}</div>` : "";
  return `<div>${nummer}</div>${aanduiding}`;
}

function renderEuroPerM2Html(regel: HuurdersoverzichtContractRegel): string {
  const bruto = formatOnbekendOfHtml(regel.huur.brutoHuurPerM2, formatEurPerM2);
  const kortingIsPositief = regel.huur.huurkorting.type === "bekend" && regel.huur.huurkorting.waarde.greaterThan(0);
  if (!kortingIsPositief) return `<div>${bruto}</div>`;
  const netto = formatOnbekendOfHtml(regel.huur.nettoHuurPerM2, formatEurPerM2);
  return `<div>${bruto}</div><div class="subtekst">netto ${netto}</div>`;
}

function renderKortingHtml(huurkorting: OnbekendOf<Decimal>): string {
  if (huurkorting.type === "onbekend") return formatOnbekendOfHtml(huurkorting, formatBedragHtml);
  if (huurkorting.waarde.isZero()) return `<span class="subtekst">—</span>`;
  return formatBedragHtml(huurkorting.waarde);
}

/** `—` bij geen openstaande posten; bedrag anders — negatief (credit) via `formatBedragHtml`, nooit Math.abs(). */
function renderOpenstaandHtml(regel: HuurdersoverzichtContractRegel): string {
  if (regel.openstaandSaldo.isZero()) return `<span class="subtekst">—</span>`;
  const titel = `${regel.aantalOpenstaandePosten} openstaande post${regel.aantalOpenstaandePosten === 1 ? "" : "en"}`;
  return `<span title="${escapeHtml(titel)}">${formatBedragHtml(regel.openstaandSaldo)}</span>`;
}

function renderHuurderHtml(regel: HuurdersoverzichtContractRegel, controleVereistPerContract: ReadonlyMap<string, readonly string[]>): string {
  const naam = regel.huurderNaam ? escapeHtml(regel.huurderNaam) : `<span class="subtekst">Onbekend</span>`;
  const berichten = controleVereistPerContract.get(regel.contractnummer);
  if (!berichten || berichten.length === 0) return naam;
  return `<span class="controle-vereist" title="${escapeHtml(berichten.join(" | "))}">${naam}</span>`;
}

function gesorteerdOpComplexEnContract(contracten: readonly HuurdersoverzichtContractRegel[]): HuurdersoverzichtContractRegel[] {
  return [...contracten].sort((a, b) => {
    const complex = (a.complexnummer ?? "").localeCompare(b.complexnummer ?? "");
    return complex !== 0 ? complex : a.contractnummer.localeCompare(b.contractnummer);
  });
}

function renderHoofdtabel(resultaat: HuurdersoverzichtResultaat): string {
  const controleVereistPerContract = new Map<string, string[]>();
  for (const item of resultaat.controleVereist) {
    if (item.contractnummer === null) continue;
    const lijst = controleVereistPerContract.get(item.contractnummer) ?? [];
    lijst.push(item.bericht);
    controleVereistPerContract.set(item.contractnummer, lijst);
  }

  const rijen = gesorteerdOpComplexEnContract(resultaat.contracten)
    .map(
      (r) => `<tr>
        <td>${renderHuurderHtml(r, controleVereistPerContract)}</td>
        <td>${renderComplexHtml(r.complexnummer, r.objectomschrijving)}</td>
        <td>${formatOnbekendOfHtml(r.huur.gehuurdOppervlak, formatM2Html)}</td>
        <td>${formatOnbekendOfHtml(r.huur.brutoJaarhuur, formatBedragHtml)}</td>
        <td>${renderKortingHtml(r.huur.huurkorting)}</td>
        <td>${formatOnbekendOfHtml(r.huur.nettoJaarhuur, formatBedragHtml)}</td>
        <td>${renderEuroPerM2Html(r)}</td>
        <td>${r.servicekostenvoorschotJaar !== null ? formatBedragHtml(r.servicekostenvoorschotJaar) : `<span class="subtekst">—</span>`}</td>
        <td>${r.contracteinde.expiratieExpiratiedatum ? escapeHtml(r.contracteinde.expiratieExpiratiedatum.toISOString().slice(0, 10)) : `<span class="subtekst">onbekend</span>`}</td>
        <td>${renderRestlooptijdHtml(r.restlooptijdDagen)}</td>
        <td>${renderStatusHtml(r.status)}</td>
        <td>${renderOpenstaandHtml(r)}</td>
      </tr>`,
    )
    .join("");

  const t = resultaat.portefeuilleTotalen;
  const totaalOpenstaand = resultaat.contracten.reduce((som, r) => som.plus(r.openstaandSaldo), new Decimal(0));
  const totaalrij = `<tr class="totaalrij">
    <td>Totaal</td>
    <td>${resultaat.contracten.length} contracten</td>
    <td>${formatOnbekendOfHtml(t.gehuurdOppervlak, formatM2Html)}</td>
    <td>${formatOnbekendOfHtml(t.brutoJaarhuur, formatBedragHtml)}</td>
    <td>${formatOnbekendOfHtml(t.huurkorting, formatBedragHtml)}</td>
    <td>${formatOnbekendOfHtml(t.nettoJaarhuur, formatBedragHtml)}</td>
    <td colspan="3"></td>
    <td>${totaalOpenstaand.isZero() ? `<span class="subtekst">—</span>` : formatBedragHtml(totaalOpenstaand)}</td>
  </tr>`;

  return `
    <table>
      <thead><tr>
        <th>Huurder</th><th>Complex</th><th>m²</th><th>Bruto jaarhuur</th><th>Korting</th>
        <th>Netto jaarhuur</th><th>€/m²</th><th>Servicekostenvoorschot</th><th>Expiratiedatum</th>
        <th>Resterend</th><th>Status</th><th>Openstaand</th>
      </tr></thead>
      <tbody>${rijen}</tbody>
      <tfoot>${totaalrij}</tfoot>
    </table>`;
}

/** `"07-2026 · +2,68%"` — periode-jaar (nooit een dag verzinnen) + effectief percentage met expliciet teken. `"niet beschikbaar"` als geen betrouwbare historische indexatie voor dit contract bestaat. */
function renderLaatsteIndexatieHtml(laatsteIndexatie: HoLaatsteIndexatie | null): string {
  if (laatsteIndexatie === null) return `<span class="subtekst">niet beschikbaar</span>`;
  const periodeJaar = `${escapeHtml(laatsteIndexatie.periode)}-${escapeHtml(laatsteIndexatie.jaar)}`;
  const teken = laatsteIndexatie.effectiefPercentage.greaterThan(0) ? "+" : "";
  const percentage = `${teken}${laatsteIndexatie.effectiefPercentage.toFixed(2).replace(".", ",")}%`;
  return `${periodeJaar} · ${escapeHtml(percentage)}`;
}

function renderContractinformatieTabel(resultaat: HuurdersoverzichtResultaat): string {
  const rijen = gesorteerdOpComplexEnContract(resultaat.contracten)
    .map(
      (r) => `<tr>
        <td>${r.huurderNaam ? escapeHtml(r.huurderNaam) : `<span class="subtekst">Onbekend</span>`}</td>
        <td>${r.unitnummer ? escapeHtml(r.unitnummer) : `<span class="subtekst">niet geregistreerd</span>`}</td>
        <td>${r.ingangsdatum ? escapeHtml(r.ingangsdatum.toISOString().slice(0, 10)) : "—"}</td>
        <td>${r.waarborgsom !== null ? formatBedragHtml(r.waarborgsom) : `<span class="subtekst">niet geregistreerd</span>`}</td>
        <td>${renderLaatsteIndexatieHtml(r.laatsteIndexatie)}</td>
        <td>${r.indexering.volgendeIndexeringsdatum ? escapeHtml(r.indexering.volgendeIndexeringsdatum.toISOString().slice(0, 10)) : "—"}</td>
      </tr>`,
    )
    .join("");
  return `
    <table>
      <thead><tr>
        <th>Huurder</th><th>Unit</th><th>Ingangsdatum</th><th>Waarborgsom</th>
        <th>Laatste indexatie</th><th>Volgende indexeringsdatum</th>
      </tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderVervallenPeildatumHtml(vervallenPeildatum: Date | null): string {
  const tekst = vervallenPeildatum ? escapeHtml(vervallenPeildatum.toISOString().slice(0, 10)) : "onbekend — geen peildatum opgegeven, zie Controle vereist";
  return `<div class="sec-sub">Peildatum vervallen-classificatie: ${tekst}</div>`;
}

function renderVervallenPostenTabel(vervallenPosten: readonly HoVervallenPost[]): string {
  if (vervallenPosten.length === 0) {
    return `<div class="toelichting">Geen vervallen posten.</div>`;
  }
  const rijen = vervallenPosten
    .map(
      (p) => `<tr>
        <td>${p.huurderNaam ? escapeHtml(p.huurderNaam) : `<span class="subtekst">Onbekend</span>`}</td>
        <td>${p.factuurnummer ? escapeHtml(p.factuurnummer) : "—"}</td>
        <td>${escapeHtml(p.periodeWeergave)}</td>
        <td>${escapeHtml(p.datumVordering.toISOString().slice(0, 10))}</td>
        <td>${p.dagenVervallen}</td>
        <td>${formatBedragHtml(p.openstaand)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table>
      <thead><tr><th>Huurder</th><th>Factuur</th><th>Periode</th><th>Datum</th><th>Dagen vervallen</th><th>Bedrag</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderOpenstaandeCreditsTabel(openstaandeCredits: readonly HoOpenstaandeCredit[]): string {
  if (openstaandeCredits.length === 0) return "";
  const rijen = openstaandeCredits
    .map(
      (c) => `<tr>
        <td>${c.huurderNaam ? escapeHtml(c.huurderNaam) : `<span class="subtekst">Onbekend</span>`}</td>
        <td>${c.factuurnummer ? escapeHtml(c.factuurnummer) : "—"}</td>
        <td>${c.omschrijving ? escapeHtml(c.omschrijving) : "—"}</td>
        <td>${escapeHtml(c.datumVordering.toISOString().slice(0, 10))}</td>
        <td>${formatBedragHtml(c.openstaand)}</td>
      </tr>`,
    )
    .join("");
  return `
    <h2 style="margin-top:32px">Openstaande credits</h2>
    <table>
      <thead><tr><th>Huurder</th><th>Factuur</th><th>Omschrijving</th><th>Datum</th><th>Bedrag</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderErnstHtml(ernst: HuurdersoverzichtControleErnst): string {
  const klasse = ernst === "KRITIEK" ? "ernst-kritiek" : ernst === "WAARSCHUWING" ? "ernst-waarschuwing" : "ernst-informatief";
  return `<span class="${klasse}">${escapeHtml(ernst)}</span>`;
}

function renderControleVereist(resultaat: HuurdersoverzichtResultaat): string {
  if (resultaat.controleVereist.length === 0) {
    return `<div class="toelichting"><strong>Geen</strong> — geen datakwaliteitspunten voor deze run.</div>`;
  }
  const rijen = resultaat.controleVereist
    .map((i) => `<tr><td>${i.contractnummer ? escapeHtml(i.contractnummer) : "—"}</td><td>${renderErnstHtml(i.ernst)}</td><td>${escapeHtml(i.bericht)}</td></tr>`)
    .join("");
  return `
    <table>
      <thead><tr><th>Contract</th><th>Ernst</th><th>Bericht</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

export function renderHuurdersoverzichtBody(administratieNaam: string, resultaat: HuurdersoverzichtResultaat): string {
  const t = resultaat.portefeuilleTotalen;
  return `
    <div class="sec-kicker">Huurdersoverzicht</div>
    <h2 class="sec-title" style="border-bottom:none;margin-top:7px">${escapeHtml(administratieNaam)}</h2>
    <div class="sec-sub">${renderMomentopnameBadge(resultaat.bronPeildatum)}</div>

    <div class="grid g4">
      ${renderKpiKaart("Bruto jaarhuur", formatOnbekendOfHtml(t.brutoJaarhuur, formatBedragHtml))}
      ${renderKpiKaart("Huurkorting", formatOnbekendOfHtml(t.huurkorting, formatBedragHtml))}
      ${renderKpiKaart("Netto jaarhuur", formatOnbekendOfHtml(t.nettoJaarhuur, formatBedragHtml))}
      ${renderKpiKaart("Gehuurde oppervlakte", formatOnbekendOfHtml(t.gehuurdOppervlak, formatM2Html))}
    </div>

    <h2 style="margin-top:32px">Contracten</h2>
    ${renderHoofdtabel(resultaat)}

    <h2 style="margin-top:32px">Contractinformatie</h2>
    <div class="toelichting" style="margin-bottom:8px">
      Aanvullende, minder frequent geraadpleegde velden per contract — complexnummer/aanduiding en
      huur-/looptijdcijfers staan in de tabel hierboven. "Laatste indexatie" toont maand-jaar en het
      zelf berekende effectieve percentage (nooit een dag verzonnen, nooit een "Waarde"-bronveld
      gebruikt) — "niet beschikbaar" als voor dit specifieke contractnummer geen betrouwbare
      historische indexatie bestaat.
    </div>
    ${renderContractinformatieTabel(resultaat)}

    <h2 style="margin-top:32px">Vervallen posten</h2>
    ${renderVervallenPeildatumHtml(resultaat.vervallenPeildatum)}
    ${renderVervallenPostenTabel(resultaat.vervallenPosten)}

    ${renderOpenstaandeCreditsTabel(resultaat.openstaandeCredits)}

    <h2 style="margin-top:32px">Controle vereist</h2>
    ${renderControleVereist(resultaat)}`;
}

export function renderHuurdersoverzichtHtml(administratieNaam: string, resultaat: HuurdersoverzichtResultaat): string {
  return renderRapportDocument(`Huurdersoverzicht — ${administratieNaam}`, "", renderHuurdersoverzichtBody(administratieNaam, resultaat));
}
