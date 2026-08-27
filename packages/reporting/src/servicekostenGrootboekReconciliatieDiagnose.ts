import Decimal from "decimal.js";
import { som } from "./servicekostenDiagnose.js";
import { begrens, type BegrensdeLijst, type ServicekostenAfrekeningDiagnoseRegel } from "./servicekostenAfrekeningDiagnose.js";

/**
 * Servicekosten ↔ grootboek-reconciliatiediagnose (2026-08-27) — TIJDELIJK,
 * ALLEEN-LEZEN, vervolg op `servicekostenAfrekeningDiagnose.ts`. De
 * operationele bron (Kostensoort_Soort Kosten/Voorschotten/Nvt) is inmiddels
 * bronbewezen; deze diagnose onderzoekt of en hoe die stromen financieel
 * aansluiten op de gewone `boekingen` (met de nadruk op grootboekrekening
 * 1711/1712, door de gebruiker aangewezen als vermoedelijke bestemming).
 *
 * Koppelsleutel: (boekjaar, dagboeknummer, boekstuknummer, volgnummer) —
 * dezelfde velden die de natuurlijke sleutel van een servicekostenregel
 * vormen, nu MET boekjaar (verscherping t.o.v. de vorige diagnose, omdat
 * financiële reconciliatie een grotere nauwkeurigheidseis heeft dan een
 * eerste verkenning — boekstuknummers kunnen per boekjaar opnieuw beginnen).
 * Uitdrukkelijk GEEN bedrag-matching — op verzoek van de gebruiker: als deze
 * sleutel niet deterministisch blijkt (lage koppelgraad), is dat een
 * bevinding om te rapporteren, geen aanleiding om op bedrag te gaan matchen.
 *
 * De doelrekeningen (bv. "1711","1712") zijn een PARAMETER, niet
 * hardcoded — deze module classificeert niets, kent geen vaste
 * grootboekrekeningen toe aan een servicekostenstroom; ze telt alleen op en
 * legt naast elkaar wat de bron en het grootboek allebei al zeggen.
 * Kostensoort 9600 blijft in elke sectie apart zichtbaar (nooit
 * samengevoegd met Kosten/Voorschotten), conform de eis dat 9600 financieel
 * traceerbaar moet blijven zonder in de actuele kosten/voorschotten-
 * opstelling mee te tellen. Wijzigt niets aan een bestaande rekenfunctie,
 * mapping of het managementrapport.
 */

export interface ServicekostenGrootboekReconciliatieBoekingRegel {
  boekjaar: number;
  boekperiode: string;
  dagboeknr: string;
  boekstuknr: string;
  volgnr: string;
  grootboeknr: string;
  bedragDebet: Decimal;
  bedragCredit: Decimal;
  saldo: Decimal;
}

const KOSTENSOORT_9600 = "9600";
const MAX_VOORBEELD_ITEMS = 20;

function boekingSleutel(boekjaar: number, dagboeknr: string, boekstuknr: string, volgnr: string): string {
  return [boekjaar, dagboeknr, boekstuknr, volgnr].join("::");
}

function servicekostenSleutel(regel: ServicekostenAfrekeningDiagnoseRegel): string {
  return boekingSleutel(regel.boekjaar, regel.dagboeknummer, regel.boekstuknummer, regel.volgnummer);
}

function natuurlijkeSleutel(regel: ServicekostenAfrekeningDiagnoseRegel): string {
  return [regel.bedrijfsnr, regel.boekjaar, regel.boekperiode, regel.dagboeknummer, regel.boekstuknummer, regel.volgnummer].join("::");
}

export interface ServicekostenGrootboekReconciliatieGrootboekTotaal {
  grootboekrekening: string;
  aantalRegels: number;
  debet: Decimal;
  credit: Decimal;
  saldo: Decimal;
}

export interface ServicekostenGrootboekReconciliatieStroomSectie {
  /** Letterlijke Kostensoort_Soort-waarde ("Kosten"/"Voorschotten"/"Nvt"/... of "(leeg)"), ongewijzigd overgenomen — geen classificatie. */
  kostensoortSoortWaarde: string;
  aantalRegelsTotaal: number;
  saldoTotaal: Decimal;
  aantalGekoppeld: number;
  aantalNietGekoppeld: number;
  saldoNietGekoppeld: Decimal;
  /** Alle grootboekrekeningen die via de koppelsleutel daadwerkelijk gevonden zijn — data-gedreven, niet beperkt tot de doelrekeningen. */
  perGrootboekrekening: ServicekostenGrootboekReconciliatieGrootboekTotaal[];
  voorbeeldenNietGekoppeld: BegrensdeLijst<{ natuurlijkeSleutel: string; saldo: Decimal }>;
}

