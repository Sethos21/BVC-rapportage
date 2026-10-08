export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1>BVC Rapportage — in opbouw</h1>
      <p>
        Deze applicatie wordt herbouwd volgens het overdrachtsdossier
        Vastgoed-AI_Architectuur_v2.0 op een relationele (PostgreSQL) datalaag.
        Fase 1 (import, staging en datakwaliteit) is in ontwikkeling — zie de
        root-README voor de huidige status en openstaande besluiten.
      </p>
      <p>
        De vorige single-file prototype-versie staat ter referentie in{" "}
        <code>/legacy</code>.
      </p>
    </main>
  );
}
