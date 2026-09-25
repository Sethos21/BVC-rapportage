import type { GrootboekMappingRegel } from "@bvc/config";
import type { Balansstand, Boekingsregel } from "@bvc/domain";
import { berekenKasstroomManagementoverzicht, type KasstroomManagementoverzichtControleVereist, type KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

/**
 * Kasstroom over een sub-periode (bv. "periode 04 t/m 06"), 2026-08-26 —
 * APART van, en zonder te wijzigen aan, de bewezen
 * `berekenKasstroomManagementoverzicht` (die blijft uitsluitend YTD-vanaf-
 * jaarbegin, ongewijzigd). Reden voor een aparte functie: die YTD-functie
 * haalt `bankstandBegin` altijd rechtstreeks uit `Balansstand.beginbalans*`
 * (1 januari van het boekjaar) — boekingen simpelweg filteren tot periode
 * 04-06 en door dezelfde functie halen zou bankstand eind stil verkeerd
 * berekenen (periode 1-3 valt er dan ongemerkt uit).
 *
 * Oplossing: roep de bewezen YTD-functie TWEE keer aan, op twee al-
 * bestaande, cumulatieve selecties:
 * - "voor de periode": boekingen periode 01 t/m (boekperiodeVan − 1);
 * - "t/m de periode": boekingen periode 01 t/m boekperiodeTotEnMet — dit IS
 *   exact dezelfde selectie/aanroep als de bestaande YTD-weergave.
 *
 * `bankstandBegin`/`bankstandEind` van de sub-periode komen RECHTSTREEKS
 * van deze twee aanroepen (geen optelling, geen aparte formule):
 * - bankstandBegin (sub-periode) = bankstandEind ("voor de periode")
 * - bankstandEind (sub-periode)  = bankstandEind ("t/m de periode") — dus
 *   IDENTIEK aan wat de bestaande YTD-functie voor dezelfde
 *   boekperiodeTotEnMet zou opleveren (test: `kasstroomManagementoverzichtSubperiode.test.ts`).
 *
 * Ontvangsten/uitgaven/eigenaaronttrekkingen/nettoKasstroom van de
 * sub-periode zijn het VERSCHIL tussen de twee YTD-uitkomsten — alleen
 * toegepast op componenten die bewezen additief zijn (zuivere sommen over
 * boekingen, geen boekstuk-overkoepelende logica die van het gekozen
 * bereik afhangt). `overigeUitgaven` volgt daarna, zoals altijd, uit
 * `uitgaven - eigenaarOnttrekkingen`. NIET-additieve zaken (bv. een Top-N
 * grootste-uitgaven-lijst) horen hier NIET thuis — die moet de aanroeper
 * apart, rechtstreeks op de sub-periode-boekingen berekenen (`berekenTopOverigeUitgaven`
 * in `apps/worker/src/genereerManagementRapport.ts`), nooit door twee
 * YTD-Top-N-lijsten van elkaar af te trekken.
 *
 * Twee harde aansluitingen (regressiegetest):
 * 1. `bankstandBegin + nettoKasstroom = bankstandEind` (volgt uit de
 *    constructie hierboven, want nettoKasstroom = ontvangsten − uitgaven =
 *    verschil van twee YTD-eindstanden min elkaar = exact het verschil
 *    tussen de twee bankstandEind-waarden).
 * 2. `bankstandEind (sub-periode) = bankstandEind` van een onafhankelijke,
 *    losse YTD-aanroep voor dezelfde `boekperiodeTotEnMet`.
 */
export interface KasstroomManagementoverzichtSubperiodeInvoer {
  balansstanden: readonly Balansstand[];
  /** Boekingen periode 01 t/m (boekperiodeVan − 1) — LEEG als boekperiodeVan = "01" (geen voorafgaande periode binnen het boekjaar). */
  boekingenVoorPeriode: readonly Boekingsregel[];
  /** Boekingen periode 01 t/m boekperiodeTotEnMet — dezelfde selectie als de bestaande YTD-weergave (bevat dus OOK de boekingen van de geselecteerde periode zelf). */
  boekingenTotEnMetPeriode: readonly Boekingsregel[];
  mappingRegels: readonly GrootboekMappingRegel[];
}

function combineerControleVereist(
  voor: readonly KasstroomManagementoverzichtControleVereist[],
  totEnMet: readonly KasstroomManagementoverzichtControleVereist[],
): KasstroomManagementoverzichtControleVereist[] {
  const perRekening = new Map<string, KasstroomManagementoverzichtControleVereist>();
  for (const item of voor) perRekening.set(item.grootboekrekening, item);
  // "totEnMet" overschrijft bewust: reflecteert het volledige bereik (01..totEnMet), dus de meest complete melding voor die rekening.
  for (const item of totEnMet) perRekening.set(item.grootboekrekening, item);
  return Array.from(perRekening.values()).sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));
}

export function berekenKasstroomManagementoverzichtSubperiode(invoer: KasstroomManagementoverzichtSubperiodeInvoer): KasstroomManagementoverzichtResultaat {
  const voorPeriode = berekenKasstroomManagementoverzicht(invoer.balansstanden, invoer.boekingenVoorPeriode, invoer.mappingRegels);
  const totEnMetPeriode = berekenKasstroomManagementoverzicht(invoer.balansstanden, invoer.boekingenTotEnMetPeriode, invoer.mappingRegels);

  const ontvangsten = totEnMetPeriode.ontvangsten.minus(voorPeriode.ontvangsten);
  const uitgaven = totEnMetPeriode.uitgaven.minus(voorPeriode.uitgaven);
  const eigenaarOnttrekkingen = totEnMetPeriode.eigenaarOnttrekkingen.minus(voorPeriode.eigenaarOnttrekkingen);
  const nettoKasstroom = ontvangsten.minus(uitgaven);
  const overigeUitgaven = uitgaven.minus(eigenaarOnttrekkingen);

  const perKwartaal = totEnMetPeriode.perKwartaal.map((kwTotEnMet, i) => {
    const kwVoor = voorPeriode.perKwartaal[i]!;
    const kwOntvangsten = kwTotEnMet.ontvangsten.minus(kwVoor.ontvangsten);
    const kwUitgaven = kwTotEnMet.uitgaven.minus(kwVoor.uitgaven);
    return {
      kwartaal: kwTotEnMet.kwartaal,
      ontvangsten: kwOntvangsten,
      uitgaven: kwUitgaven,
      eigenaarOnttrekkingen: kwTotEnMet.eigenaarOnttrekkingen.minus(kwVoor.eigenaarOnttrekkingen),
      nettoKasstroom: kwOntvangsten.minus(kwUitgaven),
    };
  });

  return {
    bankstandBegin: voorPeriode.bankstandEind,
    bankstandEind: totEnMetPeriode.bankstandEind,
    ontvangsten,
    uitgaven,
    nettoKasstroom,
    eigenaarOnttrekkingen,
    overigeUitgaven,
    perKwartaal,
    controleVereist: combineerControleVereist(voorPeriode.controleVereist, totEnMetPeriode.controleVereist),
  };
}
