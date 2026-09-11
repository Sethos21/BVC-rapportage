import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, kasstroomCategorieVoorRegel, liquideMiddelenVoorRegel, zoekMappingRegel, type Balansstand, type Boekingsregel } from "@bvc/domain";
import { berekenKasstroomPeriode } from "./kasstroomBerekening.js";

/**
 * Kasstroom-managementoverzicht (2026-08-24, vereenvoudigd op expliciet
 * verzoek van de gebruiker — "hoeveel geld kwam er binnen, hoeveel ging
 * eruit, en hoeveel daarvan heb ik zelf opgenomen?"). Bouwt voort op de
 * bewezen `berekenKasstroomPeriode` (bankstand begin/eind/netto,
 * ONGEWIJZIGD hergebruikt, geen dubbele berekening) en leidt ontvangsten/
 * uitgaven UITSLUITEND af uit de werkelijke mutaties op de bevestigde
 * liquide-middelen-rekening(en) zelf — geen tegenrekening-classificatie
 * meer nodig voor het totaal. Eigenaaronttrekkingen is een aanvullende
 * uitsplitsing BINNEN de uitgaven (welk deel van de uitgaven ging naar een
 * rekening met `kasstroomCategorie: "EIGENAARONTTREKKING"`, bv. 0840 bij
 * 070) — niet een aparte, los berekende categorie.
 *
 * Twee aansluitingen gelden ALTIJD, structureel (nooit een aparte
 * controle nodig, ze volgen uit de constructie van deze functie):
 * - `ontvangsten - uitgaven = nettoKasstroom` (nettoKasstroom komt
 *   rechtstreeks van `berekenKasstroomPeriode`'s `mutatieTotaal`, en
 *   ontvangsten/uitgaven zijn respectievelijk de som van de positieve en
 *   de (als positief bedrag getoonde) negatieve boekingen op dezelfde
 *   liquide-middelen-rekeningen — wiskundig per definitie gelijk).
 * - `eigenaarOnttrekkingen + overigeUitgaven = uitgaven` (`overigeUitgaven`
 *   is expliciet gedefinieerd als het restbedrag, geen apart berekende/
 *   te bevestigen categorie).
 *
 * Ontvangsten/uitgaven-splitsing: per individuele boeking op een liquide-
 * middelen-rekening (debet-credit positief = ontvangst, negatief =
 * uitgave) — geen boekstuk-/tegenrekeninglogica nodig voor dit totaal.
 *
 * Eigenaaronttrekkingen-splitsing (herzien 2026-08-25 na een echte
 * productie-run voor 070_Rooise_Zoom, zie
 * `kasstroomTegenrekeningDiagnose.ts`): SOM van de bedragen van
 * tegenrekening-boekingen met een bevestigde `kasstroomCategorie:
 * "EIGENAARONTTREKKING"`, binnen elk boekstuk dat ten minste één regel op
 * een liquide-middelen-rekening bevat (dus kasstroom-relevant is). Geen
 * aanname nodig over WELKE liquide regel bij welke tegenrekening hoort:
 * een boekstuk balanceert per definitie (debet = credit), dus het bedrag
 * van een bevestigde eigenaaronttrekking-tegenrekening binnen een
 * kasstroom-relevant boekstuk IS het bedrag dat via de liquide-middelen-
 * rekening is uitbetaald.
 *
 * Bewust GEEN boekstuk-brede homogeniteitseis meer (zoals een eerdere
 * versie had — "tellen alleen mee als ALLE tegenrekeningen binnen één
 * boekstuk dezelfde categorie hebben"): een echte productie-run liet zien
 * dat `boekstukSleutel` bij 070 een MAANDELIJKSE verzamelboeking is (één
 * boekstuk bundelt meerdere afzonderlijke huurontvangsten,
 * eigenaaronttrekkingen én kostenbetalingen), niet een boekstuk per
 * transactie. Een homogeniteitseis over zo'n verzamelboeking zou vrijwel
 * elke eigenaaronttrekking gemist hebben. Onbekende/ongemapte/andere
 * tegenrekeningen tellen simpelweg niet mee (geen gok) en vallen — samen
 * met alle overige uitgaven — automatisch in `overigeUitgaven`, de per
 * definitie gedefinieerde restcategorie.
 */

export interface KasstroomKwartaalRegel {
  kwartaal: 1 | 2 | 3 | 4;
  ontvangsten: Decimal;
  uitgaven: Decimal;
  eigenaarOnttrekkingen: Decimal;
  nettoKasstroom: Decimal;
}

export interface KasstroomManagementoverzichtControleVereist {
  grootboekrekening: string;
  saldo: Decimal;
  reden: string;
}

export interface KasstroomManagementoverzichtResultaat {
  bankstandBegin: Decimal;
  bankstandEind: Decimal;
  ontvangsten: Decimal;
  uitgaven: Decimal;
  /** = ontvangsten - uitgaven (per constructie gelijk aan bankstandEind - bankstandBegin). */
  nettoKasstroom: Decimal;
  /** Uitsplitsing BINNEN uitgaven: bedrag met een bevestigde tegenrekening-kasstroomCategorie "EIGENAARONTTREKKING", als positief bedrag. */
  eigenaarOnttrekkingen: Decimal;
  /** = uitgaven - eigenaarOnttrekkingen (per definitie, geen aparte berekening/aanname). */
  overigeUitgaven: Decimal;
  perKwartaal: KasstroomKwartaalRegel[];
  controleVereist: KasstroomManagementoverzichtControleVereist[];
}

