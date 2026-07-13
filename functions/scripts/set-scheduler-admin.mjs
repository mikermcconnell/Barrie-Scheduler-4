import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const readOption = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const email = readOption('--email')?.trim().toLowerCase();
const projectId = readOption('--project') || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const shouldGrant = args.includes('--grant');
const shouldRevoke = args.includes('--revoke');
const shouldApply = args.includes('--apply');

if (!email || !projectId || shouldGrant === shouldRevoke) {
  console.error(
    'Usage: node scripts/set-scheduler-admin.mjs --email user@example.com --project project-id (--grant|--revoke) [--apply]'
  );
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}

const auth = getAuth();
const user = await auth.getUserByEmail(email);
const existingClaims = user.customClaims ?? {};
const nextClaims = { ...existingClaims };

if (shouldGrant) {
  nextClaims.schedulerAdmin = true;
} else {
  delete nextClaims.schedulerAdmin;
}

console.log(`${shouldGrant ? 'Grant' : 'Revoke'} schedulerAdmin for ${email} (${user.uid}) in ${projectId}.`);
console.log(`Existing claim keys: ${Object.keys(existingClaims).sort().join(', ') || 'none'}`);

if (!shouldApply) {
  console.log('Dry run only. Re-run with --apply to make the change.');
  process.exit(0);
}

await auth.setCustomUserClaims(user.uid, nextClaims);
console.log('Claim updated. The user must sign out and sign back in before using developer access.');
