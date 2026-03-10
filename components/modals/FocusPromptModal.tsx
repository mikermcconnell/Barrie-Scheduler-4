import React, { useState } from 'react';
import { AlertTriangle, Sparkles, X } from 'lucide-react';

interface Props {
    onCancel: () => void;
    onOptimize: (instruction: string) => void;
    initialInstruction?: string;
}

export const FocusPromptModal: React.FC<Props> = ({ onCancel, onOptimize, initialInstruction = '' }) => {
    const [instruction, setInstruction] = useState(initialInstruction);

    const handleSubmit = () => {
        onOptimize(instruction);
    };

    return (
        // z-[10000] ensures focus prompt modal appears above fullscreen container (z-[9999])
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            {/* Modal Container */}
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-indigo-100 flex flex-col">

                {/* Header */}
                <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                    <div>
                        <h3 className="text-lg font-extrabold text-indigo-900 flex items-center gap-2">
                            <Sparkles size={20} className="text-indigo-600" />
                            Refine Schedule
                        </h3>
                        <p className="text-xs font-bold text-indigo-400">Guide the optimization with specific goals.</p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-1 rounded-full text-indigo-300 hover:bg-indigo-100 hover:text-indigo-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                        Focus Instructions (Optional)
                    </label>
                    <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="e.g. 'Match the master schedule closely', 'Eliminate peak gaps', 'Allow only rare 30-minute single-bus gaps if they improve the full-day schedule'..."
                        rows={4}
                        autoFocus
                        className="w-full text-sm p-3 rounded-xl border-2 border-indigo-100 bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none resize-none shadow-sm transition-all placeholder:text-gray-300 mb-4"
                    />

                    {/* Quick Prompts */}
                    <div className="mb-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">Quick Prompts</span>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { label: 'Match Master', text: 'Match the master schedule as closely as possible in every 15-minute slot.' },
                                { label: 'Peak Coverage', text: 'Eliminate peak-period gaps first, even if it means accepting small off-peak surplus.' },
                                { label: 'Minor Gaps Only', text: 'Allow only rare 1-bus gaps for a maximum of 2 consecutive 15-minute slots, and only if the overall schedule is clearly better.' },
                                { label: 'Break Coverage', text: 'Keep breaks compliant and staggered without creating same-zone service gaps.' }
                            ].map((prompt) => (
                                <button
                                    key={prompt.label}
                                    onClick={() => setInstruction(prompt.text)}
                                    className="text-xs font-bold px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 hover:scale-105 active:scale-95 transition-all"
                                >
                                    {prompt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl active:scale-95 transition-all flex items-center gap-2"
                    >
                        <Sparkles size={16} />
                        Start Optimization
                    </button>
                </div>

            </div>
        </div>
    );
};
