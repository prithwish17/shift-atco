/**
 * Board colours.
 *
 * A duty strip has to be identified at a glance across a twelve-hour timeline,
 * so every person and every position gets a fixed triple: a tinted fill, a
 * saturated accent for the left edge, and a text colour that stays legible on
 * the fill. Each has a dark-mode counterpart — a light pastel block on a dark
 * console is glare, so in dark mode the fill goes deep and the text goes light.
 *
 * Applied through CSS custom properties rather than inline colours, because an
 * inline style cannot carry a `dark:` variant: the component sets the variables
 * and the class list picks light or dark from them.
 */
export interface Swatch {
  /** Light-mode fill. */
  fill: string;
  /** Dark-mode fill. */
  fillDark: string;
  /** Accent bar, both modes. */
  edge: string;
  /** Text on the light fill. */
  text: string;
  /** Text on the dark fill. */
  textDark: string;
}

const PEOPLE_PALETTE: Swatch[] = [
  { fill: "#FEF3C7", fillDark: "#422006", edge: "#D97706", text: "#78350F", textDark: "#FDE68A" },
  { fill: "#DBEAFE", fillDark: "#172554", edge: "#2563EB", text: "#1E3A8A", textDark: "#BFDBFE" },
  { fill: "#FCE7F3", fillDark: "#500724", edge: "#DB2777", text: "#831843", textDark: "#FBCFE8" },
  { fill: "#DCFCE7", fillDark: "#052E16", edge: "#16A34A", text: "#14532D", textDark: "#BBF7D0" },
  { fill: "#EDE9FE", fillDark: "#2E1065", edge: "#7C3AED", text: "#4C1D95", textDark: "#DDD6FE" },
  { fill: "#FFEDD5", fillDark: "#431407", edge: "#EA580C", text: "#7C2D12", textDark: "#FED7AA" },
  { fill: "#CCFBF1", fillDark: "#042F2E", edge: "#0D9488", text: "#134E4A", textDark: "#99F6E4" },
  { fill: "#E2E8F0", fillDark: "#1E293B", edge: "#475569", text: "#1E293B", textDark: "#CBD5E1" },
  { fill: "#FFE4E6", fillDark: "#4C0519", edge: "#E11D48", text: "#881337", textDark: "#FECDD3" },
  { fill: "#E0E7FF", fillDark: "#1E1B4B", edge: "#4F46E5", text: "#312E81", textDark: "#C7D2FE" },
  { fill: "#ECFCCB", fillDark: "#1A2E05", edge: "#65A30D", text: "#365314", textDark: "#D9F99D" },
  { fill: "#F3E8FF", fillDark: "#3B0764", edge: "#9333EA", text: "#581C87", textDark: "#E9D5FF" },
];

/** Positions keep their own identity in the by-person view. */
const CHANNEL_PALETTE: Record<string, Swatch> = {
  TWR: PEOPLE_PALETTE[1],
  "SMC-S": PEOPLE_PALETTE[3],
  "SMC-N": PEOPLE_PALETTE[6],
  CLD: PEOPLE_PALETTE[0],
  TSO: PEOPLE_PALETTE[4],
};

const FALLBACK = PEOPLE_PALETTE[7];

export function personSwatch(colorIndex: number): Swatch {
  if (!Number.isFinite(colorIndex) || colorIndex < 0) return PEOPLE_PALETTE[0];
  return PEOPLE_PALETTE[colorIndex % PEOPLE_PALETTE.length];
}

export function channelSwatch(code: string): Swatch {
  return CHANNEL_PALETTE[code] ?? FALLBACK;
}

/** The custom properties a swatch feeds to `bg-[var(--strip-fill)]` and friends. */
export function swatchVars(swatch: Swatch): React.CSSProperties {
  return {
    "--strip-fill": swatch.fill,
    "--strip-fill-dark": swatch.fillDark,
    "--strip-edge": swatch.edge,
    "--strip-text": swatch.text,
    "--strip-text-dark": swatch.textDark,
  } as React.CSSProperties;
}

export interface HalfColors {
  text: string;
  textDark: string;
  band: string;
  bandDark: string;
}

/**
 * The halves. Blue for the first, indigo for the second — distinct from every
 * status colour, so a half band is never mistaken for a warning.
 */
export const HALF_COLORS: { first: HalfColors; second: HalfColors } = {
  first: {
    text: "#2563EB",
    textDark: "#93C5FD",
    band: "rgba(37, 99, 235, 0.07)",
    bandDark: "rgba(96, 165, 250, 0.10)",
  },
  second: {
    text: "#6D28D9",
    textDark: "#C4B5FD",
    band: "rgba(109, 40, 217, 0.08)",
    bandDark: "rgba(167, 139, 250, 0.12)",
  },
};
