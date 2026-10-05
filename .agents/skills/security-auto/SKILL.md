---
name: security-auto
description: Auto-activates when modifying authentication, API endpoints, file operations, or user input handling. Performs security review.
---

# Security Review Skill

This skill auto-activates when you modify security-sensitive code.

## Trigger Files/Patterns

- `api/*.ts` and `functions/src/*.ts` - API and Cloud Functions boundaries
- `utils/firebase.ts`, `components/contexts/AuthContext.tsx` - Firebase initialization and authentication
- `utils/services/*.ts` - Data persistence and access control
- `firestore.rules`, `firestore.indexes.json`, `storage.rules` - deployed access and query contracts
- Any file handling user input
- Any file with `fetch`, `axios`, or HTTP calls

## Security Checklist

### Input Validation

- [ ] All user inputs sanitized before use
- [ ] File paths validated (no path traversal)
- [ ] Query parameters escaped
- [ ] Form data validated on both client and server

### XSS Prevention

- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] User-provided URLs validated before rendering
- [ ] Text content escaped in templates
- [ ] No `eval()` or `new Function()` with user input

### Authentication & Authorization

- [ ] Auth tokens not logged or exposed
- [ ] Sensitive routes protected
- [ ] Session handling secure
- [ ] Firebase rules, indexes, and Storage access reviewed for every affected read/write path
- [ ] Team membership, role, workspace permission, and support-session boundaries enforced server-side or in rules

### Data Exposure

- [ ] No secrets in client-side code
- [ ] API keys not hardcoded (use environment variables)
- [ ] Error messages don't leak internal details
- [ ] Console.log statements don't expose sensitive data

### File Operations

- [ ] File uploads validated (type, size)
- [ ] File paths constructed safely
- [ ] No arbitrary file read/write from user input

## Quick Checks

```bash
# Find potential secrets
rg -n -g '*.ts' -g '*.tsx' "apiKey|secret|password|token" .

# Find dangerous patterns
rg -n -g '*.ts' -g '*.tsx' "dangerouslySetInnerHTML|eval\(" .

# Find console.logs that might leak data
rg -n -g '*.ts' -g '*.tsx' "console\.log" .
```

## Environment Variables

Required for production:
- `VITE_FIREBASE_*` - Firebase config
- `GEMINI_API_KEY` - Gemini optimization and parsing API key (server-side only)

Optional, feature-specific client configuration includes `VITE_MAPBOX_TOKEN`. Use `.env.example` as the current environment-variable reference.

**Never commit:**
- `.env` files with real values
- API keys in source code
- Credentials in comments

## Firebase Security and Release Boundary

If work changes Firestore document shapes, collections, queries,
authentication, roles, or write behavior:

1. Review the owning service and `docs/SCHEMA.md`.
2. Check `firestore.rules`, `firestore.indexes.json`, and `storage.rules` for
   matching changes.
3. Run focused application tests and the applicable emulator/rules tests.
4. Before calling a Firebase-backed release complete, compare repository rules
   with the rules deployed to the intended Firebase project. Emulator and local
   success do not prove production access.
5. Deploy rules only with explicit approval.
6. After an approved deployment, verify the deployed rules and perform an
   authenticated live write/read/read-back/cleanup check with the intended role
   and scope when practical.

If required rule changes remain undeployed, clearly report the release as
incomplete and likely to produce permission errors. Keep credentials, tokens,
user IDs, and team IDs out of logs and reports.

## Red Flags

Stop and fix immediately:
- Hardcoded API keys or secrets
- User input passed directly to file system operations
- SQL/NoSQL queries built with string concatenation
- Authentication bypasses or missing checks
- Sensitive data in URL parameters
