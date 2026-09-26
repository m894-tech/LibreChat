import type { NodePropKey, NodeType } from './types';

export const DESIGN_API_BASE = '/api/design';

export const KONVA_SCRIPT_SRC = '/design/vendor/konva.min.js';
export const KONVA_VERSION = '10.3.0';

export const SCHEMA_VERSION = 1 as const;

export const MAX_NODES = 1000;
export const MIN_ARTBOARD = 64;
export const MAX_ARTBOARD = 4096;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_OP_BATCH = 200;

export const NODE_TYPES: NodeType[] = ['text', 'rect', 'ellipse', 'image', 'group'];

export const GEOMETRY_PROPS: NodePropKey[] = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];

export const TYPE_PROPS: Record<NodeType, readonly NodePropKey[]> = {
  text: [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'text',
    'fontSize',
    'fontFamily',
    'fontStyle',
    'fill',
    'align',
  ],
  rect: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth'],
  ellipse: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth'],
  image: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'assetId', 'assetVersion', 'crop'],
  group: ['x', 'y', 'width', 'height', 'rotation', 'opacity'],
};

export const NUMERIC_PROPS: NodePropKey[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'strokeWidth',
  'fontSize',
  'assetVersion',
];

export const FONT_FAMILIES = ['Inter', 'Montserrat', 'IBM Plex Mono'] as const;

export const FONT_STYLES = ['normal', 'italic', 'bold', 'bold-italic'] as const;

export const SYSTEM_IDS = ['neutral-business', 'data-analytics', 'retail-promo'] as const;

export const DEFAULT_TOKEN_ROLES: Record<
  string,
  Partial<Record<'fill' | 'stroke' | 'fontFamily' | 'fontSize', string>>
> = {
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

export const LABELS = {
  app: 'Дизайн',
  chat: 'Чат',
  layers: 'Слои',
  inspector: 'Свойства',
  projects: 'Проекты',
  documents: 'Документы',
  createProject: 'Создать проект',
  createDocument: 'Создать документ',
  projectName: 'Название проекта',
  documentTitle: 'Название документа',
  system: 'Система оформления',
  text: 'Текст',
  rect: 'Прямоугольник',
  ellipse: 'Эллипс',
  image: 'Изображение',
  group: 'Группа',
  lock: 'Заблокировать',
  unlock: 'Разблокировать',
  undo: 'Отменить',
  redo: 'Повторить',
  save: 'Сохранить',
  exportPng: 'Экспорт PNG',
  exportSource: 'Исходник JSON',
  uploadImage: 'Загрузить изображение',
  accept: 'Принять',
  reject: 'Отклонить',
  preserveOverrides: 'Сохранить переопределения',
  saving: 'Сохранение…',
  saved: 'Сохранено',
  dirty: 'Есть несохранённые правки',
  conflict: 'Конфликт ревизии — черновик сохранён в этой вкладке',
  error: 'Ошибка',
  loading: 'Загрузка…',
  noDocument: 'Выберите или создайте документ',
  noSelection: 'Нет выбранного элемента',
  lockedHint: 'Элемент или предок заблокирован',
  textPromptUnavailable: 'Текстовая генерация недоступна: нет провайдера',
  imageGenUnavailable: 'Генерация изображений отключена',
  promptPlaceholder: 'Структурированная правка выбранного текста',
  proposalHint: 'Чат создаёт предложение, не применяет его сам',
  x: 'X',
  y: 'Y',
  width: 'Ширина',
  height: 'Высота',
  rotation: 'Поворот',
  opacity: 'Прозрачность',
  fill: 'Заливка',
  stroke: 'Обводка',
  strokeWidth: 'Толщина обводки',
  fontSize: 'Кегль',
  fontFamily: 'Шрифт',
  fontStyle: 'Начертание',
  align: 'Выравнивание',
  revision: 'Ревизия',
  viewerReadonly: 'Только просмотр',
  canvas: 'Холст',
  bindFill: 'Токен заливки',
  literal: 'Литерал',
  token: 'Токен',
  retrySave: 'Повторить сохранение',
} as const;

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  text: LABELS.text,
  rect: LABELS.rect,
  ellipse: LABELS.ellipse,
  image: LABELS.image,
  group: LABELS.group,
};
