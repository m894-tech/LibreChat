import type { DesignPayload, DesignSystemPackage, DesignNode } from './types';
import { blankPayload, createId } from './document';
import { createNode } from './operations';
import { lookupToken } from './systems';
export type TemplateId = 'blank' | 'promo' | 'business' | 'analytics';
export const TEMPLATES: ReadonlyArray<{ id: TemplateId; name: string }> = [
  { id: 'blank', name: 'Пустой холст' },
  { id: 'promo', name: 'Промо-карточка' },
  { id: 'business', name: 'Деловое объявление' },
  { id: 'analytics', name: 'Показатели — пример данных' },
];
export function templatePayload(system: DesignSystemPackage, id: TemplateId): DesignPayload {
  const result = blankPayload(system);
  if (id === 'blank') return result;
  const text = (value: string, x: number, y: number, w: number, size: number): DesignNode => {
    const n = createNode('text', system);
    n.id = createId();
    Object.assign(n.props, { x, y, width: w, height: size * 2.5, text: value, fontSize: size });
    delete n.bindings.fontSize;
    return n;
  };
  result.nodes.push(
    text(
      id === 'promo'
        ? 'Ваше предложение'
        : id === 'business'
          ? 'Новости компании'
          : 'Показатели недели',
      72,
      80,
      936,
      68,
    ),
  );
  result.nodes.push(
    text(
      id === 'analytics'
        ? 'Демонстрационные данные · замените перед публикацией'
        : 'Добавьте описание, сроки и условия',
      72,
      270,
      920,
      30,
    ),
  );
  const panel = createNode('rect', system);
  Object.assign(panel.props, {
    x: 72,
    y: 420,
    width: 936,
    height: 530,
    fill: lookupToken(system, 'color.surface'),
  });
  result.nodes.push(panel);
  if (id === 'analytics') {
    [65, 95, 80].forEach((value, i) => {
      const bar = createNode('rect', system);
      Object.assign(bar.props, {
        x: 150 + i * 260,
        y: 870 - value * 3,
        width: 140,
        height: value * 3,
        fill: lookupToken(system, 'color.accent'),
      });
      bar.bindings.fill = 'color.accent';
      result.nodes.push(bar, text(String(value), 155 + i * 260, 900, 180, 36));
    });
  } else {
    result.nodes.push(
      text(id === 'promo' ? '−20%' : 'Главное событие', 125, 560, 830, id === 'promo' ? 160 : 62),
    );
  }
  result.nodes.push(
    text(
      id === 'promo' ? 'Укажите период акции и обязательные условия' : 'Контакты · источник · дата',
      72,
      1110,
      930,
      28,
    ),
  );
  return result;
}
