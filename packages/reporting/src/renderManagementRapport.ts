import type Decimal from "decimal.js";
import { formatEUR, type OnbekendOf } from "@bvc/domain";
import { escapeHtml, formatBedragHtml, formatM2Html, formatOnbekendOfHtml, formatPercentageHtml, renderRapportDocument } from "./huisstijl.js";
import type { ManagementRapportControleItem, ManagementRapportResultaat } from "./managementRapport.js";
import type { HuurComplexKpi } from "./huurKerncijfers.js";
import type { VastgoedComplexKpi } from "./vastgoedKerncijfers.js";
import type {
  ServicekostenActuelePositieStatus,
  ServicekostenActueleComplexTotaal,
  ServicekostenAfrekeningComplexTotaal,
  ServicekostenAfrekeningContractHuurderTotaal,
} from "./servicekostenPositie.js";

/**
 * HTML-renderer voor de gecombineerde managementrapportage (v1,
 * 2026-08-26; periode-van uitgebreid 2026-08-26). Rendert UITSLUITEND het
 * al-samengestelde `ManagementRapportResultaat` (`managementRapport.ts`) —
 * geen enkele berekening hier, alleen presentatie.
 *
 * Belangrijk (expliciet verzoek gebruiker): "resultaat periode X-Y" en
 * "resultaat huidig boekjaar YTD t/m Y" mogen NOOIT onder hetzelfde label
 * verschijnen. Elke KPI-kaart in sectie 1 draagt daarom een zichtbare
 * periodebadge ("Periode X t/m Y" vs "Stand/YTD t/m Y"), en de twee
 * groepen staan ook visueel als aparte blokken.
 */

function renderKpiKaart(label: string, waardeHtml: string, subHtml = ""): string {
  return `
    <div class="card card-pad">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-val">${waardeHtml}</div>
      ${subHtml ? `<div class="kpi-sub">${subHtml}</div>` : ""}
    </div>`;
}

function renderMomentopnameBadge(bronPeildatum: Date | null): string {
  const peildatumTekst = bronPeildatum ? escapeHtml(bronPeildatum.toISOString().slice(0, 10)) : "onbekend — geen eenduidige bronrapportagedatum";
  return `<span class="badge badge-momentopname" title="Actuele bronstand, geen boekjaar/periode-gebonden cijfer">Momentopname — bronPeildatum: ${peildatumTekst}</span>`;
}

function renderPeriodeBadge(boekperiodeVan: string, boekperiodeTotEnMet: string): string {
  return `<span class="badge badge-periode" title="Uitsluitend deze periode, geen jaar-tot-datum">Periode ${escapeHtml(boekperiodeVan)} t/m ${escapeHtml(boekperiodeTotEnMet)}</span>`;
}

function renderStandBadge(boekperiodeTotEnMet: string): string {
  return `<span class="badge badge-stand" title="Boekjaar 01 t/m deze periode, ongeacht de geselecteerde periode-vanaf">Stand/YTD t/m periode ${escapeHtml(boekperiodeTotEnMet)}</span>`;
}

// --- 1. Managementsamenvatting -------------------------------------------------

function renderManagementsamenvatting(resultaat: ManagementRapportResultaat): string {
  const p = resultaat.periode;
  const s = resultaat.stand;
  const k = p.kasstroom;
  return `
    <h2>1. Managementsamenvatting</h2>

    <div class="toelichting" style="margin-bottom:8px">${renderPeriodeBadge(p.boekperiodeVan, p.boekperiodeTotEnMet)}</div>
    <div class="grid g4">
      ${renderKpiKaart("Totale opbrengsten", formatBedragHtml(p.totaleOpbrengsten))}
      ${renderKpiKaart("Totale kosten", formatBedragHtml(p.totaleKosten))}
      ${renderKpiKaart("Resultaat (periode)", formatOnbekendOfHtml(p.resultaatPeriode, formatBedragHtml))}
      ${renderKpiKaart("Ontvangsten", formatBedragHtml(k.ontvangsten))}
    </div>
    <div class="grid g4" style="margin-top:16px">
      ${renderKpiKaart("Uitgaven", formatBedragHtml(k.uitgaven))}
      ${renderKpiKaart("Netto kasstroom (periode)", formatBedragHtml(k.nettoKasstroom))}
      ${renderKpiKaart("Eigenaaronttrekkingen (periode)", formatBedragHtml(k.eigenaarOnttrekkingen))}
    </div>

    <div class="toelichting" style="margin:24px 0 8px">${renderStandBadge(s.boekperiodeTotEnMet)}</div>
    <div class="grid g4">
      ${renderKpiKaart("Bankstand einde", formatBedragHtml(s.bankstandEinde))}
      ${renderKpiKaart("Resultaat huidig boekjaar (YTD)", formatOnbekendOfHtml(s.resultaatHuidigBoekjaarYtd, formatBedragHtml))}
      ${renderKpiKaart("Balans sluit", s.balansSluit ? `<span class="ernst-informatief" style="color:var(--green)">Ja</span>` : `<span class="ernst-kritiek">Nee</span>`)}
    </div>`;
}

