import { runMaintenance } from './maintenance.js';

// Cron-only Worker: no fetch handler, public routes, credentials or user-controlled inputs.
// Bind COMMUNITY_DB to the same production database as the Pages community function.
export default {
  async scheduled(_event, env) {
    if (!env.COMMUNITY_DB) throw new Error('COMMUNITY_DB binding is required for retention maintenance.');
    await runMaintenance(env.COMMUNITY_DB);
  }
};
