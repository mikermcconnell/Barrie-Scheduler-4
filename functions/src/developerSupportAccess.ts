import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 60;

type SupportMode = 'inspect' | 'edit';
type SupportAction = 'start' | 'stop';

interface SupportAccessInput {
  action?: unknown;
  userId?: unknown;
  teamId?: unknown;
  mode?: unknown;
  reason?: unknown;
  durationMinutes?: unknown;
}

interface ValidatedStartInput {
  action: 'start';
  teamId: string;
  mode: SupportMode;
  reason: string;
  durationMinutes: number;
}

interface ValidatedStopInput {
  action: 'stop';
}

export type ValidatedSupportAccessInput = ValidatedStartInput | ValidatedStopInput;

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${label} is required.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

export function validateSupportAccessInput(
  value: unknown,
  authenticatedUid: string,
): ValidatedSupportAccessInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'A support access request is required.');
  }
  const data = value as SupportAccessInput;
  if (data.userId !== undefined && data.userId !== authenticatedUid) {
    throw new HttpsError('permission-denied', 'A support session can only be managed for the signed-in administrator.');
  }

  const action = data.action as SupportAction;
  if (action === 'stop') return { action };
  if (action !== 'start') {
    throw new HttpsError('invalid-argument', 'Support action must be start or stop.');
  }

  const teamId = requiredString(data.teamId, 'Team ID', 128);
  if (data.mode !== 'inspect' && data.mode !== 'edit') {
    throw new HttpsError('invalid-argument', 'Support mode must be inspect or edit.');
  }
  const requestedReason = typeof data.reason === 'string' ? data.reason.trim() : '';
  if (data.mode === 'edit' && !requestedReason) {
    throw new HttpsError('invalid-argument', 'A reason is required for developer edit access.');
  }
  const reason = requestedReason || 'Team inspection';
  if (reason.length > 500) {
    throw new HttpsError('invalid-argument', 'Support session reason must be 500 characters or fewer.');
  }

  const duration = data.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new HttpsError('invalid-argument', 'Support session duration must be greater than zero.');
  }
  const durationMinutes = Math.ceil(duration);
  if (durationMinutes > MAX_DURATION_MINUTES) {
    throw new HttpsError('invalid-argument', 'Support session duration cannot exceed 60 minutes.');
  }

  return { action, teamId, mode: data.mode, reason, durationMinutes };
}

function auditValues(
  uid: string,
  value: admin.firestore.DocumentData | undefined,
  fallbackTime: admin.firestore.Timestamp,
) {
  const teamId = typeof value?.teamId === 'string' && value.teamId.trim() && value.teamId.length <= 128
    ? value.teamId
    : 'unknown';
  const mode: SupportMode = value?.mode === 'edit' ? 'edit' : 'inspect';
  const reason = typeof value?.reason === 'string' && value.reason.trim() && value.reason.length <= 500
    ? value.reason.trim()
    : 'Invalid support session cleanup';
  const expiresAt = value?.expiresAt instanceof admin.firestore.Timestamp
    ? value.expiresAt
    : fallbackTime;
  return { adminUid: uid, teamId, mode, reason, expiresAt };
}

export const developerSupportAccess = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  if (request.auth?.token.schedulerAdmin !== true) {
    throw new HttpsError('permission-denied', 'Scheduler administrator access is required.');
  }

  const input = validateSupportAccessInput(request.data, uid);
  const db = admin.firestore();
  const sessionRef = db.doc(`developerSupportSessions/${uid}`);

  if (input.action === 'stop') {
    const stopped = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(sessionRef);
      if (!snapshot.exists) return false;
      const now = admin.firestore.Timestamp.now();
      const auditRef = db.collection('developerSupportAudit').doc();
      transaction.set(auditRef, {
        action: 'stop',
        ...auditValues(uid, snapshot.data(), now),
        createdAt: now,
      });
      transaction.delete(sessionRef);
      return true;
    });
    return { stopped };
  }

  const teamRef = db.doc(`teams/${input.teamId}`);
  const result = await db.runTransaction(async transaction => {
    const [teamSnapshot, existingSnapshot] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(sessionRef),
    ]);
    if (!teamSnapshot.exists) throw new HttpsError('not-found', 'The selected team no longer exists.');

    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + input.durationMinutes * 60_000,
    );
    if (existingSnapshot.exists) {
      transaction.set(db.collection('developerSupportAudit').doc(), {
        action: 'stop',
        ...auditValues(uid, existingSnapshot.data(), now),
        createdAt: now,
      });
    }
    transaction.set(sessionRef, {
      teamId: input.teamId,
      mode: input.mode,
      reason: input.reason,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    transaction.set(db.collection('developerSupportAudit').doc(), {
      action: 'start',
      adminUid: uid,
      teamId: input.teamId,
      mode: input.mode,
      reason: input.reason,
      createdAt: now,
      expiresAt,
    });
    return { now, expiresAt };
  });

  return {
    userId: uid,
    teamId: input.teamId,
    mode: input.mode,
    reason: input.reason,
    startedAt: result.now.toDate().toISOString(),
    expiresAt: result.expiresAt.toDate().toISOString(),
  };
});
