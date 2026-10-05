# Firebase Security Rules

This file is a high-level guide only.

The source of truth is:

- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- `firebase.json` for the deployed rule and index file bindings

Do not paste old snippets into Firebase Console without checking those files first.

## Current Model

The app uses a mixed model:

- user-scoped data under `users/{userId}/`
- team-scoped shared data under `teams/{teamId}/`
- invite lookup under `teamInvites/{inviteCode}`
- role checks for owners and admins on team management operations
- team membership checks for shared schedules, analytics, storage assets, and imports
- global team discovery and All uploads require the namespaced Firebase Auth custom claim `schedulerAdmin: true`
- cross-team team-data access additionally requires an active `developerSupportSessions/{uid}` record for that team

### Firestore

`firestore.rules` currently covers:

- user profiles, File Manager metadata, and the explicit user-scoped schedule,
  draft, project, and shuttle collections
- team documents, members, invites, scheduler-admin support sessions, and the
  append-only support audit
- Master Schedules and versions, schedule-review metadata, Detour Publisher
  notices/overlays/publications, platform settings, passenger-capacity settings,
  connections, and public timetable settings
- Transit App, STREETS performance metadata, TOD pickup data, Parking,
  performance snapshots, OD Matrix and imports, Residential Growth and imports,
  Fleet Plan and versions, Camp Shuttle Planner projects/scenarios/runtime
  snapshots, Council Intelligence, and Route Concept Planner

`teams/{teamId}/performanceImports/{importId}` and root `mail/{mailId}` records
are created by trusted server code through the Admin SDK. They have no ordinary
client rule grant; the generic team fallback grants only an active scoped
developer-support session access to unmatched team paths.

Authorization should come from membership documents under `teams/{teamId}/members/{userId}`.
Do not rely on `users/{userId}.teamId` for authorization.

Team document updates and deletes are limited to team owners/admins and scheduler administrators with an active team-scoped edit session.
`dataSourceTeamIds` is an exception: cross-team source links require the scoped scheduler-admin edit session so a team cannot authorize itself to another team's data.
Direct team document reads are also allowed during authenticated invite joins so the client can recover default join access for older invite lookup documents. Team collection listing remains limited to global workspace permission managers.
Users can only create their own team membership through a valid invite lookup or as the initial owner of a team they are creating; knowing a team ID alone is not enough.
The `none` workspace access profile grants no workspace reads/writes; it is intended for brand-new users and new self-created teams until access is explicitly granted in Team Management.

Cross-team authority must not be inferred from a user's own team role or `internal` workspace profile. Inspect sessions are read-only. Edit sessions require a reason, are audited, default to 30 minutes, and expire within 60 minutes.

Grant or revoke the namespaced claim from `functions/` using Application Default Credentials. The command is a dry run unless `--apply` is supplied:

```powershell
npm --prefix functions run admin:scheduler -- --email user@example.com --project barrie-scheduler-7844a --grant --apply
```

The user must sign out and sign back in after the claim changes.

### Storage

`storage.rules` currently covers:

- user-owned File Manager uploads, legacy drafts, current drafts, system drafts,
  and New Schedule project payloads
- team Master Schedules, immutable schedule-review payloads, route maps,
  Transit App data, STREETS summaries, compact Load Profiles views, TOD pickup
  data, Parking usage/revenue, OD Matrix data, Fleet Plan, and Residential Growth
- a generic team path fallback limited to an active scoped developer-support
  session; it does not grant ordinary members access to new prefixes

## Test Changes

Run the checked-in static rule regression suite for every rule change:

```powershell
npx vitest run tests/securityRules.regression.test.ts
```

For Firestore behavior covered by the emulator integration suites, also run:

```powershell
npm run test:firestore-rules
```

The emulator suite currently exercises Route Concept Planner and Detour
Publisher rules. Add or extend emulator tests when a changed rule is not covered
by those scenarios. Static checks and emulator tests do not prove what is
deployed.

## Apply Changes

Update and test the checked-in rule files first. Deploy only with explicit
approval and only to the confirmed intended Firebase project. From the
repository root, the rule-only command is:

```powershell
npx firebase deploy --project <project-id> --only firestore:rules,firestore:indexes,storage
```

If you prefer to publish in the Firebase Console, copy from the current local files, not from this Markdown summary.

Before calling a Firebase-backed release complete:

1. Confirm the intended Firebase project and compare its active Firestore and
   Storage rules with `firestore.rules` and `storage.rules` using the Firebase
   Console or Rules API. Do not assume a committed rules file is deployed.
2. If a rules change is required, deploy it only after explicit approval.
3. Re-open the active deployed rules and confirm they match the intended local
   rules after deployment.
4. With an authenticated live test account, perform the affected read or write,
   read back the written value, verify one relevant denied operation when
   practical, and clean up test data.

An emulator pass, local app test, or successful deploy command alone is not
proof of live authenticated access or persistence.

## Maintenance Guidance

- If team membership behavior changes, update `firestore.rules` and this summary together.
- If a query shape changes, check `firestore.indexes.json` and verify the
  required index is active in the intended project.
- If new storage prefixes are introduced, update `storage.rules` and `docs/SCHEMA.md`.
- Keep this file explanatory. Avoid duplicating the full ruleset here.

## External Agency Onboarding Checklist

1. Open Team Management with a global admin account.
2. Use **Create partner team**.
3. Set the team name, optional custom code, and default access level.
4. Use the Developer Access Wizard to set the exact default workspace access and any user-specific overrides.
5. Use `external-planner` or `transit-app-only` when the agency should see only Transit App Data.
6. Copy the generated invite link and send that instead of a bare code.
7. Confirm each joined user has the expected role, access level, and workspace override set.
8. Rotate the invite code/link after onboarding.
9. Test with one agency account before sharing broadly.
