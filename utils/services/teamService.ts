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
    query,
    where,
    serverTimestamp,
    Timestamp,
    updateDoc,
    writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Team, TeamMember, TeamWithMembers, TeamRole } from '../masterScheduleTypes';

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
    const teamsRef = collection(db, 'teams');
    for (let attempt = 0; attempt < 25; attempt++) {
        const candidate = generateInviteCode();
        const q = query(teamsRef, where('inviteCode', '==', candidate));
        const existing = await getDocs(q);
        const usedByOtherTeam = existing.docs.some(d => d.id !== excludeTeamId);
        if (!usedByOtherTeam) {
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
        joinedAt: serverTimestamp(),
        displayName: userDisplayName,
        email: userEmail
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

    const members: TeamMember[] = membersSnap.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            userId: data.userId,
            role: data.role,
            joinedAt: timestampToDate(data.joinedAt),
            displayName: data.displayName,
            email: data.email
        };
    });

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
    const teamRef = doc(db, 'teams', teamId);
    const teamSnap = await getDoc(teamRef);

    if (!teamSnap.exists()) {
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

    const data = memberSnap.data();
    return {
        id: memberSnap.id,
        userId: data.userId,
        role: data.role,
        joinedAt: timestampToDate(data.joinedAt),
        displayName: data.displayName,
        email: data.email
    };
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
    const teamRef = doc(db, 'teams', teamId);
    batch.delete(teamRef);

    await batch.commit();

    // Note: Cleaning up Cloud Storage files and user.teamId references
    // should be done separately or via Cloud Functions
}

// ============ MEMBERSHIP ============

/**
 * Find team by invite code
 */
export async function findTeamByInviteCode(code: string): Promise<Team | null> {
    const teamsRef = collection(db, 'teams');
    const q = query(teamsRef, where('inviteCode', '==', code.toUpperCase()));
    const querySnap = await getDocs(q);

    if (querySnap.empty) {
        return null;
    }

    if (querySnap.size > 1) {
        throw new Error('Invite code conflict detected. Ask an admin to regenerate the code.');
    }

    const teamDoc = querySnap.docs[0];
    const teamData = teamDoc.data();

    return {
        id: teamDoc.id,
        name: teamData.name,
        createdAt: timestampToDate(teamData.createdAt),
        createdBy: teamData.createdBy,
        inviteCode: teamData.inviteCode
    };
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
        joinedAt: serverTimestamp(),
        displayName,
        email
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

    // Clear teamId from removed member's user doc
    const userRef = doc(db, 'users', memberId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists() && userSnap.data().teamId === teamId) {
        await updateDoc(userRef, { teamId: null });
    }
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
 * Regenerate invite code (owner/admin only - enforcement via security rules)
 */
export async function regenerateInviteCode(teamId: string): Promise<string> {
    const newCode = await generateUniqueInviteCode(teamId);
    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, { inviteCode: newCode });
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

    const teamsRef = collection(db, 'teams');
    const q = query(teamsRef, where('inviteCode', '==', normalized));
    const existing = await getDocs(q);
    const usedByOtherTeam = existing.docs.some(d => d.id !== teamId);
    if (usedByOtherTeam) {
        throw new Error('Invite code is already in use');
    }

    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, { inviteCode: normalized });
    return normalized;
}
