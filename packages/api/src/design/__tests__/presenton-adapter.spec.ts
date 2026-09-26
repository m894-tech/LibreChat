import sharp from 'sharp';
import { createPresentonAdapter } from '../presenton-adapter';
const png = () =>
  sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } })
    .png()
    .toBuffer();
it('uses branch revisioned InsertSlide API under actor identity and labels raster', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockImplementationOnce(async (_actor, _path, init) => ({
      status: 'applied',
      operationId: init.body.operationId,
      changedSlideIds: [init.body.operations[0].payload.id],
    }));
  const result = await createPresentonAdapter({ request }).send({
    actor: 'u',
    destinationId: 'dest',
    expectedRevision: 3,
    operationId: 'op',
    png: await png(),
    sourceDocumentId: 'source',
    sourceRevision: 2,
    title: 'Test',
  });
  expect(result.editable).toBe(false);
  expect(request.mock.calls.every((c) => c[0] === 'u')).toBe(true);
  const body = request.mock.calls[2][2].body;
  expect(body.baseRevision).toBe(3);
  expect(body.operations[0].operationType).toBe('InsertSlide');
  expect(body.operations[0].payload.speaker_note).toContain('revision 2');
});
it('destination revision mismatch prevents upload', async () => {
  const request = jest.fn().mockResolvedValue({ revision: 8 });
  await expect(
    createPresentonAdapter({ request }).send({
      actor: 'u',
      destinationId: 'dest',
      expectedRevision: 3,
      operationId: 'op',
      png: await png(),
      sourceDocumentId: 'source',
      sourceRevision: 2,
      title: 'Test',
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(request).toHaveBeenCalledTimes(1);
});

it('explicit target requires existing slide and uses revisioned UpdateSlide', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3, slides: [{ id: 'existing' }] })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockImplementationOnce(async (_actor, _path, init) => ({
      status: 'applied',
      operationId: init.body.operationId,
      changedSlideIds: [init.body.operations[0].payload.id],
    }));
  const result = await createPresentonAdapter({ request }).send({
    actor: 'u',
    destinationId: 'dest',
    targetSlideId: 'existing',
    expectedRevision: 3,
    operationId: 'op',
    png: await png(),
    sourceDocumentId: 'source',
    sourceRevision: 2,
    title: 'Update',
  });
  expect(result.slideId).toBe('existing');
  const op = request.mock.calls[2][2].body.operations[0];
  expect(op.operationType).toBe('UpdateSlide');
  expect(op.targetIds).toEqual(['existing']);
});

it('HTTP success without applied receipt is never called successful send', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockResolvedValueOnce({ ok: true });
  await expect(
    createPresentonAdapter({ request }).send({
      actor: 'u',
      destinationId: 'dest',
      expectedRevision: 3,
      operationId: 'op',
      png: await png(),
      sourceDocumentId: 'source',
      sourceRevision: 2,
      title: 'Test',
    }),
  ).rejects.toMatchObject({ uncertain: true });
});

it('revision increase alone cannot confirm the planned slide', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockResolvedValueOnce({
      status: 'applied',
      operationId: 'op',
      previousRevision: 3,
      resultingRevision: 4,
      changedSlideIds: [],
    });
  await expect(
    createPresentonAdapter({ request }).send({
      actor: 'u',
      destinationId: 'dest',
      expectedRevision: 3,
      operationId: 'op',
      png: await png(),
      sourceDocumentId: 'source',
      sourceRevision: 2,
      title: 'Test',
      plannedSlideId: 'planned',
    }),
  ).rejects.toMatchObject({ uncertain: true });
  expect(request).toHaveBeenCalledTimes(3);
});
it('wrong slide evidence plus revision bump is not success', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockResolvedValueOnce({
      status: 'applied',
      operationId: 'op',
      previousRevision: 3,
      resultingRevision: 4,
      changedSlideIds: ['unrelated'],
    });
  await expect(
    createPresentonAdapter({ request }).send({
      actor: 'u',
      destinationId: 'dest',
      expectedRevision: 3,
      operationId: 'op',
      png: await png(),
      sourceDocumentId: 'source',
      sourceRevision: 2,
      title: 'Test',
      plannedSlideId: 'planned',
    }),
  ).rejects.toMatchObject({ uncertain: true });
});
it('empty changedSlideIds with exact inverse InsertSlide proof remains supported', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockResolvedValueOnce({
      status: 'applied',
      operationId: 'op',
      previousRevision: 3,
      resultingRevision: 4,
      changedSlideIds: [],
      inverseOperations: [{ operationType: 'DeleteSlide', targetIds: ['planned'] }],
    });
  const result = await createPresentonAdapter({ request }).send({
    actor: 'u',
    destinationId: 'dest',
    expectedRevision: 3,
    operationId: 'op',
    png: await png(),
    sourceDocumentId: 'source',
    sourceRevision: 2,
    title: 'Test',
    plannedSlideId: 'planned',
  });
  expect(result.slideId).toBe('planned');
});
it('rejects evidence belonging to another destination document', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockResolvedValueOnce({
      status: 'applied',
      operationId: 'op',
      documentId: 'other',
      changedSlideIds: ['planned'],
    });
  await expect(
    createPresentonAdapter({ request }).send({
      actor: 'u',
      destinationId: 'dest',
      expectedRevision: 3,
      operationId: 'op',
      png: await png(),
      sourceDocumentId: 'source',
      sourceRevision: 2,
      title: 'Test',
      plannedSlideId: 'planned',
    }),
  ).rejects.toMatchObject({ uncertain: true });
});
it('wrapped duplicate receipt can prove exact inserted slide without another mutation', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce({ revision: 3 })
    .mockResolvedValueOnce({ file_url: '/app_data/images/test.png' })
    .mockResolvedValueOnce({
      status: 'duplicate',
      receipt: {
        status: 'applied',
        operationId: 'op',
        documentId: 'dest',
        changedSlideIds: [],
        inverseOperations: [{ operationType: 'DeleteSlide', targetIds: ['planned'] }],
      },
    });
  const result = await createPresentonAdapter({ request }).send({
    actor: 'u',
    destinationId: 'dest',
    expectedRevision: 3,
    operationId: 'op',
    png: await png(),
    sourceDocumentId: 'source',
    sourceRevision: 2,
    title: 'Test',
    plannedSlideId: 'planned',
  });
  expect(result.slideId).toBe('planned');
  expect(request).toHaveBeenCalledTimes(3);
});
