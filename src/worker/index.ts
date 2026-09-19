import { env } from '../config/env';
import { logger } from '../lib/logger';
import { runSchedulerTick } from './scheduler';
import { runReconciliationTick, runStalledCheckTick } from './reconciliation';

// The interval below only triggers ticks; it is NOT the source of truth for
// pacing. All pacing/window/cap decisions are re-derived from Postgres state
// on every tick, so a restart never causes a burst of catch-up sends.
async function tick(name: string, fn: () => Promise<unknown>) {
  try {
    const result = await fn();
    logger.debug({ result }, `${name} tick complete`);
  } catch (err) {
    logger.error({ err: (err as Error).message, name }, 'worker tick failed');
  }
}

function startLoop(name: string, intervalSeconds: number, fn: () => Promise<unknown>) {
  void tick(name, fn);
  return setInterval(() => void tick(name, fn), intervalSeconds * 1000);
}

function main() {
  logger.info({ dryRun: env.dryRun, environment: env.environment }, 'SMS outreach worker starting');

  startLoop('scheduler', env.schedulerIntervalSeconds, runSchedulerTick);
  startLoop('reconciliation', env.reconciliationIntervalSeconds, runReconciliationTick);
  startLoop('stalled-check', env.stalledCheckIntervalSeconds, runStalledCheckTick);
}

if (require.main === module) {
  main();
}
