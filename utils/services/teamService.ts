/**
 * Team Service
 *
 * Handles team creation, membership management, and invite code system.
 */

import {
    collection,
    collectionGroup,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    serverTimestamp,
    Timestamp,
    updateDoc,
    writeBatch,
    query,
    where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Team, TeamMember, TeamWithMembers, TeamRole, WorkspaceAccessLevel, WorkspaceAccessOverrides } from '../masterScheduleTypes';
import {
    getDefaultWorkspaceAccessLevelForRole,
    isWorkspaceAccessFeature,
    isWorkspaceAccessLevel,
} from '../workspaceAccess';

const NEW_TEAM_DEFAULT_ACCESS_LEVEL: WorkspaceAccessLevel = 'none';

interface TeamInviteLookup {
    id: string;
    name: string;
    inviteCode: string;
    defaultMemberAccessLevel?: WorkspaceAccessLevel;
    defaultMemberWorkspaceOverrides?: WorkspaceAccessOverrides;
}

export interface CreatePartnerTeamInput {
    createdBy: string;
    teamName: string;
    inviteCode?: string;
    defaultMemberAccessLevel?: WorkspaceAccessLevel;
    defaultMemberWorkspaceOverrides?: WorkspaceAccessOverrides;
}

// ============ HELPER FUNCTIONS ============

/**
 * Generate 6-character alphanumeric invite code
 * Excludes confusing characters (0, O, 1, I)
 */
function generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * Generate a unique invite code across all teams.
 */
async function generateUniqueInviteCode(excludeTeamId?: string): Promise<string> {
    for (let attempt = 0; attempt < 25; attempt++) {
        const candidate = generateInviteCode();
        const inviteSnap = await getDoc(doc(db, 'teamInvites', candidate));
        const inviteTeamId = inviteSnap.exists() ? inviteSnap.data().teamId : null;
        if (!inviteSnap.exists() || inviteTeamId === excludeTeamId) {
            return candidate;
        }
    }
    throw new Error('Unable to generate unique invite code');
}

async function normalizeUniqueInviteCode(inviteCode: string, excludeTeamId?: string): Promise<string> {
    const normalized = inviteCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
        throw new Error('Invite code must be exactly 6 letters/numbers');
    }

    const existingInvite = await getDoc(doc(db, 'teamInvites', normalized));
    if (existingInvite.exists() && existingInvite.data().teamId !== excludeTeamId) {
        throw new Error('Invite code is already in use');
    }

    return normalized;
}

/**
 * Convert Firestore Timestamp to Date
 */
function timestampToDate(timestamp: Timestamp | Date): Date {
    if (timestamp instanceof Date) return timestamp;
    return timestamp.toDate();
}

function readMemberData(docId: string, data: Record<string, any>): TeamMember {
    const role = data.role as TeamRole;
    return {
        id: docId,
        userId: data.userId,
        role,
        accessLevel: isWorkspaceAccessLevel(data.accessLevel)
            ? data.accessLevel
            : getDefaultWorkspaceAccessLevelForRole(role),
        workspaceOverrides: sanitizeWorkspaceOverrides(data.workspaceOverrides),
        joinedAt: timestampToDate(data.joinedAt),
        displayName: data.displayName,
        email: data.email
    };
}

function readTeamData(docId: string, data: Record<string, any>): Team {
    const rawDataSourceTeamIds = data.dataSourceTeamIds;
    const dataSourceTeamIds = rawDataSourceTeamIds && typeof rawDataSourceTeamIds === 'object' && !Array.isArray(rawDataSourceTeamIds)
        ? {
            ...(typeof rawDataSourceTeamIds.transitApp === 'string' && rawDataSourceTeamIds.transitApp
                ? { transitApp: rawDataSourceTeamIds.transitApp }
                : {}),
            ...(typeof rawDataSourceTeamIds.performance === 'string' && rawDataSourceTeamIds.performance
                ? { performance: rawDataSourceTeamIds.performance }
                : {}),
            ...(typeof rawDataSourceTeamIds.masterSchedules === 'string' && rawDataSourceTeamIds.masterSchedules
                ? { masterSchedules: rawDataSourceTeamIds.masterSchedules }
                : {}),
            ...(typeof rawDataSourceTeamIds.fleetPlan === 'string' && rawDataSourceTeamIds.fleetPlan
                ? { fleetPlan: rawDataSourceTeamIds.fleetPlan }
                : {}),
            ...(typeof rawDataSourceTeamIds.strategicPlanWorkplan === 'string' && rawDataSourceTeamIds.strategicPlanWorkplan
                ? { strategicPlanWorkplan: rawDataSourceTeamIds.strategicPlanWorkplan }
                : {}),
        }
        : undefined;

    return {
        id: docId,
        name: data.name,
        createdAt: data.createdAt ? timestampToDate(data.createdAt) : new Date(0),
        createdBy: data.createdBy,
        inviteCode: data.inviteCode,
        defaultMemberAccessLevel: isWorkspaceAccessLevel(data.defaultMemberAccessLevel)
            ? data.defaultMemberAccessLevel
            : getDefaultWorkspaceAccessLevelForRole('member'),
        defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(data.defaultMemberWorkspaceOverrides),
        dataSourceTeamIds: dataSourceTeamIds && Object.keys(dataSourceTeamIds).length > 0 ? dataSourceTeamIds : undefined,
        partnerTeam: data.partnerTeam === true
    };
}

