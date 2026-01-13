---
name: security-auto
description: Auto-activates when modifying authentication, API endpoints, file operations, or user input handling. Performs security review.
---

# Security Review Skill

This skill auto-activates when you modify security-sensitive code.

## Trigger Files/Patterns

- `api/*.ts` - API endpoints
- `firebase*.ts` - Authentication/database
- `dataService.ts` - Data persistence
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
- [ ] Firebase security rules reviewed if modified

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
grep -rn "apiKey\|secret\|password\|token" --include="*.ts" --include="*.tsx"

# Find dangerous patterns
grep -rn "dangerouslySetInnerHTML\|eval(" --include="*.ts" --include="*.tsx"

# Find console.logs that might leak data
grep -rn "console.log" --include="*.ts" --include="*.tsx"
```

## Environment Variables

Required for production:
- `VITE_FIREBASE_*` - Firebase config
- `ANTHROPIC_API_KEY` - Claude API (server-side only!)

**Never commit:**
- `.env` files with real values
- API keys in source code
- Credentials in comments

## Firebase Security Rules

If modifying Firestore access:
1. Review `firestore.rules`
2. Ensure rules match intended access patterns
3. Test with Firebase emulator

## Red Flags

Stop and fix immediately:
- Hardcoded API keys or secrets
- User input passed directly to file system operations
- SQL/NoSQL queries built with string concatenation
- Authentication bypasses or missing checks
- Sensitive data in URL parameters
