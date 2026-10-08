import Decimal from "decimal.js";

/**
 * Rentroll-diagnose (2026-08-26) — TIJDELIJK, ALLEEN-LEZEN: toont rentroll-
 * regels + hun (indien deterministisch koppelbare) contractgegevens en
 * puur beschrijvende totalen per `Vorderingsoort`. Geen KPI, geen
 * berekening van jaarhuur/huurprijs-per-m²/bezettingsgraad, geen
 * classificatie van wat een `Vorderingsoort`-waarde "betekent" — dat is
 * precies waar dit instrument een antwoord op moet helpen vinden vóórdat
 * daar een huur-KPI-module op gebouwd wordt. Strikt gescheiden van, en
 * wijzigt niets aan, `vastgoedKerncijfers.ts`, `kerncijfersManagement.ts`
 * of `@bvc/domain/vastgoed.ts`.
 */

/** Tot nu toe uit documentatie/onderzoek bekende Vorderingsoort-waarden (rentroll.ts's moduledoc: "bv. 01 = Huur, 12 = Compensatie OB, 13 = Huurkorting") — een voorbeeldenlijst, GEEN bevestigde/volledige opsomming. */
const BEKENDE_VORDERINGSOORTEN = new Set(["01", "12", "13"]);

export interface RentrollDiagnoseRentrollRegel {
  contractnummer: string;
  complexnr: string | null;
  unitnr: string | null;
  vorderingsoort: string;
  prolongatieBedragJaar: Decimal | null;
  kortingBedragJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
  rapportageDatum: Date | null;
}

export interface RentrollDiagnoseContractRegel {
  contractnummer: string;
  ingangsdatum: Date | null;
  afloopdatum: Date | null;
  expiratieExpiratiedatum: Date | null;
  checkLopendContract: string | null;
}

/**
 * Koppeling van een rentroll-regel aan `contracten` via `contractnummer` —
 * uitsluitend als dat deterministisch kan (precies 1 match). Bij 0 of
 * meerdere matches wordt dat expliciet gemeld, nooit gegokt welke van
 * meerdere te gebruiken.
 */
export type RentrollDiagnoseContractKoppeling =
  | { status: "gekoppeld"; ingangsdatum: Date | null; afloopdatum: Date | null; expiratieExpiratiedatum: Date | null; checkLopendContract: string | null }
  | { status: "niet_gevonden" }
  | { status: "niet_eenduidig"; aantalGevonden: number };

export interface RentrollDiagnoseRegel {
  contractnummer: string;
  complexnr: string | null;
  unitnr: string | null;
  vorderingsoort: string;
  prolongatieBedragJaar: Decimal | null;
  kortingBedragJaar: Decimal | null;
  gehuurdOppervlak: Decimal | null;
  rapportageDatum: Date | null;
  contract: RentrollDiagnoseContractKoppeling;
}

export interface RentrollDiagnoseVorderingsoortTotaal {
  vorderingsoort: string;
  aantalRegels: number;
  /** Som over regels met een niet-`null` `prolongatie_bedrag_jaar` — een `null`-waarde telt NOOIT als 0 mee, zie `aantalRegelsZonderProlongatieBedragJaar`. */
  somProlongatieBedragJaar: Decimal;
  aantalRegelsZonderProlongatieBedragJaar: number;
  /** Som over regels met een niet-`null` `gehuurd_oppervlak` — zelfde reden als hierboven. */
  somGehuurdOppervlak: Decimal;
  aantalRegelsZonderGehuurdOppervlak: number;
  aantalUniekeContracten: number;
}

export interface RentrollDiagnoseResultaat {
  regels: RentrollDiagnoseRegel[];
  totalenPerVorderingsoort: RentrollDiagnoseVorderingsoortTotaal[];
  /** Vorderingsoort-waarden buiten de (voorbeeld-)set die tot nu toe bekend is uit documentatie — puur signalerend. */
  onverwachteVorderingsoorten: string[];
}

function som(waarden: readonly Decimal[]): Decimal {
  return waarden.reduce((totaal, waarde) => totaal.plus(waarde), new Decimal(0));
}

export function diagnoseerRentroll(
  rentroll: readonly RentrollDiagnoseRentrollRegel[],
  contracten: readonly RentrollDiagnoseContractRegel[],
): RentrollDiagnoseResultaat {
  const contractenPerNummer = new Map<string, RentrollDiagnoseContractRegel[]>();
  for (const contract of contracten) {
    const bestaand = contractenPerNummer.get(contract.contractnummer);
    if (bestaand) bestaand.push(contract);
    else contractenPerNummer.set(contract.contractnummer, [contract]);
  }

  function koppelContract(contractnummer: string): RentrollDiagnoseContractKoppeling {
    const gevonden = contractenPerNummer.get(contractnummer) ?? [];
    if (gevonden.length === 0) return { status: "niet_gevonden" };
    if (gevonden.length > 1) return { status: "niet_eenduidig", aantalGevonden: gevonden.length };
    const contract = gevonden[0]!;
    return {
      status: "gekoppeld",
      ingangsdatum: contract.ingangsdatum,
      afloopdatum: contract.afloopdatum,
      expiratieExpiratiedatum: contract.expiratieExpiratiedatum,
      checkLopendContract: contract.checkLopendContract,
    };
  }

  const regels: RentrollDiagnoseRegel[] = rentroll.map((regel) => ({ ...regel, contract: koppelContract(regel.contractnummer) }));

  const perVorderingsoort = new Map<string, RentrollDiagnoseRentrollRegel[]>();
  for (const regel of rentroll) {
    const bestaand = perVorderingsoort.get(regel.vorderingsoort);
    if (bestaand) bestaand.push(regel);
    else perVorderingsoort.set(regel.vorderingsoort, [regel]);
  }

  const totalenPerVorderingsoort: RentrollDiagnoseVorderingsoortTotaal[] = Array.from(perVorderingsoort.entries())
    .map(([vorderingsoort, groep]) => {
      const metBedrag = groep.filter((r) => r.prolongatieBedragJaar !== null);
      const metOppervlak = groep.filter((r) => r.gehuurdOppervlak !== null);
      return {
        vorderingsoort,
        aantalRegels: groep.length,
        somProlongatieBedragJaar: som(metBedrag.map((r) => r.prolongatieBedragJaar!)),
        aantalRegelsZonderProlongatieBedragJaar: groep.length - metBedrag.length,
        somGehuurdOppervlak: som(metOppervlak.map((r) => r.gehuurdOppervlak!)),
        aantalRegelsZonderGehuurdOppervlak: groep.length - metOppervlak.length,
        aantalUniekeContracten: new Set(groep.map((r) => r.contractnummer)).size,
      };
    })
    .sort((a, b) => a.vorderingsoort.localeCompare(b.vorderingsoort));

  const onverwachteVorderingsoorten = Array.from(perVorderingsoort.keys())
    .filter((v) => !BEKENDE_VORDERINGSOORTEN.has(v))
    .sort();

  return { regels, totalenPerVorderingsoort, onverwachteVorderingsoorten };
}