// --- 2. Vastgoed -----------------------------------------------------------------

function renderVastgoedComplexTabel(regels: readonly VastgoedComplexKpi[]): string {
  if (regels.length === 0) return `<div class="toelichting">Geen complexen beschikbaar.</div>`;
  const rijen = regels
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.complexnr)}</td>
        <td>${formatOnbekendOfHtml(c.totaalVvo, formatM2Html)}</td>
        <td>${formatOnbekendOfHtml(c.verhuurdeVvo, formatM2Html)}</td>
        <td>${formatOnbekendOfHtml(c.leegstandVvo, formatM2Html)}</td>
        <td>${formatOnbekendOfHtml(c.bezettingsgraad, formatPercentageHtml)}</td>
        <td>${formatOnbekendOfHtml(c.leegstandspercentage, formatPercentageHtml)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table>
      <thead><tr><th>Complex</th><th>Totale VVO</th><th>Verhuurde VVO</th><th>Leegstand</th><th>Bezettingsgraad</th><th>Leegstandspercentage</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderVastgoed(resultaat: ManagementRapportResultaat): string {
  const v = resultaat.vastgoed;
  const p = v.portefeuille;
  return `
    <h2>2. Vastgoed</h2>
    <div class="toelichting" style="margin-bottom:16px">
      ${renderMomentopnameBadge(v.bronPeildatum)}
      — bezettingsgraad/leegstand op basis van <code>units</code> (totale VVO) en <code>rentroll</code>
      (verhuurde VVO). Onafhankelijk van de geselecteerde periode hierboven — er is nog geen
      betrouwbare historische periodeselectie voor deze brondata.
    </div>
    <div class="grid g4">
      ${renderKpiKaart("Totale VVO", formatOnbekendOfHtml(p.totaalVvo, formatM2Html))}
      ${renderKpiKaart("Verhuurde VVO", formatOnbekendOfHtml(p.verhuurdeVvo, formatM2Html))}
      ${renderKpiKaart("Leegstand", formatOnbekendOfHtml(p.leegstandVvo, formatM2Html))}
      ${renderKpiKaart("Bezettingsgraad", formatOnbekendOfHtml(p.bezettingsgraad, formatPercentageHtml))}
    </div>
    <div class="grid g4" style="margin-top:16px">
      ${renderKpiKaart("Leegstandspercentage", formatOnbekendOfHtml(p.leegstandspercentage, formatPercentageHtml))}
    </div>
    <h3 class="serif" style="margin-top:24px">Per complex</h3>
    ${renderVastgoedComplexTabel(v.perComplex)}`;
}

// --- 3. Huur -----------------------------------------------------------------------

function renderHuurComplexTabel(regels: readonly HuurComplexKpi[]): string {
  if (regels.length === 0) return `<div class="toelichting">Geen complexen beschikbaar.</div>`;
  const rijen = regels
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.complexnr)}</td>
        <td>${formatOnbekendOfHtml(c.brutoJaarhuur, formatBedragHtml)}</td>
        <td>${formatOnbekendOfHtml(c.huurkortingen, formatBedragHtml)}</td>
        <td>${formatOnbekendOfHtml(c.nettoJaarhuur, formatBedragHtml)}</td>
        <td>${formatOnbekendOfHtml(c.verhuurdeVvo, formatM2Html)}</td>
        <td>${formatOnbekendOfHtml(c.brutoHuurPerM2, formatEurPerM2)}</td>
        <td>${formatOnbekendOfHtml(c.nettoHuurPerM2, formatEurPerM2)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table>
      <thead><tr><th>Complex</th><th>Bruto jaarhuur</th><th>Huurkortingen</th><th>Netto jaarhuur</th><th>Verhuurde VVO</th><th>Bruto €/m²</th><th>Netto €/m²</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function formatEurPerM2(waarde: Decimal): string {
  return `${formatBedragHtml(waarde)} /m²`;
}

function renderHuur(resultaat: ManagementRapportResultaat): string {
  const h = resultaat.huur;
  const p = h.portefeuille;
  return `
    <h2>3. Huur</h2>
    <div class="toelichting" style="margin-bottom:16px">
      ${renderMomentopnameBadge(h.bronPeildatum)}
      — bruto/netto jaarhuur op basis van <code>rentroll</code> (Vorderingsoort 01/13), onafhankelijk
      berekend van de vastgoedsectie hierboven (zie packages/reporting/README.md). Onafhankelijk van
      de geselecteerde periode — nog geen betrouwbare historische periodeselectie voor deze brondata.
    </div>
    <div class="grid g4">
      ${renderKpiKaart("Bruto jaarhuur", formatOnbekendOfHtml(p.brutoJaarhuur, formatBedragHtml))}
      ${renderKpiKaart("Huurkortingen", formatOnbekendOfHtml(p.huurkortingen, formatBedragHtml))}
      ${renderKpiKaart("Netto jaarhuur", formatOnbekendOfHtml(p.nettoJaarhuur, formatBedragHtml))}
      ${renderKpiKaart("Bruto huur per m²", formatOnbekendOfHtml(p.brutoHuurPerM2, formatEurPerM2))}
    </div>
    <div class="grid g4" style="margin-top:16px">
      ${renderKpiKaart("Netto huur per m²", formatOnbekendOfHtml(p.nettoHuurPerM2, formatEurPerM2))}
    </div>
    <h3 class="serif" style="margin-top:24px">Per complex</h3>
    ${renderHuurComplexTabel(h.perComplex)}`;
}

// --- 4. Kasstroom --------------------------------------------------------------------

function renderKasstroom(resultaat: ManagementRapportResultaat): string {
  const p = resultaat.periode;
  const k = p.kasstroom;
  const kwartaalRijen = k.perKwartaal
    .map(
      (q) =>
        `<tr><td>Q${q.kwartaal}</td><td>${formatBedragHtml(q.ontvangsten)}</td><td>${formatBedragHtml(q.uitgaven)}</td><td>${formatBedragHtml(q.eigenaarOnttrekkingen)}</td><td>${formatBedragHtml(q.nettoKasstroom)}</td></tr>`,
    )
    .join("");

  const topUitgaven = p.topOverigeUitgaven;
  const topUitgavenHtml =
    topUitgaven && topUitgaven.length > 0
      ? `
    <h3 class="serif" style="margin-top:24px">Top ${topUitgaven.length} grootste overige uitgaven (periode)</h3>
    <div class="toelichting">Werkelijke uitgaande bankbetalingen binnen periode ${escapeHtml(p.boekperiodeVan)} t/m ${escapeHtml(p.boekperiodeTotEnMet)}, exclusief eigenaaronttrekkingen — puur informatief, zit al in "overige uitgaven" hieronder.</div>
    <table>
      <thead><tr><th>Datum</th><th>Omschrijving</th><th>Bedrag</th></tr></thead>
      <tbody>${topUitgaven.map((r) => `<tr><td>${escapeHtml(r.boekdatum.toISOString().slice(0, 10))}</td><td>${escapeHtml(r.omschrijving)}</td><td>${formatBedragHtml(r.bedrag)}</td></tr>`).join("")}</tbody>
    </table>`
      : "";

  return `
    <h2>4. Kasstroom</h2>
    <div class="toelichting" style="margin-bottom:16px">
      ${renderPeriodeBadge(p.boekperiodeVan, p.boekperiodeTotEnMet)}
      — bankstand begin/eind van uitsluitend deze periode (niet 1 januari), werkelijke mutaties op de
      liquide-middelenrekening(en). Bankstand begin = bankstand einde van de voorafgaande periode.
    </div>
    <div class="grid g4">
      ${renderKpiKaart(`Bankstand begin (periode ${p.boekperiodeVan})`, formatBedragHtml(k.bankstandBegin))}
      ${renderKpiKaart("Ontvangsten", formatBedragHtml(k.ontvangsten))}
      ${renderKpiKaart("Uitgaven", formatBedragHtml(k.uitgaven))}
      ${renderKpiKaart("Netto kasstroom", formatBedragHtml(k.nettoKasstroom))}
    </div>
    <table style="margin-top:16px">
      <thead><tr><th>Onderdeel</th><th>Bedrag</th></tr></thead>
      <tbody>
        <tr><td>Waarvan eigenaaronttrekkingen</td><td>${formatBedragHtml(k.eigenaarOnttrekkingen)}</td></tr>
        <tr><td>Waarvan overige uitgaven</td><td>${formatBedragHtml(k.overigeUitgaven)}</td></tr>
        <tr class="totaalrij"><td>Bankstand einde (periode ${escapeHtml(p.boekperiodeTotEnMet)})</td><td>${formatBedragHtml(k.bankstandEind)}</td></tr>
      </tbody>
    </table>
    <h3 class="serif" style="margin-top:24px">Per kwartaal</h3>
    <table>
      <thead><tr><th>Kwartaal</th><th>Ontvangsten</th><th>Uitgaven</th><th>Eigenaaronttrekkingen</th><th>Netto kasstroom</th></tr></thead>
      <tbody>${kwartaalRijen}</tbody>
    </table>
    ${topUitgavenHtml}`;
}

// --- 5. Servicekosten ------------------------------------------------------------

function renderServicekostenStatusHtml(status: ServicekostenActuelePositieStatus): string {
  const label = status === "KOSTEN_HOGER_DAN_VOORSCHOTTEN" ? "Kosten hoger dan voorschotten" : status === "VOORSCHOTTEN_HOGER_DAN_KOSTEN" ? "Voorschotten hoger dan kosten" : "In evenwicht";
  return `<span class="ernst-informatief">${escapeHtml(label)}</span>`;
}

function renderOnbekendOfStringHtml(waarde: OnbekendOf<string>): string {
  if (waarde.type === "bekend") return escapeHtml(waarde.waarde);
  return `<span class="controle-vereist" title="${escapeHtml(waarde.reden)}">Controle vereist</span>`;
}

function renderServicekostenActueleComplexTabel(regels: readonly ServicekostenActueleComplexTotaal[]): string {
  if (regels.length === 0) return `<div class="toelichting">Geen complexen beschikbaar.</div>`;
  const rijen = regels
    .map((c) => `<tr><td>${c.complexnummer ? escapeHtml(c.complexnummer) : "—"}</td><td>${formatBedragHtml(c.kostenSaldo)}</td><td>${formatBedragHtml(c.voorschottenSaldo)}</td><td>${formatBedragHtml(c.actueelSaldo)}</td></tr>`)
    .join("");
  return `
    <table>
      <thead><tr><th>Complex</th><th>Kosten</th><th>Voorschotten</th><th>Actueel saldo</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderServicekostenAfrekeningComplexTabel(regels: readonly ServicekostenAfrekeningComplexTotaal[]): string {
  if (regels.length === 0) return `<div class="toelichting">Geen complexen beschikbaar.</div>`;
  const rijen = regels.map((c) => `<tr><td>${c.complexnummer ? escapeHtml(c.complexnummer) : "—"}</td><td>${c.aantalRegels}</td><td>${formatBedragHtml(c.saldo)}</td></tr>`).join("");
  return `
    <table>
      <thead><tr><th>Complex</th><th>Aantal regels</th><th>Saldo</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderServicekostenAfrekeningContractHuurderTabel(regels: readonly ServicekostenAfrekeningContractHuurderTotaal[]): string {
  if (regels.length === 0) return `<div class="toelichting">Geen regels met een rechtstreekse contract-/huurderkoppeling in deze periode.</div>`;
  const rijen = regels
    .map(
      (r) =>
        `<tr><td>${r.complexnummer ? escapeHtml(r.complexnummer) : "—"}</td><td>${r.unitnummer ? escapeHtml(r.unitnummer) : "—"}</td><td>${r.contractnummer ? escapeHtml(r.contractnummer) : "—"}</td><td>${r.huurdernummer ? escapeHtml(r.huurdernummer) : "—"}</td><td>${r.huurderNaam ? escapeHtml(r.huurderNaam) : "—"}</td><td>${renderOnbekendOfStringHtml(r.afrekenjaar)}</td><td>${formatBedragHtml(r.saldo)}</td></tr>`,
    )
    .join("");
  return `
    <table>
      <thead><tr><th>Complex</th><th>Unit</th><th>Contract</th><th>Huurder</th><th>Naam</th><th>Afrekenjaar</th><th>Saldo</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

function renderServicekosten(resultaat: ManagementRapportResultaat): string {
  const sk = resultaat.servicekosten;
  const a = sk.actuelePositie;
  const b = sk.afrekeningVoorgaandJaar;
  return `
    <h2>5. Servicekosten</h2>
    <div class="toelichting" style="margin-bottom:16px">
      ${renderPeriodeBadge(a.boekperiodeVan, a.boekperiodeTotEnMet)}
      — actuele kosten/voorschotten uitsluitend over deze periode, zelfde selectie als sectie 4. De
      financiële aansluiting op het grootboek is een controlemechanisme, geen managementcijfer — zie
      sectie 6 bij een afwijking.
    </div>

    <h3 class="serif">Actuele positie</h3>
    <div class="grid g4">
      ${renderKpiKaart("Kosten", formatBedragHtml(a.kostenSaldo))}
      ${renderKpiKaart("Voorschotten", formatBedragHtml(a.voorschottenSaldo))}
      ${renderKpiKaart("Actueel saldo", formatBedragHtml(a.actueelSaldo))}
      ${renderKpiKaart("Status", renderServicekostenStatusHtml(a.status))}
    </div>
    <h4 style="margin-top:20px">Per complex</h4>
    ${renderServicekostenActueleComplexTabel(a.perComplex)}

    <h3 class="serif" style="margin-top:32px">Afrekeningen voorgaande jaren (kostensoort 9600)</h3>
    <div class="toelichting" style="margin-bottom:16px">
      Losstaand van de actuele positie hierboven — telt daar nooit in mee. Per contract/huurder
      uitsluitend waar de bron een rechtstreekse koppeling heeft; complexbrede regels blijven apart
      zichtbaar, niet impliciet aan een huurder toegerekend.
    </div>
    <div class="grid g2">
      ${renderKpiKaart("Totaal saldo", formatBedragHtml(b.totaalSaldo))}
      ${renderKpiKaart("Aantal regels", String(b.aantalRegels))}
    </div>
    <h4 style="margin-top:20px">Per complex</h4>
    ${renderServicekostenAfrekeningComplexTabel(b.perComplex)}
    <h4 style="margin-top:20px">Per contract/huurder (rechtstreeks gekoppeld)</h4>
    ${renderServicekostenAfrekeningContractHuurderTabel(b.perContractHuurderAfrekenjaar)}`;
}

// --- 6. Controle vereist -----------------------------------------------------------

function renderErnstHtml(ernst: ManagementRapportControleItem["ernst"]): string {
  const klasse = ernst === "KRITIEK" ? "ernst-kritiek" : ernst === "WAARSCHUWING" ? "ernst-waarschuwing" : "ernst-informatief";
  return `<span class="${klasse}">${escapeHtml(ernst)}</span>`;
}

function renderControleVereist(resultaat: ManagementRapportResultaat): string {
  const items = resultaat.controleVereist;
  if (items.length === 0) {
    return `<h2>6. Controle vereist</h2><div class="toelichting"><strong>Geen</strong> — alle onderliggende modules meldden geen datakwaliteitspunten voor deze run.</div>`;
  }
  const rijen = items
    .map((i) => `<tr><td>${escapeHtml(i.sectie)}</td><td>${renderErnstHtml(i.ernst)}</td><td>${i.referentie ? escapeHtml(i.referentie) : "—"}</td><td>${escapeHtml(i.bericht)}</td></tr>`)
    .join("");
  return `
    <h2>6. Controle vereist</h2>
    <div class="toelichting">
      Gecombineerd uit alle onderliggende modules — een waarschuwing hier verdwijnt niet omdat de
      KPI zelf wel berekend kon worden; beide kunnen tegelijk waar zijn.
    </div>
    <table>
      <thead><tr><th>Sectie</th><th>Ernst</th><th>Referentie</th><th>Bericht</th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>`;
}

// --- Document ------------------------------------------------------------------------

export function renderManagementRapportBody(resultaat: ManagementRapportResultaat): string {
  return `
    ${renderManagementsamenvatting(resultaat)}
    ${renderVastgoed(resultaat)}
    ${renderHuur(resultaat)}
    ${renderKasstroom(resultaat)}
    ${renderServicekosten(resultaat)}
    ${renderControleVereist(resultaat)}`;
}

export function renderManagementRapportHtml(resultaat: ManagementRapportResultaat): string {
  const cover = `
    <div class="cover">
      <div class="eyebrow">BVC Vastgoed Consultants</div>
      <h1 class="serif">Managementrapportage</h1>
      <div class="object">${escapeHtml(resultaat.administratieNaam)} (Bedrijfsnr ${escapeHtml(resultaat.bedrijfsnr)})</div>
      <div class="periode">Boekjaar ${resultaat.boekjaar} — periode ${escapeHtml(resultaat.periode.boekperiodeVan)} t/m ${escapeHtml(resultaat.periode.boekperiodeTotEnMet)} — gegenereerd op ${escapeHtml(resultaat.gegenereerdOp.toISOString().slice(0, 19).replace("T", " "))}</div>
    </div>`;

  return renderRapportDocument(`Managementrapportage — ${resultaat.administratieNaam}`, cover, renderManagementRapportBody(resultaat));
}
