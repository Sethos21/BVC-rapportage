import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BronType } from "./paths.js";
import type { BronLocatie } from "./administratie.js";

export interface AuditRecord {
  tijdstip: string;
  bronLocatie: BronLocatie;
  bronType: BronType;
  betrokkenAdministraties: string[];
  oorspronkelijkeBestandsnaam: string;
  hash: string;
  gebruiker: string;
  boekjaar?: number | undefined;
  boekperiode?: string | undefined;
  validatieversie: string;
  uitkomst: "GESLAAGD" | "GEBLOKKEERD";
  issues?: string[] | undefined;
}

/**
 * Schrijft uitsluitend metadata (nooit de oude bestandsinhoud) als één
 * JSON-regel per import — zie §7 van beide lokale overdrachtsdocumenten.
 */
export function schrijfAudit(auditPad: string, record: AuditRecord): void {
  mkdirSync(dirname(auditPad), { recursive: true });
  if (!existsSync(auditPad)) {
    appendFileSync(auditPad, "");
  }
  appendFileSync(auditPad, `${JSON.stringify(record)}\n`, "utf-8");
}
