/**
 * Pinned R1 design-system catalog.
 *
 * Default allowed IDs: `neutral-business`, `data-analytics`, `retail-promo` at `1.0.0`.
 * Domain validates token roles and versions; font file/licence bundling is not this module.
 */

export const DEFAULT_SYSTEM_VERSION = '1.0.0';

export const ALLOWED_SYSTEM_IDS = ['neutral-business', 'data-analytics', 'retail-promo'] as const;

export type AllowedSystemId = (typeof ALLOWED_SYSTEM_IDS)[number];

export type TokenValueType = 'color' | 'fontFamily' | 'fontSize';

export type BindableProperty = 'fill' | 'stroke' | 'fontFamily' | 'fontSize';

export interface DesignToken {
  role: string;
  type: TokenValueType;
  value: string | number;
  properties: readonly BindableProperty[];
}

export interface DesignSystemPackage {
  id: AllowedSystemId;
  version: string;
  name: string;
  tokens: Record<string, DesignToken>;
  fonts: readonly string[];
}

function colorToken(
  role: string,
  value: string,
  properties: readonly BindableProperty[],
): DesignToken {
  return { role, type: 'color', value, properties };
}

function fontFamilyToken(role: string, value: string): DesignToken {
  return { role, type: 'fontFamily', value, properties: ['fontFamily'] };
}

function fontSizeToken(role: string, value: number): DesignToken {
  return { role, type: 'fontSize', value, properties: ['fontSize'] };
}

function tokenMap(tokens: DesignToken[]): Record<string, DesignToken> {
  const map: Record<string, DesignToken> = Object.create(null) as Record<string, DesignToken>;
  for (const token of tokens) {
    map[token.role] = token;
  }
  return map;
}

const NEUTRAL_BUSINESS: DesignSystemPackage = {
  id: 'neutral-business',
  version: DEFAULT_SYSTEM_VERSION,
  name: 'Neutral Business',
  fonts: ['Inter'],
  tokens: tokenMap([
    colorToken('color.background', '#F7F7F5', ['fill']),
    colorToken('color.surface', '#FFFFFF', ['fill']),
    colorToken('color.text', '#1A1A1A', ['fill']),
    colorToken('color.muted', '#737373', ['fill']),
    colorToken('color.accent', '#1F4E79', ['fill']),
    colorToken('color.stroke', '#E5E5E5', ['stroke', 'fill']),
    fontFamilyToken('font.family.body', 'Inter'),
    fontFamilyToken('font.family.heading', 'Inter'),
    fontSizeToken('font.size.body', 14),
    fontSizeToken('font.size.heading', 28),
  ]),
};

const DATA_ANALYTICS: DesignSystemPackage = {
  id: 'data-analytics',
  version: DEFAULT_SYSTEM_VERSION,
  name: 'Data & Analytics',
  fonts: ['Inter', 'IBM Plex Mono'],
  tokens: tokenMap([
    colorToken('color.background', '#0F172A', ['fill']),
    colorToken('color.surface', '#1E293B', ['fill']),
    colorToken('color.text', '#F8FAFC', ['fill']),
    colorToken('color.muted', '#94A3B8', ['fill']),
    colorToken('color.accent', '#38BDF8', ['fill']),
    colorToken('color.stroke', '#334155', ['stroke', 'fill']),
    fontFamilyToken('font.family.body', 'Inter'),
    fontFamilyToken('font.family.heading', 'Inter'),
    fontSizeToken('font.size.body', 14),
    fontSizeToken('font.size.heading', 24),
  ]),
};

const RETAIL_PROMO: DesignSystemPackage = {
  id: 'retail-promo',
  version: DEFAULT_SYSTEM_VERSION,
  name: 'Retail Promo',
  fonts: ['Montserrat'],
  tokens: tokenMap([
    colorToken('color.background', '#FFF7ED', ['fill']),
    colorToken('color.surface', '#FFFFFF', ['fill']),
    colorToken('color.text', '#111827', ['fill']),
    colorToken('color.muted', '#6B7280', ['fill']),
    colorToken('color.accent', '#DC2626', ['fill']),
    colorToken('color.stroke', '#FDBA74', ['stroke', 'fill']),
    fontFamilyToken('font.family.body', 'Montserrat'),
    fontFamilyToken('font.family.heading', 'Montserrat'),
    fontSizeToken('font.size.body', 16),
    fontSizeToken('font.size.heading', 36),
  ]),
};

/** Pinned catalog used by applySystem / bindToken. */
export const systemsCatalog: readonly DesignSystemPackage[] = [
  NEUTRAL_BUSINESS,
  DATA_ANALYTICS,
  RETAIL_PROMO,
];

const SYSTEMS_BY_KEY: Record<string, DesignSystemPackage> = Object.create(null) as Record<
  string,
  DesignSystemPackage
>;

for (const system of systemsCatalog) {
  SYSTEMS_BY_KEY[`${system.id}@${system.version}`] = system;
}

export function systemKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export function getSystem(id: string, version: string): DesignSystemPackage | undefined {
  return SYSTEMS_BY_KEY[systemKey(id, version)];
}

export function isAllowedSystem(id: string, version: string): boolean {
  return getSystem(id, version) !== undefined;
}

export const ALLOWED_FONT_FAMILIES: readonly string[] = Array.from(
  new Set(systemsCatalog.flatMap((system) => [...system.fonts])),
);

export const DEFAULT_TOKEN_ROLES: Record<string, Partial<Record<BindableProperty, string>>> = {
  text: {
    fill: 'color.text',
    fontFamily: 'font.family.body',
    fontSize: 'font.size.body',
  },
  rect: {
    fill: 'color.surface',
    stroke: 'color.stroke',
  },
  ellipse: {
    fill: 'color.surface',
    stroke: 'color.stroke',
  },
};

export function tokenCompatible(token: DesignToken, property: string): boolean {
  return (token.properties as readonly string[]).includes(property);
}
