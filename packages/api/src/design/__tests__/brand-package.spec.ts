import {
  BRAND_PACKAGE_MAX_JSON_BYTES,
  materializeBrandSystem,
  validateBrandPackage,
  type BrandPackage,
} from '../brand-package';
import { getSystem, systemsCatalog } from '../systems';
import { DesignError } from '../assets';

function basePkg(over: Partial<BrandPackage> = {}): BrandPackage {
  return {
    id: 'acme-brand',
    version: '1.0.0',
    name: 'Acme Brand',
    baseSystemId: 'neutral-business',
    baseSystemVersion: '1.0.0',
    tokens: {
      'color.accent': {
        type: 'color',
        value: '#FF5500',
        properties: ['fill'],
      },
    },
    fonts: [{ family: 'Inter', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' }],
    designNotes: 'Retail accent override only.',
    ...over,
  };
}

describe('validateBrandPackage', () => {
  it('normalizes overrides and inherits missing roles on materialize', () => {
    const input = basePkg({
      tokens: {
        'color.accent': { type: 'color', value: '#112233', properties: ['fill'] },
        'font.size.heading': { type: 'fontSize', value: 40, properties: ['fontSize'] },
      },
    });
    const frozen = JSON.stringify(input);
    const catalogBefore = JSON.stringify(systemsCatalog);

    const normalized = validateBrandPackage(input);
    expect(normalized.id).toBe('acme-brand');
    expect(normalized.tokens['color.accent'].value).toBe('#112233');
    expect(Object.keys(normalized.tokens).sort()).toEqual(['color.accent', 'font.size.heading']);

    const materialized = materializeBrandSystem(input);
    const base = getSystem('neutral-business', '1.0.0')!;
    expect(materialized.tokens['color.background'].value).toBe(
      base.tokens['color.background'].value,
    );
    expect(materialized.tokens['color.accent'].value).toBe('#112233');
    expect(materialized.tokens['font.size.heading'].value).toBe(40);
    expect(materialized.tokens['font.size.body'].value).toBe(base.tokens['font.size.body'].value);
    expect(materialized.fonts).toEqual(['Inter']);
    expect(materialized.id).toBe('acme-brand');

    // Deterministic role order in materialized map.
    expect(Object.keys(materialized.tokens)).toEqual(Object.keys(base.tokens).sort());

    // No mutation of input or global catalog.
    expect(JSON.stringify(input)).toBe(frozen);
    expect(JSON.stringify(systemsCatalog)).toBe(catalogBefore);
    expect(getSystem('acme-brand', '1.0.0')).toBeUndefined();
  });

  it('pins base system to fixed ids at 1.0.0 and rejects builtin id collision', () => {
    expect(() =>
      validateBrandPackage(
        basePkg({ baseSystemId: 'not-a-system' as BrandPackage['baseSystemId'] }),
      ),
    ).toThrow(DesignError);
    expect(() => validateBrandPackage(basePkg({ baseSystemVersion: '2.0.0' }))).toThrow(
      /pinned to 1\.0\.0/,
    );
    expect(() => validateBrandPackage(basePkg({ id: 'neutral-business' }))).toThrow(/builtin/);
    expect(() => validateBrandPackage(basePkg({ id: 'AB' }))).toThrow(/id must be lowercase/);
    expect(() => validateBrandPackage(basePkg({ version: '01.0.0' }))).toThrow(/semver/);
    expect(() => validateBrandPackage(basePkg({ version: 'v1.0.0' }))).toThrow(/semver/);
  });

  it('rejects unknown roles, wrong type/properties, and invalid values', () => {
    expect(() =>
      validateBrandPackage(
        basePkg({
          tokens: {
            'color.brandNew': { type: 'color', value: '#FFFFFF', properties: ['fill'] },
          },
        }),
      ),
    ).toThrow(/unknown token role/);

    expect(() =>
      validateBrandPackage(
        basePkg({
          tokens: {
            'color.accent': { type: 'fontSize', value: 12, properties: ['fontSize'] },
          },
        }),
      ),
    ).toThrow(/type must be "color"/);

    expect(() =>
      validateBrandPackage(
        basePkg({
          tokens: {
            'color.stroke': { type: 'color', value: '#AABBCC', properties: ['fill'] },
          },
        }),
      ),
    ).toThrow(/properties must match/);

    expect(() =>
      validateBrandPackage(
        basePkg({
          tokens: {
            'color.accent': { type: 'color', value: 'red', properties: ['fill'] },
          },
        }),
      ),
    ).toThrow(/hex/);

    expect(() =>
      validateBrandPackage(
        basePkg({
          tokens: {
            'font.size.body': { type: 'fontSize', value: 0, properties: ['fontSize'] },
          },
        }),
      ),
    ).toThrow(/1 and 512/);

    expect(() =>
      validateBrandPackage(
        basePkg({
          tokens: {
            'font.family.body': {
              type: 'fontFamily',
              value: 'Comic Sans',
              properties: ['fontFamily'],
            },
          },
        }),
      ),
    ).toThrow(/bundled font/);
  });

  it('rejects executable/prototype/path content and oversize JSON', () => {
    expect(() =>
      validateBrandPackage(basePkg({ designNotes: 'Hello <script>alert(1)</script>' })),
    ).toThrow(/executable/);

    expect(() => validateBrandPackage(basePkg({ designNotes: 'See javascript:alert(1)' }))).toThrow(
      /executable/,
    );

    expect(() => validateBrandPackage(basePkg({ name: 'bad ../etc/passwd name' }))).toThrow(/path/);

    const polluted = JSON.parse(
      JSON.stringify({
        ...basePkg(),
        tokens: { 'color.accent': { type: 'color', value: '#123456', properties: ['fill'] } },
      }),
    );
    Object.defineProperty(polluted, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
    });
    // When JSON-parsed __proto__ may become own key via JSON.parse:
    const viaJson = JSON.parse(
      '{"id":"acme-brand","version":"1.0.0","name":"Acme","baseSystemId":"neutral-business","baseSystemVersion":"1.0.0","tokens":{"__proto__":{"type":"color","value":"#FFFFFF","properties":["fill"]}},"fonts":[{"family":"Inter","licenseText":"SIL OPEN FONT LICENSE"}],"designNotes":"x"}',
    );
    expect(() => validateBrandPackage(viaJson)).toThrow(/forbidden key/);

    const hugeNotes = 'x'.repeat(BRAND_PACKAGE_MAX_JSON_BYTES);
    expect(() => validateBrandPackage(basePkg({ designNotes: hugeNotes }))).toThrow(
      /byte JSON limit|designNotes exceeds/,
    );
  });

  it('requires nonempty licence markers on declared fonts and rejects uploads of unknown families', () => {
    expect(() =>
      validateBrandPackage(basePkg({ fonts: [{ family: 'Inter', licenseText: '   ' }] })),
    ).toThrow(/licence/);

    expect(() =>
      validateBrandPackage(
        basePkg({ fonts: [{ family: 'CustomUpload', licenseText: 'SIL OPEN FONT LICENSE' }] }),
      ),
    ).toThrow(/bundled font/);

    const ok = validateBrandPackage(
      basePkg({
        fonts: [
          {
            family: 'Inter',
            licenseText: 'SIL OPEN FONT LICENSE Version 1.1',
            assetId: 'font-inter-1',
          },
        ],
      }),
    );
    expect(ok.fonts[0].assetId).toBe('font-inter-1');

    expect(() =>
      validateBrandPackage(
        basePkg({
          fonts: [{ family: 'Inter', licenseText: 'SIL', assetId: '../secret' }],
        }),
      ),
    ).toThrow(/path/);
  });

  it('materializeBrandSystem returns copies and does not register into catalog', () => {
    const input = basePkg({
      id: 'retail-tint',
      baseSystemId: 'retail-promo',
      tokens: {
        'color.accent': { type: 'color', value: '#00AA88', properties: ['fill'] },
      },
      fonts: [{ family: 'Montserrat', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' }],
    });
    const a = materializeBrandSystem(input);
    const b = materializeBrandSystem(input);
    expect(a).toEqual(b);
    a.tokens['color.accent'].value = '#000000';
    expect(b.tokens['color.accent'].value).toBe('#00AA88');
    expect(getSystem('retail-tint', '1.0.0')).toBeUndefined();
    expect(systemsCatalog.map((s) => s.id)).toEqual([
      'neutral-business',
      'data-analytics',
      'retail-promo',
    ]);
  });
});
