import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DesignDocument, DesignNode, DesignSystemPackage } from '../types';
import Inspector from '../inspector';

const system: DesignSystemPackage = {
  id: 'neutral-business',
  version: '1.0.0',
  name: 'Neutral',
  tokens: {},
};

function geometry(extra: Partial<DesignNode['props']> = {}) {
  return {
    x: 10,
    y: 20,
    width: 320,
    height: 240,
    rotation: 0,
    opacity: 1,
    ...extra,
  };
}

function makeNode(partial: Partial<DesignNode> & Pick<DesignNode, 'id' | 'type'>): DesignNode {
  return {
    parentId: null,
    locked: false,
    bindings: {},
    props: geometry(),
    ...partial,
    props: geometry(partial.props),
  };
}

function makeDoc(nodes: DesignNode[]): DesignDocument {
  return {
    id: 'd1',
    projectId: 'p1',
    kind: 'canvas',
    schemaVersion: 1,
    title: 'Canvas',
    revision: 1,
    designSystem: { id: 'neutral-business', version: '1.0.0' },
    payload: { width: 1080, height: 1350, nodes },
    assetRefs: [{ assetId: 'asset-1', version: 1 }],
    archived: false,
  };
}

function renderInspector(
  nodes: DesignNode[],
  selectedId: string,
  extra?: Partial<React.ComponentProps<typeof Inspector>>,
) {
  const onOperations = jest.fn();
  const onFlush = jest.fn();
  const onPreserveOverrides = jest.fn();
  const view = render(
    <Inspector
      document={makeDoc(nodes)}
      selectedId={selectedId}
      readOnly={false}
      preserveOverrides={false}
      systems={[system]}
      onPreserveOverrides={onPreserveOverrides}
      onOperations={onOperations}
      onFlush={onFlush}
      {...extra}
    />,
  );
  return { ...view, onOperations, onFlush, onPreserveOverrides };
}

const imageNode = makeNode({
  id: 'img1',
  type: 'image',
  props: {
    assetId: 'asset-1',
    assetVersion: 1,
    crop: { x: 1, y: 2, width: 100, height: 80 },
  },
});

const backNode = makeNode({ id: 'rect1', type: 'rect' });
const frontNode = makeNode({ id: 'ell1', type: 'ellipse' });

it('selected image emits canonical crop op', () => {
  const { onOperations } = renderInspector([backNode, imageNode, frontNode], 'img1');
  fireEvent.change(screen.getByLabelText('Кадр X'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Кадр Y'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Кадр ширина'), { target: { value: '64' } });
  fireEvent.change(screen.getByLabelText('Кадр высота'), { target: { value: '48' } });
  fireEvent.blur(screen.getByLabelText('Кадр высота'));
  expect(onOperations).toHaveBeenCalledTimes(1);
  expect(onOperations).toHaveBeenCalledWith(
    [
      {
        type: 'setProperty',
        nodeId: 'img1',
        property: 'crop',
        value: { x: 8, y: 4, width: 64, height: 48 },
      },
    ],
    { immediate: true },
  );
});

it('locked viewer disables controls', () => {
  const lockedImage = makeNode({
    id: 'img1',
    type: 'image',
    locked: true,
    props: {
      assetId: 'asset-1',
      assetVersion: 1,
      crop: { x: 1, y: 2, width: 100, height: 80 },
    },
  });
  renderInspector([backNode, lockedImage, frontNode], 'img1', { readOnly: true });
  expect(screen.getByLabelText('Кадр X')).toBeDisabled();
  expect(screen.getByLabelText('Кадр Y')).toBeDisabled();
  expect(screen.getByLabelText('Кадр ширина')).toBeDisabled();
  expect(screen.getByLabelText('Кадр высота')).toBeDisabled();
  expect(screen.getByLabelText('X')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Вперёд' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeDisabled();
});
