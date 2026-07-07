import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell, ComposedChart, Area,
  ReferenceLine } from "recharts";

// ── Design tokens ─────────────────────────────────────────────────────────
const C = {
  navy:      "#1F3864",
  navyMid:   "#2F5597",
  navyLight: "#D9E1F2",
  bg:        "#F4F5F7",
  white:     "#FFFFFF",
  grey1:     "#F0F1F3",
  grey2:     "#E2E4E9",
  grey3:     "#9AA1B4",
  text:      "#1A1D2E",
  textSub:   "#5A6070",
  green:     "#2D6A4F",
  greenL:    "#E2EFDA",
  greenDark: "#375623",
  orange:    "#C55A11",
  orangeL:   "#FCE4D6",
  yellow:    "#7B6200",
  yellowL:   "#FFF2CC",
  red:       "#C00000",
};

const NL = (n) => n == null ? "–" : `€\u00A0${Math.round(n).toLocaleString("nl-NL")}`;
const PCT = (n) => `${(n * 100).toFixed(1)}%`;
const toQ = (p) => p <= 3 ? "Q1" : p <= 6 ? "Q2" : p <= 9 ? "Q3" : "Q4";

const KWARTAAL_OPTIES = [
  { waarde: 1, label: "1e kwartaal (Q1)" },
  { waarde: 2, label: "2e kwartaal (Q2)" },
  { waarde: 3, label: "3e kwartaal (Q3)" },
  { waarde: 4, label: "4e kwartaal (Q4)" },
];
const periodeLabel = (kwartaal, jaar) =>
  ({ 1: `Q1 ${jaar}`, 2: `H1 ${jaar}`, 3: `9M ${jaar}`, 4: `FY ${jaar}` }[kwartaal] || `Q${kwartaal} ${jaar}`);
const periodeEindDatum = (kwartaal, jaar) =>
  ({ 1: `31 maart ${jaar}`, 2: `30 juni ${jaar}`, 3: `30 september ${jaar}`, 4: `31 december ${jaar}` }[kwartaal]);
const periodeEindDatumKort = (kwartaal, jaar) =>
  ({ 1: `31-03-${jaar}`, 2: `30-06-${jaar}`, 3: `30-09-${jaar}`, 4: `31-12-${jaar}` }[kwartaal]);

// ── Portfolios ─────────────────────────────────────────────────────────────
const PORTFOLIOS = {
  gvh: {
    label: "Gebroeders van Houtum",
    sub: "Rooise Zoom · Veghel",
    kleur: C.navy,
    complexen: { 1: "Villa I", 2: "Villa II", 3: "Villa III", 4: "Sportpark" },
    svc_excl_complex: [4],
    bestanden: [
      { key: "boekingen",     label: "IDBC Boekingen",       verplicht: true  },
      { key: "servicekosten", label: "IDBC Servicekosten",   verplicht: true  },
      { key: "balans",        label: "IDBC Balans per jaar", verplicht: true  },
      { key: "exploitatie",   label: "IDBC Exploitatie",     verplicht: false },
      { key: "rentroll",      label: "IDBC Rent Roll",       verplicht: false },
      { key: "begroting",     label: "Begroting 2026",       verplicht: false },
    ],
  },
  fergagne: {
    label: "Fergagne BV",
    sub: "Pater van den Elsenlaan · Veghel",
    kleur: C.greenDark,
    complexen: {},
    svc_excl_complex: [],
    bestanden: [
      { key: "boekingen",     label: "IDBC Boekingen",       verplicht: true  },
      { key: "servicekosten", label: "IDBC Servicekosten",   verplicht: true  },
      { key: "balans",        label: "IDBC Balans per jaar", verplicht: true  },
      { key: "exploitatie",   label: "IDBC Exploitatie",     verplicht: false },
      { key: "rentroll",      label: "IDBC Rent Roll",       verplicht: false },
      { key: "begroting",     label: "Begroting 2026",       verplicht: false },
    ],
  },
};

