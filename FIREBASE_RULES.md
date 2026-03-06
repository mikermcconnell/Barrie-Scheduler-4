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
- role checks for owners and admins on team management operations
- team membership checks for shared schedules, analytics, storage assets, and imports

### Firestore

`firestore.rules` currently covers:

- `users/{userId}` and subcollections for personal data
- `teams/{teamId}` documents
- `teams/{teamId}/members`
- `teams/{teamId}/masterSchedules`
- `teams/{teamId}/transitAppData`
- `teams/{teamId}/performanceData`
- `teams/{teamId}/odMatrixData` and `imports`

The checked-in rules do not currently include a dedicated `teams/{teamId}/connectionLibrary` match.
If Connection Library is relied on in production, update `firestore.rules` and `docs/SCHEMA.md` together.

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
