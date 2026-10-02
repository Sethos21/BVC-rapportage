import type Decimal from "decimal.js";
import { escapeHtml, type PnLBronBijdrage, type PnLGroepBovenEbitda, type PnLVergelijking } from "@bvc/reporting";
import type { Begrotingsversie, VergelijkendeBegrotingsPnLRegel, VergelijkendeBegrotingsPnLResultaat } from "@bvc/begroting-data";
import type { AdministratieListItem } from "./administratie.js";
import { BOEKPERIODES } from "./serveUi.js";

/**
 * TRANCHE 11 — server-rendered HTML voor de begrotingsworkflow (`/begroting/...`), zelfde
 * bewuste stijl als `serveUi.ts`: geen client-side JavaScript, rekent en classificeert NIETS —
 * presenteert uitsluitend wat de aanroeper (`begrotingRoutes.ts`) al heeft opgehaald/berekend
 * via de bestaande rekenlaag. Dit is BEWUST GEEN 1-op-1 visuele implementatie van de
 * UX_01…UX_13-ontwerpen (die vereisen client-side interactie/JS-componenten die deze
 * lokale, JS-vrije server-shell niet biedt) — het volgt wel de VASTGESTELDE structuur en
 * volgorde uit `09_Begrotingsmodule_UX_Vastgesteld.md` §3/§10: tabelgerichte vergelijkende
 * P&L, progressive disclosure (detail pas na doorklikken), onbekend/leeg/bewust-€0 blijven
 * zichtbaar onderscheiden, gebruikerstaal in plaats van technische statuscodes.
 *
 * UX-ASSEMBLAGEDELTA (post-Tranche-13, `docs/begroting/ux/`): de vastgestelde visuele taal
 * (kleuren, typografie, kaarten, tabelopmaak, zijbalknavigatie, volledige-breedte desktop-
 * layout) uit `09_Begrotingsmodule_UX_Vastgesteld.md`/`UX_Ontwerpen/`/`prototype/` is nu
 * toegepast op DEZE BESTAANDE, server-gerenderde architectuur — géén overstap naar een
 * client-side SPA (dat zou een nieuw architectuurbesluit zijn, buiten scope). Interacties die
 * in het prototype inline-in-de-tabel-rij plaatsvinden (bv. een module direct uitklappen in de
 * vergelijkende P&L) blijven daarom een eigen paginanavigatie — dezelfde bestaande routes,
 * dezelfde velden/formuliernamen, uitsluitend opnieuw gestyled binnen hetzelfde visuele systeem
 * (zijbalk + topbar + kaarten), zodat de hoofd-/detailnavigatie wél duidelijk is. Geen enkele
 * waarde, berekening of route is hierbij gewijzigd.
 */

const BASIS_CSS = `
  :root{
    --ink:#10233f; --muted:#5c6c82; --line:#dde3e9; --paper:#f5f7f9;
    --green:#0b6a58; --green-dark:#073f36; --green-soft:#eaf4f1;
    --amber:#9a6a0b; --amber-soft:#fff3d9;
    --red:#a14c36; --red-soft:#fbeae6;
    --radius:8px;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:"Segoe UI",Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,sans-serif;color:var(--ink);background:var(--paper);-webkit-font-smoothing:antialiased}
  button,input,select,textarea{font:inherit}
  button{cursor:pointer}

  /* eenvoudige pagina's zonder open begrotingsversie (keuzescherm, foutpagina): gecentreerd, geen zijbalk */
  .wrap{max-width:760px;margin:48px auto;padding:0 24px}
  .wrap-smal{max-width:560px;margin:60px auto;padding:0 24px}

  /* werkomgeving (hoofdscherm, detailschermen, controleren): zijbalk + vrijwel volledige desktopbreedte */
  .app-shell{min-height:100vh;display:flex}
  .sidebar{width:230px;flex:0 0 230px;background:linear-gradient(180deg,#073f36 0%,#0b4a3d 55%,#073a33 100%);color:#fff;display:flex;flex-direction:column;position:sticky;top:0;align-self:flex-start;height:100vh}
  .brand{padding:22px 22px 18px;border-bottom:1px solid rgba(255,255,255,.14)}
  .brand-title{font-size:14.5px;font-weight:700;letter-spacing:-.1px;line-height:1.3}
  .brand-sub{font-size:11px;opacity:.75;margin-top:4px}
  .nav{padding:14px 10px;display:grid;gap:3px}
  .nav a{display:block;padding:10px 14px;border-radius:6px;color:rgba(255,255,255,.88);text-decoration:none;font-size:13.5px}
  .nav a:hover{background:rgba(255,255,255,.09)}
  .nav a.actief{background:rgba(255,255,255,.15);color:#fff;font-weight:650}
  .nav-terug{margin-top:auto;padding:14px 10px;border-top:1px solid rgba(255,255,255,.14)}
  .nav-terug a{display:block;padding:10px 14px;border-radius:6px;color:rgba(255,255,255,.72);text-decoration:none;font-size:12.5px}
  .nav-terug a:hover{background:rgba(255,255,255,.09);color:#fff}

  .workspace{flex:1;min-width:0;display:flex;flex-direction:column}
  .topbar{min-height:54px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 30px}
  .topbar-context{font-size:13px;color:var(--muted)}
  .topbar-context strong{color:var(--ink)}

  .main{flex:1;padding:28px 34px 72px}

  .eyebrow{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:650}
  .title-row{display:flex;align-items:center;gap:13px;margin:6px 0 6px;flex-wrap:wrap}
  h1{font-size:24px;margin:0;letter-spacing:-.3px;line-height:1.3}
  h2{font-size:15px;margin:26px 0 10px;color:var(--ink)}
  .sub{color:var(--muted);font-size:13.5px;margin:0 0 20px;line-height:1.5}

  .pill{display:inline-flex;align-items:center;padding:4px 13px;border-radius:999px;font-size:12px;font-weight:650;white-space:nowrap}
  .pill.concept{background:var(--amber-soft);color:var(--amber)}
  .pill.vastgesteld{background:var(--green-soft);color:var(--green-dark)}

  .card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px;margin-bottom:22px;box-shadow:0 1px 2px rgba(16,35,63,.03)}

  label{display:block;font-size:12px;font-weight:650;color:var(--muted);margin:14px 0 6px}
  label:first-of-type{margin-top:0}
  select,input,textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line);border-radius:6px;font-size:13.5px;color:var(--ink);background:#fff;transition:border-color .12s,box-shadow .12s}
  select:focus,input:focus,textarea:focus{outline:0;border-color:var(--green);box-shadow:0 0 0 3px rgba(11,106,88,.12)}
  input[type=checkbox]{width:auto}

  button[type=submit]{margin-top:20px;padding:10px 18px;border:none;border-radius:7px;background:var(--green);color:#fff;font-size:13.5px;font-weight:650}
  button[type=submit]:hover{background:var(--green-dark)}
  button.secundair{background:#fff;color:var(--ink);border:1px solid var(--line)}
  button.secundair:hover{background:#f3f5f6}

  .fouten{background:var(--red-soft);border:1px solid #e3c3b9;border-radius:var(--radius);padding:13px 16px;margin-bottom:20px;color:#7d3a28;font-size:13.5px}
  .fouten ul{margin:6px 0 0;padding-left:18px}

  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);font-weight:650;padding:10px 12px;border-bottom:1px solid var(--line);background:#fafbfc}
  th:first-child,td:first-child{text-align:left}
  td{padding:10px 12px;border-bottom:1px solid #eef1f3;text-align:right;font-variant-numeric:tabular-nums;vertical-align:middle}
  tbody tr:hover td{background:#fbfcfc}
  tr.groep td{background:#f4f6f7;font-weight:650;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}
  tr.subtotaal td{font-weight:700;border-top:2px solid var(--line);border-bottom:2px solid var(--line)}

  .onbekend{color:var(--amber);font-weight:600}
  .naam{font-weight:650;display:block}
  .naam-sub{display:block;font-size:11px;color:var(--muted);font-weight:400;margin-top:2px}
  .bewerk{display:inline-block;font-size:11.5px;color:var(--green);text-decoration:none;font-weight:650;margin-right:8px}
  .bewerk:hover{text-decoration:underline}

  .banner{background:var(--green-soft);border:1px solid #cfe3d8;border-radius:var(--radius);padding:13px 16px;margin-bottom:20px;font-size:13.5px;color:#163f37}
  .banner a{color:var(--green-dark);font-weight:650}
  .banner.vastgesteld{background:#f3f0e4;border-color:#e2d8bd;color:#5a4f2e}

  .terug{display:inline-block;margin-top:4px;color:var(--muted);text-decoration:none;font-size:13px}
  .terug:hover{color:var(--ink)}

  .lijst{list-style:none;padding:0;margin:0}
  .lijst li{padding:10px 0;border-bottom:1px solid var(--line);font-size:13.5px;display:flex;justify-content:space-between;align-items:center}
  .lijst a{color:var(--green);text-decoration:none;font-weight:650}
  .lijst-acties{display:flex;align-items:center;gap:16px}
  .verwijder-link{color:var(--muted)!important;font-weight:500!important;font-size:12px}
  .verwijder-link:hover{color:var(--red)!important;text-decoration:underline}
  button.danger{background:var(--red)}
  button.danger:hover{background:#7d3a28}

  .controle-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:22px;align-items:start}
  .metrics-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:22px}
  .metric{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
  .metric span{display:block;color:var(--muted);font-size:11.5px}
  .metric strong{display:block;margin-top:6px;font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}

  @media (max-width:980px){
    .app-shell{flex-direction:column}
    .sidebar{position:relative;width:100%;height:auto;top:0}
    .main{padding:20px 18px 60px}
    .controle-grid{grid-template-columns:1fr}
  }
`;

function paginaShell(titel: string, bodyHtml: string, breed = true): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(titel)}</title>
<style>${BASIS_CSS}</style>
</head>
<body>
<div class="${breed ? "wrap" : "wrap-smal"}">
${bodyHtml}
</div>
</body>
</html>`;
}

/**
 * De werkomgeving-app-shell (zijbalk + topbar) voor elk scherm binnen een geopende
 * begrotingsversie (hoofdscherm, detail-/invoerschermen, controleren/vaststellen) — realiseert
 * de vastgestelde "duidelijke hoofd- en detailnavigatie" (UX_01/UX_11/UX_13) zonder client-side
 * routing: `navHtml` zijn gewone `<a>`-links naar bestaande routes.
 */
function appShell(o: { titel: string; navHtml: string; topbarContext: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(o.titel)}</title>
<style>${BASIS_CSS}</style>
</head>
<body>
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-title">BVC Vastgoed Consultants</div>
      <div class="brand-sub">Exploitatiebegroting</div>
    </div>
    <nav class="nav">${o.navHtml}</nav>
  </aside>
  <div class="workspace">
    <div class="topbar"><div class="topbar-context">${o.topbarContext}</div></div>
    <div class="main">${o.bodyHtml}</div>
  </div>
</div>
</body>
</html>`;
}

