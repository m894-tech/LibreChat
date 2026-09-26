import type { BrandPackage } from './brand-package';
import { getSystem, type DesignSystemPackage, type DesignToken } from './systems';
/** Authored package candidates using existing licensed fonts. Not automatically published. */
export interface ExtendedSystemPackage {
  brand: BrandPackage;
  designNotes: string;
  referenceURLs: string[];
  reviewStatus: 'candidate';
}
type Direction = {
  id: string;
  name: string;
  bg: string;
  surface: string;
  text: string;
  accent: string;
  heading: number;
  font: 'Inter' | 'Montserrat';
  notes: string;
  refs: string[];
};
const DIRECTIONS: readonly Direction[] = [
  {
    id: 'swiss-editorial',
    name: 'Swiss Editorial',
    bg: '#FFFFFF',
    surface: '#EEEEEE',
    text: '#111111',
    accent: '#222222',
    heading: 64,
    font: 'Inter',
    notes:
      'Monochrome editorial grid. Hierarchy by scale, not accent. No gradients, decorative shadows or brightCTA. Original adaptation; not Vucko clone.',
    refs: ['https://vucko.co'],
  },
  {
    id: 'warm-editorial',
    name: 'Warm Editorial',
    bg: '#F6F2E9',
    surface: '#FFFFFF',
    text: '#29251E',
    accent: '#594C3D',
    heading: 52,
    font: 'Inter',
    notes:
      'Content-first warm paper, restrained brown text emphasis. Sans-serif substitution intentionally explicit; no unlicensed serif.',
    refs: ['https://posthog.com'],
  },
  {
    id: 'modern-saas',
    name: 'Modern SaaS',
    bg: '#FFFFFF',
    surface: '#EFF4FB',
    text: '#14233B',
    accent: '#2451C4',
    heading: 44,
    font: 'Inter',
    notes:
      'Product-led blue functional accent, calm surfaces, minimal ornament. Data labels never decorative.',
    refs: ['https://ui.shadcn.com'],
  },
  {
    id: 'technical-dark',
    name: 'Technical Dark',
    bg: '#08090A',
    surface: '#141516',
    text: '#F7F8F8',
    accent: '#D0D6E0',
    heading: 48,
    font: 'Inter',
    notes:
      'Preserve nearblack technical surface and achromatic accent; no neon. Text controls crisp, no heavybold decorative heading.',
    refs: ['https://linear.app/changelog'],
  },
  {
    id: 'premium-minimal',
    name: 'Premium Minimal',
    bg: '#FAFAFA',
    surface: '#F0F0F0',
    text: '#161616',
    accent: '#333333',
    heading: 48,
    font: 'Inter',
    notes:
      'Strict minimal high contrast, generous whitespace. Product imagery is content, not decorative substitute.',
    refs: ['https://vucko.co', 'https://ui.shadcn.com'],
  },
  {
    id: 'bold-campaign',
    name: 'Bold Campaign',
    bg: '#FFF200',
    surface: '#FFFFFF',
    text: '#111111',
    accent: '#B51A18',
    heading: 80,
    font: 'Montserrat',
    notes:
      'Original campaign direction: assertive yellow field, large type and limited red emphasis. Never soften into generic muted orange.',
    refs: ['https://vucko.co'],
  },
  {
    id: 'friendly-product',
    name: 'Friendly Product',
    bg: '#EEEFE9',
    surface: '#FFFFFF',
    text: '#111827',
    accent: '#A86000',
    heading: 40,
    font: 'Inter',
    notes:
      'Approachable content cards, simple outlines, warm active color. Adapted from workshop layout, no copied mascot. Inter replaces unavailable PlexSans.',
    refs: ['https://posthog.com'],
  },
  {
    id: 'public-accessible',
    name: 'Public & Accessible',
    bg: '#FFFFFF',
    surface: '#EEF3F8',
    text: '#111111',
    accent: '#003A70',
    heading: 44,
    font: 'Inter',
    notes:
      'Original public-information direction. High textcontrast, plain language, visible labels. Color alone never communicates status; candidate not WCAG certification.',
    refs: ['https://ui.shadcn.com'],
  },
  {
    id: 'playful-creative',
    name: 'Playful Creative',
    bg: '#F1ECFF',
    surface: '#FFFFFF',
    text: '#241B3D',
    accent: '#5730A4',
    heading: 60,
    font: 'Montserrat',
    notes:
      'Original expressive purple direction, large playful headings, restrained geometry; illustrations must be real assets, no fake placeholder decoration.',
    refs: ['https://posthog.com'],
  },
];
export function extendedSystemPackages(): ExtendedSystemPackage[] {
  const base = getSystem('neutral-business', '1.0.0')!;
  return DIRECTIONS.map((d) => {
    const override = (
      role: string,
      value: string | number,
    ): {
      type: DesignToken['type'];
      value: string | number;
      properties: readonly import('./systems').BindableProperty[];
    } => ({ type: base.tokens[role].type, properties: [...base.tokens[role].properties], value });
    const brand: BrandPackage = {
      id: d.id,
      version: '1.0.0',
      name: d.name,
      baseSystemId: 'neutral-business',
      baseSystemVersion: '1.0.0',
      tokens: {
        'color.background': override('color.background', d.bg),
        'color.surface': override('color.surface', d.surface),
        'color.text': override('color.text', d.text),
        'color.accent': override('color.accent', d.accent),
        'font.family.body': override('font.family.body', 'Inter'),
        'font.family.heading': override('font.family.heading', d.font),
        'font.size.heading': override('font.size.heading', d.heading),
      },
      fonts: [
        { family: 'Inter', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' },
        ...(d.font === 'Montserrat'
          ? [{ family: 'Montserrat', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' }]
          : []),
      ],
      designNotes: d.notes,
    };
    return { brand, designNotes: d.notes, referenceURLs: [...d.refs], reviewStatus: 'candidate' };
  });
}
