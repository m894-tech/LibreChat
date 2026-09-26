import type { ClientSession, Connection } from 'mongoose';
import { DesignError } from './errors';
export interface GenerationReservation {
  jobId: string;
  principalId: string;
  units: number;
  period: string;
}
export interface GenerationBudget {
  preflight(principalId: string): Promise<void>;
  reserve(jobId: string, principalId: string): Promise<GenerationReservation>;
  claimDispatch(jobId: string, principalId: string): Promise<void>;
  settle(jobId: string, state: 'consumed' | 'released' | 'uncertain'): Promise<void>;
}
/** Configured monthly upper-bound allowance, not a provider invoice or currency ledger.
 * Unit price must conservatively cover configured request caps. Default allowance0.
 * Reservations survive crashes; uncertainty never releases automatically.
 */
export async function createGenerationBudget(options: {
  connection: Connection;
  monthlyAllowance: number;
  requestUnits: number;
  now?: () => Date;
}): Promise<GenerationBudget> {
  const { connection, monthlyAllowance, requestUnits } = options;
  if (
    !Number.isSafeInteger(monthlyAllowance) ||
    monthlyAllowance < 0 ||
    !Number.isSafeInteger(requestUnits) ||
    requestUnits < 1
  )
    throw new DesignError(422, 'budget_config', 'Invalid conservative budget limits');
  if (!connection.db) throw new DesignError(503, 'budget_database', 'Database unavailable');
  const accounts = connection.db.collection('design_generation_allowances'),
    reservations = connection.db.collection('design_generation_reservations');
  await reservations.createIndex({ jobId: 1 }, { unique: true });
  await accounts.createIndex({ principalId: 1, period: 1 }, { unique: true });
  async function transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await connection.startSession();
    try {
      let value: T;
      await session.withTransaction(async () => {
        value = await fn(session);
      });
      return value!;
    } finally {
      await session.endSession();
    }
  }
  return {
    async preflight(principalId) {
      const period = (options.now?.() ?? new Date()).toISOString().slice(0, 7);
      const account = await accounts.findOne({ principalId, period });
      if ((account?.spent ?? 0) + (account?.reserved ?? 0) + requestUnits > monthlyAllowance)
        throw new DesignError(429, 'budget_exceeded', 'Generation allowance exhausted');
    },
    async reserve(jobId, principalId) {
      if (!/^[\w.-]{1,128}$/.test(jobId) || !/^[\w.-]{1,128}$/.test(principalId))
        throw new DesignError(422, 'budget_identity', 'Invalid budget identity');
      const period = (options.now?.() ?? new Date()).toISOString().slice(0, 7);
      return transaction(async (session) => {
        const existing = await reservations.findOne({ jobId }, { session });
        if (existing) {
          if (existing.principalId !== principalId)
            throw new DesignError(409, 'budget_identity', 'Reservation identity mismatch');
          return {
            jobId,
            principalId,
            units: existing.units as number,
            period: existing.period as string,
          };
        }
        await accounts.updateOne(
          { principalId, period },
          { $setOnInsert: { spent: 0, reserved: 0 } },
          { session, upsert: true },
        );
        const changed = await accounts.updateOne(
          {
            principalId,
            period,
            $expr: { $lte: [{ $add: ['$spent', '$reserved', requestUnits] }, monthlyAllowance] },
          },
          { $inc: { reserved: requestUnits } },
          { session },
        );
        if (changed.modifiedCount !== 1)
          throw new DesignError(429, 'budget_exceeded', 'Generation allowance exhausted');
        await reservations.insertOne(
          { jobId, principalId, period, units: requestUnits, state: 'reserved' },
          { session },
        );
        return { jobId, principalId, period, units: requestUnits };
      });
    },
    async claimDispatch(jobId, principalId) {
      const result = await reservations.updateOne(
        { jobId, principalId, state: 'reserved', dispatchClaimed: { $ne: true } },
        { $set: { dispatchClaimed: true } },
      );
      if (result.modifiedCount !== 1)
        throw new DesignError(
          409,
          'generation_already_dispatched',
          'Provider dispatch already claimed; no automatic retry',
        );
    },
    async settle(jobId, state) {
      if (!['consumed', 'released', 'uncertain'].includes(state))
        throw new DesignError(422, 'budget_state', 'Invalid settlement state');
      await transaction(async (session) => {
        const row = await reservations.findOne({ jobId }, { session });
        if (!row) throw new DesignError(404, 'budget_reservation', 'Reservation missing');
        if (row.state === state) return;
        if (row.state === 'consumed' || row.state === 'released')
          throw new DesignError(409, 'budget_settled', 'Reservation already settled');
        if (state !== 'uncertain')
          await accounts.updateOne(
            { principalId: row.principalId, period: row.period },
            {
              $inc: { reserved: -row.units, ...(state === 'consumed' ? { spent: row.units } : {}) },
            },
            { session },
          );
        await reservations.updateOne({ jobId }, { $set: { state } }, { session });
      });
    },
  };
}
