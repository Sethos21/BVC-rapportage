import { parseContracten, parseRentroll, type GestaagdContract, type GestaagdeRentrollregel } from "@bvc/data-contracts";
import type { BgContractFeiten, BgRentrollComponent } from "@bvc/reporting";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { resolveBron } from "./sourceResolver.js";

/**
 * TRANCHE 12 — de bronadapter Contracten/RentRoll → `BgContractFeiten[]`. Vertaalt UITSLUITEND
 * al bewezen bronvelden (zie `@bvc/reporting`'s `begroteHuuropbrengsten.ts`'s moduledoc voor het
 * volledige brononderzoek) naar de exacte vorm die de bestaande, ongewijzigde pure Huur-motor
 * (`berekenBegroteHuuropbrengsten`) verwacht. Bevat GEEN classificatielogica (belast/onbelast,
 * indexatie, pro-rata) — dat blijft uitsluitend in de pure calculator; deze laag levert alleen
 * de rauwe, per-contract gegroepeerde bronfeiten aan.
 *
 * TWEE BRONNEN, ÉÉN SLEUTEL: `contracten_huidig` (identiteit/data/indexatie — Bedrijfsnr+Contract)
 * en `rentroll` (financiële componenten — Bedrijfsnummer+Contractnummer). Beide bestanden zijn
 * GEDEELD over administraties (bewezen, zie `genereerContractHuurderDiagnose.ts`'s moduledoc) —
 * filtering op `bedrijfsnr` is daarom verplicht en gebeurt op BEIDE bronnen onafhankelijk, nooit
 * op het resultaat van één ervan alleen.
 *
 * BEIDE BRONNEN VEREIST: ontbreekt één van de twee bronbestanden, dan blijft het volledige
 * resultaat `bronBeschikbaar: false` (`contracten: []`) — een contract zonder rentroll-koppeling
 * zou anders een bevestigde €0-bruto-huur suggereren terwijl de werkelijke reden "geen
 * rentroll-brondata beschikbaar" is (unknown ≠ €0, CLAUDE.md §6). Dit is een bewuste,
 * conservatieve keuze: een gedeeltelijke, financieel misleidende snapshot is nooit beter dan
 * een expliciet lege snapshot (die de bestaande Begroting-lifecycle al correct als "nog niet
 * ingevuld" behandelt).
 *
 * VORDERINGSOORT-FILTER: uitsluitend "01" (bruto huur) en "13" (huurkorting) zijn bewezen
 * relevant (zie moduledoc `begroteHuuropbrengsten.ts`) — andere waarden (bv. "12", Compensatie
 * OB) worden hier NIET meegenomen in `rentrollComponenten`; de pure calculator zou ze toch
 * negeren, maar deze adapter filtert al vooraf om nooit de indruk te wekken dat elke
 * rentroll-regel is meegewogen.
 *
 * NIET GEBOUWD IN TRANCHE 12: `toekomstigeKortingswijzigingen` blijft altijd een lege lijst.
 * Het bewezen bronbestand daarvoor (`contract_prijsregels.xlsx`/`contracten_huidig_met_
 * prijzen.xlsx`) is geen geregistreerd brontype (`BRON_TYPES`) en heeft geen parser — het
 * bouwen van de kandidaat-resolutielaag ("kiest zelf nooit tussen conflicterende kandidaten",
 * zie `begroteHuuropbrengsten.ts` punt 4) is een aparte, niet-triviale vervolgstap. Zonder deze
 * lijst valt de pure calculator terug op zijn eigen, al bestaande fallback: de huidige korting
 * vlak doorzetten over het hele begrotingsjaar — exact het bestaande, bewezen gedrag.
 */

export interface ContractenRentrollLeesresultaat {
  /** `false` zodra één van beide bronbestanden ontbreekt — dan is `contracten` altijd `[]` (zie moduledoc). */
  bronBeschikbaar: boolean;
  aantalRuweContractenRegels: number;
  aantalRuweRentrollRegels: number;
  /** Aantal contractregels ná Bedrijfsnr-filter (vóór eventuele parse-issues). */
  aantalContractenNaFilter: number;
  /** Aantal rentrollregels ná Bedrijfsnummer-filter. */
  aantalRentrollNaFilter: number;
  contracten: readonly BgContractFeiten[];
  /** Parse-issues (KRITIEK/WAARSCHUWING) van beide bronnen — nooit stilzwijgend verworpen. */
  contractenIssues: readonly { ernst: string; bericht: string }[];
  rentrollIssues: readonly { ernst: string; bericht: string }[];
}

