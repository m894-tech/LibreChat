/**
 * Pure branded design-system package validator.
 *
 * Validates brand packages that override tokens on a pinned base system.
 * Does not mutate the global catalog, persist, network, or execute content.
 */

import {
  ALLOWED_FONT_FAMILIES,
  ALLOWED_SYSTEM_IDS,
  getSystem,
  type AllowedSystemId,
  type BindableProperty,
  type DesignSystemPackage,
  type DesignToken,
  type TokenValueType,
} from './systems';
import { DesignError } from './assets';

export const BRAND_PACKAGE_MAX_JSON_BYTES: number = 128 * 1024;

export const BRAND_PACKAGE_ID_RE = /^[a-z0-9-]{3,64}$/;

/** SemVer core + optional pre-release / build metadata. */
export const BRAND_PACKAGE_SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const EXECUTABLE_RE =
  /<\s*script|javascript:|expression\s*\(|@import\b|url\s*\(|eval\s*\(|Function\s*\(|<\/?[a-z]|on[a-z]+\s*=/i;

const PATH_RE = /\.\.\/|\.\.\\|(?:^|[\\/])\.\.(?:[\\/]|$)|^[\\/]|^[A-Za-z]:[\\/]/;

const BUNDLED_FONTS: ReadonlySet<string> = new Set(ALLOWED_FONT_FAMILIES);

const BASE_SYSTEM_ID_SET: ReadonlySet<string> = new Set(ALLOWED_SYSTEM_IDS);

export interface BrandPackageToken {
  type: TokenValueType;
  value: string | number;
  properties: readonly BindableProperty[];
}

export interface BrandPackageFont {
  family: string;
  assetId?: string;
  licenseText: string;
}

export interface BrandPackage {
  id: string;
  version: string;
  name: string;
  baseSystemId: AllowedSystemId | string;
  baseSystemVersion: string;
  tokens: Record<string, BrandPackageToken>;
  fonts: BrandPackageFont[];
  designNotes: string;
}

/** Materialized view shaped like DesignSystemPackage with free-form id. */
export interface MaterializedBrandSystem {
  id: string;
  version: string;
  name: string;
  tokens: Record<string, DesignToken>;
  fonts: string[];
}

function fail(message: string): never {
  throw new DesignError(422, 'VALIDATION', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertSafeKey(key: string, label: string): void {
  if (FORBIDDEN_KEYS.has(key)) {
    fail(`${label} contains forbidden key "${key}"`);
  }
}

function assertSafeString(value: string, label: string): void {
  if (EXECUTABLE_RE.test(value)) {
    fail(`${label} contains disallowed executable or markup content`);
  }
  if (PATH_RE.test(value)) {
    fail(`${label} contains disallowed path content`);
  }
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function cloneProperties(properties: readonly BindableProperty[]): BindableProperty[] {
  return properties.slice();
}

function propertiesEqual(
  actual: readonly unknown[],
  expected: readonly BindableProperty[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      return false;
    }
  }
  return true;
}

function parseTokenOverride(role: string, raw: unknown, baseToken: DesignToken): BrandPackageToken {
  if (!isPlainObject(raw)) {
    fail(`token "${role}" must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!['type', 'value', 'properties'].includes(key)) fail('Unknown token field');
    assertSafeKey(key, `token "${role}"`);
  }

  const type = raw.type;
  if (type !== 'color' && type !== 'fontFamily' && type !== 'fontSize') {
    fail(`token "${role}" has invalid type`);
  }
  if (type !== baseToken.type) {
    fail(`token "${role}" type must be "${baseToken.type}"`);
  }

  if (!Array.isArray(raw.properties)) {
    fail(`token "${role}" properties must be an array`);
  }
  if (!propertiesEqual(raw.properties, baseToken.properties)) {
    fail(`token "${role}" properties must match the base system exactly`);
  }

  if (type === 'color') {
    if (typeof raw.value !== 'string' || !HEX_COLOR_RE.test(raw.value)) {
      fail(`token "${role}" color value must be #RRGGBB or #RRGGBBAA hex`);
    }
    assertSafeString(raw.value, `token "${role}" value`);
    return {
      type,
      value: raw.value,
      properties: cloneProperties(baseToken.properties),
    };
  }

  if (type === 'fontSize') {
    if (
      typeof raw.value !== 'number' ||
      !Number.isFinite(raw.value) ||
      !Number.isInteger(raw.value)
    ) {
      fail(`token "${role}" fontSize must be an integer`);
    }
    if (raw.value < 1 || raw.value > 512) {
      fail(`token "${role}" fontSize must be between 1 and 512`);
    }
    return {
      type,
      value: raw.value,
      properties: cloneProperties(baseToken.properties),
    };
  }

  if (typeof raw.value !== 'string' || raw.value.trim().length === 0) {
    fail(`token "${role}" fontFamily value is required`);
  }
  assertSafeString(raw.value, `token "${role}" value`);
  if (!BUNDLED_FONTS.has(raw.value)) {
    fail(`token "${role}" fontFamily must be a known bundled font`);
  }
  return {
    type,
    value: raw.value,
    properties: cloneProperties(baseToken.properties),
  };
}

function parseFont(raw: unknown, index: number): BrandPackageFont {
  if (!isPlainObject(raw)) {
    fail(`fonts[${index}] must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!['family', 'assetId', 'licenseText'].includes(key)) fail('Unknown font field');
    assertSafeKey(key, `fonts[${index}]`);
  }

  if (typeof raw.family !== 'string' || raw.family.trim().length === 0) {
    fail(`fonts[${index}].family is required`);
  }
  assertSafeString(raw.family, `fonts[${index}].family`);
  if (!BUNDLED_FONTS.has(raw.family)) {
    fail(`fonts[${index}].family must be a known bundled font`);
  }

  if (typeof raw.licenseText !== 'string' || raw.licenseText.trim().length === 0) {
    fail(`fonts[${index}].licenseText must be a nonempty licence marker`);
  }
  assertSafeString(raw.licenseText, `fonts[${index}].licenseText`);

  const font: BrandPackageFont = {
    family: raw.family,
    licenseText: raw.licenseText,
  };

  if (raw.assetId !== undefined) {
    if (typeof raw.assetId !== 'string' || raw.assetId.trim().length === 0) {
      fail(`fonts[${index}].assetId is invalid`);
    }
    assertSafeString(raw.assetId, `fonts[${index}].assetId`);
    if (raw.assetId.includes('/') || raw.assetId.includes('\\') || raw.assetId.includes('\0')) {
      fail(`fonts[${index}].assetId must not contain path separators`);
    }
    // Opaque id only — server may later pin an exact content hash. No uploads here.
    font.assetId = raw.assetId;
  }

  return font;
}

/**
 * Validate and normalize a brand package. Returns a deep copy.
 * Does not mutate `input` or the global systems catalog.
 */
export function validateBrandPackage(input: unknown): BrandPackage {
  let jsonBytes: number;
  try {
    jsonBytes = utf8Bytes(JSON.stringify(input));
  } catch {
    fail('brand package is not JSON-serializable');
  }
  if (jsonBytes > BRAND_PACKAGE_MAX_JSON_BYTES) {
    fail(`brand package exceeds ${BRAND_PACKAGE_MAX_JSON_BYTES} byte JSON limit`);
  }

  if (!isPlainObject(input)) {
    fail('brand package must be a plain object');
  }
  for (const key of Object.keys(input)) {
    if (
      ![
        'id',
        'version',
        'name',
        'baseSystemId',
        'baseSystemVersion',
        'tokens',
        'fonts',
        'designNotes',
      ].includes(key)
    )
      fail('Unknown brand field');
    assertSafeKey(key, 'brand package');
  }

  if (typeof input.id !== 'string' || !BRAND_PACKAGE_ID_RE.test(input.id)) {
    fail('id must be lowercase a-z0-9- with length 3..64');
  }
  if (BASE_SYSTEM_ID_SET.has(input.id)) {
    fail('id must not collide with a builtin base system id');
  }
  assertSafeString(input.id, 'id');

  if (typeof input.version !== 'string' || !BRAND_PACKAGE_SEMVER_RE.test(input.version)) {
    fail('version must be a valid semver string');
  }
  assertSafeString(input.version, 'version');

  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    fail('name is required');
  }
  if (input.name.length > 128) {
    fail('name exceeds maximum length');
  }
  assertSafeString(input.name, 'name');

  if (typeof input.baseSystemId !== 'string' || !BASE_SYSTEM_ID_SET.has(input.baseSystemId)) {
    fail('baseSystemId must be one of the fixed base system ids');
  }
  if (typeof input.baseSystemVersion !== 'string') {
    fail('baseSystemVersion is required');
  }
  if (input.baseSystemVersion !== '1.0.0') {
    fail('baseSystemVersion must be pinned to 1.0.0');
  }
  assertSafeString(input.baseSystemVersion, 'baseSystemVersion');

  const base = getSystem(input.baseSystemId, input.baseSystemVersion);
  if (!base) {
    fail('base system is not available');
  }

  if (typeof input.designNotes !== 'string') {
    fail('designNotes must be a string');
  }
  if (utf8Bytes(input.designNotes) > 8 * 1024) {
    fail('designNotes exceeds maximum length');
  }
  assertSafeString(input.designNotes, 'designNotes');

  if (!isPlainObject(input.tokens)) {
    fail('tokens must be a plain object');
  }

  const tokens: Record<string, BrandPackageToken> = Object.create(null) as Record<
    string,
    BrandPackageToken
  >;
  const tokenRoles = Object.keys(input.tokens).sort();
  for (const role of tokenRoles) {
    assertSafeKey(role, 'tokens');
    if (!Object.prototype.hasOwnProperty.call(base.tokens, role)) {
      fail(`unknown token role "${role}"`);
    }
    const baseToken = base.tokens[role];
    tokens[role] = parseTokenOverride(role, input.tokens[role], baseToken);
  }

  if (!Array.isArray(input.fonts)) {
    fail('fonts must be an array');
  }
  if (input.fonts.length > 16) {
    fail('fonts exceeds maximum entries');
  }

  const fonts: BrandPackageFont[] = [];
  const seenFamilies = new Set<string>();
  for (let i = 0; i < input.fonts.length; i++) {
    const font = parseFont(input.fonts[i], i);
    if (seenFamilies.has(font.family)) {
      fail(`duplicate font family "${font.family}"`);
    }
    seenFamilies.add(font.family);
    fonts.push(font);
  }

  for (const role of Object.keys(tokens)) {
    const token = tokens[role];
    if (token.type === 'fontFamily') {
      const family = token.value as string;
      if (!seenFamilies.has(family) && !base.fonts.includes(family)) {
        fail(`fontFamily token "${role}" references undeclared font "${family}"`);
      }
    }
  }

  return {
    id: input.id,
    version: input.version,
    name: input.name,
    baseSystemId: input.baseSystemId,
    baseSystemVersion: input.baseSystemVersion,
    tokens,
    fonts,
    designNotes: input.designNotes,
  };
}

/**
 * Materialize a validated brand package into a DesignSystemPackage-like object.
 * Merges base tokens with overrides as deterministic copies. Does not modify the catalog.
 */
export function materializeBrandSystem(input: unknown): MaterializedBrandSystem {
  const pkg = validateBrandPackage(input);
  const base = getSystem(pkg.baseSystemId, pkg.baseSystemVersion);
  if (!base) {
    fail('base system is not available');
  }

  const tokens: Record<string, DesignToken> = Object.create(null) as Record<string, DesignToken>;
  const roles = Object.keys(base.tokens).sort();
  for (const role of roles) {
    const baseToken = base.tokens[role];
    const override = Object.prototype.hasOwnProperty.call(pkg.tokens, role)
      ? pkg.tokens[role]
      : undefined;
    if (override) {
      tokens[role] = {
        role,
        type: override.type,
        value: override.value,
        properties: cloneProperties(override.properties),
      };
    } else {
      tokens[role] = {
        role: baseToken.role,
        type: baseToken.type,
        value: baseToken.value,
        properties: cloneProperties(baseToken.properties),
      };
    }
  }

  const fontSet = new Set<string>();
  for (const family of base.fonts) {
    fontSet.add(family);
  }
  for (const font of pkg.fonts) {
    fontSet.add(font.family);
  }
  for (const role of Object.keys(tokens)) {
    const token = tokens[role];
    if (token.type === 'fontFamily' && typeof token.value === 'string') {
      fontSet.add(token.value);
    }
  }

  const fonts = Array.from(fontSet).sort();

  return {
    id: pkg.id,
    version: pkg.version,
    name: pkg.name,
    tokens,
    fonts,
  };
}

/** @internal test helper — exposed type alias compatibility with catalog. */
export type { DesignSystemPackage, DesignToken, TokenValueType, BindableProperty };
