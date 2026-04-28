# Implementation Plan: User Workspace Access Levels

Date: 2026-04-28

## Summary

Add a user-level workspace access system so selected users only see production-ready workspaces, while internal/admin users can still see unfinished or experimental workspaces.

This should sit beside the existing team roles. Team role controls what a user can do; access level controls what the user can see.

## Product Decision

Use access profiles instead of one-off booleans scattered through the UI.

Recommended profiles:

| Access level | Intended user | Default visibility |
| --- | --- | --- |
| `production` | Early real users / limited rollout | Production-ready workspaces only |
| `planner` | Trusted planning users | Production workspaces plus selected planning tools |
| `admin` | Team managers | Planner access plus team/admin surfaces |
| `internal` | Mike / developers / testers | Everything, including unfinished workspaces |

Keep `TeamRole` separate:

- `owner`, `admin`, `member` = permissions and data writes
- `accessLevel` = visible app/workspace surfaces

## Proposed Production Workspace Set

Initial conservative rollout:

- Show to `production`:
  - Scheduled Transit / Fixed Route
  - Dashboard & Reporting / Operations
- Hide from `production`:
  - Transit On-Demand, unless Mike confirms it is production-ready
  - OD Matrix
  - Corridor Speed/Headway
  - Fleet Plan
  - Route Planner
  - Shuttle Planner
  - Network Connections
  - Route 8 Sandbox
  - other experimental analytics

This mapping should be easy to change in one file.

## Data Model

Extend team member documents:

```ts
type WorkspaceAccessLevel = 'production' | 'planner' | 'admin' | 'internal';

type WorkspaceKey =
  | 'workspaceFixedRoute'
  | 'workspaceOperations'
  | 'workspaceOndemand'
  | 'analyticsTransitApp'
  | 'analyticsOdMatrix'
  | 'analyticsCorridorSpeed'
  | 'analyticsCorridorHeadway'
  | 'analyticsStudentPass'
  | 'analyticsFleetPlan'
  | 'analyticsNetworkConnections'
  | 'analyticsRoutePlanner'
  | 'analyticsShuttlePlanner'
  | 'analyticsRoute8Sandbox';

interface TeamMember {
  role: TeamRole;
  accessLevel?: WorkspaceAccessLevel;
  workspaceOverrides?: Partial<Record<WorkspaceKey, boolean>>;
}
```

Defaults:

- New team creator: `internal`
- New invited member: `production`
- Existing members with no field:
  - owner/admin: treat as `internal` for backward compatibility
  - member: treat as `production`

## Affected Files

### New files

- `utils/workspaceAccess.ts`
  - central workspace registry
  - profile-to-workspace mapping
  - helper functions like `canAccessWorkspace()` and `resolveAccessLevel()`
- `hooks/useWorkspaceAccess.ts` or `utils/workspaceAccessContext.ts`
  - React-facing access lookup using current team/member state
- `tests/workspaceAccess.test.ts`
  - profile mapping and fallback tests

### Existing files

- `utils/masterScheduleTypes.ts`
  - add `WorkspaceAccessLevel`, `WorkspaceKey`, optional member access fields
- `utils/services/teamService.ts`
  - persist default access level on create/join
  - read access fields in `getTeamMember()` and `getTeamWithMembers()`
  - add update helper for owner/admin to change a member access level
- `components/contexts/TeamContext.tsx`
  - expose current `teamMember`, `accessLevel`, and/or workspace access helper
- `App.tsx`
  - replace global-only `isAppViewEnabled()` checks with global flag + user workspace access
  - block direct hash navigation to hidden top-level workspaces
- `components/Analytics/AnalyticsDashboard.tsx`
  - hide cards the current user cannot access
  - block internal view transitions if access changes while open
- `components/TeamManagement.tsx`
  - show each member's access level
  - let owner/admin update access level
  - make the difference between role and access level clear in the UI
- `firestore.rules`
  - if enforcing data access, add helper checks for workspace-backed collections
  - at minimum, ensure only owner/admin can edit member access fields
- `storage.rules`
  - mirror any data-level workspace restrictions where storage paths expose hidden workspace data
- `tests/securityRules.regression.test.ts`
  - add checks around member access update rules if rules are changed
- `docs/SCHEMA.md`
  - document `TeamMember.accessLevel` and `workspaceOverrides`
- `docs/ARCHITECTURE.md`
  - note the central workspace access registry if this ships

## Implementation Steps

### Phase 1: Central registry and pure logic

