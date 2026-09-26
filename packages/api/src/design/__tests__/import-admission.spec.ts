import { EventEmitter } from 'events';
import { createImportAdmission } from '../import-admission';
it('caps inflight imports and releases exactly once on close/finish', () => {
  const gate = createImportAdmission(1);
  const response = () =>
    Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    });
  const a = response(),
    b = response(),
    c = response();
  const next = jest.fn();
  gate({} as any, a as any, next);
  expect(next).toHaveBeenCalledTimes(1);
  gate({} as any, b as any, next);
  expect(b.status).toHaveBeenCalledWith(429);
  a.emit('finish');
  a.emit('close');
  gate({} as any, c as any, next);
  expect(next).toHaveBeenCalledTimes(2);
  const d = response();
  gate({} as any, d as any, next);
  expect(d.status).toHaveBeenCalledWith(429);
});

it('keeps work slot after peer disconnect until parsing/transaction finishes', () => {
  const gate = createImportAdmission(1);
  const response = () =>
    Object.assign(new EventEmitter(), {
      locals: { packageProcessing: false, releasePackageSlot: () => {} },
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    });
  const a = response(),
    b = response();
  const next = jest.fn();
  gate({} as any, a as any, next);
  a.locals.packageProcessing = true;
  a.emit('close');
  gate({} as any, b as any, next);
  expect(b.status).toHaveBeenCalledWith(429);
  a.locals.releasePackageSlot();
  gate({} as any, response() as any, next);
  expect(next).toHaveBeenCalledTimes(2);
});
