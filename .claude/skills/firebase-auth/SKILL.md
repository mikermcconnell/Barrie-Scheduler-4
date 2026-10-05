---
name: firebase-auth
description: Use when working on Firebase services, authentication, persistence, security rules, indexes, or Storage access.
---

## Firebase Integration

### Architecture

| Service | Purpose | Key Files |
|---------|---------|-----------|
| Firebase initialization | Client SDK setup | `utils/firebase.ts` |
| Firestore | User- and team-scoped metadata | `utils/services/`, `firestore.rules`, `firestore.indexes.json` |
| Storage | Large JSON, CSV, images, and generated payloads | `utils/services/`, `storage.rules` |
| Auth | User authentication | `components/contexts/AuthContext.tsx`, `components/modals/AuthModal.tsx` |

### Storage Strategy

Many large workspaces use this pattern because Firestore documents have a 1 MB
limit:
- **Metadata/pointers**: Firestore
- **Large payload**: Firebase Storage
- **Safe flow**: upload a unique Storage object, commit its Firestore pointer,
  then clean up only the superseded or uncommitted object

Do not generalize one service's path or ownership model to every feature. Use
`docs/SCHEMA.md` to identify whether the record is user-scoped, team-scoped, or
global, and verify the owning service before changing it.

### User Types

| Type | Data Location | Behavior |
|------|---------------|----------|
| Guest | Feature-specific local state where supported | No authenticated cloud access |
| Authenticated | User- or team-scoped Firebase paths | Access still depends on membership, role, workspace permissions, and rules |

### Fixed-Route Draft Services

- `utils/services/draftService.ts`: current user-scoped `draftSchedules` and checkpoints
- `utils/services/systemDraftService.ts`: current user-scoped multi-route `systemDrafts`
- `utils/services/masterScheduleService.ts`: team-scoped published schedules and versions
- `utils/services/dataService.ts`: legacy `scheduleDrafts`, saved files, and Transit On Demand persistence

### Rule and Query Change Checklist

When changing document shapes, collections, queries, authentication, access
roles, or write behavior:

1. Read `docs/SCHEMA.md` and the owning service.
2. Check `firestore.rules`, `firestore.indexes.json`, and `storage.rules` for
   required matching changes. Do not rely on broad example rules.
3. Add or update focused application and emulator/rules tests.
4. Before calling a Firebase-backed release complete, compare the repository
   rules with the rules deployed to the intended Firebase project. Local files
   and emulator tests do not prove deployment.
5. Deploy rules only with explicit user approval.
6. After an approved deployment, verify the deployed rules and perform an
   authenticated live write, read-back, and cleanup using the intended role and
   scope when practical. Never expose credentials, auth tokens, user IDs, or
   team IDs in reports.

If required rule changes were not deployed, report the release as incomplete
and likely to produce permission errors.

### Common Issues

- **CORS errors**: Check `cors.json` configuration
- **1MB limit**: Ensure large data goes to Storage, not Firestore
- **Auth state**: Use `onAuthStateChanged` listener
- **Permission denied**: Verify the authenticated user's membership, role,
  workspace access, exact query shape, deployed rules, and Storage path