// ── Data verwerking ────────────────────────────────────────────────────────
function parseXLSX(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheets = {};
        wb.SheetNames.forEach(n => {
          sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
        });
        res(sheets);
      } catch (err) { rej(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

function verwerkBoekingen(rows, complexFilter = null, unitFilter = null, jaar = 2026, kwartaal = 2) {
  const jaarVorig = jaar - 1;
  const jaarKort = String(jaar).slice(-2);
  const jaarVorigKort = String(jaarVorig).slice(-2);

  let data = rows.map(r => ({
    ...r,
    netto: (r.Boeking_Bedrag_Debet || 0) - (r.Boeking_Bedrag_Credit || 0),
    kwartaal: toQ(r.Boeking_Boekperiode || 1),
  }));
  if (complexFilter) data = data.filter(r => r.Boeking_Complexnr === complexFilter);
  if (unitFilter)    data = data.filter(r => r.Boeking_Unitnr === unitFilter);

  const sumGB = (jr, kw, gb, excl = []) => {
    const gbl = Array.isArray(gb) ? gb : [gb];
    return data.filter(r =>
      r.Boeking_Boekjaar === jr && r.kwartaal === kw &&
      gbl.includes(r.Boeking_Grootboeknr) &&
      !excl.includes(r.Boeking_OGB_Kostensoort_Omschr)
    ).reduce((s, r) => s + r.netto, 0);
  };

  const huurKw = (jr, kw) =>
    Math.abs(sumGB(jr, kw, [8800, 8801], ["Afrekening huurders"]));

  const KWARTALEN = ["Q1","Q2","Q3","Q4"];
  const Q_HUIDIG = KWARTALEN.slice(0, kwartaal);

  const periodeHuidig = Q_HUIDIG.reduce((s,q) => s + huurKw(jaar,q), 0);
  const periodeVorig  = Q_HUIDIG.reduce((s,q) => s + huurKw(jaarVorig,q), 0);
  const fyVorig       = KWARTALEN.reduce((s,q) => s + huurKw(jaarVorig,q), 0);

  const ontt_q = {};
  const bank_q = {};
  [jaarVorig, jaar].forEach(j => KWARTALEN.forEach(q => {
    ontt_q[`${j}_${q}`] = sumGB(j, q, 840);
    bank_q[`${j}_${q}`] = sumGB(j, q, 1010);
  }));

  const onttrekkingHuidig = Q_HUIDIG.reduce((s,q) => s + (ontt_q[`${jaar}_${q}`]||0), 0);
  const ratioHuidig = periodeHuidig > 0 ? onttrekkingHuidig / periodeHuidig : 0;

  const huurTrend = KWARTALEN.map(q => ({
    kw: q,
    vorig: huurKw(jaarVorig, q),
    huidig: huurKw(jaar, q),
  }));

  // Per complex huurverdeling
  const complexen = [...new Set(data.map(r => r.Boeking_Complexnr).filter(Boolean))].sort();
  const huurPerComplex = complexen.map(cx => {
    const lbl = data.find(r => r.Boeking_Complexnr === cx)?.Complexomschrijving || `Complex ${cx}`;
    return {
      complex: lbl.split("(")[0].trim().substring(0, 15),
      vorig: Math.abs(data.filter(r =>
        r.Boeking_Boekjaar===jaarVorig && Q_HUIDIG.includes(r.kwartaal) &&
        r.Boeking_Complexnr===cx && r.Boeking_Grootboeknr===8800
      ).reduce((s,r)=>s+r.netto,0)),
      huidig: Math.abs(data.filter(r =>
        r.Boeking_Boekjaar===jaar && Q_HUIDIG.includes(r.kwartaal) &&
        r.Boeking_Complexnr===cx && r.Boeking_Grootboeknr===8800
      ).reduce((s,r)=>s+r.netto,0)),
    };
  }).filter(c => c.huidig > 0 || c.vorig > 0);

  // Bankstand opbouwen (startpunt is een vaste historische referentiewaarde)
  const BANK_START = -13227;
  let s = BANK_START;
  const bankStand = KWARTALEN.map(q => {
    s += bank_q[`${jaarVorig}_${q}`] || 0;
    return { kw: `${q} '${jaarVorigKort}`, stand: Math.round(s), jaar: jaarVorig };
  });
  let s2 = s;
  Q_HUIDIG.forEach(q => {
    s2 += bank_q[`${jaar}_${q}`] || 0;
    bankStand.push({ kw: `${q} '${jaarKort}`, stand: Math.round(s2), jaar });
  });
  const bankstandHuidig = s2;

  // Kasstroom tabel
  const kasstroomData = [
    ...KWARTALEN.map(q => ({
      kw: `${q} '${jaarVorigKort}`, jaar: jaarVorig,
      huur: huurKw(jaarVorig,q),
      exploitatie: Math.abs(sumGB(jaarVorig,q,[4000,4130,4200,4300,4305,4310,4330,4340,4350,4508,4700,4710,4903,4990,4992])),
      onttrekking: Math.abs(ontt_q[`${jaarVorig}_${q}`]||0),
      netto: bank_q[`${jaarVorig}_${q}`]||0,
    })),
    ...Q_HUIDIG.map(q => ({
      kw: `${q} '${jaarKort}`, jaar,
      huur: huurKw(jaar,q),
      exploitatie: Math.abs(sumGB(jaar,q,[4000,4130,4200,4300,4305,4310,4330,4340,4350,4508,4700,4710,4903,4990,4992])),
      onttrekking: Math.abs(ontt_q[`${jaar}_${q}`]||0),
      netto: bank_q[`${jaar}_${q}`]||0,
    })),
  ].map(r => ({ ...r, ratio: r.huur > 0 ? r.onttrekking / r.huur : 0 }));

  // Units beschikbaar
  const units = [...new Set(data.map(r => r.Boeking_Unitnr).filter(Boolean))];

  // P&L data — "_25"/"_26" zijn interne sleutels voor "vorig jaar"/"huidig jaar"
  const plData = [];
  const EXCL_BK = ["Afrekening huurders"];

  const plRijen = [
    { label:"Huuropbrengst belast",    gb:[8800], sign:-1 },
    { label:"Huuropbrengst onbelast",  gb:[8801], sign:-1 },
    { label:"Verleende huurkorting",   gb:[8805,9400], sign:1 },
    { label:"Zonnestroom",             gb:[8815], sign:-1 },
    { label:"Beheerkosten",            gb:[4000], sign:1 },
    { label:"Verzekeringen",           gb:[4130], sign:1 },
    { label:"Onderhoud gebouwen",      gb:[4300,4305], sign:1 },
    { label:"Onderhoud installaties",  gb:[4340], sign:1 },
    { label:"Onderhoud terrein",       gb:[4330], sign:1 },
    { label:"Servicekosten eigenaar",  gb:[4350], sign:1 },
    { label:"OZB / WOZ",              gb:[4700], sign:1 },
    { label:"Gemeentelijke heffingen", gb:[4710], sign:1 },
    { label:"Niet verr. BTW",         gb:[4903], sign:1 },
    { label:"Diverse alg. kosten",     gb:[4990], sign:1 },
  ];

  plRijen.forEach(rij => {
    const row = { label: rij.label };
    KWARTALEN.forEach(q => {
      row[`q${q.toLowerCase()}_25`] = rij.sign * sumGB(jaarVorig, q, rij.gb, EXCL_BK);
    });
    Q_HUIDIG.forEach(q => {
      row[`q${q.toLowerCase()}_26`] = rij.sign * sumGB(jaar, q, rij.gb, EXCL_BK);
    });
    plData.push(row);
  });

  return {
    jaar, jaarVorig, kwartaal,
    periodeHuidig, periodeVorig, fyVorig, onttrekkingHuidig, ratioHuidig, bankstandHuidig,
    huurTrend, huurPerComplex, bankStand, kasstroomData,
    plData, units, ontt_q, bank_q,
    complexen: complexen.map(cx => ({
      nr: cx,
      naam: data.find(r => r.Boeking_Complexnr === cx)?.Complexomschrijving || `Complex ${cx}`,
    })),
  };
}

function verwerkSvc(rows, complexFilter = null, jaar = 2026, kwartaal = 2) {
  const jaarVorig = jaar - 1;
  const periodes = kwartaal * 3;
  const EXCL = ["Afrekening huurders","Voorschot service"];
  let d = rows;
  if (complexFilter) d = d.filter(r => r.Service_Begroting_Complex === complexFilter);

  const periodeSom = (jr, excl = EXCL) => {
    const sub = d.filter(r =>
      r.Service_Begroting_Jaar === jr && !excl.includes(r.Service_Kostensoort_Naam)
    );
    return sub.reduce((s, r) => {
      for (let i=1;i<=periodes;i++) s += r[`Service_Geboekt_periode_${String(i).padStart(2,"0")}`] || 0;
      return s;
    }, 0);
  };

  const byKs = (jr) => {
    const sub = d.filter(r =>
      r.Service_Begroting_Jaar === jr && !EXCL.includes(r.Service_Kostensoort_Naam)
    );
    const m = {};
    sub.forEach(r => {
      const k = r.Service_Kostensoort_Naam;
      for (let i=1;i<=periodes;i++) m[k] = (m[k]||0) + (r[`Service_Geboekt_periode_${String(i).padStart(2,"0")}`]||0);
    });
    return m;
  };

  const vscSom = (jr) => d.filter(r =>
    r.Service_Begroting_Jaar === jr && r.Service_Kostensoort_Naam === "Voorschot service"
  ).reduce((s,r) => {
    for(let i=1;i<=periodes;i++) s += r[`Service_Geboekt_periode_${String(i).padStart(2,"0")}`]||0;
    return s;
  }, 0);

  const tot26 = periodeSom(jaar), tot25 = periodeSom(jaarVorig);
  const vsc25 = vscSom(jaarVorig), vsc26 = vscSom(jaar);
  const ks25 = byKs(jaarVorig), ks26 = byKs(jaar);

  const svcVgl = Object.keys({...ks25,...ks26})
    .map(k => ({
      naam: k.length>22?k.slice(0,22)+"…":k,
      vorig: Math.round(ks25[k]||0),
      huidig: Math.round(ks26[k]||0),
    }))
    .filter(r => r.vorig>50 || r.huidig>50)
    .sort((a,b) => b.huidig-a.huidig)
    .slice(0,12);

  const svcDetail = Object.keys({...ks25,...ks26})
    .map(k => ({
      ks: k,
      h1_25: Math.round(ks25[k]||0),
      h1_26: Math.round(ks26[k]||0),
      delta: Math.round((ks26[k]||0)-(ks25[k]||0)),
    }))
    .filter(r => r.h1_25>50 || r.h1_26>50)
    .sort((a,b) => b.h1_26-a.h1_26);

  return { jaar, jaarVorig, kwartaal, tot26, tot25, vsc25, vsc26, saldo26: tot26+vsc26, saldo25: tot25+vsc25, svcVgl, svcDetail };
}

function verwerkBalans(rows, jaar = 2026, kwartaal = 2) {
  const jaarVorig = jaar - 1;
  const periodeCode = String(kwartaal * 3).padStart(2, "0");
  // Huidig jaar: saldo t/m het gekozen kwartaal. Vorig jaar: altijd volledig boekjaar (vergelijking t.o.v. jaarstart).
  const saldoHuidig = (gb) => {
    const r = rows.find(r => r.Jaar===jaar && r.Grootboekrekeningnr===gb);
    if (!r) return 0;
    return r[`Saldo_tm_periode_${periodeCode}`] ?? r.Eindsaldo ?? ((r.Saldo_debet||0)-(r.Saldo_credit||0));
  };
  const saldoVorig = (gb) => {
    const r = rows.find(r => r.Jaar===jaarVorig && r.Grootboekrekeningnr===gb);
    if (!r) return 0;
    return r.Eindsaldo ?? r.Saldo_tm_periode_12 ?? ((r.Saldo_debet||0)-(r.Saldo_credit||0));
  };
  return {
    jaar, jaarVorig, kwartaal,
    bank25: saldoVorig(1010), bank26: saldoHuidig(1010),
    deb25: Math.abs(saldoVorig(1310)), deb26: Math.abs(saldoHuidig(1310)),
    cred25: Math.abs(saldoVorig(1600)), cred26: Math.abs(saldoHuidig(1600)),
    vsc25: Math.abs(saldoVorig(1712)), vsc26: Math.abs(saldoHuidig(1712)),
    ev25: saldoVorig(850), ev26: saldoHuidig(850),
  };
}

function verwerkRentRoll(rows) {
  return rows
    .filter(r => r.Vorderingsoort === 1)
    .map(r => ({
      huurder:    r.Huurder_naam_1,
      unit:       r.Unitnummer,
      unit_omschr:r.Unit_omschrijving,
      unit_adres: r.Unit_adres,
      complex_nr: r.Complexnummer,
      complex:    r.Complex_omschrijving,
      m2:         r.Gehuurd_oppervlak || r["m2/Verhuur"] || 0,
      jaarhuur:   r.Prolongatie_bedrag_jaar || 0,
      vsc_jaar:   r.Service_voorschot_jaar || 0,
      ingang:     r.Contract_ingangsdatum,
      einde:      r.Contract_afloopdatum,
      rest:       r.Restant_looptijd || 0,
      indexering: r.Indexeringspercentage || r.Indexering_percentage || null,
      index_datum:r.Indexeringsdatum || null,
    }))
    .sort((a,b) => a.rest - b.rest);
}

// ── Claude AI analyse ──────────────────────────────────────────────────────
async function haalAIAnalyse(portfolioLabel, kpis) {
  const jaar = kpis.jaar, jaarVorig = kpis.jaarVorig, kwartaal = kpis.kwartaal;
  const labelHuidig = periodeLabel(kwartaal, jaar);
  const labelVorig  = periodeLabel(kwartaal, jaarVorig);
  const prompt = `Je bent een Nederlandse vastgoed asset manager. Geef een beknopte managementsamenvatting in 4-5 zinnen in het Nederlands op basis van onderstaande ${labelHuidig} cijfers voor ${portfolioLabel}. Wees concreet met bedragen en noem 2-3 opvallende punten.

Huurinkomen ${labelHuidig}: €${Math.round(kpis.periodeHuidig).toLocaleString("nl-NL")}
Huurinkomen ${labelVorig}: €${Math.round(kpis.periodeVorig).toLocaleString("nl-NL")}
Groei: ${((kpis.periodeHuidig-kpis.periodeVorig)/kpis.periodeVorig*100).toFixed(1)}%
Eigenaarsonttrekkingen ${labelHuidig}: €${Math.round(kpis.onttrekkingHuidig).toLocaleString("nl-NL")}
Uitbetalingsratio: ${(kpis.ratioHuidig*100).toFixed(1)}%
Servicekosten ${labelHuidig}: €${Math.round(kpis.svc?.tot26||0).toLocaleString("nl-NL")}
Servicekosten ${labelVorig}: €${Math.round(kpis.svc?.tot25||0).toLocaleString("nl-NL")}
Bankstand eind ${labelHuidig}: €${Math.round(kpis.bankstandHuidig||0).toLocaleString("nl-NL")}
Huurdebiteuren ${labelHuidig}: €${Math.round(kpis.balans?.deb26||0).toLocaleString("nl-NL")}

Geef alleen de samenvatting, geen opmaak of opsommingtekens.`;

  try {
    const res = await fetch(process.env.REACT_APP_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || "";
  } catch { return ""; }
}

// ── Archief (localStorage) ─────────────────────────────────────────────────
const ARCHIEF_KEY = "bvc_rapportage_archief";

function archiefLaden() {
  try { return JSON.parse(localStorage.getItem(ARCHIEF_KEY) || "[]"); }
  catch { return []; }
}

function archiefOpslaan(item) {
  const archief = archiefLaden();
  archief.unshift({ ...item, id: Date.now(), datum: new Date().toISOString() });
  localStorage.setItem(ARCHIEF_KEY, JSON.stringify(archief.slice(0, 50)));
}

// ── Excel export ───────────────────────────────────────────────────────────
function exporteerExcel(label, bk, svc, balans, rr) {
  const wb = XLSX.utils.book_new();
  const labelHuidig = periodeLabel(bk.kwartaal, bk.jaar);
  const labelVorig  = periodeLabel(bk.kwartaal, bk.jaarVorig);

  // KPI sheet
  const kpiData = [
    ["Indicator",labelHuidig,labelVorig,"Δ"],
    ["Huurinkomen",Math.round(bk.periodeHuidig),Math.round(bk.periodeVorig),Math.round(bk.periodeHuidig-bk.periodeVorig)],
    ["Eigenaarsonttrekking",Math.round(bk.onttrekkingHuidig),"",""],
    ["Uitbetalingsratio",PCT(bk.ratioHuidig),"",""],
    ["Servicekosten",Math.round(svc?.tot26||0),Math.round(svc?.tot25||0),Math.round((svc?.tot26||0)-(svc?.tot25||0))],
    ["Saldo servicekosten",Math.round(svc?.saldo26||0),Math.round(svc?.saldo25||0),""],
    ["Bankstand",Math.round(bk.bankstandHuidig),Math.round(balans?.bank25||0),""],
    ["Huurdebiteuren",Math.round(balans?.deb26||0),Math.round(balans?.deb25||0),""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiData), "KPI Overzicht");

  // Huurtrend
  if (bk.huurTrend) {
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([["Kwartaal",String(bk.jaarVorig),String(bk.jaar)],...bk.huurTrend.map(r=>[r.kw,r.vorig,r.huidig])]),
      "Huurtrend");
  }

  // Servicekosten
  if (svc?.svcDetail) {
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([["Kostensoort",labelVorig,labelHuidig,"Δ"],...svc.svcDetail.map(r=>[r.ks,r.h1_25,r.h1_26,r.delta])]),
      "Servicekosten");
  }

  // Rent Roll
  if (rr?.length > 0) {
    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([
        ["Huurder","Complex","Unit","m²","Jaarhuur","€/m²","Svc.vrsch/jr","Ingang","Einde","Restant jr","Indexering"],
        ...rr.map(r=>[r.huurder,r.complex,r.unit_adres||r.unit,r.m2,r.jaarhuur,r.m2>0?Math.round(r.jaarhuur/r.m2):0,r.vsc_jaar,r.ingang,r.einde,r.rest,r.indexering])
      ]), "Rent Roll");
  }

  XLSX.writeFile(wb, `Rapportage_${label.replace(/\s+/g,"_")}_${labelHuidig.replace(/\s+/g,"_")}.xlsx`);
}

