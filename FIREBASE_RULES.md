# Firebase Security Rules

Since you started Firebase in **production mode**, you need to configure security rules.

## Firestore Rules

Go to **Firebase Console → Firestore → Rules** and paste:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Storage Rules

Go to **Firebase Console → Storage → Rules** and paste:

```javascript
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // Users can only access their own files
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## What These Rules Do

1. **Authentication Required**: Only logged-in users can read/write data
2. **User Isolation**: Each user can only access files and data in their own `users/{userId}/` path
3. **Complete Protection**: No unauthenticated access, no cross-user access

## To Apply

1. Copy each rule set
2. Go to Firebase Console → Firestore/Storage → Rules tab
3. Paste and click "Publish"
