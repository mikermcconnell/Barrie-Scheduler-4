Inspect `git status` and perform a findings-first security audit of the requested
scope. Do not modify, deploy, or expose secrets unless separately asked. Check:
- XSS vulnerabilities
- query and injection risks
- Unsafe file operations
- Exposed API keys or secrets
- CSRF vulnerabilities
- Input validation issues
- Authentication, team membership, role, workspace, and support-session boundaries
- Firestore rules, required indexes, and Storage rules for affected data paths

For Firebase-backed release review, compare repository rules with the rules
deployed to the intended project. Treat emulator-only results as local evidence,
not production proof. Deploy only with explicit approval; after an approved
deployment, verify the deployed rules and an authenticated live
read/write/read-back check without printing credentials or identifiers.