// ── Kleine UI componenten ──────────────────────────────────────────────────
function KPI({ label, val, delta, deltaLabel, goed_pos=true, sub, prefix="€" }) {
  const d = delta ?? null;
  const goed = d != null ? (d > 0) === goed_pos : null;
  return (
    <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
      borderRadius:2, padding:"16px 18px" }}>
      <div style={{ fontSize:10, color:C.textSub, letterSpacing:"0.07em",
        textTransform:"uppercase", marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:21, fontWeight:700, color:C.text,
        fontVariantNumeric:"tabular-nums" }}>
        {prefix === "€" ? NL(val) : val}
      </div>
      {d != null && (
        <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ background:goed?C.greenL:C.orangeL,
            color:goed?C.green:C.orange,
            fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:10 }}>
            {d >= 0 ? "+" : ""}{NL(d)}
          </span>
          <span style={{ fontSize:11, color:C.grey3 }}>vs {deltaLabel}</span>
        </div>
      )}
      {sub && <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function Signaal({ status, tekst }) {
  const conf = {
    goed:     { bg:C.greenL,    fg:C.green,  icon:"✓" },
    aandacht: { bg:C.yellowL,   fg:C.yellow, icon:"⚠" },
    kritiek:  { bg:C.orangeL,   fg:C.orange, icon:"✗" },
    info:     { bg:C.navyLight, fg:C.navyMid,icon:"→" },
  }[status] || { bg:C.grey1, fg:C.grey3, icon:"·" };
  return (
    <span style={{ background:conf.bg, color:conf.fg, fontSize:11, fontWeight:600,
      padding:"4px 10px", borderRadius:2,
      display:"inline-flex", alignItems:"center", gap:5 }}>
      {conf.icon} {tekst}
    </span>
  );
}

function UploadVak({ bestand, bestandObj, onChange, kleur }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f=e.dataTransfer.files[0]; if(f) onChange(bestand.key,f); }}
      style={{ border:`1.5px dashed ${drag?kleur:bestandObj?kleur:C.grey2}`,
        borderRadius:2, padding:"11px 16px", cursor:"pointer",
        background:bestandObj?`${kleur}08`:drag?`${kleur}05`:C.white,
        display:"flex", alignItems:"center", gap:12, transition:"all 0.15s" }}>
      <div style={{ width:30, height:30, borderRadius:2,
        background:bestandObj?kleur:C.grey1,
        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <span style={{ fontSize:14, color:bestandObj?C.white:C.grey3 }}>
          {bestandObj?"✓":"↑"}
        </span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, color:C.text }}>
          {bestand.label}
          {bestand.verplicht && <span style={{ color:C.red, marginLeft:4 }}>*</span>}
        </div>
        <div style={{ fontSize:11, color:C.textSub, marginTop:2, overflow:"hidden",
          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {bestandObj ? bestandObj.name : "Sleep of klik om te uploaden"}
        </div>
      </div>
      <input type="file" accept=".xlsx,.xls" style={{ display:"none" }}
        onChange={e => { if(e.target.files[0]) onChange(bestand.key,e.target.files[0]); }} />
    </label>
  );
}

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
      borderRadius:2, padding:"10px 14px", fontSize:12 }}>
      <div style={{ fontWeight:600, marginBottom:6 }}>{label}</div>
      {payload.map((p,i) => (
        <div key={i} style={{ color:p.color||C.text, marginBottom:2 }}>
          {p.name}: {typeof p.value === "number" ? NL(p.value) : p.value}
        </div>
      ))}
    </div>
  );
};

// ── Tab navigatie ──────────────────────────────────────────────────────────
const TABS = [
  { id:"dashboard",     label:"Dashboard"       },
  { id:"pl",            label:"P&L per kwartaal"},
  { id:"servicekosten", label:"Servicekosten"   },
  { id:"rentroll",      label:"Rent Roll"       },
  { id:"cashflow",      label:"Cashflow"        },
  { id:"balans",        label:"Balans"          },
  { id:"signalen",      label:"Signalen"        },
  { id:"archief",       label:"Archief"         },
];

// ── TABS inhoud ────────────────────────────────────────────────────────────

