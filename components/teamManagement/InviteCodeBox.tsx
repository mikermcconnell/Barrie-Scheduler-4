import React, { useState } from 'react';
import { Check, Copy, Link } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { buildInviteLinkForCurrentLocation } from '../../utils/inviteLinks';

interface InviteCodeBoxProps {
    code: string;
    canEdit: boolean;
    /** Resolve true when the change was saved so the editor can close. */
    onRegenerate: () => Promise<boolean>;
    onSetCode: (code: string) => Promise<boolean>;
}

const iconButton = 'rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-100';
const textButton = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50';

export const InviteCodeBox: React.FC<InviteCodeBoxProps> = ({ code, canEdit, onRegenerate, onSetCode }) => {
    const toast = useToast();
    const [copied, setCopied] = useState<'code' | 'link' | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const copy = async (kind: 'code' | 'link'): Promise<void> => {
        try {
            await navigator.clipboard.writeText(kind === 'code' ? code : buildInviteLinkForCurrentLocation(code));
            setCopied(kind);
            toast?.success(kind === 'code' ? 'Invite code copied!' : 'Invite link copied!');
            setTimeout(() => setCopied(null), 2000);
        } catch {
            toast?.error(kind === 'code' ? 'Failed to copy code' : 'Failed to copy link');
        }
    };

    const run = async (action: () => Promise<boolean>): Promise<void> => {
        setSaving(true);
        try {
            if (await action()) setIsEditing(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex items-center gap-3">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Invite code</p>
                    <p className="font-mono text-xl font-black tracking-wider text-gray-950">{code}</p>
                </div>
                <div className="flex gap-1">
                    <button onClick={() => void copy('code')} className={iconButton} title="Copy code">
                        {copied === 'code' ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                    <button onClick={() => void copy('link')} className={iconButton} title="Copy invite link">
                        {copied === 'link' ? <Check size={16} /> : <Link size={16} />}
                    </button>
                </div>
                {canEdit && !isEditing && (
                    <button
                        onClick={() => {
                            setDraft(code);
                            setIsEditing(true);
                        }}
                        className={textButton}
                    >
                        Change
                    </button>
                )}
            </div>

            {canEdit && isEditing && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                        maxLength={6}
                        placeholder="BARRIE"
                        aria-label="New invite code"
                        className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-center font-mono text-sm uppercase tracking-wider"
                    />
                    <button
                        onClick={() => void run(() => onSetCode(draft))}
                        disabled={saving || draft.length !== 6}
                        className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => void run(onRegenerate)} disabled={saving} className={textButton}>
                        Generate new
                    </button>
                    <button onClick={() => setIsEditing(false)} disabled={saving} className={textButton}>
                        Cancel
                    </button>
                    <p className="w-full text-xs text-gray-500">Use exactly 6 letters or numbers. Old links stop working.</p>
                </div>
            )}
        </div>
    );
};
