/**
 * Team Service
 *
 * Handles team creation, membership management, and invite code system.
 */

import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    serverTimestamp,
    Timestamp,
    updateDoc,
    writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Team, TeamMember, TeamWithMembers, TeamRole, WorkspaceAccessLevel, WorkspaceAccessOverrides } from '../masterScheduleTypes';
import { getDefaultWorkspaceAccessLevelForRole, isWorkspaceAccessLevel } from '../workspaceAccess';

interface TeamInviteLookup {
    id: string;
    name: string;
    inviteCode: string;
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
        workspaceOverrides: data.workspaceOverrides as WorkspaceAccessOverrides | undefined,
        joinedAt: timestampToDate(data.joinedAt),
        displayName: data.displayName,
        email: data.email
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

    // Create team document
    await setDoc(teamDocRef, {
        name: teamName,
        createdAt: serverTimestamp(),
        createdBy: userId,
        inviteCode
    });

    // Add creator as owner in members subcollection
    const memberRef = doc(db, 'teams', teamId, 'members', userId);
    await setDoc(memberRef, {
        userId,
        role: 'owner' as TeamRole,
        accessLevel: 'internal' as WorkspaceAccessLevel,
        joinedAt: serverTimestamp(),
        displayName: userDisplayName,
        email: userEmail
    });

    const inviteRef = doc(db, 'teamInvites', inviteCode);
    await setDoc(inviteRef, {
        teamId,
        teamName: teamName,
        createdBy: userId,
        updatedAt: serverTimestamp()
    });

    // Update user document with teamId
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, { teamId }, { merge: true });

    return teamId;
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

    const teamData = teamSnap.data();
    const team: Team = {
        id: teamSnap.id,
        name: teamData.name,
        createdAt: timestampToDate(teamData.createdAt),
        createdBy: teamData.createdBy,
        inviteCode: teamData.inviteCode
    };

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

    const teamData = teamSnap.data();
    return {
        id: teamSnap.id,
        name: teamData.name,
        createdAt: timestampToDate(teamData.createdAt),
        createdBy: teamData.createdBy,
        inviteCode: teamData.inviteCode
    };
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
    await updateDoc(teamRef, { name: newName });
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
    const inviteRef = doc(db, 'teamInvites', normalizedCode);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
        return null;
    }

    const inviteData = inviteSnap.data();

    return {
        id: inviteData.teamId,
        name: inviteData.teamName,
        inviteCode: normalizedCode
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
    email: string
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
        // Already a member, just update user's teamId
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, { teamId }, { merge: true });
        return teamId;
    }

    // Add as new member
    await setDoc(memberRef, {
        userId,
        role: 'member' as TeamRole,
        accessLevel: getDefaultWorkspaceAccessLevelForRole('member'),
        joinedAt: serverTimestamp(),
        displayName,
        email,
        inviteCode: inviteCode.toUpperCase()
    });

    // Update user document with teamId
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, { teamId }, { merge: true });

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
    const memberRef = doc(db, 'teams', teamId, 'members', memberId);
    await updateDoc(memberRef, { accessLevel });
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
    const normalized = inviteCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
        throw new Error('Invite code must be exactly 6 letters/numbers');
    }

    const existingInvite = await getDoc(doc(db, 'teamInvites', normalized));
    if (existingInvite.exists() && existingInvite.data().teamId !== teamId) {
        throw new Error('Invite code is already in use');
    }

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
        updatedAt: serverTimestamp()
    });
    if (previousCode && previousCode !== normalized) {
        await deleteDoc(doc(db, 'teamInvites', previousCode));
    }
    return normalized;
}