const RETIRED_WORKSPACE_OVERRIDE_KEYS = new Set(['analyticsCouncilIntelligence']);

function sanitizeWorkspaceOverrides(overrides: unknown): WorkspaceAccessOverrides | undefined {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        return undefined;
    }

    const sanitized: WorkspaceAccessOverrides = {};
    Object.entries(overrides as Record<string, unknown>).forEach(([key, value]) => {
        if (RETIRED_WORKSPACE_OVERRIDE_KEYS.has(key)) return;
        if (!isWorkspaceAccessFeature(key as any)) {
            throw new Error(`Invalid workspace override key: ${key}`);
        }
        if (typeof value !== 'boolean') {
            throw new Error(`Invalid workspace override value for ${key}`);
        }
        sanitized[key as keyof WorkspaceAccessOverrides] = value;
    });

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

async function getTeamDefaultWorkspaceAccess(teamId: string): Promise<{
    accessLevel: WorkspaceAccessLevel;
    workspaceOverrides?: WorkspaceAccessOverrides;
}> {
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    if (!teamSnap.exists()) {
        return { accessLevel: getDefaultWorkspaceAccessLevelForRole('member') };
    }

    const defaultAccessLevel = teamSnap.data().defaultMemberAccessLevel;
    return {
        accessLevel: isWorkspaceAccessLevel(defaultAccessLevel)
            ? defaultAccessLevel
            : getDefaultWorkspaceAccessLevelForRole('member'),
        workspaceOverrides: sanitizeWorkspaceOverrides(teamSnap.data().defaultMemberWorkspaceOverrides),
    };
}

// ============ TEAM CRUD ============

/**
 * Create a new team and set the creator as owner
 */
export async function createTeam(
    userId: string,
    teamName: string,
    userDisplayName: string,
    userEmail: string
): Promise<string> {
    const teamsRef = collection(db, 'teams');
    const teamDocRef = doc(teamsRef);
    const teamId = teamDocRef.id;

    const inviteCode = await generateUniqueInviteCode();
    const batch = writeBatch(db);

    // Create team document
    batch.set(teamDocRef, {
        name: teamName,
        createdAt: serverTimestamp(),
        createdBy: userId,
        inviteCode,
        defaultMemberAccessLevel: NEW_TEAM_DEFAULT_ACCESS_LEVEL
    });

    // Add creator as owner in members subcollection
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    batch.set(memberRef, {
        userId,
        role: 'owner' as TeamRole,
        accessLevel: NEW_TEAM_DEFAULT_ACCESS_LEVEL,
        joinedAt: serverTimestamp(),
        displayName: userDisplayName,
        email: userEmail
    });

    const inviteRef = doc(db, 'teamInvites', inviteCode);
    batch.set(inviteRef, {
        teamId,
        teamName: teamName,
        createdBy: userId,
        defaultMemberAccessLevel: NEW_TEAM_DEFAULT_ACCESS_LEVEL,
        updatedAt: serverTimestamp()
    });

    // Update user document with teamId
    const userRef = doc(db, 'users', userId);
    batch.set(userRef, { teamId }, { merge: true });

    await batch.commit();

    return teamId;
}

/**
 * Create a partner agency team without switching the current admin into that team.
 * Intended for global admins setting up external agencies such as Lane Transit.
 */
