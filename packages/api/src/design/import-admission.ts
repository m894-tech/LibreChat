import type { Request, Response, NextFunction, RequestHandler } from 'express';
/** Process-local bound for RAM-heavy ZIP operations; not a distributed storage quota. */
export function createImportAdmission(maxConcurrent: number = 2): RequestHandler {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8)
    throw Error('Invalid import concurrency');
  let active = 0;
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (active >= maxConcurrent) {
      res.setHeader('Retry-After', '3');
      res
        .status(429)
        .json({ code: 'import_busy', message: 'Too many package imports; try again later' });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    res.locals ??= {};
    res.locals.releasePackageSlot = release;
    res.once('finish', release);
    res.once('close', () => {
      if (!res.locals.packageProcessing) release();
    });
    next();
  };
}