// Dashboard
function DashboardTab({ bk, svc, balans, aiTekst, kleur }) {
  const labelHuidig = periodeLabel(bk.kwartaal, bk.jaar);
  const labelVorig  = periodeLabel(bk.kwartaal, bk.jaarVorig);
  return (
    <div>
      {aiTekst && (
        <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
          borderLeft:`3px solid ${kleur}`, borderRadius:2,
          padding:"16px 20px", marginBottom:22 }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
            letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:8 }}>
            AI Managementsamenvatting
          </div>
          <p style={{ margin:0, fontSize:13, lineHeight:1.75, color:C.text }}>{aiTekst}</p>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginBottom:22 }}>
        <KPI label={`Huurinkomen ${labelHuidig}`} val={bk.periodeHuidig}
          delta={bk.periodeHuidig-bk.periodeVorig} deltaLabel={labelVorig} />
        <KPI label="Eigenaarsonttrekking" val={bk.onttrekkingHuidig}
          sub={`Ratio: ${PCT(bk.ratioHuidig)}`} />
        <KPI label={`Servicekosten ${labelHuidig}`} val={svc?.tot26||0}
          delta={(svc?.tot26||0)-(svc?.tot25||0)} deltaLabel={labelVorig} goed_pos={false} />
        <KPI label={`Svc saldo ${labelHuidig}`} val={svc?.saldo26||0}
          sub={(svc?.saldo26||0)<=0?"Voorschotten > kosten ✓":"Tekort ⚠"} />
        <KPI label={`Bankstand eind ${labelHuidig}`} val={bk.bankstandHuidig}
          delta={bk.bankstandHuidig-(balans?.bank25||0)} deltaLabel={`FY ${bk.jaarVorig}`} />
      </div>

      <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
        borderRadius:2, padding:"13px 16px", marginBottom:20 }}>
        <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
          letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:9 }}>
          Signaalkaart
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
          <Signaal status={bk.periodeHuidig>bk.periodeVorig?"goed":"kritiek"}
            tekst={`Huur ${bk.periodeHuidig>bk.periodeVorig?"+":""}${(((bk.periodeHuidig-bk.periodeVorig)/bk.periodeVorig)*100).toFixed(1)}% vs ${labelVorig}`} />
          <Signaal status={bk.ratioHuidig<0.85?"goed":bk.ratioHuidig<1?"aandacht":"kritiek"}
            tekst={`Uitbetalingsratio ${PCT(bk.ratioHuidig)}`} />
          <Signaal status={(bk.bankstandHuidig||0)>50000?"goed":(bk.bankstandHuidig||0)>0?"aandacht":"kritiek"}
            tekst={`Bankstand ${NL(bk.bankstandHuidig)}`} />
          <Signaal status={(svc?.saldo26||0)<=0?"goed":"aandacht"}
            tekst={`Svc saldo ${NL(svc?.saldo26||0)}`} />
          <Signaal status={(balans?.deb26||0)<=(balans?.deb25||0)?"goed":"aandacht"}
            tekst={`Debiteuren ${NL(balans?.deb26||0)}`} />
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
          borderRadius:2, padding:"18px 14px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
            letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:14 }}>
            Huurinkomsten per kwartaal
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bk.huurTrend} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grey2} vertical={false} />
              <XAxis dataKey="kw" tick={{ fontSize:10, fill:C.textSub }}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:9, fill:C.textSub }} axisLine={false} tickLine={false}
                tickFormatter={v=>`€${(v/1000).toFixed(0)}K`} />
              <Tooltip content={<TT />} />
              <Legend wrapperStyle={{ fontSize:11 }} />
              <Bar dataKey="vorig" fill={C.navyLight} name={String(bk.jaarVorig)} radius={[2,2,0,0]} />
              <Bar dataKey="huidig" fill={kleur} name={String(bk.jaar)} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
          borderRadius:2, padding:"18px 14px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
            letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:14 }}>
            Servicekosten {labelHuidig} vergelijking
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={(svc?.svcVgl||[]).slice(0,6)} layout="vertical" barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grey2} horizontal={false} />
              <XAxis type="number" tick={{ fontSize:9, fill:C.textSub }}
                axisLine={false} tickLine={false}
                tickFormatter={v=>`€${(v/1000).toFixed(0)}K`} />
              <YAxis dataKey="naam" type="category" tick={{ fontSize:9, fill:C.textSub }}
                width={120} axisLine={false} tickLine={false} />
              <Tooltip content={<TT />} />
              <Legend wrapperStyle={{ fontSize:11 }} />
              <Bar dataKey="vorig" fill={C.navyLight} name={labelVorig} radius={[0,2,2,0]} />
              <Bar dataKey="huidig" name={labelHuidig} radius={[0,2,2,0]}>
                {(svc?.svcVgl||[]).slice(0,6).map((e,i) => (
                  <Cell key={i} fill={e.huidig>e.vorig?C.orange:kleur} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// P&L tab
function PLTab({ bk, kleur }) {
  const COL_25 = "#2F75B6";
  const SECTIES = [
    { label:"OPBRENGSTEN", hdr:true },
    { label:"Huuropbrengst belast",    key:"Huuropbrengst belast",    sign:1  },
    { label:"Huuropbrengst onbelast",  key:"Huuropbrengst onbelast",  sign:1  },
    { label:"Verleende huurkorting",   key:"Verleende huurkorting",   sign:-1, kleur:C.orangeL },
    { label:"Zonnestroom",             key:"Zonnestroom",             sign:1  },
    { label:"KOSTEN", hdr:true },
    { label:"Beheerkosten",            key:"Beheerkosten",            sign:-1 },
    { label:"Verzekeringen",           key:"Verzekeringen",           sign:-1 },
    { label:"Onderhoud gebouwen",      key:"Onderhoud gebouwen",      sign:-1 },
    { label:"Onderhoud installaties",  key:"Onderhoud installaties",  sign:-1 },
    { label:"OZB / WOZ",              key:"OZB / WOZ",              sign:-1 },
    { label:"Gemeentelijke heffingen", key:"Gemeentelijke heffingen", sign:-1 },
    { label:"Diverse alg. kosten",     key:"Diverse alg. kosten",    sign:-1 },
  ];

  const jaar = bk.jaar, jaarVorig = bk.jaarVorig, kwartaal = bk.kwartaal;
  const Q25 = ["Q1","Q2","Q3","Q4"];
  const Q26 = Q25.slice(0, kwartaal);
  const labelHuidig = periodeLabel(kwartaal, jaar);
  const labelVorig  = periodeLabel(kwartaal, jaarVorig);
  const totaalKolommen = 1 + Q25.length + Q26.length + 2 + 1;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <h3 style={{ margin:0, fontSize:15, fontWeight:700 }}>P&L per kwartaal</h3>
          <p style={{ margin:"3px 0 0", fontSize:11, color:C.textSub }}>
            Serviceafrekeningen vorig jaar niet meegenomen
          </p>
        </div>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr>
              <th style={{ background:C.grey1, padding:"5px 10px", textAlign:"left",
                border:`1px solid ${C.grey2}`, fontSize:10, color:C.textSub }} rowSpan={2}>
                Omschrijving
              </th>
              {[{l:`ACTUEEL ${jaarVorig}`,s:Q25.length,bg:COL_25},{l:`ACTUEEL ${jaar}`,s:Q26.length,bg:kleur}].map((g,i)=>(
                <th key={i} colSpan={g.s} style={{ background:g.bg, color:C.white,
                  padding:"5px 8px", textAlign:"center", border:`1px solid ${C.grey2}`,
                  fontSize:10, fontWeight:700 }}>{g.l}</th>
              ))}
              <th style={{ background:C.navy, color:C.white, padding:"5px 8px",
                textAlign:"center", border:`1px solid ${C.grey2}`, fontSize:10 }} colSpan={2}>
                TOTALEN {labelHuidig.split(" ")[0]}
              </th>
              <th style={{ background:C.navy, color:C.white, padding:"5px 8px",
                textAlign:"center", border:`1px solid ${C.grey2}`, fontSize:10 }}>
                ∆
              </th>
            </tr>
            <tr>
              {Q25.map(q=><th key={q} style={{ background:COL_25, color:C.white,
                padding:"5px 8px", textAlign:"right", border:`1px solid ${C.grey2}`,
                fontSize:10, minWidth:90 }}>{q} {jaarVorig}</th>)}
              {Q26.map(q=><th key={q} style={{ background:kleur, color:C.white,
                padding:"5px 8px", textAlign:"right", border:`1px solid ${C.grey2}`,
                fontSize:10, minWidth:90 }}>{q} {jaar}</th>)}
              <th style={{ background:kleur, color:C.white, padding:"5px 8px",
                textAlign:"right", border:`1px solid ${C.grey2}`, fontSize:10, minWidth:90 }}>
                {labelHuidig}
              </th>
              <th style={{ background:COL_25, color:C.white, padding:"5px 8px",
                textAlign:"right", border:`1px solid ${C.grey2}`, fontSize:10, minWidth:90 }}>
                {labelVorig}
              </th>
              <th style={{ background:C.navy, color:C.white, padding:"5px 8px",
                textAlign:"right", border:`1px solid ${C.grey2}`, fontSize:10, minWidth:90 }}>
                ∆ {labelHuidig.split(" ")[0]}
              </th>
            </tr>
          </thead>
          <tbody>
            {SECTIES.map((rij, ri) => {
              if (rij.hdr) return (
                <tr key={ri}>
                  <td colSpan={totaalKolommen} style={{ background:C.navy, color:C.white,
                    padding:"6px 10px", fontWeight:700, fontSize:11,
                    border:`1px solid ${C.grey2}` }}>{rij.label}</td>
                </tr>
              );
              const d = (bk.plData||[]).find(r => r.label === rij.key) || {};
              const periodeHuidigRij = Q26.reduce((s,q) => s + (d[`q${q.toLowerCase()}_26`]||0), 0);
              const periodeVorigRij  = Q25.slice(0,Q26.length).reduce((s,q) => s + (d[`q${q.toLowerCase()}_25`]||0), 0);
              const delta = (periodeHuidigRij-periodeVorigRij)*rij.sign;
              const rowBg = rij.kleur || (ri%2===0?C.white:C.grey1);
              const dbg = delta >= 0 ? C.greenL : C.orangeL;
              return (
                <tr key={ri}>
                  <td style={{ padding:"5px 10px", background:rowBg,
                    paddingLeft:20, border:`1px solid ${C.grey2}` }}>{rij.label}</td>
                  {Q25.map(q => {
                    const v = d[`q${q.toLowerCase()}_25`]||0;
                    return <td key={q} style={{ padding:"5px 8px", textAlign:"right",
                      background:rowBg, fontVariantNumeric:"tabular-nums",
                      border:`1px solid ${C.grey2}` }}>{v ? NL(v) : "–"}</td>;
                  })}
                  {Q26.map(q => {
                    const v = d[`q${q.toLowerCase()}_26`]||0;
                    return <td key={q} style={{ padding:"5px 8px", textAlign:"right",
                      background:rowBg, fontVariantNumeric:"tabular-nums",
                      border:`1px solid ${C.grey2}` }}>{v ? NL(v) : "–"}</td>;
                  })}
                  <td style={{ padding:"5px 8px", textAlign:"right", background:rowBg,
                    fontWeight:600, fontVariantNumeric:"tabular-nums",
                    border:`1px solid ${C.grey2}` }}>{periodeHuidigRij ? NL(periodeHuidigRij) : "–"}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", background:rowBg,
                    fontVariantNumeric:"tabular-nums",
                    border:`1px solid ${C.grey2}` }}>{periodeVorigRij ? NL(periodeVorigRij) : "–"}</td>
                  <td style={{ padding:"5px 8px", textAlign:"right", background:dbg,
                    color:delta>=0?C.green:C.orange, fontWeight:600,
                    fontVariantNumeric:"tabular-nums",
                    border:`1px solid ${C.grey2}` }}>
                    {delta ? `${delta>=0?"+":""}${NL(delta)}` : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Servicekosten tab
function ServicekostenTab({ svc, kleur, unitFilter }) {
  const labelHuidig = periodeLabel(svc?.kwartaal, svc?.jaar);
  const labelVorig  = periodeLabel(svc?.kwartaal, svc?.jaarVorig);
  return (
    <div>
      {unitFilter && (
        <div style={{ background:C.navyLight, color:C.navy, padding:"8px 14px",
          borderRadius:2, fontSize:12, marginBottom:16, fontWeight:500 }}>
          ℹ Servicekosten zijn niet per unit beschikbaar — overzicht toont het gehele complex.
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
        <KPI label={`Totaal kosten ${labelHuidig}`} val={svc?.tot26||0}
          delta={(svc?.tot26||0)-(svc?.tot25||0)} deltaLabel={labelVorig} goed_pos={false} />
        <KPI label={`Totaal kosten ${labelVorig}`} val={svc?.tot25||0} />
        <KPI label={`Voorschotten ${labelHuidig}`}  val={svc?.vsc26||0}
          sub="Ontvangen (negatief)" />
        <KPI label={`Saldo ${labelHuidig}`} val={svc?.saldo26||0}
          sub={(svc?.saldo26||0)<=0?"Overschot ✓":"Tekort ⚠"} />
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr>
              {["Kostensoort",labelVorig,labelHuidig,"∆ Absoluut","∆ %","Signaal"].map((h,i)=>(
                <th key={i} style={{ background:i===0?C.navy:i<=2?"#2F75B6":i===5?C.navy:kleur,
                  color:C.white, padding:"7px 10px",
                  textAlign:i===0?"left":"right",
                  border:`1px solid ${C.grey2}`, fontSize:10, fontWeight:700,
                  minWidth:i===0?180:90 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(svc?.svcDetail||[]).map((r,i) => {
              const bg = i%2===0?C.white:C.grey1;
              const good = r.delta <= 0;
              const sig = r.delta > 1000 && !good ? "🔴 Kritiek"
                : r.delta > 0 ? "🟡 Licht" : r.delta < -2000 ? "🟢 Daling" : "→ Stabiel";
              const sbg = sig.includes("Kritiek") ? C.orangeL
                : sig.includes("Licht") ? C.yellowL
                : sig.includes("Daling") ? C.greenL : C.grey1;
              return (
                <tr key={i}>
                  <td style={{ padding:"6px 10px", background:bg,
                    border:`1px solid ${C.grey2}` }}>{r.ks}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", background:bg,
                    fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                    {NL(r.h1_25)}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", background:bg,
                    fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                    {NL(r.h1_26)}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right",
                    background:good?C.greenL:C.orangeL,
                    color:good?C.green:C.orange, fontWeight:600,
                    fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                    {r.delta>=0?"+":""}{NL(r.delta)}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right",
                    background:good?C.greenL:C.orangeL,
                    color:good?C.green:C.orange, fontWeight:600,
                    border:`1px solid ${C.grey2}` }}>
                    {r.h1_25 ? `${((r.delta/r.h1_25)*100).toFixed(1)}%` : "–"}</td>
                  <td style={{ padding:"5px 8px", textAlign:"center",
                    background:sbg, border:`1px solid ${C.grey2}`, fontSize:11, fontWeight:600,
                    color:sbg===C.greenL?C.green:sbg===C.orangeL?C.orange:sbg===C.yellowL?C.yellow:C.grey3 }}>
                    {sig}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Rent Roll tab
function RentRollTab({ rr, kleur, complexFilter, unitFilter }) {
  const datum = new Date().toLocaleDateString("nl-NL", { day:"numeric", month:"long", year:"numeric" });
  const gefilterd = rr.filter(r => {
    if (complexFilter && r.complex_nr !== complexFilter) return false;
    if (unitFilter && r.unit !== unitFilter) return false;
    return true;
  });
  const totM2 = gefilterd.reduce((s,r)=>s+r.m2,0);
  const totJH = gefilterd.reduce((s,r)=>s+r.jaarhuur,0);
  const totVsc= gefilterd.reduce((s,r)=>s+r.vsc_jaar,0);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <h3 style={{ margin:0, fontSize:15, fontWeight:700 }}>Rent Roll</h3>
          <p style={{ margin:"3px 0 0", fontSize:11, color:C.textSub }}>
            Per {datum} · {gefilterd.length} contracten · {Math.round(totM2).toLocaleString("nl-NL")} m²
          </p>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 }}>
        <KPI label="Totaal jaarhuur"       val={totJH} />
        <KPI label="Verhuurd oppervlak"    val={`${Math.round(totM2).toLocaleString("nl-NL")} m²`} prefix="" />
        <KPI label="Gem. huurprijs/m²/jr"  val={`€ ${totM2>0?Math.round(totJH/totM2):0}`} prefix="" />
        <KPI label="Totaal svc.vrsch./jr"  val={totVsc} />
      </div>

      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead>
            <tr>
              {["Huurder","Object/Adres","Complex","m²","Jaarhuur","€/m²/jr",
                "Svc./jr","Ingang","Einde","Restant","Index","Risico"].map((h,i)=>(
                <th key={i} style={{ background:kleur, color:C.white,
                  padding:"7px 8px", textAlign:i>2?"right":"left",
                  border:`1px solid ${C.grey2}`, fontSize:10, fontWeight:700,
                  whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gefilterd.map((r,i) => {
              const bg = i%2===0?C.white:C.grey1;
              const rBg = r.rest<1?C.orangeL:r.rest<2?C.yellowL:C.greenL;
              const rFg = r.rest<1?C.orange:r.rest<2?C.yellow:C.green;
              const rLbl = r.rest<1?"🔴 <1jr":r.rest<2?"⚠ 1-2jr":"✓ >2jr";
              const fmtDatum = (d) => {
                if (!d) return "–";
                try { return new Date(d).toLocaleDateString("nl-NL"); }
                catch { return String(d).split("T")[0]; }
              };
              return (
                <tr key={i}>
                  <td style={{ padding:"6px 8px", background:bg,
                    fontWeight:500, border:`1px solid ${C.grey2}`,
                    maxWidth:160, overflow:"hidden", textOverflow:"ellipsis" }}>
                    {r.huurder}</td>
                  <td style={{ padding:"6px 8px", background:bg, fontSize:11,
                    color:C.textSub, border:`1px solid ${C.grey2}` }}>
                    {r.unit_adres||r.unit_omschr||r.unit||"–"}</td>
                  <td style={{ padding:"6px 8px", background:bg, fontSize:11,
                    border:`1px solid ${C.grey2}` }}>{r.complex||"–"}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                    {Math.round(r.m2)}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontWeight:600, fontVariantNumeric:"tabular-nums",
                    border:`1px solid ${C.grey2}` }}>{NL(r.jaarhuur)}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                    {r.m2>0?`€ ${Math.round(r.jaarhuur/r.m2)}`:"–"}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                    {NL(r.vsc_jaar)}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontSize:11, border:`1px solid ${C.grey2}` }}>
                    {fmtDatum(r.ingang)}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontSize:11, border:`1px solid ${C.grey2}` }}>
                    {r.einde?fmtDatum(r.einde):"Doorlopend"}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:rBg,
                    color:rFg, fontWeight:600, border:`1px solid ${C.grey2}` }}>
                    {r.rest>0?`${r.rest.toFixed(1)} jr`:"Verlopen"}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right", background:bg,
                    fontSize:11, border:`1px solid ${C.grey2}` }}>
                    {r.indexering ? `${r.indexering}%` : "–"}
                    {r.index_datum ? ` (${fmtDatum(r.index_datum)})` : ""}
                  </td>
                  <td style={{ padding:"5px 7px", textAlign:"center",
                    background:rBg, color:rFg, fontWeight:600, fontSize:11,
                    border:`1px solid ${C.grey2}` }}>{rLbl}</td>
                </tr>
              );
            })}
            <tr style={{ fontWeight:700 }}>
              <td style={{ padding:"7px 8px", background:C.navyLight,
                border:`1px solid ${C.grey2}` }}>TOTAAL</td>
              <td colSpan={2} style={{ background:C.navyLight, border:`1px solid ${C.grey2}` }} />
              <td style={{ padding:"7px 8px", textAlign:"right", background:C.navyLight,
                fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                {Math.round(totM2).toLocaleString("nl-NL")}</td>
              <td style={{ padding:"7px 8px", textAlign:"right", background:C.navyLight,
                fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                {NL(totJH)}</td>
              <td style={{ padding:"7px 8px", textAlign:"right", background:C.navyLight,
                border:`1px solid ${C.grey2}` }}>
                {totM2>0?`€ ${Math.round(totJH/totM2)}`:"–"}</td>
              <td style={{ padding:"7px 8px", textAlign:"right", background:C.navyLight,
                fontVariantNumeric:"tabular-nums", border:`1px solid ${C.grey2}` }}>
                {NL(totVsc)}</td>
              <td colSpan={5} style={{ background:C.navyLight,
                border:`1px solid ${C.grey2}` }} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Cashflow tab
function CashflowTab({ bk, kleur, unitFilter }) {
  const data = bk.kasstroomData || [];
  const labelHuidig = periodeLabel(bk.kwartaal, bk.jaar);
  const jaarKort = String(bk.jaar).slice(-2);
  return (
    <div>
      {unitFilter && (
        <div style={{ background:C.navyLight, color:C.navy, padding:"8px 14px",
          borderRadius:2, fontSize:12, marginBottom:16 }}>
          ℹ Cashflow is niet per unit beschikbaar — overzicht toont het gehele complex.
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
        <KPI label={`Bankstand eind ${labelHuidig}`} val={bk.bankstandHuidig}
          delta={bk.bankstandHuidig-(bk.kasstroomData?.[0]?.netto||0)}
          deltaLabel={`begin ${bk.jaarVorig}`} />
        <KPI label={`Huurinkomen ${labelHuidig}`} val={bk.periodeHuidig} />
        <KPI label="Eigenaarsonttrekking" val={bk.onttrekkingHuidig}
          sub={`Ratio: ${PCT(bk.ratioHuidig)}`} />
        <KPI label="Streefwaarde bank" val={50000}
          sub={bk.bankstandHuidig>=50000?"✓ Boven streefwaarde":"⚠ Onder streefwaarde"} />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:14, marginBottom:14 }}>
        <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
          borderRadius:2, padding:"18px 14px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
            letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:14 }}>
            Bankstandverloop · streefwaarde €50.000
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={bk.bankStand||[]}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grey2} vertical={false} />
              <XAxis dataKey="kw" tick={{ fontSize:9, fill:C.textSub }}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:9, fill:C.textSub }} axisLine={false} tickLine={false}
                tickFormatter={v=>`€${(v/1000).toFixed(0)}K`} />
              <Tooltip content={<TT />} />
              <ReferenceLine y={50000} stroke={C.green} strokeDasharray="5 3" />
              <ReferenceLine y={0} stroke={C.red} strokeDasharray="3 3" />
              <Area dataKey="stand" fill={C.navyLight} stroke={C.navyMid}
                strokeWidth={2} fillOpacity={0.3} type="monotone" name="Bankstand" />
              <Line dataKey="stand" stroke={kleur} strokeWidth={2.5} type="monotone"
                name="Bankstand" dot={(props) => {
                  const { cx, cy, payload } = props;
                  const fill = payload.stand>=50000?C.green:payload.stand>=0?C.yellow:C.red;
                  return <circle key={payload.kw} cx={cx} cy={cy} r={4}
                    fill={fill} stroke={C.white} strokeWidth={1.5} />;
                }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
          borderRadius:2, padding:"18px 14px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
            letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:14 }}>
            Uitbetalingsratio · norm &lt; 85%
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.grey2} vertical={false} />
              <XAxis dataKey="kw" tick={{ fontSize:9, fill:C.textSub }}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:9, fill:C.textSub }} axisLine={false} tickLine={false}
                tickFormatter={v=>`${(v*100).toFixed(0)}%`} domain={[0,1.2]} />
              <Tooltip formatter={v=>PCT(v)} />
              <ReferenceLine y={0.85} stroke={C.green} strokeDasharray="5 3" />
              <Bar dataKey="ratio" name="Uitbet.ratio" radius={[2,2,0,0]}>
                {data.map((d,i) => (
                  <Cell key={i} fill={d.ratio<0.85?C.green:d.ratio<1?C.yellow:C.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
        borderRadius:2, padding:"18px 14px" }}>
        <div style={{ fontSize:10, fontWeight:700, color:C.textSub,
          letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:14 }}>
          Kasstroomoverzicht per kwartaal
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr>
                {["Omschrijving",...data.map(d=>d.kw),labelHuidig,`FY ${bk.jaarVorig}`].map((h,i)=>(
                  <th key={i} style={{
                    background:h.includes(`'${jaarKort}`)?"#2F5597":h===labelHuidig?"#2F5597":h===`FY ${bk.jaarVorig}`?"#2F75B6":i===0?C.grey1:C.navyMid,
                    color:i===0?C.textSub:C.white,
                    padding:"6px 8px", textAlign:i===0?"left":"right",
                    border:`1px solid ${C.grey2}`, fontSize:10, fontWeight:700,
                    minWidth:i===0?160:90 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label:"Huurontvangsten", key:"huur",       positief:true  },
                { label:"Exploitatiekosten",key:"exploitatie",positief:false },
                { label:"Eigenaarsonttrekkingen",key:"onttrekking",positief:false},
                { label:"Netto kasstroom", key:"netto",       netto:true     },
              ].map((rij,ri) => {
                const h1_26 = data.filter(d=>d.jaar===bk.jaar).reduce((s,d)=>s+(d[rij.key]||0),0);
                const fy_25 = data.filter(d=>d.jaar===bk.jaarVorig).reduce((s,d)=>s+(d[rij.key]||0),0);
                const bg = rij.netto?C.navy:ri%2===0?C.white:C.grey1;
                return (
                  <tr key={ri}>
                    <td style={{ padding:"6px 10px", background:bg,
                      color:rij.netto?C.white:C.text,
                      fontWeight:rij.netto?700:400,
                      border:`1px solid ${C.grey2}` }}>{rij.label}</td>
                    {data.map((d,di) => {
                      const v = d[rij.key]||0;
                      const cellBg = rij.netto?(v>=0?C.greenL:C.orangeL):bg;
                      const cellFg = rij.netto?(v>=0?C.green:C.orange):rij.netto?C.white:C.text;
                      return (
                        <td key={di} style={{ padding:"6px 8px", textAlign:"right",
                          background:cellBg, color:cellFg,
                          fontVariantNumeric:"tabular-nums",
                          border:`1px solid ${C.grey2}` }}>
                          {v ? NL(v) : "–"}
                        </td>
                      );
                    })}
                    <td style={{ padding:"6px 8px", textAlign:"right",
                      background:rij.netto?(h1_26>=0?C.greenL:C.orangeL):"#E8F0E3",
                      color:rij.netto?(h1_26>=0?C.green:C.orange):C.greenDark,
                      fontWeight:700, fontVariantNumeric:"tabular-nums",
                      border:`1px solid ${C.grey2}` }}>{h1_26?NL(h1_26):"–"}</td>
                    <td style={{ padding:"6px 8px", textAlign:"right",
                      background:C.grey1, fontVariantNumeric:"tabular-nums",
                      border:`1px solid ${C.grey2}` }}>{fy_25?NL(fy_25):"–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Balans tab
function BalansTab({ balans, unitFilter }) {
  const fmt = (n) => n ? Math.abs(Math.round(n)).toLocaleString("nl-NL") : "-";
  const jaar = balans?.jaar || 2026, jaarVorig = balans?.jaarVorig || 2025, kwartaal = balans?.kwartaal || 2;
  return (
    <div style={{ maxWidth:700 }}>
      {unitFilter && (
        <div style={{ background:C.navyLight, color:C.navy, padding:"8px 14px",
          borderRadius:2, fontSize:12, marginBottom:16 }}>
          ℹ Balans is niet per unit beschikbaar — overzicht toont de volledige balans.
        </div>
      )}
      <div style={{ textAlign:"center", marginBottom:28,
        borderBottom:`3px solid ${C.navy}`, paddingBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:700, margin:"0 0 4px",
          fontFamily:"Georgia, serif" }}>Balans</h2>
        <p style={{ fontSize:12, color:C.textSub, margin:0 }}>
          Per {periodeEindDatum(kwartaal, jaar)} · vergelijking 31 december {jaarVorig}
        </p>
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse",
        fontFamily:"Georgia, serif" }}>
        <thead>
          <tr style={{ borderBottom:`2px solid ${C.navy}` }}>
            <th style={{ textAlign:"left", padding:"4px 0 8px",
              fontSize:11, fontWeight:400, color:C.textSub }}>&nbsp;</th>
            <th style={{ width:130, textAlign:"right", padding:"4px 0 8px 8px",
              fontSize:11, fontWeight:600, color:C.navy,
              borderLeft:`1px solid ${C.grey2}` }}>{periodeEindDatumKort(kwartaal, jaar)}</th>
            <th style={{ width:130, textAlign:"right", padding:"4px 0 8px 8px",
              fontSize:11, color:C.textSub,
              borderLeft:`1px solid ${C.grey2}` }}>31-12-{jaarVorig}</th>
          </tr>
        </thead>
        <tbody>
          {/* ACTIVA */}
          <tr>
            <td colSpan={3} style={{ padding:"14px 0 4px",
              fontSize:13, fontWeight:700, color:C.navy,
              letterSpacing:"0.08em", textTransform:"uppercase",
              borderTop:`2px solid ${C.navy}`,
              fontFamily:"Inter, system-ui, sans-serif" }}>Activa</td>
          </tr>
          {[
            { label:"Vlottende activa", hdr:true },
            { label:"Huurdebiteuren",           h:balans?.deb26,  v:balans?.deb25  },
            { label:"Liquide middelen",          h:balans?.bank26, v:balans?.bank25 },
            { label:"Overige vlottende activa",  h:null, v:null },
          ].map((r,i) => r.hdr ? (
            <tr key={i}>
              <td colSpan={3} style={{ padding:"8px 0 4px 0",
                fontSize:11, fontWeight:700, color:C.navy,
                letterSpacing:"0.04em", textTransform:"uppercase",
                borderBottom:`1px solid ${C.navy}`,
                fontFamily:"Inter, system-ui, sans-serif" }}>{r.label}</td>
            </tr>
          ) : (
            <tr key={i} style={{ borderBottom:`1px solid ${C.grey2}` }}>
              <td style={{ padding:"5px 0 5px 16px", fontSize:12 }}>{r.label}</td>
              <td style={{ textAlign:"right", padding:"5px 0 5px 8px", fontSize:12,
                fontVariantNumeric:"tabular-nums",
                borderLeft:`1px solid ${C.grey2}` }}>
                {r.h != null ? fmt(r.h) : "–"}</td>
              <td style={{ textAlign:"right", padding:"5px 0 5px 8px", fontSize:12,
                fontVariantNumeric:"tabular-nums", color:C.textSub,
                borderLeft:`1px solid ${C.grey2}` }}>
                {r.v != null ? fmt(r.v) : "–"}</td>
            </tr>
          ))}
          <tr style={{ borderTop:`1.5px solid ${C.navy}`,
            background:C.navyLight }}>
            <td style={{ padding:"7px 0 7px 8px", fontSize:12, fontWeight:700,
              color:C.navy, fontStyle:"italic" }}>Totaal activa</td>
            <td style={{ textAlign:"right", padding:"7px 0 7px 8px", fontSize:12,
              fontWeight:700, fontVariantNumeric:"tabular-nums", color:C.navy,
              borderLeft:`1px solid ${C.grey2}`,
              borderBottom:`3px double ${C.navy}` }}>
              {fmt((balans?.deb26||0)+(balans?.bank26||0))}</td>
            <td style={{ textAlign:"right", padding:"7px 0 7px 8px", fontSize:12,
              fontWeight:700, fontVariantNumeric:"tabular-nums", color:C.textSub,
              borderLeft:`1px solid ${C.grey2}`,
              borderBottom:`3px double ${C.navy}` }}>
              {fmt((balans?.deb25||0)+(balans?.bank25||0))}</td>
          </tr>

          <tr><td colSpan={3} style={{ height:24 }} /></tr>

          {/* PASSIVA */}
          <tr>
            <td colSpan={3} style={{ padding:"0 0 4px", fontSize:13, fontWeight:700,
              color:C.navy, letterSpacing:"0.08em", textTransform:"uppercase",
              borderTop:`2px solid ${C.navy}`,
              fontFamily:"Inter, system-ui, sans-serif" }}>Passiva</td>
          </tr>
          {[
            { label:"Kortlopende schulden", hdr:true },
            { label:"Crediteuren",                    h:balans?.cred26, v:balans?.cred25 },
            { label:"Svc.kosten vooruit ontvangen",   h:balans?.vsc26,  v:balans?.vsc25  },
          ].map((r,i) => r.hdr ? (
            <tr key={i}>
              <td colSpan={3} style={{ padding:"8px 0 4px 0",
                fontSize:11, fontWeight:700, color:C.navy,
                letterSpacing:"0.04em", textTransform:"uppercase",
                borderBottom:`1px solid ${C.navy}`,
                fontFamily:"Inter, system-ui, sans-serif" }}>{r.label}</td>
            </tr>
          ) : (
            <tr key={i} style={{ borderBottom:`1px solid ${C.grey2}` }}>
              <td style={{ padding:"5px 0 5px 16px", fontSize:12 }}>{r.label}</td>
              <td style={{ textAlign:"right", padding:"5px 0 5px 8px", fontSize:12,
                fontVariantNumeric:"tabular-nums",
                borderLeft:`1px solid ${C.grey2}` }}>
                {r.h != null ? fmt(r.h) : "–"}</td>
              <td style={{ textAlign:"right", padding:"5px 0 5px 8px", fontSize:12,
                fontVariantNumeric:"tabular-nums", color:C.textSub,
                borderLeft:`1px solid ${C.grey2}` }}>
                {r.v != null ? fmt(r.v) : "–"}</td>
            </tr>
          ))}
          <tr style={{ borderTop:`1.5px solid ${C.navy}`, background:C.navyLight }}>
            <td style={{ padding:"7px 0 7px 8px", fontSize:12, fontWeight:700,
              color:C.navy, fontStyle:"italic" }}>Totaal passiva</td>
            <td style={{ textAlign:"right", padding:"7px 0 7px 8px", fontSize:12,
              fontWeight:700, fontVariantNumeric:"tabular-nums", color:C.navy,
              borderLeft:`1px solid ${C.grey2}`,
              borderBottom:`3px double ${C.navy}` }}>
              {fmt((balans?.cred26||0)+(balans?.vsc26||0))}</td>
            <td style={{ textAlign:"right", padding:"7px 0 7px 8px", fontSize:12,
              fontWeight:700, fontVariantNumeric:"tabular-nums", color:C.textSub,
              borderLeft:`1px solid ${C.grey2}`,
              borderBottom:`3px double ${C.navy}` }}>
              {fmt((balans?.cred25||0)+(balans?.vsc25||0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Signalen tab
function SignalenTab({ bk, svc, balans, rr }) {
  const labelHuidig = periodeLabel(bk.kwartaal, bk.jaar);
  const labelVorig  = periodeLabel(bk.kwartaal, bk.jaarVorig);
  const signalen = [
    bk.periodeHuidig > bk.periodeVorig
      ? { prio:"🟢 Positief", pbg:C.greenL, pfg:C.green, onderwerp:`Huurgroei ${labelHuidig}`,
          effect:`${labelVorig}: ${NL(bk.periodeVorig)} → ${labelHuidig}: ${NL(bk.periodeHuidig)} (+${(((bk.periodeHuidig-bk.periodeVorig)/bk.periodeVorig)*100).toFixed(1)}%)`,
          actie:"Monitor kwartaaltrend. Controleer op nieuwe contracten en indexeringen." }
      : { prio:"🔴 Aandacht", pbg:C.orangeL, pfg:C.orange, onderwerp:`Huur gedaald vs ${labelVorig}`,
          effect:`${labelVorig}: ${NL(bk.periodeVorig)} → ${labelHuidig}: ${NL(bk.periodeHuidig)}`,
          actie:"Onderzoek oorzaak (leegstand, kortingen, vertrek huurder)." },
    bk.ratioHuidig < 0.85
      ? { prio:"🟢 Positief", pbg:C.greenL, pfg:C.green, onderwerp:"Uitbetalingsratio gezond",
          effect:`${PCT(bk.ratioHuidig)} — onder norm van 85%`,
          actie:"Blijf monitoren. Streef naar ratio < 85% per kwartaal." }
      : { prio:"🟡 Aandacht", pbg:C.yellowL, pfg:C.yellow, onderwerp:"Uitbetalingsratio verhoogd",
          effect:`${PCT(bk.ratioHuidig)} — boven norm van 85%`,
          actie:"Beoordeel of onttrekkingen verlaagd kunnen worden." },
    (bk.bankstandHuidig||0) >= 50000
      ? { prio:"🟢 Positief", pbg:C.greenL, pfg:C.green, onderwerp:"Bankstand boven streefwaarde",
          effect:`${NL(bk.bankstandHuidig)} — boven €50.000`,
          actie:"Positief. Bewaken bij grote onttrekkingen komend halfjaar." }
      : { prio:"🔴 Aandacht", pbg:C.orangeL, pfg:C.orange, onderwerp:"Bankstand onder streefwaarde",
          effect:`${NL(bk.bankstandHuidig)} — onder streefwaarde €50.000`,
          actie:"Cashflow bewaken. Overweeg lagere onttrekking H2." },
    ...(rr||[]).filter(r=>r.rest<1).map(r=>({
      prio:"🔴 Urgent", pbg:C.orangeL, pfg:C.orange,
      onderwerp:`Contract bijna verlopen — ${r.huurder}`,
      effect:`Restant looptijd: ${r.rest.toFixed(1)} jaar · Jaarhuur: ${NL(r.jaarhuur)}`,
      actie:"Direct contact opnemen voor verlenging of nieuwe huurder zoeken.",
    })),
    ...(rr||[]).filter(r=>r.rest>=1&&r.rest<2).map(r=>({
      prio:"🟡 Bewaken", pbg:C.yellowL, pfg:C.yellow,
      onderwerp:`Contract verloopt binnen 2 jaar — ${r.huurder}`,
      effect:`Restant looptijd: ${r.rest.toFixed(1)} jaar · Jaarhuur: ${NL(r.jaarhuur)}`,
      actie:"Verlengingsgesprek plannen voor komend kwartaal.",
    })),
  ];

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:15, fontWeight:700 }}>Signalen & Actiepunten</h3>
        <p style={{ margin:"3px 0 0", fontSize:11, color:C.textSub }}>
          Automatisch gegenereerd op basis van de geüploade data
        </p>
      </div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead>
          <tr>
            {["Prioriteit","Onderwerp","Financieel effect","Aanbevolen actie"].map((h,i)=>(
              <th key={i} style={{ background:C.navy, color:C.white,
                padding:"8px 12px", textAlign:"left",
                border:`1px solid ${C.grey2}`, fontSize:10, fontWeight:700,
                width:i===0?"110px":i===1?"200px":i===2?"260px":"auto" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signalen.map((s,i) => (
            <tr key={i}>
              <td style={{ padding:"10px 12px", background:s.pbg,
                border:`1px solid ${C.grey2}`, verticalAlign:"top" }}>
                <span style={{ color:s.pfg, fontWeight:700 }}>{s.prio}</span>
              </td>
              <td style={{ padding:"10px 12px", background:i%2===0?C.white:C.grey1,
                fontWeight:600, border:`1px solid ${C.grey2}`, verticalAlign:"top" }}>
                {s.onderwerp}</td>
              <td style={{ padding:"10px 12px", background:i%2===0?C.white:C.grey1,
                fontSize:11, color:C.textSub, fontStyle:"italic",
                border:`1px solid ${C.grey2}`, verticalAlign:"top", lineHeight:1.6 }}>
                {s.effect}</td>
              <td style={{ padding:"10px 12px", background:i%2===0?C.white:C.grey1,
                fontSize:11, border:`1px solid ${C.grey2}`,
                verticalAlign:"top", lineHeight:1.6 }}>{s.actie}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Archief tab
function ArchiefTab({ onHerstel }) {
  const [archief, setArchief] = useState(archiefLaden);

  const verwijder = (id) => {
    const nieuw = archief.filter(a => a.id !== id);
    localStorage.setItem(ARCHIEF_KEY, JSON.stringify(nieuw));
    setArchief(nieuw);
  };

  if (archief.length === 0) return (
    <div style={{ textAlign:"center", padding:"60px 0", color:C.textSub }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📁</div>
      <div style={{ fontSize:14, fontWeight:600 }}>Nog geen rapporten opgeslagen</div>
      <div style={{ fontSize:12, marginTop:6 }}>
        Genereer een rapport en sla het op via de knop "Rapport opslaan in archief"
      </div>
    </div>
  );

  return (
    <div>
      <h3 style={{ margin:"0 0 16px", fontSize:15, fontWeight:700 }}>
        Rapportage archief
      </h3>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
        <thead>
          <tr>
            {["Portfolio","Periode","Datum opgeslagen","Huurinkomen","Bankstand","Acties"].map((h,i)=>(
              <th key={i} style={{ background:C.navy, color:C.white,
                padding:"7px 10px", textAlign:"left",
                border:`1px solid ${C.grey2}`, fontSize:10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {archief.map((a,i) => (
            <tr key={a.id} style={{ background:i%2===0?C.white:C.grey1 }}>
              <td style={{ padding:"8px 10px", border:`1px solid ${C.grey2}`,
                fontWeight:600 }}>{a.portfolio}</td>
              <td style={{ padding:"8px 10px", border:`1px solid ${C.grey2}` }}>
                {a.periode || "–"}</td>
              <td style={{ padding:"8px 10px", border:`1px solid ${C.grey2}`,
                color:C.textSub, fontSize:11 }}>
                {new Date(a.datum).toLocaleString("nl-NL")}</td>
              <td style={{ padding:"8px 10px", border:`1px solid ${C.grey2}`,
                fontVariantNumeric:"tabular-nums" }}>
                {a.h1_huur ? NL(a.h1_huur) : "–"}</td>
              <td style={{ padding:"8px 10px", border:`1px solid ${C.grey2}`,
                fontVariantNumeric:"tabular-nums" }}>
                {a.bankstand ? NL(a.bankstand) : "–"}</td>
              <td style={{ padding:"8px 10px", border:`1px solid ${C.grey2}` }}>
                <button onClick={() => onHerstel(a)} disabled={!a.data}
                  title={!a.data ? "Opgeslagen vóór deze update — geen volledige data beschikbaar" : undefined}
                  style={{
                    background:a.data?C.navy:C.grey2, color:a.data?C.white:C.grey3,
                    border:"none", borderRadius:2, padding:"4px 10px", fontSize:11,
                    cursor:a.data?"pointer":"default", marginRight:6 }}>
                  Bekijken
                </button>
                <button onClick={() => verwijder(a.id)} style={{
                  background:"none", color:C.red, border:`1px solid ${C.red}`,
                  borderRadius:2, padding:"4px 10px", fontSize:11,
                  cursor:"pointer" }}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Hoofd App ──────────────────────────────────────────────────────────────
export default function App() {
  const [stap, setStap]           = useState("kies");
  const [portfolio, setPortfolio] = useState(null);
  const [bestanden, setBestanden] = useState({});
  const [voortgang, setVoortgang] = useState("");
  const [fout, setFout]           = useState("");
  const [tab, setTab]             = useState("dashboard");

  // Gefilterd
  const [complexFilter, setComplexFilter] = useState(null);
  const [unitFilter, setUnitFilter]       = useState(null);

  // Periode
  const [periodeJaar, setPeriodeJaar]         = useState(2026);
  const [periodeKwartaal, setPeriodeKwartaal] = useState(2);

  // Data
  const [bkData,  setBkData]  = useState(null);
  const [svcData, setSvcData] = useState(null);
  const [balData, setBalData] = useState(null);
  const [rrData,  setRrData]  = useState([]);
  const [aiTekst, setAiTekst] = useState("");

  const p = portfolio ? PORTFOLIOS[portfolio] : null;

  const zetBestand = useCallback((key, file) => {
    setBestanden(prev => ({ ...prev, [key]: file }));
  }, []);

  const kanVerwerken = p && p.bestanden.filter(b=>b.verplicht).every(b=>bestanden[b.key]);

  const verwerkData = async () => {
    setStap("verwerk"); setFout("");
    try {
      setVoortgang("Boekingen inlezen…");
      const bkS  = await parseXLSX(bestanden.boekingen);
      const bkR  = bkS[Object.keys(bkS)[0]];

      setVoortgang("Servicekosten inlezen…");
      const svcS = await parseXLSX(bestanden.servicekosten);
      const svcR = svcS[Object.keys(svcS)[0]];

      setVoortgang("Balans inlezen…");
      const balS = await parseXLSX(bestanden.balans);
      const balR = balS[Object.keys(balS)[0]];

      let rrR = [];
      if (bestanden.rentroll) {
        setVoortgang("Rent Roll inlezen…");
        const rrS = await parseXLSX(bestanden.rentroll);
        rrR = verwerkRentRoll(rrS[Object.keys(rrS)[0]]);
      }

      setVoortgang("Data verwerken…");
      const bk  = verwerkBoekingen(bkR, null, null, periodeJaar, periodeKwartaal);
      const svc = verwerkSvc(svcR, null, periodeJaar, periodeKwartaal);
      const bal = verwerkBalans(balR, periodeJaar, periodeKwartaal);

      setBkData(bk); setSvcData(svc); setBalData(bal); setRrData(rrR);

      setVoortgang("AI-analyse genereren…");
      const tekst = await haalAIAnalyse(p.label, { ...bk, svc, balans: bal });
      setAiTekst(tekst);

      // Archief opslaan — volledige snapshot zodat het rapport later teruggehaald kan worden
      archiefOpslaan({
        portfolioKey: portfolio,
        portfolio: p.label,
        jaar: periodeJaar,
        kwartaal: periodeKwartaal,
        periode: periodeLabel(periodeKwartaal, periodeJaar),
        h1_huur: bk.periodeHuidig,
        bankstand: bk.bankstandHuidig,
        data: { bk, svc, balans: bal, rr: rrR, aiTekst: tekst },
      });

      setVoortgang(""); setStap("rapport");
    } catch(e) {
      setFout(`Fout: ${e.message}`);
      setStap("upload");
    }
  };

  // Portfolio kiezen: laad automatisch het laatst opgeslagen rapport, anders naar upload
  const kiesPortfolio = (key) => {
    setPortfolio(key);
    const laatste = archiefLaden().find(a => a.portfolioKey === key && a.data);
    if (laatste) {
      setBkData(laatste.data.bk); setSvcData(laatste.data.svc);
      setBalData(laatste.data.balans); setRrData(laatste.data.rr || []);
      setAiTekst(laatste.data.aiTekst || "");
      setPeriodeJaar(laatste.jaar || 2026); setPeriodeKwartaal(laatste.kwartaal || 2);
      setComplexFilter(null); setUnitFilter(null); setTab("dashboard");
      setStap("rapport");
    } else {
      setStap("upload");
    }
  };

  // Nieuwe rapportage voor dezelfde portfolio (behoudt portfolio, reset upload/periode)
  const nieuweRapportage = () => {
    setBestanden({}); setBkData(null); setSvcData(null); setBalData(null);
    setRrData([]); setAiTekst(""); setFout("");
    setComplexFilter(null); setUnitFilter(null);
    setPeriodeJaar(2026); setPeriodeKwartaal(2);
    setTab("dashboard"); setStap("upload");
  };

  // Rapport herstellen vanuit het archief
  const herstelArchief = (a) => {
    if (!a.data) return;
    const key = a.portfolioKey || Object.keys(PORTFOLIOS).find(k => PORTFOLIOS[k].label === a.portfolio);
    setPortfolio(key || null);
    setBkData(a.data.bk); setSvcData(a.data.svc);
    setBalData(a.data.balans); setRrData(a.data.rr || []);
    setAiTekst(a.data.aiTekst || "");
    setPeriodeJaar(a.jaar || 2026); setPeriodeKwartaal(a.kwartaal || 2);
    setComplexFilter(null); setUnitFilter(null); setTab("dashboard");
    setStap("rapport");
  };

  const reset = () => {
    setPortfolio(null); setBestanden({}); setBkData(null);
    setSvcData(null); setBalData(null); setRrData([]);
    setAiTekst(""); setTab("dashboard"); setStap("kies");
    setComplexFilter(null); setUnitFilter(null);
    setPeriodeJaar(2026); setPeriodeKwartaal(2);
  };

  // Filter opnieuw verwerken als complex/unit wijzigt
  const gefilterdBk = bkData && (complexFilter || unitFilter)
    ? (() => {
        const bkS_raw = bkData; // al verwerkt, herverwerk niet
        return bkS_raw;
      })()
    : bkData;

  // Beschikbare units voor geselecteerd complex
  const beschikbareUnits = bkData?.complexen && complexFilter
    ? [...new Set(
        (bkData.units||[]).filter(u => {
          return true; // vereenvoudigd — toon alle units
        })
      )]
    : bkData?.units || [];

  return (
    <div style={{ minHeight:"100vh", background:C.bg,
      fontFamily:"Inter,system-ui,sans-serif", color:C.text, fontSize:14 }}>

      {/* Topbalk */}
      <div style={{ background:C.navy, color:C.white, padding:"0 32px", height:52,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:28, height:28, background:C.white, borderRadius:2,
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            <span style={{ fontSize:14, color:C.navy, fontWeight:800 }}>V</span>
          </div>
          <span style={{ fontWeight:600, fontSize:14 }}>BVC Rapportage</span>
          {p && (
            <span style={{ background:"rgba(255,255,255,0.14)", fontSize:12,
              padding:"2px 10px", borderRadius:10 }}>{p.label}</span>
          )}
        </div>
        {stap !== "kies" && (
          <div style={{ display:"flex", gap:8 }}>
            {stap === "rapport" && (
              <button onClick={nieuweRapportage} style={{ background:"rgba(255,255,255,0.18)",
                color:C.white, border:"none", padding:"5px 14px",
                borderRadius:2, cursor:"pointer", fontSize:12, fontWeight:600 }}>
                + Nieuwe rapportage
              </button>
            )}
            <button onClick={reset} style={{ background:"rgba(255,255,255,0.1)",
              color:C.white, border:"none", padding:"5px 14px",
              borderRadius:2, cursor:"pointer", fontSize:12 }}>
              ← Ander portfolio
            </button>
          </div>
        )}
      </div>

      <div style={{ maxWidth:1160, margin:"0 auto", padding:"40px 24px" }}>

        {/* STAP 1: Kies portfolio */}
        {stap === "kies" && (
          <div>
            <h1 style={{ fontSize:28, fontWeight:700, marginBottom:8,
              letterSpacing:"-0.02em" }}>Kies een portfolio</h1>
            <p style={{ color:C.textSub, marginBottom:36, fontSize:14 }}>
              Selecteer het vastgoedportfolio. De laatst opgeslagen cijfers worden automatisch getoond.
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
              gap:16, maxWidth:580 }}>
              {Object.entries(PORTFOLIOS).map(([key, pf]) => (
                <button key={key}
                  onClick={() => kiesPortfolio(key)}
                  style={{ background:C.white, border:`1.5px solid ${C.grey2}`,
                    borderRadius:2, padding:"24px 28px", cursor:"pointer",
                    textAlign:"left", transition:"all 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor=pf.kleur}
                  onMouseLeave={e => e.currentTarget.style.borderColor=C.grey2}>
                  <div style={{ width:8, height:8, borderRadius:"50%",
                    background:pf.kleur, marginBottom:12 }} />
                  <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>
                    {pf.label}</div>
                  <div style={{ fontSize:12, color:C.textSub }}>{pf.sub}</div>
                </button>
              ))}
            </div>

            {/* Archief knop */}
            <button onClick={() => setStap("archief_view")}
              style={{ marginTop:24, background:"none", color:C.navyMid,
                border:`1px solid ${C.navyMid}`, borderRadius:2,
                padding:"8px 18px", fontSize:13, cursor:"pointer" }}>
              📁 Eerder rapport bekijken
            </button>
          </div>
        )}

        {/* STAP 1b: Archief bekijken zonder rapport */}
        {stap === "archief_view" && (
          <div>
            <button onClick={() => setStap("kies")} style={{ background:"none",
              border:"none", cursor:"pointer", color:C.navyMid,
              fontSize:13, marginBottom:20 }}>← Terug</button>
            <ArchiefTab onHerstel={herstelArchief} />
          </div>
        )}

        {/* STAP 2: Upload */}
        {stap === "upload" && p && (
          <div>
            <div style={{ marginBottom:28 }}>
              <div style={{ fontSize:12, color:C.textSub, marginBottom:4 }}>
                {p.label} · {p.sub}
              </div>
              <h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>
                Upload IDBC-bestanden
              </h2>
              <p style={{ color:C.textSub, marginTop:8, fontSize:13 }}>
                Sleep bestanden in de velden of klik om te selecteren.
                <span style={{ color:C.red }}> *</span> = verplicht
              </p>
            </div>

            <div style={{ background:C.white, border:`1px solid ${C.grey2}`,
              borderRadius:2, padding:"16px 18px", marginBottom:20, maxWidth:660 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.textSub,
                letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>
                Voor welke periode is dit rapport?<span style={{ color:C.red }}> *</span>
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <select value={periodeKwartaal}
                  onChange={e => setPeriodeKwartaal(Number(e.target.value))}
                  style={{ border:`1px solid ${C.grey2}`, borderRadius:2,
                    padding:"7px 12px", fontSize:13, background:C.white,
                    color:C.text, cursor:"pointer" }}>
                  {KWARTAAL_OPTIES.map(k => (
                    <option key={k.waarde} value={k.waarde}>{k.label}</option>
                  ))}
                </select>
                <input type="number" value={periodeJaar}
                  onChange={e => setPeriodeJaar(Number(e.target.value) || periodeJaar)}
                  style={{ border:`1px solid ${C.grey2}`, borderRadius:2,
                    padding:"7px 12px", fontSize:13, width:90, color:C.text }} />
                <span style={{ fontSize:12, color:C.textSub }}>
                  → rapport toont {periodeLabel(periodeKwartaal, periodeJaar)} vs {periodeLabel(periodeKwartaal, periodeJaar-1)}
                </span>
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
              gap:10, maxWidth:660 }}>
              {p.bestanden.map(b => (
                <UploadVak key={b.key} bestand={b} bestandObj={bestanden[b.key]}
                  onChange={zetBestand} kleur={p.kleur} />
              ))}
            </div>
            {fout && (
              <div style={{ background:C.orangeL, color:C.orange, borderRadius:2,
                padding:"12px 16px", marginTop:16, fontSize:13, maxWidth:660 }}>
                {fout}
              </div>
            )}
            <div style={{ marginTop:24, display:"flex", gap:10 }}>
              <button onClick={verwerkData} disabled={!kanVerwerken}
                style={{ background:kanVerwerken?p.kleur:C.grey2,
                  color:kanVerwerken?C.white:C.grey3, border:"none",
                  borderRadius:2, padding:"11px 28px", fontSize:14,
                  fontWeight:600, cursor:kanVerwerken?"pointer":"default" }}>
                Rapportage genereren →
              </button>
              <button onClick={() => setStap("kies")} style={{ background:C.white,
                color:C.textSub, border:`1px solid ${C.grey2}`,
                borderRadius:2, padding:"11px 20px", fontSize:14, cursor:"pointer" }}>
                ← Terug
              </button>
            </div>
          </div>
        )}

        {/* STAP 3: Verwerken */}
        {stap === "verwerk" && (
          <div style={{ textAlign:"center", padding:"80px 0" }}>
            <div style={{ width:44, height:44, border:`3px solid ${C.grey2}`,
              borderTopColor:C.navy, borderRadius:"50%",
              margin:"0 auto 20px",
              animation:"spin 0.8s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <h3 style={{ fontSize:17, fontWeight:600, marginBottom:6 }}>Bezig…</h3>
            <p style={{ color:C.textSub, fontSize:13 }}>{voortgang}</p>
          </div>
        )}

        {/* STAP 4: Rapport */}
        {stap === "rapport" && p && bkData && (
          <div>
            {/* Header */}
            <div style={{ background:C.white, borderBottom:`1px solid ${C.grey2}`,
              margin:"-40px -24px 28px", padding:"16px 24px 0" }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"flex-end", marginBottom:12 }}>
                <div>
                  <p style={{ fontSize:11, color:C.textSub, letterSpacing:"0.07em",
                    textTransform:"uppercase", margin:"0 0 4px" }}>
                    {periodeLabel(bkData.kwartaal, bkData.jaar)} · periodes 1–{bkData.kwartaal*3}
                  </p>
                  <h2 style={{ fontSize:22, fontWeight:700, margin:0 }}>{p.label}</h2>
                  <p style={{ fontSize:12, color:C.textSub, margin:"3px 0 0" }}>{p.sub}</p>
                </div>
                <div style={{ display:"flex", gap:8, paddingBottom:2 }}>
                  <button onClick={() => exporteerExcel(p.label, bkData, svcData, balData, rrData)}
                    style={{ background:C.navy, color:C.white, border:"none",
                      borderRadius:2, padding:"8px 18px", fontSize:12,
                      fontWeight:600, cursor:"pointer" }}>
                    ↓ Excel
                  </button>
                  <button onClick={() => setStap("archief_view")}
                    style={{ background:C.white, color:C.textSub,
                      border:`1px solid ${C.grey2}`, borderRadius:2,
                      padding:"8px 14px", fontSize:12, cursor:"pointer" }}>
                    📁 Archief
                  </button>
                </div>
              </div>

              {/* Filterbalk */}
              <div style={{ display:"flex", gap:10, marginBottom:12,
                alignItems:"center", flexWrap:"wrap" }}>
                <span style={{ fontSize:11, color:C.textSub, fontWeight:600 }}>Filter:</span>
                <select
                  value={complexFilter || ""}
                  onChange={e => { setComplexFilter(e.target.value?Number(e.target.value):null); setUnitFilter(null); }}
                  style={{ border:`1px solid ${C.grey2}`, borderRadius:2,
                    padding:"4px 10px", fontSize:12, background:C.white,
                    color:C.text, cursor:"pointer" }}>
                  <option value="">Alle complexen</option>
                  {(bkData.complexen||[]).map(cx => (
                    <option key={cx.nr} value={cx.nr}>{cx.naam}</option>
                  ))}
                </select>
                <select
                  value={unitFilter || ""}
                  onChange={e => setUnitFilter(e.target.value||null)}
                  disabled={!complexFilter}
                  style={{ border:`1px solid ${complexFilter?C.grey2:C.grey2}`,
                    borderRadius:2, padding:"4px 10px", fontSize:12,
                    background:complexFilter?C.white:C.grey1,
                    color:complexFilter?C.text:C.grey3, cursor:complexFilter?"pointer":"default" }}>
                  <option value="">Alle units</option>
                  {(bkData.units||[]).map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                {(complexFilter || unitFilter) && (
                  <button onClick={() => { setComplexFilter(null); setUnitFilter(null); }}
                    style={{ background:"none", border:"none", color:C.navyMid,
                      fontSize:12, cursor:"pointer", textDecoration:"underline" }}>
                    × Filter wissen
                  </button>
                )}
                {unitFilter && (
                  <span style={{ background:C.navyLight, color:C.navyMid,
                    fontSize:11, padding:"3px 10px", borderRadius:2 }}>
                    ℹ Servicekosten, balans en cashflow tonen het volledige complex
                  </span>
                )}
              </div>

              {/* Tab navigatie */}
              <div style={{ display:"flex", gap:0, overflowX:"auto" }}>
                {TABS.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    background:"none", border:"none", cursor:"pointer",
                    padding:"10px 16px", fontSize:13,
                    fontWeight:tab===t.id?600:400,
                    color:tab===t.id?p.kleur:C.textSub,
                    borderBottom:`2px solid ${tab===t.id?p.kleur:"transparent"}`,
                    marginBottom:-1, whiteSpace:"nowrap" }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab inhoud */}
            {tab==="dashboard"     && <DashboardTab bk={bkData} svc={svcData} balans={balData} aiTekst={aiTekst} kleur={p.kleur} />}
            {tab==="pl"            && <PLTab bk={bkData} kleur={p.kleur} />}
            {tab==="servicekosten" && <ServicekostenTab svc={svcData} kleur={p.kleur} unitFilter={unitFilter} />}
            {tab==="rentroll"      && <RentRollTab rr={rrData} kleur={p.kleur} complexFilter={complexFilter} unitFilter={unitFilter} />}
            {tab==="cashflow"      && <CashflowTab bk={bkData} kleur={p.kleur} unitFilter={unitFilter} />}
            {tab==="balans"        && <BalansTab balans={balData} unitFilter={unitFilter} />}
            {tab==="signalen"      && <SignalenTab bk={bkData} svc={svcData} balans={balData} rr={rrData} />}
            {tab==="archief"       && <ArchiefTab onHerstel={() => {}} />}
          </div>
        )}
      </div>
    </div>
  );
}