import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query,
    orderBy,
    where,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject,
    listAll
} from 'firebase/storage';
import { db, storage } from './firebase';
import type { Shift, Requirement } from '../types';

// Types for saved data
export interface SavedSchedule {
    id: string;
    name: string;
    description?: string;
    status: 'draft' | 'published' | 'archived';
    shiftData: Shift[];
    masterScheduleData: Requirement[];
    schedulesData?: Record<string, Requirement[]>;
    createdAt: Date;
    updatedAt: Date;
}

export interface SavedFile {
    id: string;
    name: string;
    type: 'schedule_master' | 'rideco' | 'barrie_tod' | 'other';
    storagePath: string;
    downloadUrl: string;
    size: number;
    uploadedAt: Date;
}

// ============ SCHEDULES ============

export const saveSchedule = async (
    userId: string,
    schedule: Omit<SavedSchedule, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> => {
    const schedulesRef = collection(db, 'users', userId, 'schedules');
    const newDocRef = doc(schedulesRef);

    await setDoc(newDocRef, {
        ...schedule,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    return newDocRef.id;
};

export const updateSchedule = async (
    userId: string,
    scheduleId: string,
    updates: Partial<Omit<SavedSchedule, 'id' | 'createdAt'>>
): Promise<void> => {
    const scheduleRef = doc(db, 'users', userId, 'schedules', scheduleId);
    await setDoc(scheduleRef, {
        ...updates,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

export const getSchedule = async (
    userId: string,
    scheduleId: string
): Promise<SavedSchedule | null> => {
    const scheduleRef = doc(db, 'users', userId, 'schedules', scheduleId);
    const snapshot = await getDoc(scheduleRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();
    return {
        id: snapshot.id,
        ...data,
        createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
        updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date()
    } as SavedSchedule;
};

export const getAllSchedules = async (userId: string): Promise<SavedSchedule[]> => {
    const schedulesRef = collection(db, 'users', userId, 'schedules');
    const q = query(schedulesRef, orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date()
        } as SavedSchedule;
    });
};

export const deleteSchedule = async (
    userId: string,
    scheduleId: string
): Promise<void> => {
    const scheduleRef = doc(db, 'users', userId, 'schedules', scheduleId);
    await deleteDoc(scheduleRef);
};

// ============ FILES ============

export const uploadFile = async (
    userId: string,
    file: File,
    fileType: SavedFile['type']
): Promise<SavedFile> => {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `users/${userId}/files/${timestamp}_${safeName}`;

    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, file);
    const downloadUrl = await getDownloadURL(fileRef);

    // Save metadata to Firestore
    const filesRef = collection(db, 'users', userId, 'files');
    const newDocRef = doc(filesRef);

    const fileData: Omit<SavedFile, 'id'> = {
        name: file.name,
        type: fileType,
        storagePath,
        downloadUrl,
        size: file.size,
        uploadedAt: new Date()
    };

    await setDoc(newDocRef, {
        ...fileData,
        uploadedAt: serverTimestamp()
    });

    return {
        id: newDocRef.id,
        ...fileData
    };
};

export const getAllFiles = async (userId: string): Promise<SavedFile[]> => {
    const filesRef = collection(db, 'users', userId, 'files');
    const q = query(filesRef, orderBy('uploadedAt', 'desc'));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            ...data,
            uploadedAt: (data.uploadedAt as Timestamp)?.toDate() || new Date()
        } as SavedFile;
    });
};

export const deleteFile = async (
    userId: string,
    fileId: string,
    storagePath: string
): Promise<void> => {
    // Delete from Storage
    const fileRef = ref(storage, storagePath);
    try {
        await deleteObject(fileRef);
    } catch (err) {
        console.warn('File may already be deleted from storage:', err);
    }

    // Delete metadata from Firestore
    const fileDocRef = doc(db, 'users', userId, 'files', fileId);
    await deleteDoc(fileDocRef);
};

// ============ FILE CONTENT ============

export const downloadFileContent = async (downloadUrl: string): Promise<string> => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
        // On localhost, use the serverless proxy to bypass CORS
        console.log('Using proxy for localhost download...');
        const response = await fetch('/api/download-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ downloadUrl })
        });

        if (!response.ok) {
            throw new Error(`Proxy download failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Download failed');
        }

        return data.content;
    }

    // On deployed version, direct fetch works fine
    const response = await fetch(downloadUrl);
    return response.text();
};

export const downloadFileArrayBuffer = async (downloadUrl: string): Promise<ArrayBuffer> => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
        console.log('Using proxy for localhost binary download...');
        try {
            const response = await fetch('/api/download-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ downloadUrl, format: 'base64' })
            });

            if (!response.ok) throw new Error(`Proxy download failed: ${response.status}`);

            const data = await response.json();
            if (!data.success) throw new Error(data.error || 'Download failed');

            // Decode Base64 to ArrayBuffer
            const binaryString = atob(data.content);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        } catch (e) {
            console.error("Proxy binary download error:", e);
            throw e;
        }
    }

    const response = await fetch(downloadUrl);
    return response.arrayBuffer();
};
