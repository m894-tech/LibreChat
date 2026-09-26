import type { Collection, Document } from 'mongodb';
/** Read-only recovery never changes the dispatch state of a possibly active worker.
 * Only public observation overlays uncertainty. Original worker can still commit a
 * matching success; a recorded proposal can be re-associated without model retry.
 */
export async function recoverEditJob(
  rows: Collection<any>,
  proposals: Collection<any>,
  row: Document,
  prefix: 'inpaint' | 'outpaint',
): Promise<any> {
  if (row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled')
    return row;
  const proposal = await proposals.findOne({
    _id: 'job-' + prefix + '-' + row.id,
    documentId: row.documentId,
    authorId: row.actor,
  });
  if (proposal) {
    await rows.updateOne(
      { id: row.id, actor: row.actor, status: { $in: ['running', 'submission_unknown'] } },
      { $set: { status: 'succeeded', proposalId: String(proposal._id) } },
    );
    const current = await rows.findOne({ id: row.id, actor: row.actor });
    return current ?? row;
  }
  if (row.status === 'running' && Date.now() - new Date(row.createdAt ?? 0).getTime() > 120000)
    return { ...row, status: 'submission_unknown' };
  return row;
}