function bouwStroomSectie(regels: readonly ServicekostenAfrekeningDiagnoseRegel[], boekingenPerSleutel: Map<string, ServicekostenGrootboekReconciliatieBoekingRegel[]>): Omit<ServicekostenGrootboekReconciliatieStroomSectie, "kostensoortSoortWaarde"> {
  let aantalGekoppeld = 0;
  const nietGekoppeld: ServicekostenAfrekeningDiagnoseRegel[] = [];
  const perRekeningMap = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();

  for (const regel of regels) {
    const matches = boekingenPerSleutel.get(servicekostenSleutel(regel)) ?? [];
    if (matches.length === 0) {
      nietGekoppeld.push(regel);
      continue;
    }
    aantalGekoppeld += 1;
    for (const boeking of matches) {
      const groep = perRekeningMap.get(boeking.grootboeknr) ?? [];
      groep.push(regel);
      perRekeningMap.set(boeking.grootboeknr, groep);
    }
  }

  const perGrootboekrekening: ServicekostenGrootboekReconciliatieGrootboekTotaal[] = Array.from(perRekeningMap.entries())
    .map(([grootboekrekening, groep]) => ({
      grootboekrekening,
      aantalRegels: groep.length,
      debet: som(groep.map((r) => r.bedragDebet)),
      credit: som(groep.map((r) => r.bedragCredit)),
      saldo: som(groep.map((r) => r.saldo)),
    }))
    .sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  return {
    aantalRegelsTotaal: regels.length,
    saldoTotaal: som(regels.map((r) => r.saldo)),
    aantalGekoppeld,
    aantalNietGekoppeld: nietGekoppeld.length,
    saldoNietGekoppeld: som(nietGekoppeld.map((r) => r.saldo)),
    perGrootboekrekening,
    voorbeeldenNietGekoppeld: begrens(
      nietGekoppeld.map((r) => ({ natuurlijkeSleutel: natuurlijkeSleutel(r), saldo: r.saldo })),
      MAX_VOORBEELD_ITEMS,
    ),
  };
}

export interface ServicekostenGrootboekReconciliatieStroomBijdrage {
  kostensoortSoortWaarde: string;
  aantalRegels: number;
  saldo: Decimal;
}

export interface ServicekostenGrootboekReconciliatieRekeningVergelijking {
  grootboekrekening: string;
  /** Onafhankelijk uit `boekingen` gesommeerd, zelfde boekjaar/periode-selectie — de "waarheid" om tegen te leggen. */
  grootboekSaldo: Decimal;
  grootboekAantalRegels: number;
  servicekostenGekoppeldSaldoTotaal: Decimal;
  servicekostenGekoppeldAantalRegels: number;
  /** Uitsplitsing van wat er via de koppeling op deze rekening terechtkomt, per letterlijke Kostensoort_Soort-waarde — 9600 blijft hier zichtbaar als "Nvt", nooit samengevoegd met Kosten/Voorschotten. */
  servicekostenGekoppeldPerStroom: ServicekostenGrootboekReconciliatieStroomBijdrage[];
  /** grootboekSaldo - servicekostenGekoppeldSaldoTotaal — geen automatische "verklaring" toegepast, puur het cijfer. */
  verschil: Decimal;
}

export interface ServicekostenGrootboekReconciliatiePeriodeVergelijking {
  boekperiode: string;
  grootboekrekening: string;
  grootboekSaldo: Decimal;
  servicekostenGekoppeldSaldo: Decimal;
  verschil: Decimal;
}

export interface ServicekostenGrootboekReconciliatieControleItem {
  ernst: "WAARSCHUWING" | "INFORMATIEF";
  bericht: string;
}

export interface ServicekostenGrootboekReconciliatieResultaat {
  doelrekeningen: string[];
  perStroom: ServicekostenGrootboekReconciliatieStroomSectie[];
  /** Apart van `perStroom` — kostensoort 9600, ongeacht de Kostensoort_Soort-waarde, expliciet financieel traceerbaar gehouden. */
  kostensoort9600: Omit<ServicekostenGrootboekReconciliatieStroomSectie, "kostensoortSoortWaarde">;
  rekeningVergelijking: ServicekostenGrootboekReconciliatieRekeningVergelijking[];
  periodeVergelijking: ServicekostenGrootboekReconciliatiePeriodeVergelijking[];
  controleVereist: ServicekostenGrootboekReconciliatieControleItem[];
}

