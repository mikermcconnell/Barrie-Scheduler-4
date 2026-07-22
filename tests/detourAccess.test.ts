import { describe, expect, it } from 'vitest';
import { canAccessDetourPublisher } from '../utils/detours/detourAccess';
import { buildFeatureFlags, getFeatureOverrideEnvVar } from '../utils/features';

const subject = (
    inviteCode: string,
    accessLevel: Parameters<typeof canAccessDetourPublisher>[0]['accessLevel'],
    isGlobalAdmin = false,
) => ({ team: { inviteCode }, accessLevel, isGlobalAdmin });

describe('Detour Publisher access', () => {
    it('allows all Barrie team access profiles', () => {
        expect(canAccessDetourPublisher(subject('BARRIE', 'production'))).toBe(true);
        expect(canAccessDetourPublisher(subject(' barrie ', 'planner'))).toBe(true);
    });

    it('allows developer, internal, and admin access outside the Barrie team', () => {
        expect(canAccessDetourPublisher(subject('PARTNER', 'none', true))).toBe(true);
        expect(canAccessDetourPublisher(subject('PARTNER', 'internal'))).toBe(true);
        expect(canAccessDetourPublisher(subject('PARTNER', 'admin'))).toBe(true);
    });

    it('hides the Barrie-specific publisher from ordinary partner users', () => {
        expect(canAccessDetourPublisher(subject('PARTNER', 'production'))).toBe(false);
        expect(canAccessDetourPublisher(subject('PARTNER', 'planner'))).toBe(false);
        expect(canAccessDetourPublisher({ team: null, accessLevel: 'none', isGlobalAdmin: false })).toBe(false);
    });

    it('honours an explicit global feature shutdown', () => {
        const flags = buildFeatureFlags({ [getFeatureOverrideEnvVar('fixedDetours')]: 'false' });
        expect(canAccessDetourPublisher({ ...subject('BARRIE', 'internal'), flags })).toBe(false);
    });
});