interface WerkomgevingContext {
  administratieId: string;
  weergavenaam: string;
  versie: Begrotingsversie;
  laatstAfgeslotenBoekperiode: string;
  actief: "hoofdscherm" | "controle";
}

function statusPill(status: Begrotingsversie["status"]): string {
  return status === "VASTGESTELD" ? `<span class="pill vastgesteld">Vastgesteld</span>` : `<span class="pill concept">Concept</span>`;
}

function werkomgevingHoofdschermUrl(ctx: WerkomgevingContext): string {
  return `/begroting/${encodeURIComponent(ctx.administratieId)}/${encodeURIComponent(ctx.versie.id)}?laatstAfgeslotenBoekperiode=${encodeURIComponent(ctx.laatstAfgeslotenBoekperiode)}`;
}

function werkomgevingControleUrl(ctx: WerkomgevingContext): string {
  return `/begroting/${encodeURIComponent(ctx.administratieId)}/${encodeURIComponent(ctx.versie.id)}/controle?laatstAfgeslotenBoekperiode=${encodeURIComponent(ctx.laatstAfgeslotenBoekperiode)}`;
}

/** Zijbalk met de twee echte bestemmingen binnen een open begrotingsversie — hoofdscherm en controleren/vaststellen gebruiken deze, met actieve-staat-markering. */
function werkomgevingShell(ctx: WerkomgevingContext, titel: string, bodyHtml: string): string {
  const navHtml = [
    `<a href="${escapeHtml(werkomgevingHoofdschermUrl(ctx))}" class="${ctx.actief === "hoofdscherm" ? "actief" : ""}">Vergelijkende P&amp;L</a>`,
    `<a href="${escapeHtml(werkomgevingControleUrl(ctx))}" class="${ctx.actief === "controle" ? "actief" : ""}">Controleren &amp; vaststellen</a>`,
  ].join("");
  const topbarContext = `<strong>${escapeHtml(ctx.weergavenaam)}</strong> — Begroting ${ctx.versie.begrotingsjaar}`;
  return appShell({ titel, navHtml, topbarContext, bodyHtml });
}

function fmtBedrag(d: Decimal): string {
  const negatief = d.isNegative();
  const [geheel, decimalen] = d.abs().toFixed(2).split(".");
  const geheelMetPunten = geheel!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (negatief ? "-€ " : "€ ") + geheelMetPunten + "," + decimalen;
}

function fmtWaarde(w: PnLBronBijdrage | null | undefined): string {
  if (w === null || w === undefined) return `<span class="onbekend">onbekend</span>`;
  if (w.status === "ONBEKEND") return `<span class="onbekend" title="${escapeHtml(w.toelichting)}">onbekend</span>`;
  return escapeHtml(fmtBedrag(w.bedrag));
}

function fmtVoorstel(v: VergelijkendeBegrotingsPnLRegel["voorstel"]): string {
  if (v.type === "HANDMATIG") return `<span class="naam-sub" style="display:inline">Handmatig opgebouwd</span>`;
  if (v.type === "ONBEKEND") return `<span class="onbekend">onbekend</span>`;
  return escapeHtml(fmtBedrag(v.bedrag));
}

const LABELS: Record<string, string> = {
  HUUROPBRENGST_BELAST: "Huuropbrengst belast",
  HUUROPBRENGST_ONBELAST: "Huuropbrengst onbelast",
  VERLEENDE_HUURKORTING: "Verleende huurkorting",
  HUUR_NIET_GECLASSIFICEERD: "Huur — niet geclassificeerd",
  BEHEERKOSTEN: "Beheersvergoeding",
  BEHEER_NIET_GECLASSIFICEERD: "Beheer — niet geclassificeerd",
  MANAGEMENTVERGOEDING: "Managementvergoeding",
  MANAGEMENT_NIET_GECLASSIFICEERD: "Management — niet geclassificeerd",
  ONDERHOUD: "Onderhoud (gepland + correctief/dagelijks)",
  ONDERHOUD_NIET_GECLASSIFICEERD: "Onderhoud — niet geclassificeerd",
  VERZEKERINGEN: "Verzekeringen",
  VERZEKERINGEN_NIET_GECLASSIFICEERD: "Verzekeringen — niet geclassificeerd",
  GEMEENTELIJKE_LASTEN: "Gemeentelijke lasten pand",
  GEMEENTELIJKE_LASTEN_NIET_GECLASSIFICEERD: "Gemeentelijke lasten — niet geclassificeerd",
  ACCOUNTANT: "Accountantkosten",
  JURIDISCHE_KOSTEN: "Juridische kosten",
  MAKELAARSKOSTEN: "Makelaar- en taxatiekosten",
  ALGEMENE_KOSTEN: "Overige algemene kosten",
  BANKKOSTEN: "Bankkosten",
  ALGEMENE_KOSTEN_NIET_GECLASSIFICEERD: "Algemene kosten — niet geclassificeerd",
  LEEGSTANDSKOSTEN: "Leegstandskosten",
  LEEGSTANDSKOSTEN_ONBEKEND_ONDERDEEL: "Leegstandskosten — onderdeel onbekend",
  LEEGSTANDSKOSTEN_NIET_GECLASSIFICEERD: "Leegstandskosten — niet geclassificeerd",
  NIET_VERREKENBARE_BTW: "Niet verrekenbare btw",
  NIET_VERREKENBARE_BTW_NIET_GECLASSIFICEERD: "Niet verrekenbare btw — niet geclassificeerd",
  RENTEKOSTEN: "Rente leningen",
  RENTE_OPBRENGSTEN: "Opbrengst rente",
};

function label(regelSleutel: string): string {
  return LABELS[regelSleutel] ?? regelSleutel.charAt(0) + regelSleutel.slice(1).toLowerCase().replace(/_/g, " ");
}

/**
 * UX-UITROL (2026-10-02) — gedeeld bouwblok voor ELK moduledetailscherm: toont dezelfde rij(en)
 * uit de al-bestaande vergelijkende P&L (`VergelijkendeBegrotingsPnLResultaat`, hergebruikt van
 * `leesBegrotingsWerkomgeving`) die op het hoofdscherm ook al zichtbaar zijn — Begroting vorig
 * jaar / Werkelijk / Estimated / Voorstel / Jouw begroting (09_Begrotingsmodule_UX_Vastgesteld §3).
 * Puur presentatie/lookup op `regelSleutel`: geen nieuwe berekening, geen tweede databron. `null`/
 * lege lijst (regelSleutel niet gevonden) geeft bewust niets terug — geen placeholder-rij.
 */