const RELEVANTE_VORDERINGSOORTEN = new Set(["01", "13"]);

function naarRentrollComponent(regel: GestaagdeRentrollregel): BgRentrollComponent | null {
  if (!RELEVANTE_VORDERINGSOORTEN.has(regel.vorderingsoort)) return null;
  if (regel.prolongatieBedragJaar === null) return null;
  return { vorderingsoort: regel.vorderingsoort, bedragJaar: regel.prolongatieBedragJaar, btwYn: regel.btwYn };
}

function naarBgContractFeiten(contract: GestaagdContract, rentrollregels: readonly GestaagdeRentrollregel[]): BgContractFeiten {
  const rentrollComponenten = rentrollregels.map(naarRentrollComponent).filter((c): c is BgRentrollComponent => c !== null);
  return {
    bedrijfsnr: contract.bedrijfsnr,
    contractnummer: contract.contract,
    huurdernummer: contract.huurdernummer,
    huurderNaam: contract.huurderNaam,
    complexnummer: contract.complexnummer,
    rentrollComponenten,
    ingangsdatum: contract.ingangsdatum,
    einddatum: contract.expiratieExpiratiedatum, // bewezen: NIET Afloopdatum, zie begroteHuuropbrengsten.ts
    indexatiedatum: contract.verhogingDatum,
    indexatieHerhalingMaanden: contract.verhogingOpnieuwNa,
    toekomstigeKortingswijzigingen: [], // zie moduledoc — niet gebouwd in Tranche 12
  };
}

/**
 * Leest Contracten + RentRoll voor één administratie, valideert via de bestaande
 * `@bvc/data-contracts`-parsers, filtert op `bedrijfsnr` (administratie-isolatie, beide bronnen
 * onafhankelijk gedeeld) en groepeert tot `BgContractFeiten[]`. Schrijft niets, muteert niets —
 * uitsluitend lezen + vertalen.
 */
export function leesBgContractFeitenVoorAdministratie(root: string, administratieId: string, bedrijfsnr: string): ContractenRentrollLeesresultaat {
  const leegResultaat = (): ContractenRentrollLeesresultaat => ({
    bronBeschikbaar: false,
    aantalRuweContractenRegels: 0,
    aantalRuweRentrollRegels: 0,
    aantalContractenNaFilter: 0,
    aantalRentrollNaFilter: 0,
    contracten: [],
    contractenIssues: [],
    rentrollIssues: [],
  });

  const contractenBron = resolveBron(root, administratieId, "contracten_huidig");
  const rentrollBron = resolveBron(root, administratieId, "rentroll");
  if (!contractenBron.bestaat || !rentrollBron.bestaat) return leegResultaat();

  const adapter = new ExcelBronAdapter();
  const ruweContractenRijen = adapter.leesRuweRijen(contractenBron);
  const ruweRentrollRijen = adapter.leesRuweRijen(rentrollBron);

  const { rijen: contractenRijen, issues: contractenIssues } = parseContracten(ruweContractenRijen);
  const { rijen: rentrollRijen, issues: rentrollIssues } = parseRentroll(ruweRentrollRijen);

  const contractenVanAdministratie = contractenRijen.filter((r) => r.bedrijfsnr === bedrijfsnr);
  const rentrollVanAdministratie = rentrollRijen.filter((r) => r.bedrijfsnummer === bedrijfsnr);

  const rentrollPerContract = new Map<string, GestaagdeRentrollregel[]>();
  for (const regel of rentrollVanAdministratie) {
    const lijst = rentrollPerContract.get(regel.contractnummer) ?? [];
    lijst.push(regel);
    rentrollPerContract.set(regel.contractnummer, lijst);
  }

  const contracten = contractenVanAdministratie.map((c) => naarBgContractFeiten(c, rentrollPerContract.get(c.contract) ?? []));

  return {
    bronBeschikbaar: true,
    aantalRuweContractenRegels: ruweContractenRijen.length,
    aantalRuweRentrollRegels: ruweRentrollRijen.length,
    aantalContractenNaFilter: contractenVanAdministratie.length,
    aantalRentrollNaFilter: rentrollVanAdministratie.length,
    contracten,
    contractenIssues: contractenIssues.map((i) => ({ ernst: i.ernst, bericht: i.bericht })),
    rentrollIssues: rentrollIssues.map((i) => ({ ernst: i.ernst, bericht: i.bericht })),
  };
}