export function berekenKasstroomManagementoverzicht(
  balansstanden: readonly Balansstand[],
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
): KasstroomManagementoverzichtResultaat {
  const kasstroomPeriode = berekenKasstroomPeriode(balansstanden, boekingen, mappingRegels);

  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  // Ontvangsten/uitgaven: rechtstreeks per boeking op een liquide-middelen-rekening, geen
  // tegenrekeninglogica nodig — zie moduledoc.
  let ontvangsten = new Decimal(0);
  let uitgaven = new Decimal(0);
  const perKwartaalOntvangsten = new Map<number, Decimal>();
  const perKwartaalUitgaven = new Map<number, Decimal>();

  for (const boeking of boekingen) {
    if (!liquideRekeningen.has(boeking.grootboeknr)) continue;
    const saldo = boekingSaldo(boeking);
    const kwartaal = kwartaalVanDatum(boeking.boekdatum);
    if (saldo.isPositive()) {
      ontvangsten = ontvangsten.plus(saldo);
      perKwartaalOntvangsten.set(kwartaal, (perKwartaalOntvangsten.get(kwartaal) ?? new Decimal(0)).plus(saldo));
    } else if (saldo.isNegative()) {
      uitgaven = uitgaven.plus(saldo.negated());
      perKwartaalUitgaven.set(kwartaal, (perKwartaalUitgaven.get(kwartaal) ?? new Decimal(0)).plus(saldo.negated()));
    }
  }

  // Eigenaaronttrekkingen: per boekstukSleutel bepalen of er ten minste één liquide-middelen-regel
  // in zit (kasstroom-relevant); zo ja, telt elke tegenrekening-regel met een bevestigde
  // kasstroomCategorie "EIGENAARONTTREKKING" mee met haar eigen bedrag (geen homogeniteitseis,
  // geen aanname over welke liquide regel erbij hoort — zie moduledoc).
  const kasstroomRelevantBoekstuk = new Map<string, boolean>();
  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    if (liquideRekeningen.has(boeking.grootboeknr)) kasstroomRelevantBoekstuk.set(key, true);
    else if (!kasstroomRelevantBoekstuk.has(key)) kasstroomRelevantBoekstuk.set(key, false);
  }

  let eigenaarOnttrekkingen = new Decimal(0);
  const perKwartaalOnttrekkingen = new Map<number, Decimal>();

  for (const boeking of boekingen) {
    if (liquideRekeningen.has(boeking.grootboeknr)) continue; // alleen tegenrekeningen
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    if (!kasstroomRelevantBoekstuk.get(key)) continue; // geen liquide regel in dit boekstuk -- niet kasstroom-relevant

    const mappingResultaat = zoekMappingRegel(mappingRegels, boeking.grootboeknr);
    if (mappingResultaat.type === "onbekend") continue; // geen gok, telt mee in overigeUitgaven via uitgaven-restdefinitie
    const categorieResultaat = kasstroomCategorieVoorRegel(mappingResultaat.waarde);
    if (categorieResultaat.type !== "bekend" || categorieResultaat.waarde !== "EIGENAARONTTREKKING") continue;

    const bedrag = boekingSaldo(boeking);
    const kwartaal = kwartaalVanDatum(boeking.boekdatum);
    eigenaarOnttrekkingen = eigenaarOnttrekkingen.plus(bedrag);
    perKwartaalOnttrekkingen.set(kwartaal, (perKwartaalOnttrekkingen.get(kwartaal) ?? new Decimal(0)).plus(bedrag));
  }

  const overigeUitgaven = uitgaven.minus(eigenaarOnttrekkingen);

  const perKwartaal: KasstroomKwartaalRegel[] = ([1, 2, 3, 4] as const).map((kwartaal) => {
    const kwOntvangsten = perKwartaalOntvangsten.get(kwartaal) ?? new Decimal(0);
    const kwUitgaven = perKwartaalUitgaven.get(kwartaal) ?? new Decimal(0);
    const kwOnttrekkingen = perKwartaalOnttrekkingen.get(kwartaal) ?? new Decimal(0);
    return { kwartaal, ontvangsten: kwOntvangsten, uitgaven: kwUitgaven, eigenaarOnttrekkingen: kwOnttrekkingen, nettoKasstroom: kwOntvangsten.minus(kwUitgaven) };
  });

  const controleVereist: KasstroomManagementoverzichtControleVereist[] = [...kasstroomPeriode.controleVereist].sort((a, b) => a.grootboekrekening.localeCompare(b.grootboekrekening));

  return {
    bankstandBegin: kasstroomPeriode.beginstandTotaal,
    bankstandEind: kasstroomPeriode.eindstandTotaal,
    ontvangsten,
    uitgaven,
    nettoKasstroom: kasstroomPeriode.mutatieTotaal,
    eigenaarOnttrekkingen,
    overigeUitgaven,
    perKwartaal,
    controleVereist,
  };
}

function kwartaalVanDatum(datum: Date): 1 | 2 | 3 | 4 {
  return (Math.floor(datum.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
}
