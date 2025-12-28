---
name: firebase-auth
description: Use when working on dataService.ts, firebase.ts, auth, storage, or security rules. Handles data persistence and authentication.
---

## Firebase Integration

### Architecture

| Service | Purpose | Key Files |
|---------|---------|-----------|
| Firestore | Metadata storage | `dataService.ts`, `firestore.rules` |
| Storage | Large JSON/images | `dataService.ts`, `storage.rules` |
| Auth | User authentication | `AuthContext.tsx`, `AuthModal.tsx` |

### Storage Strategy

Due to Firestore's 1MB document limit:
- **Metadata**: Stored in Firestore (draft name, timestamps, userId)
- **Schedule JSON**: Uploaded to Firebase Storage
- **Flow**: Save → Upload to Storage → Store metadata in Firestore

### User Types

| Type | Data Location | Behavior |
|------|---------------|----------|
| Guest | localStorage only | No cloud sync |
| Authenticated | Firebase | Cloud sync across devices |

### Key Functions in dataService.ts

- `saveDraft()`: Upload JSON to Storage, save metadata to Firestore
- `getDraft()`: Fetch metadata, download JSON from Storage
- `saveDraftVersion()`: Store version history
- `restoreDraftVersion()`: Rollback to previous version

### Security Rules Pattern

```javascript
// Firestore
match /users/{userId}/drafts/{draftId} {
  allow read, write: if request.auth.uid == userId;
}

// Storage
match /users/{userId}/{allPaths=**} {
  allow read, write: if request.auth.uid == userId;
}
```

### Common Issues

- **CORS errors**: Check `cors.json` configuration
- **1MB limit**: Ensure large data goes to Storage, not Firestore
- **Auth state**: Use `onAuthStateChanged` listener