export async function createPartnerTeam(input: CreatePartnerTeamInput): Promise<{ teamId: string; inviteCode: string }> {
    const normalizedName = input.teamName.trim();
    if (!normalizedName) {
        throw new Error('Team name is required');
    }

    const defaultMemberAccessLevel = input.defaultMemberAccessLevel ?? 'external-planner';
    if (!isWorkspaceAccessLevel(defaultMemberAccessLevel)) {
        throw new Error('Invalid workspace access level');
    }

    const inviteCode = input.inviteCode
        ? await normalizeUniqueInviteCode(input.inviteCode)
        : await generateUniqueInviteCode();

    const teamsRef = collection(db, 'teams');
    const teamDocRef = doc(teamsRef);
    const teamId = teamDocRef.id;

    const batch = writeBatch(db);

    batch.set(teamDocRef, {
        name: normalizedName,
        createdAt: serverTimestamp(),
        createdBy: input.createdBy,
        inviteCode,
        defaultMemberAccessLevel,
        ...(input.defaultMemberWorkspaceOverrides
            ? { defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(input.defaultMemberWorkspaceOverrides) }
            : {}),
        partnerTeam: true
    });

    batch.set(doc(db, 'teamInvites', inviteCode), {
        teamId,
        teamName: normalizedName,
        createdBy: input.createdBy,
        defaultMemberAccessLevel,
        ...(input.defaultMemberWorkspaceOverrides
            ? { defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(input.defaultMemberWorkspaceOverrides) }
            : {}),
        updatedAt: serverTimestamp()
    });

    await batch.commit();

    return { teamId, inviteCode };
}

/**
 * Get team by ID with all members
 */
export async function getTeamWithMembers(teamId: string): Promise<TeamWithMembers | null> {
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);

    if (!teamSnap.exists()) {
        return null;
    }

    const team = readTeamData(teamSnap.id, teamSnap.data());

    // Get all members
    const membersRef = collection(db, 'teams', teamId, 'members');
    const membersSnap = await getDocs(membersRef);

    const members: TeamMember[] = membersSnap.docs.map(doc => readMemberData(doc.id, doc.data()));

    return {
        ...team,
        members,
        memberCount: members.length
    };
}

/**
 * Get all teams for internal/admin permission management.
 * Security rules restrict this to workspace permission managers.
 */
export async function getTeamsForPermissionManagement(): Promise<Team[]> {
    const teamsRef = collection(db, 'teams');
    const teamsSnap = await getDocs(teamsRef);

    return teamsSnap.docs
        .map(teamDoc => readTeamData(teamDoc.id, teamDoc.data()))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get user's current team (reads from user doc)
 */
export async function getUserTeam(userId: string): Promise<Team | null> {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists() || !userSnap.data().teamId) {
        return null;
    }

    const teamId = userSnap.data().teamId;
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
        await updateDoc(userRef, { teamId: null });
        return null;
    }

    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);

    if (!teamSnap.exists()) {
        await updateDoc(userRef, { teamId: null });
        return null;
    }

    return readTeamData(teamSnap.id, teamSnap.data());
}

/**
 * Get every team the user belongs to.
 *
 * The userId equality filter is part of the authorization contract for the
 * collection-group query. Firestore rules only permit callers to enumerate
 * membership records whose stored userId matches their authenticated UID.
 */
export async function getUserTeams(userId: string): Promise<Team[]> {
    const membershipsQuery = query(
        collectionGroup(db, 'members'),
        where('userId', '==', userId),
    );
    const membershipsSnap = await getDocs(membershipsQuery);

    const teamIds = Array.from(new Set(membershipsSnap.docs.flatMap(membershipDoc => {
        if (membershipDoc.id !== userId || membershipDoc.data().userId !== userId) return [];
        const teamId = membershipDoc.ref.parent.parent?.id;
        return teamId ? [teamId] : [];
    })));

    const teamSnaps = await Promise.all(
        teamIds.map(teamId => getDoc(doc(db, 'teams', teamId))),
    );

    return teamSnaps
        .filter(teamSnap => teamSnap.exists())
        .map(teamSnap => readTeamData(teamSnap.id, teamSnap.data()))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Change the user's active team after confirming that they belong to it.
 */
export async function switchUserTeam(userId: string, teamId: string): Promise<void> {
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists() || memberSnap.data().userId !== userId) {
        throw new Error('You are not a member of that team.');
    }

    const teamSnap = await getDoc(doc(db, 'teams', teamId));
    if (!teamSnap.exists()) {
        throw new Error('That team is no longer available.');
    }

    await setDoc(doc(db, 'users', userId), { teamId }, { merge: true });
}

/**
 * Get a single team member record.
 */
