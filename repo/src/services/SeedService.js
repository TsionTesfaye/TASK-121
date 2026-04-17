/**
 * SeedService — auto-provisions demo accounts on first boot.
 *
 * On a fresh install (no users in DB), seeds an org and one account for every
 * role so testers can log in immediately without going through the bootstrap UI.
 * Already-bootstrapped systems are left untouched.
 */

import { bootstrapService } from './BootstrapService.js';
import { authService } from './AuthService.js';
import { ROLES } from '../utils/constants.js';

/**
 * Demo credentials seeded at first boot.
 * Exported for use in tests and documentation.
 */
export const DEMO_ACCOUNTS = Object.freeze({
  ADMIN: {
    username: 'admin',
    password: 'Admin@retailops1',
    role: ROLES.ADMINISTRATOR,
  },
  MANAGER: {
    username: 'manager',
    password: 'Manager@retailops1',
    role: ROLES.STORE_MANAGER,
  },
  ANALYST: {
    username: 'analyst',
    password: 'Analyst@retailops1',
    role: ROLES.ANALYST,
  },
  REVIEWER: {
    username: 'reviewer',
    password: 'Reviewer@retailops1',
    role: ROLES.REVIEWER,
  },
});

export const DEMO_ORG = 'EaglePoint Retail';

export class SeedService {
  /**
   * Seeds demo accounts if the system has not been bootstrapped yet.
   * No-op if already bootstrapped.
   *
   * @returns {Promise<boolean>}  true if seeding ran, false if skipped.
   */
  async seedDemoAccounts() {
    const bootstrapped = await bootstrapService.isBootstrapped();
    if (bootstrapped) return false;

    const admin = DEMO_ACCOUNTS.ADMIN;

    // Bootstrap: creates root org node, admin user, and org encryption config.
    const { org } = await bootstrapService.bootstrap({
      adminUsername: admin.username,
      adminPassword: admin.password,
      orgName: DEMO_ORG,
    });

    // Login as admin to create the remaining role accounts.
    await authService.login(admin.username, admin.password);

    for (const account of [DEMO_ACCOUNTS.MANAGER, DEMO_ACCOUNTS.ANALYST, DEMO_ACCOUNTS.REVIEWER]) {
      await authService.createUser({
        username: account.username,
        password: account.password,
        role: account.role,
        organizationNodeId: org.id,
      });
    }

    // Clear session — app navigates to login after seed.
    await authService.logout();
    return true;
  }
}

export const seedService = new SeedService();