export function diagnoseerServicekostenGrootboekReconciliatie(
  servicekosten: readonly ServicekostenAfrekeningDiagnoseRegel[],
  boekingen: readonly ServicekostenGrootboekReconciliatieBoekingRegel[],
  doelrekeningen: readonly string[],
): ServicekostenGrootboekReconciliatieResultaat {
  const controleVereist: ServicekostenGrootboekReconciliatieControleItem[] = [];

  const boekingenPerSleutel = new Map<string, ServicekostenGrootboekReconciliatieBoekingRegel[]>();
  for (const boeking of boekingen) {
    const sleutel = boekingSleutel(boeking.boekjaar, boeking.dagboeknr, boeking.boekstuknr, boeking.volgnr);
    const groep = boekingenPerSleutel.get(sleutel) ?? [];
    groep.push(boeking);
    boekingenPerSleutel.set(sleutel, groep);
  }

  // ── Per stroom (letterlijke Kostensoort_Soort-waarde) ──────────────────
  const perSoortMap = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
  for (const regel of servicekosten) {
    const sleutel = regel.kostensoortSoort ?? "(leeg)";
    const groep = perSoortMap.get(sleutel) ?? [];
    groep.push(regel);
    perSoortMap.set(sleutel, groep);
  }
  const perStroom: ServicekostenGrootboekReconciliatieStroomSectie[] = Array.from(perSoortMap.entries())
    .map(([kostensoortSoortWaarde, groep]) => ({ kostensoortSoortWaarde, ...bouwStroomSectie(groep, boekingenPerSleutel) }))
    .sort((a, b) => a.kostensoortSoortWaarde.localeCompare(b.kostensoortSoortWaarde));

  for (const stroom of perStroom) {
    if (stroom.aantalRegelsTotaal > 0 && stroom.aantalNietGekoppeld > 0) {
      const percentage = Math.round((stroom.aantalNietGekoppeld / stroom.aantalRegelsTotaal) * 100);
      controleVereist.push({
        ernst: percentage > 25 ? "WAARSCHUWING" : "INFORMATIEF",
        bericht: `Kostensoort_Soort "${stroom.kostensoortSoortWaarde}": ${stroom.aantalNietGekoppeld} van ${stroom.aantalRegelsTotaal} regels (${percentage}%) konden niet aan een boekingsregel gekoppeld worden (saldo niet-gekoppeld: ${stroom.saldoNietGekoppeld.toString()}).`,
      });
    }
    for (const gb of stroom.perGrootboekrekening) {
      if (!doelrekeningen.includes(gb.grootboekrekening)) {
        controleVereist.push({
          ernst: "WAARSCHUWING",
          bericht: `Kostensoort_Soort "${stroom.kostensoortSoortWaarde}" koppelt ${gb.aantalRegels} regel(s) (saldo ${gb.saldo.toString()}) aan grootboekrekening "${gb.grootboekrekening}" — niet in de opgegeven doelrekeningen (${doelrekeningen.join(", ")}).`,
        });
      }
    }
  }

  // ── Kostensoort 9600, apart, ongeacht Kostensoort_Soort ────────────────
  const negenzeshonderdRegels = servicekosten.filter((r) => r.kostensoort === KOSTENSOORT_9600);
  const kostensoort9600 = bouwStroomSectie(negenzeshonderdRegels, boekingenPerSleutel);
  if (kostensoort9600.aantalRegelsTotaal > 0) {
    controleVereist.push({
      ernst: "INFORMATIEF",
      bericht: `Kostensoort 9600: ${kostensoort9600.aantalGekoppeld} van ${kostensoort9600.aantalRegelsTotaal} regels gekoppeld aan grootboek; rekeningen gevonden: ${kostensoort9600.perGrootboekrekening.map((g) => g.grootboekrekening).join(", ") || "(geen)"}.`,
    });
  }

  // ── Onafhankelijke grootboektotalen + reconciliatie per doelrekening ──
  const boekingenPerRekening = new Map<string, ServicekostenGrootboekReconciliatieBoekingRegel[]>();
  for (const boeking of boekingen) {
    const groep = boekingenPerRekening.get(boeking.grootboeknr) ?? [];
    groep.push(boeking);
    boekingenPerRekening.set(boeking.grootboeknr, groep);
  }

  function servicekostenGekoppeldOpRekening(grootboekrekening: string): ServicekostenAfrekeningDiagnoseRegel[] {
    return servicekosten.filter((regel) => (boekingenPerSleutel.get(servicekostenSleutel(regel)) ?? []).some((b) => b.grootboeknr === grootboekrekening));
  }

  const rekeningVergelijking: ServicekostenGrootboekReconciliatieRekeningVergelijking[] = doelrekeningen.map((grootboekrekening) => {
    const grootboekRegels = boekingenPerRekening.get(grootboekrekening) ?? [];
    const gekoppeldeRegels = servicekostenGekoppeldOpRekening(grootboekrekening);

    const perStroomMap = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
    for (const regel of gekoppeldeRegels) {
      const sleutel = regel.kostensoortSoort ?? "(leeg)";
      const groep = perStroomMap.get(sleutel) ?? [];
      groep.push(regel);
      perStroomMap.set(sleutel, groep);
    }
    const servicekostenGekoppeldPerStroom: ServicekostenGrootboekReconciliatieStroomBijdrage[] = Array.from(perStroomMap.entries())
      .map(([kostensoortSoortWaarde, groep]) => ({ kostensoortSoortWaarde, aantalRegels: groep.length, saldo: som(groep.map((r) => r.saldo)) }))
      .sort((a, b) => a.kostensoortSoortWaarde.localeCompare(b.kostensoortSoortWaarde));

    const grootboekSaldo = som(grootboekRegels.map((r) => r.saldo));
    const servicekostenGekoppeldSaldoTotaal = som(gekoppeldeRegels.map((r) => r.saldo));
    const verschil = grootboekSaldo.minus(servicekostenGekoppeldSaldoTotaal);

    return {
      grootboekrekening,
      grootboekSaldo,
      grootboekAantalRegels: grootboekRegels.length,
      servicekostenGekoppeldSaldoTotaal,
      servicekostenGekoppeldAantalRegels: gekoppeldeRegels.length,
      servicekostenGekoppeldPerStroom,
      verschil,
    };
  });

  for (const vergelijking of rekeningVergelijking) {
    if (!vergelijking.verschil.isZero()) {
      controleVereist.push({
        ernst: "WAARSCHUWING",
        bericht: `Grootboekrekening ${vergelijking.grootboekrekening}: grootboeksaldo (${vergelijking.grootboekSaldo.toString()}) wijkt af van het gekoppelde servicekostensaldo (${vergelijking.servicekostenGekoppeldSaldoTotaal.toString()}) — verschil ${vergelijking.verschil.toString()}.`,
      });
    } else {
      controleVereist.push({
        ernst: "INFORMATIEF",
        bericht: `Grootboekrekening ${vergelijking.grootboekrekening}: grootboeksaldo en gekoppeld servicekostensaldo sluiten exact aan (${vergelijking.grootboekSaldo.toString()}).`,
      });
    }
  }

  // ── Periode-voor-periode, per doelrekening ─────────────────────────────
  const periodeVergelijking: ServicekostenGrootboekReconciliatiePeriodeVergelijking[] = [];
  for (const grootboekrekening of doelrekeningen) {
    const grootboekPerPeriode = new Map<string, ServicekostenGrootboekReconciliatieBoekingRegel[]>();
    for (const boeking of boekingenPerRekening.get(grootboekrekening) ?? []) {
      const groep = grootboekPerPeriode.get(boeking.boekperiode) ?? [];
      groep.push(boeking);
      grootboekPerPeriode.set(boeking.boekperiode, groep);
    }
    const gekoppeldePerPeriode = new Map<string, ServicekostenAfrekeningDiagnoseRegel[]>();
    for (const regel of servicekostenGekoppeldOpRekening(grootboekrekening)) {
      const groep = gekoppeldePerPeriode.get(regel.boekperiode) ?? [];
      groep.push(regel);
      gekoppeldePerPeriode.set(regel.boekperiode, groep);
    }
    const alleBoekperiodes = new Set([...grootboekPerPeriode.keys(), ...gekoppeldePerPeriode.keys()]);
    for (const boekperiode of Array.from(alleBoekperiodes).sort()) {
      const grootboekSaldo = som((grootboekPerPeriode.get(boekperiode) ?? []).map((r) => r.saldo));
      const servicekostenGekoppeldSaldo = som((gekoppeldePerPeriode.get(boekperiode) ?? []).map((r) => r.saldo));
      periodeVergelijking.push({ boekperiode, grootboekrekening, grootboekSaldo, servicekostenGekoppeldSaldo, verschil: grootboekSaldo.minus(servicekostenGekoppeldSaldo) });
    }
  }

  const aantalPeriodesMetVerschil = periodeVergelijking.filter((p) => !p.verschil.isZero()).length;
  if (aantalPeriodesMetVerschil > 0) {
    controleVereist.push({
      ernst: "WAARSCHUWING",
      bericht: `${aantalPeriodesMetVerschil} van ${periodeVergelijking.length} periode/grootboekrekening-combinaties hebben een verschil tussen grootboeksaldo en gekoppeld servicekostensaldo.`,
    });
  }

  return { doelrekeningen: [...doelrekeningen], perStroom, kostensoort9600, rekeningVergelijking, periodeVergelijking, controleVereist };
}