export async function getTeamMember(teamId: string, userId: string): Promise<TeamMember | null> {
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
        return null;
    }

    return readMemberData(memberSnap.id, memberSnap.data());
}

/**
 * Rename team (owner/admin only - enforcement via security rules)
 */
export async function renameTeam(teamId: string, newName: string): Promise<void> {
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    await updateDoc(teamRef, { name: newName });
    if (teamSnap.exists()) {
        const inviteCode = teamSnap.data().inviteCode as string | undefined;
        if (inviteCode) {
            await setDoc(doc(db, 'teamInvites', inviteCode), {
                teamId,
                teamName: newName,
                createdBy: teamSnap.data().createdBy,
                defaultMemberAccessLevel: isWorkspaceAccessLevel(teamSnap.data().defaultMemberAccessLevel)
                    ? teamSnap.data().defaultMemberAccessLevel
                    : getDefaultWorkspaceAccessLevelForRole('member'),
                defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(teamSnap.data().defaultMemberWorkspaceOverrides) ?? {},
                updatedAt: serverTimestamp()
            }, { merge: true });
        }
    }
}

/**
 * Delete team and all associated data (owner only - enforcement via security rules)
 * WARNING: This deletes all master schedules, versions, and members
 */
export async function deleteTeam(teamId: string): Promise<void> {
    const batch = writeBatch(db);
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    const inviteCode = teamSnap.exists() ? (teamSnap.data().inviteCode as string | undefined) : undefined;

    // Delete all members
    const membersRef = collection(db, 'teams', teamId, 'members');
    const membersSnap = await getDocs(membersRef);
    membersSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    // Delete all master schedules and their versions
    const schedulesRef = collection(db, 'teams', teamId, 'masterSchedules');
    const schedulesSnap = await getDocs(schedulesRef);

    for (const scheduleDoc of schedulesSnap.docs) {
        // Delete all versions
        const versionsRef = collection(db, 'teams', teamId, 'masterSchedules', scheduleDoc.id, 'versions');
        const versionsSnap = await getDocs(versionsRef);
        versionsSnap.docs.forEach(versionDoc => {
            batch.delete(versionDoc.ref);
        });

        // Delete schedule
        batch.delete(scheduleDoc.ref);
    }

    // Delete team
    batch.delete(teamRef);
    if (inviteCode) {
        batch.delete(doc(db, 'teamInvites', inviteCode));
    }

    await batch.commit();

    // Note: Cleaning up Cloud Storage files and user.teamId references
    // should be done separately or via Cloud Functions
}

// ============ MEMBERSHIP ============

/**
 * Find team by invite code
 */
export async function findTeamByInviteCode(code: string): Promise<TeamInviteLookup | null> {
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
        return null;
    }

    const inviteRef = doc(db, 'teamInvites', normalizedCode);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
        return null;
    }

    const inviteData = inviteSnap.data();

    return {
        id: inviteData.teamId,
        name: inviteData.teamName,
        inviteCode: normalizedCode,
        defaultMemberAccessLevel: isWorkspaceAccessLevel(inviteData.defaultMemberAccessLevel)
            ? inviteData.defaultMemberAccessLevel
            : undefined,
        defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(inviteData.defaultMemberWorkspaceOverrides),
    };
}

/**
 * Get a team and its members by invite code.
 */
export async function getTeamWithMembersByInviteCode(code: string): Promise<TeamWithMembers | null> {
    const team = await findTeamByInviteCode(code);
    if (!team) {
        return null;
    }

    return getTeamWithMembers(team.id);
}

/**
 * Join team using invite code
 */