1. Create `utils/workspaceAccess.ts`.
2. Define all workspace keys in one place.
3. Map access levels to allowed workspace keys.
4. Keep existing environment feature flags as a second layer:
   - workspace is visible only if feature flag is enabled AND user access allows it.
5. Add unit tests for:
   - production users see only production workspaces
   - internal users see all enabled workspaces
   - owner/admin fallback remains permissive for existing users
   - explicit `workspaceOverrides` can allow/block a specific workspace

### Phase 2: Team member data support

1. Extend `TeamMember` type.
2. Update `createTeam()` to set creator access to `internal`.
3. Update `joinTeamByInviteCode()` to set new members to `production`.
4. Update team/member read functions to return access fields.
5. Add `updateMemberAccessLevel(teamId, memberId, accessLevel)`.
6. Keep role updates separate from access updates.

### Phase 3: App shell gating

1. Update `TeamContext` to expose current member access.
2. Update `App.tsx` so home cards respect workspace access.
3. Update hash parsing so hidden workspaces redirect to `home`.
4. Avoid showing a blocked workspace during loading; show a short loading/redirect state.

### Phase 4: Analytics workspace gating

1. Update `AnalyticsDashboard` to use the same access helper.
2. Hide blocked analytics cards.
3. Prevent direct state transitions into blocked analytics views.
4. If a user loses access while inside a workspace, return them to the analytics dashboard.

### Phase 5: Team Management UI

1. Add an “Access level” column/control beside role.
2. Use friendly labels:
   - Production only
   - Planner
   - Admin workspace access
   - Internal/testing
3. Add helper text: “Role controls permissions. Access level controls visible workspaces.”
4. Restrict edits to owner/admin.
5. Avoid letting an owner accidentally remove their own ability to manage the team without a confirmation.

### Phase 6: Optional hard security enforcement

UI gating is enough to keep users from seeing unfinished workspaces. It is not enough for sensitive data.

If hidden workspaces expose sensitive data, add Firestore/Storage rule enforcement for those collections. Suggested first pass:

- Always enforce member-only team boundaries as today.
- Keep production fixed-route and operations data readable by normal team members if those are production surfaces.
- Restrict experimental workspace collections/storage to `planner`, `admin`, or `internal` as appropriate.
- Add regression tests for the rule helpers.

Do not overcomplicate rules if the first goal is rollout hygiene rather than strict data secrecy.

### Phase 7: Docs and migration notes

1. Update `docs/SCHEMA.md` with the new member fields.
2. Update `docs/ARCHITECTURE.md` with the workspace access layer.
3. Add a short admin note describing recommended launch setup:
   - Mike/internal users = `internal`
   - early real users = `production`
   - trusted planners = `planner`
4. No bulk migration is required if the app has safe fallbacks for missing `accessLevel`.

## Testing Plan

Run at minimum:

```bash
npm run test -- workspaceAccess
npm run test -- securityRules.regression
npm run build
```

Manual checks:

1. Sign in as owner/admin with no explicit access level: should still see everything.
2. Set a member to `production`: they should only see production workspace cards.
3. Try direct hash navigation to hidden top-level workspace, e.g. `#ondemand`: should redirect to home.
4. Open Analytics as `production`: hidden cards should not render.
5. Promote user to `planner` or `internal`: newly allowed cards should appear after refresh/team reload.
6. Confirm role permissions still work independently of access level.

## Risks and Mitigations

- Risk: users are locked out accidentally.
  - Mitigation: permissive fallback for owner/admin, and clear Team Management controls.
- Risk: feature flags and access profiles drift.
  - Mitigation: centralize all workspace keys and tests in `utils/workspaceAccess.ts`.
- Risk: UI hiding is mistaken for security.
  - Mitigation: document the distinction and add Firestore/Storage enforcement only where data sensitivity requires it.
- Risk: unfinished workspace can still be reached through old state.
  - Mitigation: gate both cards and view transitions.

## PM Review Outcome

Recommendation: APPROVE WITH CHANGES.

Required changes before implementation:

1. Keep the first version simple: access profiles plus optional overrides, not a complex permissions builder.
2. Do not merge role and access level; they solve different problems.
3. Use safe fallbacks so current admins are not locked out.
4. Treat security-rule enforcement as a deliberate second layer, not as a blocker for hiding unfinished workspaces.

## Open Questions for Mike

1. Is Transit On-Demand production-ready, or should it be hidden from `production` users for now?
2. Should `planner` include Transit App Data and Fleet Plan by default?
3. Should production users have read-only access in some workspaces, or should hidden/visible be the first milestone?
