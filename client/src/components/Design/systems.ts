import type { BindableProperty, DesignSystemPackage, DesignToken, TokenValueType } from './types';

export const DEFAULT_SYSTEM_VERSION = '1.0.0';

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
  const map: Record<string, DesignToken> = {};
  for (const token of tokens) {
    map[token.role] = token;
  }
  return map;
}

const NEUTRAL: DesignSystemPackage = {
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

const ANALYTICS: DesignSystemPackage = {
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

const RETAIL: DesignSystemPackage = {
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

export const R1_SYSTEMS: DesignSystemPackage[] = [NEUTRAL, ANALYTICS, RETAIL];

export function tokenValueOf(token: unknown): string | number | undefined {
  if (typeof token === 'string' || typeof token === 'number') {
    return token;
  }
  if (token && typeof token === 'object' && 'value' in token) {
    const value = (token as { value: unknown }).value;
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

export function adaptSystem(raw: unknown): DesignSystemPackage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.version !== 'string') {
    return null;
  }
  const tokensIn = item.tokens;
  const tokens: Record<string, DesignToken | { value: string | number }> = {};
  if (tokensIn && typeof tokensIn === 'object') {
    for (const [role, token] of Object.entries(tokensIn as Record<string, unknown>)) {
      const value = tokenValueOf(token);
      if (value === undefined) {
        continue;
      }
      if (token && typeof token === 'object' && 'type' in token) {
        const typed = token as DesignToken;
        tokens[role] = {
          role: typed.role ?? role,
          type: (typed.type as TokenValueType) ?? 'color',
          value,
          properties: typed.properties ?? [],
        };
      } else {
        tokens[role] = { value };
      }
    }
  }
  const fonts = Array.isArray(item.fonts)
    ? item.fonts.filter((font) => typeof font === 'string')
    : [];
  return {
    id: item.id,
    version: item.version,
    name: typeof item.name === 'string' ? item.name : item.id,
    tokens,
    fonts,
  };
}

export function adaptSystems(raw: unknown): DesignSystemPackage[] {
  const list = Array.isArray(raw) ? raw : [];
  const adapted = list.map(adaptSystem).filter((item): item is DesignSystemPackage => item != null);
  return adapted.length > 0 ? adapted : R1_SYSTEMS;
}

export function getSystemPackage(
  id: string,
  version = DEFAULT_SYSTEM_VERSION,
): DesignSystemPackage | undefined {
  return R1_SYSTEMS.find((item) => item.id === id && item.version === version);
}

export function defaultSystem(): DesignSystemPackage {
  return R1_SYSTEMS[0];
}

export function lookupToken(
  system: DesignSystemPackage,
  role: string,
): string | number | undefined {
  return tokenValueOf(system.tokens[role]);
}