export async function joinTeamByInviteCode(
    userId: string,
    inviteCode: string,
    displayName: string,
    email: string,
    options: { activate?: boolean } = {},
): Promise<string> {
    // Find team by invite code
    const team = await findTeamByInviteCode(inviteCode);

    if (!team) {
        throw new Error('Invalid invite code');
    }

    const teamId = team.id;

    // Check if user is already a member
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    const memberSnap = await getDoc(memberRef);

    if (memberSnap.exists()) {
        if (options.activate !== false) {
            await setDoc(doc(db, 'users', userId), { teamId }, { merge: true });
        }
        return teamId;
    }

    let defaultAccess: {
        accessLevel: WorkspaceAccessLevel;
        workspaceOverrides?: WorkspaceAccessOverrides;
    } = {
        accessLevel: team.defaultMemberAccessLevel ?? NEW_TEAM_DEFAULT_ACCESS_LEVEL,
        workspaceOverrides: team.defaultMemberWorkspaceOverrides,
    };

    // Older invite lookup documents may not have denormalized defaults yet.
    // Fall back to the team doc when rules allow it, but never fail the join
    // solely because that private read is unavailable.
    if (!team.defaultMemberAccessLevel && !team.defaultMemberWorkspaceOverrides) {
        try {
            defaultAccess = await getTeamDefaultWorkspaceAccess(teamId);
        } catch (error) {
            console.warn('Unable to read team defaults while joining by invite; using no workspace access.', error);
        }
    }

    // Add as new member
    await setDoc(memberRef, {
        userId,
        role: 'member' as TeamRole,
        accessLevel: defaultAccess.accessLevel,
        ...(defaultAccess.workspaceOverrides ? { workspaceOverrides: defaultAccess.workspaceOverrides } : {}),
        joinedAt: serverTimestamp(),
        displayName,
        email,
        inviteCode: inviteCode.toUpperCase()
    });

    if (options.activate !== false) {
        await setDoc(doc(db, 'users', userId), { teamId }, { merge: true });
    }

    return teamId;
}

/**
 * Leave team (removes membership, clears user.teamId)
 */
export async function leaveTeam(userId: string): Promise<void> {
    // Get user's current team
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists() || !userSnap.data().teamId) {
        return;
    }

    const teamId = userSnap.data().teamId;

    // Remove from members
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    await deleteDoc(memberRef);

    // Clear teamId from user
    await updateDoc(userRef, { teamId: null });
}

/**
 * Remove member from team (owner/admin only - enforcement via security rules)
 */
export async function removeMember(teamId: string, memberId: string): Promise<void> {
    const memberRef = doc(db, 'teams', teamId, 'members', memberId);
    await deleteDoc(memberRef);
}

/**
 * Update member role (owner only - enforcement via security rules)
 */
export async function updateMemberRole(
    teamId: string,
    memberId: string,
    newRole: TeamRole
): Promise<void> {
    const memberRef = doc(db, 'teams', teamId, 'members', memberId);
    await updateDoc(memberRef, { role: newRole });
}

/**
 * Update member workspace visibility profile (owner/admin only - enforcement via security rules)
 */
export async function updateMemberAccessLevel(
    teamId: string,
    memberId: string,
    accessLevel: WorkspaceAccessLevel
): Promise<void> {
    if (!isWorkspaceAccessLevel(accessLevel)) {
        throw new Error('Invalid workspace access level');
    }

    const memberRef = doc(db, 'teams', teamId, 'members', memberId);
    await updateDoc(memberRef, { accessLevel });
}

/**
 * Update a member's workspace profile and optional per-workspace overrides.
 */
export async function updateMemberWorkspaceAccess(
    teamId: string,
    memberId: string,
    accessLevel: WorkspaceAccessLevel,
    workspaceOverrides?: WorkspaceAccessOverrides
): Promise<void> {
    if (!isWorkspaceAccessLevel(accessLevel)) {
        throw new Error('Invalid workspace access level');
    }

    const memberRef = doc(db, 'teams', teamId, 'members', memberId);
    const sanitizedOverrides = sanitizeWorkspaceOverrides(workspaceOverrides);
    await updateDoc(memberRef, {
        accessLevel,
        workspaceOverrides: sanitizedOverrides ?? {},
    });
}

/**
 * Update the access level assigned to future users who join with this team's invite code.
 */
