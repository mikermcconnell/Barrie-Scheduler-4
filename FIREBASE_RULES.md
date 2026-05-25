# Firebase Security Rules

This file is a high-level guide only.

The source of truth is:

- `firestore.rules`
- `storage.rules`

Do not paste old snippets into Firebase Console without checking those files first.

## Current Model

The app uses a mixed model:

- user-scoped data under `users/{userId}/`
- team-scoped shared data under `teams/{teamId}/`
- invite lookup under `teamInvites/{inviteCode}`
- role checks for owners and admins on team management operations
- team membership checks for shared schedules, analytics, storage assets, and imports
- global cross-team permission management requires a Firebase Auth custom claim, such as `schedulerAdmin: true`

### Firestore

`firestore.rules` currently covers:

- `users/{userId}` and subcollections for personal data
- `teamInvites/{inviteCode}` for invite lookup
- `teams/{teamId}` documents
- `teams/{teamId}/members`
- `teams/{teamId}/masterSchedules`
- `teams/{teamId}/transitAppData`
- `teams/{teamId}/performanceData`
- `teams/{teamId}/odMatrixData` and `imports`

Authorization should come from membership documents under `teams/{teamId}/members/{userId}`.
Do not rely on `users/{userId}.teamId` for authorization.

Cross-team team lookup and permission management should come from Firebase Auth custom claims, not from a user's own team role or workspace access level.

### Storage

`storage.rules` currently covers:

- `users/{userId}/...`
- `teams/{teamId}/masterSchedules/...`
- `teams/{teamId}/routeMaps/...`
- `teams/{teamId}/transitAppData/...`
- `teams/{teamId}/performanceData/...`
- `teams/{teamId}/odMatrixData/...`

## Apply Changes

Update the checked-in rule files first, then deploy from the repository root:

```powershell
npx firebase deploy --only firestore:rules,storage
```

If you prefer to publish in the Firebase Console, copy from the current local files, not from this Markdown summary.

## Maintenance Guidance

- If team membership behavior changes, update `firestore.rules` and this summary together.
- If new storage prefixes are introduced, update `storage.rules` and `docs/SCHEMA.md`.
- Keep this file explanatory. Avoid duplicating the full ruleset here.

## External Agency Onboarding Checklist

1. Open Team Management with a global admin account.
2. Use **Create partner team**.
3. Set the team name, optional custom code, and default access level.
4. Use the Developer Access Wizard to set the exact default workspace access and any user-specific overrides.
5. Use `transit-app-only` when the agency should see only Transit App Data; use `external-planner` when they need the external planning profile.
6. Copy the generated invite link and send that instead of a bare code.
7. Confirm each joined user has the expected role, access level, and workspace override set.
8. Rotate the invite code/link after onboarding.
9. Test with one agency account before sharing broadly.