export function moduleWerkomgevingPnLHtml(vergelijkend: VergelijkendeBegrotingsPnLResultaat, regelSleutels: readonly string[]): string {
  const regels = regelSleutels.map((sleutel) => vergelijkend.regels.find((r) => r.regelSleutel === sleutel)).filter((r): r is VergelijkendeBegrotingsPnLRegel => r !== undefined);
  if (regels.length === 0) return "";
  const rijHtml = (r: VergelijkendeBegrotingsPnLRegel) => `
    <tr>
      <td>${escapeHtml(label(r.regelSleutel))}</td>
      <td style="text-align:right">${fmtWaarde(r.begrotingVorigJaar)}</td>
      <td style="text-align:right">${fmtWaarde(r.werkelijk)}</td>
      <td style="text-align:right">${fmtWaarde(r.estimated)}</td>
      <td style="text-align:right">${fmtVoorstel(r.voorstel)}</td>
      <td style="text-align:right"><strong>${fmtWaarde(r.jouwBegroting)}</strong></td>
    </tr>`;
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="eyebrow">Vergelijkende P&amp;L</div>
      <table style="margin:0">
        <thead><tr><th style="text-align:left">Onderdeel</th><th style="text-align:right">Begroting vorig jaar</th><th style="text-align:right">Werkelijk</th><th style="text-align:right">Estimated</th><th style="text-align:right">Voorstel</th><th style="text-align:right">Jouw begroting</th></tr></thead>
        <tbody>${regels.map(rijHtml).join("")}</tbody>
      </table>
    </div>`;
}

const GROEP_LABELS: Record<PnLGroepBovenEbitda, string> = {
  OPBRENGSTEN: "Opbrengsten",
  MANAGEMENT_EN_BEHEER: "Management en beheer",
  EXPLOITATIE_LASTEN: "Exploitatie",
  ALGEMENE_KOSTEN: "Algemene kosten",
};

/** Modules met een in deze tranche gebouwde invoerpagina — alle andere posten zijn deze tranche alleen-lezen in de vergelijkende P&L. */
const BEWERKBARE_MODULES: Record<string, readonly { key: string; label: string }[]> = {
  HUUROPBRENGST_BELAST: [{ key: "huur", label: "Aanpassen" }],
  HUUROPBRENGST_ONBELAST: [{ key: "huur", label: "Aanpassen" }],
  VERLEENDE_HUURKORTING: [{ key: "huur", label: "Aanpassen" }],
  BEHEERKOSTEN: [{ key: "beheer", label: "Aanpassen" }],
  MANAGEMENTVERGOEDING: [{ key: "management", label: "Aanpassen" }],
  ONDERHOUD: [
    { key: "gepland-onderhoud", label: "Gepland onderhoud" },
    { key: "correctief", label: "Correctief/dagelijks" },
  ],
  VERZEKERINGEN: [{ key: "verzekeringen", label: "Aanpassen" }],
  GEMEENTELIJKE_LASTEN: [{ key: "gemeentelijke-lasten", label: "Aanpassen" }],
  ACCOUNTANT: [{ key: "algemene-kosten", label: "Aanpassen" }],
  JURIDISCHE_KOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  MAKELAARSKOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  ALGEMENE_KOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  BANKKOSTEN: [{ key: "algemene-kosten", label: "Aanpassen" }],
  LEEGSTANDSKOSTEN: [{ key: "leegstand", label: "Aanpassen" }],
  NIET_VERREKENBARE_BTW: [{ key: "btw", label: "Aanpassen" }],
  RENTEKOSTEN: [{ key: "rente-leningen", label: "Aanpassen" }],
  RENTE_OPBRENGSTEN: [{ key: "rente-opbrengst", label: "Aanpassen" }],
};

export interface AdministratieKeuzeSchermOpties {
  fouten?: readonly string[];
  melding?: string;
  ingevoerd?: { administratieId?: string; begrotingsjaar?: string; laatstAfgeslotenBoekperiode?: string; indexatiePercentage?: string };
  bestaandeVersies?: readonly Begrotingsversie[];
}

export function renderBegrotingKeuzeScherm(administraties: readonly AdministratieListItem[], opties: AdministratieKeuzeSchermOpties = {}): string {
  const geselecteerd = opties.ingevoerd?.administratieId ?? "";
  const administratieOpties = administraties
    .map((a) => `<option value="${escapeHtml(a.administratieId)}"${a.administratieId === geselecteerd ? " selected" : ""}>${escapeHtml(a.weergavenaam)} (${escapeHtml(a.bedrijfsnr)})</option>`)
    .join("");
  const periodeOpties = BOEKPERIODES.map((p) => `<option value="${p.waarde}"${p.waarde === (opties.ingevoerd?.laatstAfgeslotenBoekperiode ?? "") ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("");

  const foutenHtml =
    opties.fouten && opties.fouten.length > 0
      ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${opties.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>`
      : "";
  const meldingHtml = opties.melding !== undefined ? `<div class="banner">${escapeHtml(opties.melding)}</div>` : "";

  const bestaandeVersiesHtml =
    opties.bestaandeVersies !== undefined
      ? `<h2>Bestaande begrotingen voor deze administratie</h2><div class="card">${
          opties.bestaandeVersies.length === 0
            ? `<div class="sub">Nog geen begrotingsversie voor deze administratie.</div>`
            : `<ul class="lijst">${opties.bestaandeVersies
                .map((v) => {
                  const basis = `/begroting/${encodeURIComponent(geselecteerd)}/${encodeURIComponent(v.id)}`;
                  // Verwijderen is een destructieve secundaire actie — uitsluitend zichtbaar voor CONCEPT, en
                  // visueel bewust klein/gedempt zodat hij niet concurreert met de primaire "Openen"-actie.
                  const verwijderLink = v.status === "CONCEPT" ? `<a class="verwijder-link" href="${basis}/verwijderen">Verwijderen</a>` : "";
                  return `<li><span>${v.begrotingsjaar} — ${v.status === "VASTGESTELD" ? "Vastgesteld" : "Concept"}${v.naam ? ` — ${escapeHtml(v.naam)}` : ""}</span><span class="lijst-acties"><a href="${basis}">Openen →</a>${verwijderLink}</span></li>`;
                })
                .join("")}</ul>`
        }</div>`
      : "";

  const body = `
    <div class="eyebrow">BVC Vastgoed Consultants — Exploitatiebegroting</div>
    <h1>Begroting kiezen of starten</h1>
    <div class="sub">Het exacte startscherm is nog niet als afzonderlijk UX-ontwerp vastgesteld (zie hoofdstuk 12 van de UX-vastgesteld-set) — dit is een minimale, functionele selectie op basis van de al bestaande administratieselectie.</div>
    ${meldingHtml}
    <div class="card">
      ${foutenHtml}
      <form method="GET" action="/begroting">
        <label for="administratieId">Administratie</label>
        <select name="administratieId" id="administratieId" onchange="this.form.submit()">
          <option value="" disabled${geselecteerd ? "" : " selected"}>Kies een administratie…</option>
          ${administratieOpties}
        </select>
        <noscript><button type="submit" class="secundair">Administratie tonen</button></noscript>
      </form>
    </div>
    ${bestaandeVersiesHtml}
    ${
      geselecteerd
        ? `<h2>Nieuwe begroting starten</h2>
    <div class="card">
      <form method="POST" action="/begroting/nieuw">
        <input type="hidden" name="administratieId" value="${escapeHtml(geselecteerd)}" />
        <label for="begrotingsjaar">Begrotingsjaar (het jaar waarvoor je nu een begroting opstelt)</label>
        <input type="number" name="begrotingsjaar" id="begrotingsjaar" min="2000" max="2100" step="1" value="${escapeHtml(opties.ingevoerd?.begrotingsjaar ?? "")}" required />
        <label for="laatstAfgeslotenBoekperiode">Laatst afgesloten boekperiode van het huidige jaar (voor Werkelijk/Estimated)</label>
        <select name="laatstAfgeslotenBoekperiode" id="laatstAfgeslotenBoekperiode" required>
          <option value="" disabled${opties.ingevoerd?.laatstAfgeslotenBoekperiode ? "" : " selected"}>Kies een periode…</option>
          ${periodeOpties}
        </select>
        <label for="indexatiePercentage">Algemeen verwacht huurindexatiepercentage (UX §2/§4 — vooraf vastgesteld, geldt standaard voor alle contracten)</label>
        <input type="text" name="indexatiePercentage" id="indexatiePercentage" value="${escapeHtml(opties.ingevoerd?.indexatiePercentage ?? "")}" placeholder="bv. 3,0" required />
        <button type="submit">Nieuwe begroting starten</button>
      </form>
    </div>`
        : ""
    }`;
  return paginaShell("BVC Rapportage — Begroting", body);
}

/**
 * Product-readiness fix (migratie 42): getoond wanneer een begrotingsversie nog geen opgeslagen
 * laatst-afgesloten-boekperiode heeft (legacy-versie van vóór deze fix). Verzint nooit een periode
 * — de gebruiker kiest hem hier expliciet, eenmalig, waarna hij persistent bij de versie wordt
 * vastgelegd (zie `POST .../boekperiode` in `begrotingRoutes.ts`).
 */
export function renderKiesBoekperiodeScherm(o: { administratieId: string; weergavenaam: string; versie: Begrotingsversie; fouten?: readonly string[] }): string {
  const periodeOpties = BOEKPERIODES.map((p) => `<option value="${p.waarde}">${escapeHtml(p.label)}</option>`).join("");
  const foutenHtml =
    o.fouten && o.fouten.length > 0 ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${o.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>` : "";
  const body = `
    <div class="eyebrow">${escapeHtml(o.weergavenaam)} — Begroting ${o.versie.begrotingsjaar}</div>
    <h1>Kies de laatst afgesloten boekperiode</h1>
    <div class="sub">Voor deze bestaande begrotingsversie is nog geen laatst afgesloten boekperiode vastgelegd (nodig om Werkelijk/Estimated te tonen). Kies hem eenmalig — de keuze wordt daarna bij deze versie bewaard en hoeft niet opnieuw gekozen te worden.</div>
    ${foutenHtml}
    <div class="card">
      <form method="POST" action="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/boekperiode">
        <label for="laatstAfgeslotenBoekperiode">Laatst afgesloten boekperiode</label>
        <select name="laatstAfgeslotenBoekperiode" id="laatstAfgeslotenBoekperiode" required>
          <option value="" disabled selected>Kies een periode…</option>
          ${periodeOpties}
        </select>
        <button type="submit">Opslaan en openen</button>
      </form>
    </div>
    <a class="terug" href="/begroting?administratieId=${encodeURIComponent(o.administratieId)}">← Terug naar begrotingskeuze</a>`;
  return paginaShell(`Boekperiode kiezen — Begroting ${o.versie.begrotingsjaar}`, body);
}

/**
 * Veilig verwijderen conceptbegroting — uitsluitend bereikbaar/bedoeld voor een CONCEPT-versie
 * (de aanroeper in `begrotingRoutes.ts` weigert dit scherm server-side voor VASTGESTELD, en
 * `verwijderConceptVersie` weigert de daadwerkelijke verwijdering sowieso nogmaals). Eén klik is
 * bewust nooit genoeg: de gebruiker moet exact "VERWIJDEREN" typen, server-side gevalideerd —
 * geen browser-`confirm()`, een eigen pagina binnen dezelfde visuele taal als de rest van de
 * begrotingsmodule.
 */
export function renderVerwijderBevestigingScherm(o: { administratieId: string; weergavenaam: string; versie: Begrotingsversie; fouten?: readonly string[] }): string {
  const foutenHtml =
    o.fouten && o.fouten.length > 0 ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${o.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>` : "";
  const naamRegel = o.versie.naam ? `<li><span>Naam</span><strong>${escapeHtml(o.versie.naam)}</strong></li>` : "";
  const body = `
    <div class="eyebrow">${escapeHtml(o.weergavenaam)} — Begroting ${o.versie.begrotingsjaar}</div>
    <h1>Conceptbegroting verwijderen</h1>
    <div class="fouten"><strong>Dit kan niet ongedaan worden gemaakt.</strong> Deze conceptbegroting en alle daarbij opgeslagen invoer (alle modules, overrides, beoordelingen) worden definitief verwijderd. Andere begrotingsversies van deze of een andere administratie, bronbestanden, algemene administratiegegevens en gedeelde mappings blijven onaangeroerd.</div>
    <div class="card">
      <ul class="lijst">
        <li><span>Administratie</span><strong>${escapeHtml(o.weergavenaam)}</strong></li>
        <li><span>Begrotingsjaar</span><strong>${o.versie.begrotingsjaar}</strong></li>
        ${naamRegel}
        <li><span>Status</span><strong>Concept</strong></li>
      </ul>
    </div>
    ${foutenHtml}
    <div class="card">
      <form method="POST" action="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/verwijderen">
        <label for="bevestiging">Typ exact <strong>VERWIJDEREN</strong> om te bevestigen</label>
        <input type="text" name="bevestiging" id="bevestiging" autocomplete="off" required />
        <button type="submit" class="danger">Definitief verwijderen</button>
      </form>
    </div>
    <a class="terug" href="/begroting?administratieId=${encodeURIComponent(o.administratieId)}">← Terug naar begrotingskeuze (zonder te verwijderen)</a>`;
  return paginaShell(`Verwijderen — Begroting ${o.versie.begrotingsjaar}`, body);
}

export interface HoofdschermOpties {
  administratieId: string;
  weergavenaam: string;
  versie: Begrotingsversie;
  vergelijkend: VergelijkendeBegrotingsPnLResultaat;
  laatstAfgeslotenBoekperiode: string;
  melding?: string;
}

const GROEP_VOLGORDE: readonly PnLGroepBovenEbitda[] = ["OPBRENGSTEN", "MANAGEMENT_EN_BEHEER", "EXPLOITATIE_LASTEN", "ALGEMENE_KOSTEN"];

function regelRij(o: HoofdschermOpties, r: VergelijkendeBegrotingsPnLRegel): string {
  const moduleLinks = BEWERKBARE_MODULES[r.regelSleutel];
  const bewerkLinks =
    o.versie.status === "CONCEPT" && moduleLinks !== undefined
      ? moduleLinks
          .map(
            (m) =>
              `<a class="bewerk" href="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/module/${m.key}?laatstAfgeslotenBoekperiode=${encodeURIComponent(o.laatstAfgeslotenBoekperiode)}">${escapeHtml(m.label)}</a>`,
          )
          .join(" · ")
      : "";
  return `<tr>
    <td><span class="naam">${escapeHtml(label(r.regelSleutel))}</span>${bewerkLinks ? `<span class="naam-sub">${bewerkLinks}</span>` : ""}</td>
    <td>${fmtWaarde(r.begrotingVorigJaar)}</td>
    <td>${fmtWaarde(r.werkelijk)}</td>
    <td>${fmtWaarde(r.estimated)}</td>
    <td>${fmtVoorstel(r.voorstel)}</td>
    <td>${fmtWaarde(r.jouwBegroting)}</td>
  </tr>`;
}

export function renderBegrotingHoofdscherm(o: HoofdschermOpties): string {
  const { vergelijkend } = o;
  const bovenRegels = vergelijkend.regels.filter((r) => r.boomPositie === "BOVEN_EBITDA");
  const onderRegels = vergelijkend.regels.filter((r) => r.boomPositie === "ONDER_EBITDA");

  const groepenHtml = GROEP_VOLGORDE.map((groep) => {
    const regels = bovenRegels.filter((r) => r.groep === groep);
    if (regels.length === 0) return "";
    return `<tr class="groep"><td colspan="6">${escapeHtml(GROEP_LABELS[groep])}</td></tr>${regels.map((r) => regelRij(o, r)).join("")}`;
  }).join("");

  const onderHtml = onderRegels.length > 0 ? `<tr class="groep"><td colspan="6">Onder EBITDA</td></tr>${onderRegels.map((r) => regelRij(o, r)).join("")}` : "";

  const ebitdaRij = (naam: string, resultaat: (typeof vergelijkend)["werkelijk"] | null) =>
    resultaat === null
      ? `<span class="onbekend">onbekend</span>`
      : resultaat.ebitda.volledigheid.status === "VOLLEDIG"
        ? fmtBedrag(resultaat.ebitda.bedrag)
        : `<span class="onbekend" title="Onvolledig: niet alle posten zijn bekend">${fmtBedrag(resultaat.ebitda.bedrag)} (onvolledig)</span>`;

  const statusBanner =
    o.versie.status === "VASTGESTELD"
      ? `<div class="banner vastgesteld"><strong>Vastgesteld</strong> op ${o.versie.vastgesteldAt ? o.versie.vastgesteldAt.toLocaleDateString("nl-NL") : "-"} — deze begroting is alleen-lezen (Terugkijken).</div>`
      : `<div class="banner">Werk de onderdelen hieronder bij, en ga daarna naar <a href="${escapeHtml(werkomgevingControleUrl({ administratieId: o.administratieId, weergavenaam: o.weergavenaam, versie: o.versie, laatstAfgeslotenBoekperiode: o.laatstAfgeslotenBoekperiode, actief: "hoofdscherm" }))}">controleren en vaststellen →</a></div>`;

  const meldingHtml = o.melding !== undefined ? `<div class="banner">${escapeHtml(o.melding)}</div>` : "";

  const body = `
    <div class="eyebrow">Begroting ${o.versie.begrotingsjaar}</div>
    <div class="title-row"><h1>Vergelijkende exploitatiebegroting</h1>${statusPill(o.versie.status)}</div>
    <div class="sub">Werkelijk/Estimated: ${o.versie.begrotingsjaar - 1} t/m periode ${escapeHtml(o.laatstAfgeslotenBoekperiode)}. Bron: productieboekingen + de bestaande, bewezen GL/OGB-bronmapping — geen testdata.</div>
    ${meldingHtml}
    ${statusBanner}
    <div class="card">
      <table>
        <thead><tr><th>Onderdeel</th><th>Begroting ${o.versie.begrotingsjaar - 1}</th><th>Werkelijk ${o.versie.begrotingsjaar - 1}</th><th>Estimated ${o.versie.begrotingsjaar - 1}</th><th>Voorstel ${o.versie.begrotingsjaar}</th><th>Jouw begroting ${o.versie.begrotingsjaar}</th></tr></thead>
        <tbody>
          ${groepenHtml}
          <tr class="subtotaal"><td>EBITDA (bedrijfsresultaat)</td><td>${ebitdaRij("vorig", vergelijkend.begrotingVorigJaar)}</td><td>${ebitdaRij("werkelijk", vergelijkend.werkelijk)}</td><td>${ebitdaRij("estimated", vergelijkend.estimated)}</td><td>—</td><td>${ebitdaRij("nieuw", vergelijkend.jouwBegroting)}</td></tr>
          ${onderHtml}
        </tbody>
      </table>
    </div>
    <a class="terug" href="/begroting?administratieId=${encodeURIComponent(o.administratieId)}">← Terug naar begrotingskeuze</a>`;
  return werkomgevingShell(
    { administratieId: o.administratieId, weergavenaam: o.weergavenaam, versie: o.versie, laatstAfgeslotenBoekperiode: o.laatstAfgeslotenBoekperiode, actief: "hoofdscherm" },
    `Begroting ${o.versie.begrotingsjaar} — ${o.weergavenaam}`,
    body,
  );
}

export function renderControlePagina(o: { administratieId: string; weergavenaam: string; versie: Begrotingsversie; laatstAfgeslotenBoekperiode: string; vergelijking: PnLVergelijking | null; vaststelFout?: string }): string {
  const ctx: WerkomgevingContext = { administratieId: o.administratieId, weergavenaam: o.weergavenaam, versie: o.versie, laatstAfgeslotenBoekperiode: o.laatstAfgeslotenBoekperiode, actief: "controle" };
  const rij = (naam: string, v: PnLVergelijking["ebitda"]) =>
    `<tr><td>${escapeHtml(naam)}</td><td>${fmtBedrag(v.basis)}</td><td>${fmtBedrag(v.vergelijk)}</td><td>${fmtBedrag(v.afwijking)}</td><td>${v.volledigheid.status === "VOLLEDIG" ? "Volledig" : "Onvolledig"}</td></tr>`;

  const metricsHtml =
    o.vergelijking === null
      ? ""
      : `<div class="metrics-row">
      <div class="metric"><span>Jouw begroting ${o.versie.begrotingsjaar} — EBITDA</span><strong>${fmtBedrag(o.vergelijking.ebitda.vergelijk)}</strong></div>
      <div class="metric"><span>Estimated ${o.versie.begrotingsjaar - 1} — EBITDA</span><strong>${fmtBedrag(o.vergelijking.ebitda.basis)}</strong></div>
      <div class="metric"><span>Verschil t.o.v. Estimated</span><strong>${fmtBedrag(o.vergelijking.ebitda.afwijking)}</strong></div>
      <div class="metric"><span>Volledigheid</span><strong>${o.vergelijking.ebitda.volledigheid.status === "VOLLEDIG" ? "Volledig" : "Onvolledig"}</strong></div>
    </div>`;

  const vergelijkingHtml =
    o.vergelijking === null
      ? `<div class="card"><div class="sub">Er bestaat nog geen vastgestelde begroting voor ${o.versie.begrotingsjaar - 1} — Estimated (en daarmee deze vergelijking) is nog niet beschikbaar. Dit blokkeert het opstellen van Jouw begroting niet.</div></div>`
      : `<div class="card">
      <h2 style="margin-top:0">Begrotingsonderdelen</h2>
      <table>
        <thead><tr><th>Post</th><th>Estimated ${o.versie.begrotingsjaar - 1}</th><th>Jouw begroting ${o.versie.begrotingsjaar}</th><th>Verschil</th><th>Volledigheid</th></tr></thead>
        <tbody>
          ${rij("Totaal opbrengsten", o.vergelijking.totaalOpbrengsten)}
          ${rij("Management en beheer", o.vergelijking.managementEnBeheer)}
          ${rij("Exploitatie lasten", o.vergelijking.exploitatieLasten)}
          ${rij("Algemene kosten", o.vergelijking.algemeneKosten)}
          ${rij("Totaal kosten", o.vergelijking.totaalKosten)}
          <tr class="subtotaal">${rij("EBITDA", o.vergelijking.ebitda).replace("<tr>", "").replace("</tr>", "")}</tr>
        </tbody>
      </table>
    </div>`;

  const eindcontroleHtml =
    o.versie.status === "VASTGESTELD"
      ? `<div class="card">
        <h2 style="margin-top:0">Vastgesteld</h2>
        <div class="banner vastgesteld"><strong>Begroting vastgesteld</strong>${o.versie.vastgesteldAt ? ` op ${o.versie.vastgesteldAt.toLocaleDateString("nl-NL")}` : ""} — alleen-lezen (Terugkijken).</div>
      </div>`
      : `<div class="card">
        <h2 style="margin-top:0">Eindcontrole</h2>
        <div class="sub">Wat nog nodig is voor vaststelling.</div>
        ${o.vaststelFout !== undefined ? `<div class="fouten"><strong>Vaststellen kan nog niet:</strong> ${escapeHtml(o.vaststelFout)}</div>` : ""}
        <form method="POST" action="/begroting/${encodeURIComponent(o.administratieId)}/${encodeURIComponent(o.versie.id)}/vaststellen">
          <label><input type="checkbox" name="bevestigd" value="1" style="width:auto;display:inline-block;margin-right:8px" required />Ik bevestig dat ik deze begroting voor ${o.versie.begrotingsjaar} definitief wil vaststellen. Na vaststellen is de begroting alleen-lezen.</label>
          <label for="toelichting">Toelichting bij vaststelling (optioneel)</label>
          <textarea name="toelichting" id="toelichting" rows="3" placeholder="Bijvoorbeeld: akkoord na bespreking met eigenaar"></textarea>
          <button type="submit">Begroting vaststellen</button>
        </form>
      </div>`;

  const body = `
    <div class="eyebrow">Begroting ${o.versie.begrotingsjaar}</div>
    <div class="title-row"><h1>Controle begroting ${o.versie.begrotingsjaar} — ${escapeHtml(o.weergavenaam)}</h1>${statusPill(o.versie.status)}</div>
    <div class="sub">${o.versie.status === "VASTGESTELD" ? "Definitieve begroting — controleer de totalen en de onderbouwing." : "Controleer de totalen en afwijkingen voordat je de begroting vaststelt."}</div>
    ${metricsHtml}
    <div class="controle-grid">
      <div>${vergelijkingHtml}</div>
      <div>${eindcontroleHtml}</div>
    </div>
    <a class="terug" href="${escapeHtml(werkomgevingHoofdschermUrl(ctx))}">← Terug naar de vergelijkende P&L</a>`;
  return werkomgevingShell(ctx, `Controleren — Begroting ${o.versie.begrotingsjaar}`, body);
}

export function renderFoutPagina(titel: string, bericht: string, terugUrl = "/begroting"): string {
  const body = `
    <div class="eyebrow">BVC Vastgoed Consultants</div>
    <h1>${escapeHtml(titel)}</h1>
    <div class="card">
      <div class="fouten">${escapeHtml(bericht)}</div>
      <a class="terug" href="${escapeHtml(terugUrl)}">← Terug</a>
    </div>`;
  return paginaShell(titel, body, false);
}

/**
 * Tranche 14 — generieke read-only lifecycle: iedere detailpagina gebruikt DEZELFDE render-
 * functie voor CONCEPT en VASTGESTELD. Bij `alleenLezen` wikkelt deze shell de formulierinhoud
 * in een `<fieldset disabled>` — dat schakelt ALLE input/select/textarea/button-elementen
 * daarbinnen in één keer uit (standaard HTML5-gedrag), zonder dat elke render-functie zelf elk
 * veld hoeft te markeren. De route-laag blokkeert schrijfacties (POST) hoe dan ook al op
 * niet-CONCEPT (`handleModuleRoute`) — dit is uitsluitend de zichtbare, niet-bewerkbare weergave.
 */
function moduleFormShell(o: { titel: string; terugUrl: string; fouten?: readonly string[]; inhoud: string; alleenLezen?: boolean }): string {
  const foutenHtml =
    o.fouten && o.fouten.length > 0 ? `<div class="fouten"><strong>Controleer de invoer:</strong><ul>${o.fouten.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>` : "";
  const alleenLezenBanner = o.alleenLezen ? `<div class="banner vastgesteld">Vastgesteld — deze onderbouwing is alleen-lezen.</div>` : "";
  const inhoud = o.alleenLezen ? `<fieldset disabled style="border:none;padding:0;margin:0">${o.inhoud}</fieldset>` : o.inhoud;
  const body = `
    <div class="eyebrow">${o.alleenLezen ? "Begrotingsonderdeel — alleen-lezen" : "Begrotingsonderdeel aanpassen"}</div>
    <div class="title-row"><h1>${escapeHtml(o.titel)}</h1>${o.alleenLezen ? `<span class="pill vastgesteld">Vastgesteld</span>` : `<span class="pill concept">Concept</span>`}</div>
    ${alleenLezenBanner}
    ${foutenHtml}
    <div class="card">${inhoud}</div>
    <a class="terug" href="${escapeHtml(o.terugUrl)}">← Terug naar de vergelijkende P&L</a>`;
  const navHtml = `<a href="${escapeHtml(o.terugUrl)}" class="actief">← Vergelijkende P&amp;L</a>`;
  return appShell({ titel: o.titel, navHtml, topbarContext: escapeHtml(o.titel), bodyHtml: body });
}

const geldWaarde = (d: Decimal | null): string => (d === null ? "" : d.toString());

/**
 * UX-UITROL (2026-10-02, Sectie 3) — samengestelde Onderhoud-totaalsamenvatting, gedeeld door
 * Gepland- en Correctief/Dagelijks-detailscherm (`renderGeplandOnderhoudForm`/`renderCorrectiefForm`).
 * Puur presentatie: alle bedragen komen al geformatteerd binnen (`@bvc/worker`'s `fmtBedragKort`
 * op het bestaande `OnderhoudTotaalResultaat` van `leesOnderhoudTotaalVoorWerkomgeving`) — hier
 * wordt niets opnieuw berekend of gemapt.
 */
export interface OnderhoudTotaalSamenvattingVeld {
  begrotingGepland: string;
  begrotingCorrectief: string;
  begrotingTotaal: string;
  werkelijkTotaal: string;
  resterendeVerwachtingTotaal: string;
  estimatedTotaal: string;
  verschilEstimatedVsBegroting: string;
}

function onderhoudTotaalSamenvattingHtml(s: OnderhoudTotaalSamenvattingVeld): string {
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="eyebrow">Onderhoud totaal — Gepland + Correctief/dagelijks</div>
      <table style="margin:0">
        <tbody>
          <tr><td>Begroting Gepland onderhoud</td><td style="text-align:right">${escapeHtml(s.begrotingGepland)}</td></tr>
          <tr><td>Begroting Correctief/dagelijks onderhoud</td><td style="text-align:right">${escapeHtml(s.begrotingCorrectief)}</td></tr>
          <tr><td><strong>Begroting Onderhoud totaal</strong></td><td style="text-align:right"><strong>${escapeHtml(s.begrotingTotaal)}</strong></td></tr>
          <tr><td>Werkelijk Onderhoud totaal (tot afgesloten boekperiode, niet uitgesplitst per Gepland/Correctief)</td><td style="text-align:right">${escapeHtml(s.werkelijkTotaal)}</td></tr>
          <tr><td>Resterende verwachting (Gepland + Correctief/dagelijks samen)</td><td style="text-align:right">${escapeHtml(s.resterendeVerwachtingTotaal)}</td></tr>
          <tr><td><strong>Estimated Onderhoud totaal</strong></td><td style="text-align:right"><strong>${escapeHtml(s.estimatedTotaal)}</strong></td></tr>
          <tr><td>Verschil Estimated t.o.v. Begroting</td><td style="text-align:right">${escapeHtml(s.verschilEstimatedVsBegroting)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

export interface ManagementFormOpties {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  alleenLezen?: boolean;
  huidig: { wijze: string; bedrag: string; eenheid: string; ingangsdatum: string; bestaandBedrag: string; bestaandEenheid: string; indexatiePercentage: string; indexatiedatum: string; nieuwBedrag: string; nieuweEenheid: string };
  pnlHtml?: string;
}

export function renderManagementForm(o: ManagementFormOpties): string {
  const eenheidOpties = (naam: string, huidig: string) => `<select name="${naam}"><option value="MAAND"${huidig === "MAAND" ? " selected" : ""}>per maand</option><option value="JAAR"${huidig === "JAAR" ? " selected" : ""}>per jaar</option></select>`;
  const inhoud = `
    ${o.pnlHtml ?? ""}
    <p class="sub">Kies precies één van de drie situaties (UX_03) en vul uitsluitend de bijbehorende velden in.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <label><input type="radio" name="wijze" value="NIEUWE_VERGOEDING" style="width:auto;display:inline-block;margin-right:8px"${o.huidig.wijze === "NIEUWE_VERGOEDING" ? " checked" : ""} />1. Nieuwe vergoeding (vóór ingangsdatum werkelijk €0)</label>
      <label for="bedrag">Bedrag</label><input type="text" name="bedrag" id="bedrag" value="${escapeHtml(o.huidig.bedrag)}" placeholder="bv. 500,00" />
      <label for="eenheid">Eenheid</label>${eenheidOpties("eenheid", o.huidig.eenheid)}
      <label for="ingangsdatum">Ingangsdatum (leeg = vanaf januari)</label><input type="date" name="ingangsdatum" id="ingangsdatum" value="${escapeHtml(o.huidig.ingangsdatum)}" />

      <label style="margin-top:24px"><input type="radio" name="wijze" value="INDEXEER_BESTAAND" style="width:auto;display:inline-block;margin-right:8px"${o.huidig.wijze === "INDEXEER_BESTAAND" ? " checked" : ""} />2. Bestaand bedrag indexeren</label>
      <label for="bestaandBedrag">Bestaand bedrag</label><input type="text" name="bestaandBedrag" id="bestaandBedrag" value="${escapeHtml(o.huidig.bestaandBedrag)}" />
      <label for="bestaandEenheid">Eenheid bestaand bedrag</label>${eenheidOpties("bestaandEenheid", o.huidig.bestaandEenheid)}
      <label for="indexatiePercentage">Indexatiepercentage</label><input type="text" name="indexatiePercentage" id="indexatiePercentage" value="${escapeHtml(o.huidig.indexatiePercentage)}" />
      <label for="indexatiedatum">Indexatiedatum</label><input type="date" name="indexatiedatum" id="indexatiedatum" value="${escapeHtml(o.huidig.indexatiedatum)}" />

      <label style="margin-top:24px"><input type="radio" name="wijze" value="WIJZIG_BESTAAND_BEDRAG" style="width:auto;display:inline-block;margin-right:8px"${o.huidig.wijze === "WIJZIG_BESTAAND_BEDRAG" ? " checked" : ""} />3. Bestaand bedrag vanaf een datum vervangen</label>
      <label for="nieuwBedrag">Nieuw bedrag</label><input type="text" name="nieuwBedrag" id="nieuwBedrag" value="${escapeHtml(o.huidig.nieuwBedrag)}" />
      <label for="nieuweEenheid">Eenheid nieuw bedrag</label>${eenheidOpties("nieuweEenheid", o.huidig.nieuweEenheid)}

      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Managementvergoeding", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export interface CorrectiefRegelRow {
  id: number | null;
  omschrijving: string;
  complexnummer: string;
  grootboekrekening: string;
  ogbKostensoort: string;
  jaarbedrag: string;
}

export function renderCorrectiefForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  regels: readonly CorrectiefRegelRow[];
  beoordeeld: boolean;
  alleenLezen?: boolean;
  onderhoudTotaal?: OnderhoudTotaalSamenvattingVeld;
}): string {
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 6 - o.regels.length) }, (): CorrectiefRegelRow => ({ id: null, omschrijving: "", complexnummer: "", grootboekrekening: "", ogbKostensoort: "", jaarbedrag: "" }))];
  const rijHtml = (r: CorrectiefRegelRow, i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" placeholder="Omschrijving" /></td>
      <td><input type="text" name="complexnummer_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="NTB" /></td>
      <td><input type="text" name="grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" placeholder="GL" /></td>
      <td><input type="text" name="ogbKostensoort_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" /></td>
      <td><input type="text" name="jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" placeholder="0,00" /></td>
    </tr>`;
  const samenvattingHtml = o.onderhoudTotaal !== undefined ? onderhoudTotaalSamenvattingHtml(o.onderhoudTotaal) : "";
  const inhoud = `
    ${samenvattingHtml}
    <p class="sub">Een lege regel (geen omschrijving én geen bedrag) wordt genegeerd. Bewust nul regels + beoordeeld = een bewuste €0-begroting.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Omschrijving</th><th style="text-align:left">Complex</th><th style="text-align:left">Grootboek</th><th style="text-align:left">OGB</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      <label><input type="checkbox" name="beoordeeld" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.beoordeeld ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Correctief / dagelijks onderhoud", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export function renderBtwForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  regels: readonly { id: number | null; omschrijving: string; complexnummer: string; jaarbedrag: string }[];
  beoordeeld: boolean;
  resterendeVerwachting: string;
  alleenLezen?: boolean;
  pnlHtml?: string;
}): string {
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 4 - o.regels.length) }, () => ({ id: null as number | null, omschrijving: "", complexnummer: "", jaarbedrag: "" }))];
  const rijHtml = (r: (typeof rijen)[number], i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" placeholder="Omschrijving" /></td>
      <td><input type="text" name="complexnummer_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="optioneel" /></td>
      <td><input type="text" name="jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" placeholder="0,00" /></td>
    </tr>`;
  const inhoud = `
    ${o.pnlHtml ?? ""}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Omschrijving</th><th style="text-align:left">Complex</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      <label><input type="checkbox" name="beoordeeld" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.beoordeeld ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>
      <label for="resterendeVerwachting">Estimated — verwachting resterend jaar (leeg = onbekend, 0 = geen verdere verwachting)</label>
      <input type="text" name="resterendeVerwachting" id="resterendeVerwachting" value="${escapeHtml(o.resterendeVerwachting)}" />
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Niet verrekenbare btw", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export function renderRenteForm(o: {
  categorie: "RENTEKOSTEN" | "RENTE_OPBRENGSTEN";
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  begrotingsbedrag: string;
  beoordeeld: boolean;
  resterendeVerwachting: string;
  alleenLezen?: boolean;
  pnlHtml?: string;
}): string {
  const isOpbrengst = o.categorie === "RENTE_OPBRENGSTEN";
  const toelichting = isOpbrengst
    ? `<p class="sub">Voer het verwachte bedrag als POSITIEF bedrag in — de vertaling naar de interne boekhoudconventie gebeurt automatisch.</p>`
    : `<p class="sub">Eén jaarbedrag op moduleniveau — geen leningadministratie of automatische renteberekening (Tranche 10).</p>`;
  const inhoud = `
    ${o.pnlHtml ?? ""}
    ${toelichting}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <label for="begrotingsbedrag">Begroting — jaarbedrag${isOpbrengst ? " (positief)" : ""}</label>
      <input type="text" name="begrotingsbedrag" id="begrotingsbedrag" value="${escapeHtml(o.begrotingsbedrag)}" placeholder="0,00" />
      <label><input type="checkbox" name="beoordeeld" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.beoordeeld ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>
      <label for="resterendeVerwachting">Estimated — verwachting resterend jaar${isOpbrengst ? " (positief)" : ""} (leeg = onbekend, 0 = geen verdere verwachting)</label>
      <input type="text" name="resterendeVerwachting" id="resterendeVerwachting" value="${escapeHtml(o.resterendeVerwachting)}" />
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: isOpbrengst ? "Opbrengst rente" : "Rente leningen", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export interface HuurDetailRegel {
  contractnummer: string;
  huurderNaam: string | null;
  complexnummer: string | null;
  belastOnbelast: string;
  indexatiePercentageGebruikt: string;
  indexatiePercentageBron: "ALGEMEEN" | "OVERRIDE";
  effectieveIndexatiedatum: string | null;
  bruto: string;
  korting: string;
  netto: string;
  overrideWaarde: string;
}

/**
 * Huur-detailweergave (UX_01, Tranche 12): toont de bewezen contractbasis per contract —
 * bronhuur/indexatie/override/resulterende huur/korting blijven zichtbaar onderscheiden zodat
 * later herleidbaar blijft hoe het bedrag is ontstaan (§10). Rekent zelf niets — alle bedragen
 * komen kant-en-klaar van de aanroeper (de bestaande, ongewijzigde pure Huur-motor).
 */
export function renderHuurDetail(o: {
  administratieId: string;
  versieId: string;
  terugUrl: string;
  actieUrl: string;
  begrotingsjaar: number;
  alleenLezen: boolean;
  algemeenIndexatiePercentage: string;
  regels: readonly HuurDetailRegel[];
  controleVereist: readonly string[];
  portefeuilleNetto: string;
  pnlHtml?: string;
}): string {
  const waarschuwingenHtml = o.controleVereist.length > 0 ? `<div class="banner">${o.controleVereist.map(escapeHtml).join("<br/>")}</div>` : "";
  const rijenHtml = o.regels
    .map(
      (r) => `<tr>
      <td><span class="naam">${escapeHtml(r.contractnummer)}</span><span class="naam-sub">${escapeHtml(r.huurderNaam ?? "onbekende huurder")} · complex ${escapeHtml(r.complexnummer ?? "-")}</span></td>
      <td>${escapeHtml(r.belastOnbelast)}</td>
      <td>${escapeHtml(r.indexatiePercentageGebruikt)}% (${r.indexatiePercentageBron === "OVERRIDE" ? "override" : "algemeen"})</td>
      <td>${r.effectieveIndexatiedatum ? escapeHtml(r.effectieveIndexatiedatum) : "-"}</td>
      <td>${escapeHtml(r.bruto)}</td>
      <td>${escapeHtml(r.korting)}</td>
      <td>${escapeHtml(r.netto)}</td>
      <td>${o.alleenLezen ? escapeHtml(r.overrideWaarde || "-") : `<input type="text" name="override_${escapeHtml(r.contractnummer)}" value="${escapeHtml(r.overrideWaarde)}" placeholder="algemeen" style="width:70px" />`}</td>
    </tr>`,
    )
    .join("");
  const inhoud = `
    ${o.pnlHtml ?? ""}
    ${waarschuwingenHtml}
    <div class="sub">Algemeen indexatiepercentage voor ${o.begrotingsjaar}: ${escapeHtml(o.algemeenIndexatiePercentage)}%. Een contractoverride vervangt uitsluitend het toegepaste percentage voor dat contract — de bronfeiten blijven ongewijzigd.</div>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Contract</th><th>Belast/onbelast</th><th>Indexatie</th><th>Ingangsdatum indexatie</th><th>Bruto</th><th>Korting</th><th>Netto</th><th>Override %</th></tr></thead>
        <tbody>${rijenHtml}</tbody>
      </table>
      <p class="sub">Netto huur portefeuille (Jouw begroting): <strong>${escapeHtml(o.portefeuilleNetto)}</strong></p>
      ${o.alleenLezen ? "" : `<button type="submit">Overrides opslaan</button>`}
    </form>`;
  return moduleFormShell({ titel: `Huur — contractbasis ${o.begrotingsjaar}`, terugUrl: o.terugUrl, inhoud, alleenLezen: o.alleenLezen });
}

export interface BeheerDetailRegel {
  complexnummer: string;
  vastToegepast: boolean;
  variabelToegepast: boolean;
  variabelPercentageGebruikt: string | null;
  nettoHuurGrondslag: string;
  vastNaIndexatie: string;
  variabeleVergoeding: string;
  totaleVergoeding: string;
  vastBedragJaarInvoer: string;
  vastIndexatiePercentageInvoer: string;
  vastIndexatiedatumInvoer: string;
  variabelPercentageInvoer: string;
}

/** Beheersvergoeding-detailweergave (UX_02, Tranche 12): vast/variabel apart zichtbaar, variabele grondslag = de nieuwe, contract-afgeleide netto huur uit Module 1. */
export function renderBeheerDetail(o: {
  terugUrl: string;
  actieUrl: string;
  alleenLezen: boolean;
  regels: readonly BeheerDetailRegel[];
  controleVereist: readonly string[];
  portefeuilleTotaal: string;
  pnlHtml?: string;
}): string {
  const waarschuwingenHtml = o.controleVereist.length > 0 ? `<div class="banner">${o.controleVereist.map(escapeHtml).join("<br/>")}</div>` : "";
  const rijenHtml = o.regels
    .map((r, i) =>
      o.alleenLezen
        ? `<tr>
      <td class="naam">${escapeHtml(r.complexnummer)}</td>
      <td>${r.vastToegepast ? escapeHtml(r.vastNaIndexatie) : "-"}</td>
      <td>${r.variabelToegepast ? `${escapeHtml(r.variabelPercentageGebruikt ?? "-")}% × ${escapeHtml(r.nettoHuurGrondslag)}` : "-"}</td>
      <td>${escapeHtml(r.totaleVergoeding)}</td>
    </tr>`
        : `<tr>
      <td class="naam">${escapeHtml(r.complexnummer)}</td>
      <td><input type="hidden" name="complexnummer_${i}" value="${escapeHtml(r.complexnummer)}" /><input type="text" name="vastBedrag_${i}" value="${escapeHtml(r.vastBedragJaarInvoer)}" placeholder="geen vast deel" style="width:90px" /></td>
      <td><input type="text" name="vastIndex_${i}" value="${escapeHtml(r.vastIndexatiePercentageInvoer)}" placeholder="%" style="width:50px" /></td>
      <td><input type="date" name="vastIndexDatum_${i}" value="${escapeHtml(r.vastIndexatiedatumInvoer)}" style="width:130px" /></td>
      <td><input type="text" name="variabelPercentage_${i}" value="${escapeHtml(r.variabelPercentageInvoer)}" placeholder="geen variabel deel" style="width:70px" /> × ${escapeHtml(r.nettoHuurGrondslag)}</td>
      <td>${escapeHtml(r.totaleVergoeding)}</td>
    </tr>`,
    )
    .join("");
  const inhoud = `
    ${o.pnlHtml ?? ""}
    ${waarschuwingenHtml}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Complex</th><th>Vast bedrag/jaar</th>${o.alleenLezen ? "" : "<th>Vast index %</th><th>Vast indexatiedatum</th>"}<th>Variabel % × netto huurgrondslag</th><th>Totaal</th></tr></thead>
        <tbody>${rijenHtml}</tbody>
      </table>
      <p class="sub">Totale beheersvergoeding portefeuille: <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      ${o.alleenLezen ? "" : `<button type="submit">Configuratie opslaan</button>`}
    </form>`;
  return moduleFormShell({ titel: "Beheersvergoeding", terugUrl: o.terugUrl, inhoud, alleenLezen: o.alleenLezen });
}

function beoordeeldCheckbox(naam: string, aangevinkt: boolean): string {
  return `<label><input type="checkbox" name="${naam}" value="1" style="width:auto;display:inline-block;margin-right:8px"${aangevinkt ? " checked" : ""} />Ik heb dit onderdeel beoordeeld</label>`;
}

export interface LeegstandCategorieOpties {
  categorie: string;
  titel: string;
  beoordeeld: boolean;
  regels: readonly { id: number | null; complexnummer: string; omschrijving: string; q1: string; q2: string; q3: string; q4: string }[];
}

/** Leegstandskosten (UX/OB-031, Tranche 13): drie categorieën, elk dezelfde compacte structuur Complex|Omschrijving|Q1-Q4. */
export function renderLeegstandForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; categorieen: readonly LeegstandCategorieOpties[]; portefeuilleTotaal: string; alleenLezen?: boolean; pnlHtml?: string }): string {
  const sectie = (c: LeegstandCategorieOpties, prefix: string) => {
    const rijen = [...c.regels, ...Array.from({ length: Math.max(0, 4 - c.regels.length) }, () => ({ id: null, complexnummer: "", omschrijving: "", q1: "", q2: "", q3: "", q4: "" }))];
    return `<h2>${escapeHtml(c.titel)}</h2>
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Omschrijving</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th></tr></thead>
        <tbody>${rijen
          .map(
            (r, i) => `<tr>
          <td><input type="hidden" name="${prefix}_id_${i}" value="${r.id ?? ""}" /><input type="text" name="${prefix}_complex_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="optioneel" style="width:80px" /></td>
          <td><input type="text" name="${prefix}_omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" /></td>
          <td><input type="text" name="${prefix}_q1_${i}" value="${escapeHtml(r.q1)}" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_q2_${i}" value="${escapeHtml(r.q2)}" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_q3_${i}" value="${escapeHtml(r.q3)}" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_q4_${i}" value="${escapeHtml(r.q4)}" style="width:70px" /></td>
        </tr>`,
          )
          .join("")}</tbody>
      </table>
      ${beoordeeldCheckbox(`${prefix}_beoordeeld`, c.beoordeeld)}`;
  };
  const inhoud = `
    ${o.pnlHtml ?? ""}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      ${sectie(o.categorieen[0]!, "nuts")}
      ${sectie(o.categorieen[1]!, "service")}
      ${sectie(o.categorieen[2]!, "overige")}
      <p class="sub">Totaal Leegstandskosten (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Leegstandskosten", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export interface AlgemeneKostenCategorieOpties {
  categorie: string;
  titel: string;
  beoordeeld: boolean;
  vorigJaarBedrag: string;
  verwachteVerhogingPercentage: string;
  toonVoorstelVelden: boolean;
  regels: readonly { id: number | null; omschrijving: string; complexnummer: string; ogbKostensoortCode: string; jaarbedrag: string }[];
}

/** Algemene kosten (OB-035/036, Tranche 13): vijf categorieën, elk dezelfde regelvorm (Omschrijving|Complex|OGB|Jaarbedrag); Accountant/Bank tonen aanvullend het informatieve vorig-jaar/verwachte-verhoging-voorstel. */
export function renderAlgemeneKostenForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; categorieen: readonly AlgemeneKostenCategorieOpties[]; portefeuilleTotaal: string; alleenLezen?: boolean; pnlHtml?: string }): string {
  const sectie = (c: AlgemeneKostenCategorieOpties, prefix: string) => {
    const rijen = [...c.regels, ...Array.from({ length: Math.max(0, 3 - c.regels.length) }, () => ({ id: null, omschrijving: "", complexnummer: "", ogbKostensoortCode: "", jaarbedrag: "" }))];
    const voorstelHtml = c.toonVoorstelVelden
      ? `<p class="sub">Voorstel (informatief): vorig jaar <input type="text" name="${prefix}_vorigJaar" value="${escapeHtml(c.vorigJaarBedrag)}" style="width:90px;display:inline-block" /> + verwachte verhoging <input type="text" name="${prefix}_verhoging" value="${escapeHtml(c.verwachteVerhogingPercentage)}" style="width:60px;display:inline-block" />%</p>`
      : "";
    return `<h2>${escapeHtml(c.titel)}</h2>
      ${voorstelHtml}
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Omschrijving</th><th style="text-align:left">Complex</th><th style="text-align:left">OGB</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${rijen
          .map(
            (r, i) => `<tr>
          <td><input type="hidden" name="${prefix}_id_${i}" value="${r.id ?? ""}" /><input type="text" name="${prefix}_omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" /></td>
          <td><input type="text" name="${prefix}_complex_${i}" value="${escapeHtml(r.complexnummer)}" placeholder="optioneel" style="width:80px" /></td>
          <td><input type="text" name="${prefix}_ogb_${i}" value="${escapeHtml(r.ogbKostensoortCode)}" placeholder="optioneel" style="width:70px" /></td>
          <td><input type="text" name="${prefix}_jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" style="width:90px" /></td>
        </tr>`,
          )
          .join("")}</tbody>
      </table>
      ${beoordeeldCheckbox(`${prefix}_beoordeeld`, c.beoordeeld)}`;
  };
  const prefixen = ["accountant", "juridisch", "makelaar", "algemeen", "bank"];
  const inhoud = `
    ${o.pnlHtml ?? ""}
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      ${o.categorieen.map((c, i) => sectie(c, prefixen[i]!)).join("<hr style=\"border:none;border-top:1px solid var(--line);margin:20px 0\" />")}
      <p class="sub">Totaal Algemene kosten (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Algemene kosten", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export interface VerzekeringRegelVeld {
  id: number | null;
  complexnummer: string;
  verzekeraar: string;
  grootboekrekening: string;
  ogbKostensoort: string;
  ingangsdatum: string;
  looptijdMaanden: string;
  bedrag: string;
  indexPercentage: string;
  handmatigBegrootOverride: string;
}

/** Verzekeringen (UX_06, Tranche 13): compacte polisregels Complex|Verzekeraar|Ingangsdatum|Looptijd|Bedrag|Index%|GL|OGB|Override. */
export function renderVerzekeringenForm(o: { actieUrl: string; terugUrl: string; fouten?: readonly string[]; regels: readonly VerzekeringRegelVeld[]; beoordeeld: boolean; portefeuilleTotaal: string; alleenLezen?: boolean; pnlHtml?: string }): string {
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 6 - o.regels.length) }, (): VerzekeringRegelVeld => ({ id: null, complexnummer: "", verzekeraar: "", grootboekrekening: "", ogbKostensoort: "", ingangsdatum: "", looptijdMaanden: "", bedrag: "", indexPercentage: "", handmatigBegrootOverride: "" }))];
  const rijHtml = (r: VerzekeringRegelVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="complex_${i}" value="${escapeHtml(r.complexnummer)}" style="width:70px" /></td>
      <td><input type="text" name="verzekeraar_${i}" value="${escapeHtml(r.verzekeraar)}" style="width:110px" /></td>
      <td><input type="text" name="grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" style="width:60px" /></td>
      <td><input type="text" name="ogb_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" style="width:60px" /></td>
      <td><input type="date" name="ingangsdatum_${i}" value="${escapeHtml(r.ingangsdatum)}" style="width:130px" /></td>
      <td><input type="text" name="looptijd_${i}" value="${escapeHtml(r.looptijdMaanden)}" style="width:50px" /></td>
      <td><input type="text" name="bedrag_${i}" value="${escapeHtml(r.bedrag)}" style="width:80px" /></td>
      <td><input type="text" name="index_${i}" value="${escapeHtml(r.indexPercentage)}" style="width:50px" /></td>
      <td><input type="text" name="override_${i}" value="${escapeHtml(r.handmatigBegrootOverride)}" placeholder="berekend" style="width:80px" /></td>
    </tr>`;
  const inhoud = `
    ${o.pnlHtml ?? ""}
    <p class="sub">Override laat het berekende voorstel (huidige premie × indexatie) staan tenzij ingevuld.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Verzekeraar</th><th style="text-align:left">GL</th><th style="text-align:left">OGB</th><th>Ingangsdatum</th><th>Looptijd (mnd)</th><th>Jaarpremie</th><th>Index %</th><th>Override</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      ${beoordeeldCheckbox("beoordeeld", o.beoordeeld)}
      <p class="sub">Totaal Verzekeringen (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Verzekeringen", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export interface GeplandOnderhoudRegelVeld {
  id: number | null;
  complexnummer: string;
  omschrijving: string;
  grootboekrekening: string;
  ogbKostensoort: string;
  aanleidingType: string;
  aanleidingToelichting: string;
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  status: string;
  leverancier: string;
  offertebedrag: string;
  notitie: string;
}

const AANLEIDING_OPTIES = ["MJOP", "INSPECTIE", "OFFERTE", "OVERIG"];
const STATUS_OPTIES = ["GEPLAND", "IN_UITVOERING", "UITGESTELD", "VERVALLEN", "AFGEROND", "ONVOORZIEN"];

/** Gepland onderhoud (UX_04, Tranche 13): handmatige activiteiten per complex, Q1-Q4, bron/status. Werkelijk/Estimated bestaan uitsluitend op Onderhoud-totaalniveau (§16/§17) — hier bewust niet per activiteit getoond. */
export function renderGeplandOnderhoudForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  regels: readonly GeplandOnderhoudRegelVeld[];
  beoordeeld: boolean;
  jaartotaal: string;
  alleenLezen?: boolean;
  onderhoudTotaal?: OnderhoudTotaalSamenvattingVeld;
}): string {
  const leeg = (): GeplandOnderhoudRegelVeld => ({ id: null, complexnummer: "", omschrijving: "", grootboekrekening: "", ogbKostensoort: "", aanleidingType: "", aanleidingToelichting: "", q1: "", q2: "", q3: "", q4: "", status: "GEPLAND", leverancier: "", offertebedrag: "", notitie: "" });
  const rijen = [...o.regels, ...Array.from({ length: Math.max(0, 5 - o.regels.length) }, leeg)];
  const opties = (waarden: readonly string[], huidig: string, naam: string) =>
    `<select name="${naam}"><option value=""${huidig ? "" : " selected"}>-</option>${waarden.map((w) => `<option value="${w}"${w === huidig ? " selected" : ""}>${w}</option>`).join("")}</select>`;
  const rijHtml = (r: GeplandOnderhoudRegelVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="id_${i}" value="${r.id ?? ""}" /><input type="text" name="complex_${i}" value="${escapeHtml(r.complexnummer)}" style="width:60px" /></td>
      <td><input type="text" name="omschrijving_${i}" value="${escapeHtml(r.omschrijving)}" style="width:130px" /></td>
      <td><input type="text" name="grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" style="width:60px" /></td>
      <td><input type="text" name="ogb_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" style="width:60px" /></td>
      <td>${opties(AANLEIDING_OPTIES, r.aanleidingType, `aanleiding_${i}`)}<input type="text" name="toelichting_${i}" value="${escapeHtml(r.aanleidingToelichting)}" placeholder="toelichting" style="width:100px" /></td>
      <td><input type="text" name="q1_${i}" value="${escapeHtml(r.q1)}" style="width:60px" /></td>
      <td><input type="text" name="q2_${i}" value="${escapeHtml(r.q2)}" style="width:60px" /></td>
      <td><input type="text" name="q3_${i}" value="${escapeHtml(r.q3)}" style="width:60px" /></td>
      <td><input type="text" name="q4_${i}" value="${escapeHtml(r.q4)}" style="width:60px" /></td>
      <td>${opties(STATUS_OPTIES, r.status, `status_${i}`)}</td>
      <td><input type="text" name="leverancier_${i}" value="${escapeHtml(r.leverancier)}" placeholder="optioneel" style="width:90px" /></td>
      <td><input type="text" name="offertebedrag_${i}" value="${escapeHtml(r.offertebedrag)}" placeholder="optioneel" style="width:70px" /></td>
      <td><input type="text" name="notitie_${i}" value="${escapeHtml(r.notitie)}" placeholder="optioneel" style="width:90px" /></td>
    </tr>`;
  const samenvattingHtml = o.onderhoudTotaal !== undefined ? onderhoudTotaalSamenvattingHtml(o.onderhoudTotaal) : "";
  const inhoud = `
    ${samenvattingHtml}
    <p class="sub">Werkelijk is alleen beschikbaar voor Onderhoud totaal (Gepland + Correctief/dagelijks samen) — er is bewust geen Werkelijk per activiteit.</p>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <table style="margin-bottom:16px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Omschrijving</th><th style="text-align:left">GL</th><th style="text-align:left">OGB</th><th style="text-align:left">Bron</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Status</th><th style="text-align:left">Leverancier</th><th>Offerte</th><th style="text-align:left">Notitie</th></tr></thead>
        <tbody>${rijen.map(rijHtml).join("")}</tbody>
      </table>
      ${beoordeeldCheckbox("beoordeeld", o.beoordeeld)}
      <p class="sub">Jaartotaal Gepland onderhoud: <strong>${escapeHtml(o.jaartotaal)}</strong> (telt samen met Correctief/dagelijks op tot de P&L-post Onderhoud)</p>
      <button type="submit">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Gepland onderhoud", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export interface WozObjectVeld {
  id: number | null;
  complexnummer: string;
  objectType: string;
  unitnummer: string;
  aanslagjaar: string;
  waardepeildatum: string;
  werkelijkeWoz: string;
  verwachteWozOverride: string;
}

export interface GemeentelijkeLastenRegelVeld {
  id: number | null;
  grootboekrekening: string;
  ogbKostensoort: string;
  jaarbedrag: string;
}

/** Gemeentelijke lasten / WOZ (UX_08, Tranche 13): GL-regels (het echte P&L-begrotingsbedrag), WOZ-historie (bronbasis voor het voorstel), en de twee aannamepercentages — exact het bestaande, geaccepteerde model. */
export function renderGemeentelijkeLastenForm(o: {
  actieUrl: string;
  terugUrl: string;
  fouten?: readonly string[];
  relevanteGrootboeken: readonly string[];
  glRegels: readonly GemeentelijkeLastenRegelVeld[];
  wozObjecten: readonly WozObjectVeld[];
  wozStijgingPercentage: string;
  lastenPercentageStijging: string;
  begrotingsPercentageOverride: string;
  werkelijkeGemeentelijkeLasten: string;
  beoordeeld: boolean;
  wozSetBevestigd: boolean;
  voorstelMogelijk: boolean;
  voorstelReden: string | null;
  portefeuilleTotaal: string;
  alleenLezen?: boolean;
  pnlHtml?: string;
}): string {
  const glRijen = [...o.glRegels, ...Array.from({ length: Math.max(0, 3 - o.glRegels.length) }, (): GemeentelijkeLastenRegelVeld => ({ id: null, grootboekrekening: "", ogbKostensoort: "", jaarbedrag: "" }))];
  const glRijHtml = (r: GemeentelijkeLastenRegelVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="gl_id_${i}" value="${r.id ?? ""}" /><input type="text" name="gl_grootboekrekening_${i}" value="${escapeHtml(r.grootboekrekening)}" list="relevanteGrootboeken" style="width:80px" /></td>
      <td><input type="text" name="gl_ogb_${i}" value="${escapeHtml(r.ogbKostensoort)}" placeholder="optioneel" style="width:70px" /></td>
      <td><input type="text" name="gl_jaarbedrag_${i}" value="${escapeHtml(r.jaarbedrag)}" style="width:100px" /></td>
    </tr>`;
  const wozRijen = [...o.wozObjecten, ...Array.from({ length: Math.max(0, 3 - o.wozObjecten.length) }, (): WozObjectVeld => ({ id: null, complexnummer: "", objectType: "GEHEEL_COMPLEX", unitnummer: "", aanslagjaar: "", waardepeildatum: "", werkelijkeWoz: "", verwachteWozOverride: "" }))];
  const wozRijHtml = (r: WozObjectVeld, i: number) => `
    <tr>
      <td><input type="hidden" name="woz_id_${i}" value="${r.id ?? ""}" /><input type="text" name="woz_complex_${i}" value="${escapeHtml(r.complexnummer)}" style="width:70px" /></td>
      <td><select name="woz_objectType_${i}"><option value="GEHEEL_COMPLEX"${r.objectType === "GEHEEL_COMPLEX" ? " selected" : ""}>Geheel complex</option><option value="UNIT"${r.objectType === "UNIT" ? " selected" : ""}>Unit</option></select></td>
      <td><input type="text" name="woz_unit_${i}" value="${escapeHtml(r.unitnummer)}" placeholder="optioneel" style="width:60px" /></td>
      <td><input type="text" name="woz_aanslagjaar_${i}" value="${escapeHtml(r.aanslagjaar)}" style="width:70px" /></td>
      <td><input type="date" name="woz_waardepeildatum_${i}" value="${escapeHtml(r.waardepeildatum)}" style="width:130px" /></td>
      <td><input type="text" name="woz_werkelijk_${i}" value="${escapeHtml(r.werkelijkeWoz)}" style="width:100px" /></td>
      <td><input type="text" name="woz_override_${i}" value="${escapeHtml(r.verwachteWozOverride)}" placeholder="automatisch" style="width:100px" /></td>
    </tr>`;
  const voorstelKnop = o.voorstelMogelijk
    ? `<button type="submit" name="actie" value="voorstelOvernemen" class="secundair">Voorstel overnemen</button>`
    : o.voorstelReden !== null
      ? `<p class="sub">Voorstel overnemen niet mogelijk: ${escapeHtml(o.voorstelReden)}</p>`
      : "";
  const inhoud = `
    ${o.pnlHtml ?? ""}
    <datalist id="relevanteGrootboeken">${o.relevanteGrootboeken.map((gl) => `<option value="${escapeHtml(gl)}">`).join("")}</datalist>
    <form method="POST" action="${escapeHtml(o.actieUrl)}">
      <h2>Begroting per grootboekrekening</h2>
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Grootboek</th><th style="text-align:left">OGB</th><th style="text-align:left">Jaarbedrag</th></tr></thead>
        <tbody>${glRijen.map(glRijHtml).join("")}</tbody>
      </table>
      <p class="sub">Relevante grootboekrekeningen voor deze administratie: ${o.relevanteGrootboeken.length > 0 ? o.relevanteGrootboeken.map(escapeHtml).join(", ") : "geen bewezen mapping gevonden"}.</p>
      ${voorstelKnop}

      <h2>WOZ-historie</h2>
      <table style="margin-bottom:10px">
        <thead><tr><th style="text-align:left">Complex</th><th style="text-align:left">Type</th><th style="text-align:left">Unit</th><th>Aanslagjaar</th><th>Waardepeildatum</th><th>Werkelijke WOZ</th><th>Verwachte WOZ (override)</th></tr></thead>
        <tbody>${wozRijen.map(wozRijHtml).join("")}</tbody>
      </table>
      <label><input type="checkbox" name="wozSetBevestigd" value="1" style="width:auto;display:inline-block;margin-right:8px"${o.wozSetBevestigd ? " checked" : ""} />De WOZ-set is compleet (verplicht om vast te kunnen stellen)</label>

      <h2>Aannames</h2>
      <label for="wozStijging">Verwachte WOZ-stijging %</label><input type="text" name="wozStijging" id="wozStijging" value="${escapeHtml(o.wozStijgingPercentage)}" />
      <label for="lastenStijging">Verwachte stijging lastenpercentage %</label><input type="text" name="lastenStijging" id="lastenStijging" value="${escapeHtml(o.lastenPercentageStijging)}" />
      <label for="percentageOverride">Handmatige override lastenpercentage % (optioneel)</label><input type="text" name="percentageOverride" id="percentageOverride" value="${escapeHtml(o.begrotingsPercentageOverride)}" />
      <label for="werkelijkeLasten">Werkelijke totale gemeentelijke lasten (optioneel, voor het historisch percentage)</label><input type="text" name="werkelijkeLasten" id="werkelijkeLasten" value="${escapeHtml(o.werkelijkeGemeentelijkeLasten)}" />
      ${beoordeeldCheckbox("beoordeeld", o.beoordeeld)}

      <p class="sub">Totaal Gemeentelijke lasten pand (Jouw begroting): <strong>${escapeHtml(o.portefeuilleTotaal)}</strong></p>
      <button type="submit" name="actie" value="opslaan">Opslaan</button>
    </form>`;
  return moduleFormShell({ titel: "Gemeentelijke lasten / WOZ", terugUrl: o.terugUrl, ...(o.fouten !== undefined ? { fouten: o.fouten } : {}), inhoud, alleenLezen: o.alleenLezen === true });
}

export { geldWaarde };
export { paginaShell };