export async function updateTeamDefaultMemberAccessLevel(
    teamId: string,
    accessLevel: WorkspaceAccessLevel
): Promise<void> {
    if (!isWorkspaceAccessLevel(accessLevel)) {
        throw new Error('Invalid workspace access level');
    }

    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    await updateDoc(teamRef, { defaultMemberAccessLevel: accessLevel });
    if (teamSnap.exists()) {
        const inviteCode = teamSnap.data().inviteCode as string | undefined;
        if (inviteCode) {
            await setDoc(doc(db, 'teamInvites', inviteCode), {
                teamId,
                teamName: teamSnap.data().name,
                defaultMemberAccessLevel: accessLevel,
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    }
}

/**
 * Update the workspace profile and optional overrides assigned to future invite joins.
 */
export async function updateTeamDefaultWorkspaceAccess(
    teamId: string,
    accessLevel: WorkspaceAccessLevel,
    workspaceOverrides?: WorkspaceAccessOverrides
): Promise<void> {
    if (!isWorkspaceAccessLevel(accessLevel)) {
        throw new Error('Invalid workspace access level');
    }

    const teamRef = doc(db, 'teams', teamId);
    const sanitizedOverrides = sanitizeWorkspaceOverrides(workspaceOverrides);
    const teamSnap = await getDoc(teamRef);
    await updateDoc(teamRef, {
        defaultMemberAccessLevel: accessLevel,
        defaultMemberWorkspaceOverrides: sanitizedOverrides ?? {},
    });
    if (teamSnap.exists()) {
        const inviteCode = teamSnap.data().inviteCode as string | undefined;
        if (inviteCode) {
            await setDoc(doc(db, 'teamInvites', inviteCode), {
                teamId,
                teamName: teamSnap.data().name,
                defaultMemberAccessLevel: accessLevel,
                defaultMemberWorkspaceOverrides: sanitizedOverrides ?? {},
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    }
}

/**
 * Set source teams for partner workspaces. Evidence sources are read-only;
 * Strategic Plan work-plan collaboration is explicitly editable by rule.
 * Empty values remove the override and make the workspace use its own team data.
 */
export async function updateTeamDataSourceTeamIds(
    teamId: string,
    dataSourceTeamIds: Team['dataSourceTeamIds']
): Promise<void> {
    const normalized = {
        ...(dataSourceTeamIds?.transitApp ? { transitApp: dataSourceTeamIds.transitApp } : {}),
        ...(dataSourceTeamIds?.performance ? { performance: dataSourceTeamIds.performance } : {}),
        ...(dataSourceTeamIds?.fleetPlan ? { fleetPlan: dataSourceTeamIds.fleetPlan } : {}),
        ...(dataSourceTeamIds?.masterSchedules ? { masterSchedules: dataSourceTeamIds.masterSchedules } : {}),
        ...(dataSourceTeamIds?.strategicPlanWorkplan ? { strategicPlanWorkplan: dataSourceTeamIds.strategicPlanWorkplan } : {}),
    };

    await updateDoc(doc(db, 'teams', teamId), {
        dataSourceTeamIds: normalized,
    });
}

/**
 * Regenerate invite code (owner/admin only - enforcement via security rules)
 */
export async function regenerateInviteCode(teamId: string): Promise<string> {
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    if (!teamSnap.exists()) {
        throw new Error('Team not found');
    }

    const previousCode = teamSnap.data().inviteCode as string | undefined;
    const newCode = await generateUniqueInviteCode(teamId);
    await updateDoc(teamRef, { inviteCode: newCode });
    await setDoc(doc(db, 'teamInvites', newCode), {
        teamId,
        teamName: teamSnap.data().name,
        createdBy: teamSnap.data().createdBy,
        defaultMemberAccessLevel: isWorkspaceAccessLevel(teamSnap.data().defaultMemberAccessLevel)
            ? teamSnap.data().defaultMemberAccessLevel
            : getDefaultWorkspaceAccessLevelForRole('member'),
        defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(teamSnap.data().defaultMemberWorkspaceOverrides) ?? {},
        updatedAt: serverTimestamp()
    });
    if (previousCode && previousCode !== newCode) {
        await deleteDoc(doc(db, 'teamInvites', previousCode));
    }
    return newCode;
}

/**
 * Set a custom invite code (owner/admin only - enforcement via security rules)
 * Must be 6 alphanumeric characters and unique across teams.
 */
export async function setInviteCode(teamId: string, inviteCode: string): Promise<string> {
    const normalized = await normalizeUniqueInviteCode(inviteCode, teamId);

    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);
    if (!teamSnap.exists()) {
        throw new Error('Team not found');
    }

    const previousCode = teamSnap.data().inviteCode as string | undefined;
    await updateDoc(teamRef, { inviteCode: normalized });
    await setDoc(doc(db, 'teamInvites', normalized), {
        teamId,
        teamName: teamSnap.data().name,
        createdBy: teamSnap.data().createdBy,
        defaultMemberAccessLevel: isWorkspaceAccessLevel(teamSnap.data().defaultMemberAccessLevel)
            ? teamSnap.data().defaultMemberAccessLevel
            : getDefaultWorkspaceAccessLevelForRole('member'),
        defaultMemberWorkspaceOverrides: sanitizeWorkspaceOverrides(teamSnap.data().defaultMemberWorkspaceOverrides) ?? {},
        updatedAt: serverTimestamp()
    });
    if (previousCode && previousCode !== normalized) {
        await deleteDoc(doc(db, 'teamInvites', previousCode));
    }
    return normalized;
}
