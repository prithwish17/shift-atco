const TEAM_ALIASES: Record<string, string> = {
  A: "A",
  ALPHA: "A",
  B: "B",
  BRAVO: "B",
  C: "C",
  CHARLIE: "C",
  D: "D",
  DELTA: "D",
  E: "E",
  ECHO: "E",
  G: "G",
  GENERAL: "G",
};

export function normalizeRosterTeamKey(value?: string | null) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^TEAM\s+/, "");

  return TEAM_ALIASES[normalized] || normalized;
}

export function getRosterTeamQueryValues(team?: string | null) {
  const canonical = normalizeRosterTeamKey(team);

  switch (canonical) {
    case "A":
      return ["A", "a", "Alpha", "ALPHA", "Team Alpha", "TEAM ALPHA"];
    case "B":
      return ["B", "b", "Bravo", "BRAVO", "Team Bravo", "TEAM BRAVO"];
    case "C":
      return ["C", "c", "Charlie", "CHARLIE", "Team Charlie", "TEAM CHARLIE"];
    case "D":
      return ["D", "d", "Delta", "DELTA", "Team Delta", "TEAM DELTA"];
    case "E":
      return ["E", "e", "Echo", "ECHO", "Team Echo", "TEAM ECHO"];
    case "G":
      return ["G", "g", "General", "GENERAL", "Team General", "TEAM GENERAL"];
    default:
      return canonical ? [canonical] : [];
  }
}
