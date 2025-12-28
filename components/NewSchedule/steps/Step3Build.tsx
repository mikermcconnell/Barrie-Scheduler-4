
import React from 'react';
import { TimeBand } from '../utils/runtimeAnalysis';
import { Clock, Bus, Plus, Trash2, LayoutGrid } from 'lucide-react';

export interface BlockConfig {
    id: string; // "100-1"
    startTime: string; // "06:00"
    endTime: string; // "20:00"
}

export interface ScheduleConfig {
    routeNumber: string;
    cycleMode?: 'Strict' | 'Floating'; // New
    cycleTime: number;
    recoveryRatio?: number; // percent, e.g. 15
    recoveryDistribution?: 'End' | 'Proportional';
    // Headway is now calculated
    blocks: BlockConfig[];
}

interface Step3Props {
    dayType: string;
    bands: TimeBand[];
    config: ScheduleConfig;
    setConfig: (c: ScheduleConfig) => void;
}

export const Step3Build: React.FC<Step3Props> = ({ dayType, bands, config, setConfig }) => {

    // Helper to add minutes to HH:MM time string
    const addMinutes = (timeStr: string, minutes: number): string => {
        const [h, m] = timeStr.split(':').map(Number);
        const date = new Date();
        date.setHours(h, m, 0, 0);
        date.setMinutes(date.getMinutes() + minutes);
        return date.toTimeString().slice(0, 5);
    };

    // Auto-calculate subsequent block start times whenever head/config changes
    React.useEffect(() => {
        if (config.blocks.length <= 1) return;

        const cycleTime = config.cycleTime;
        const computedHeadway = config.blocks.length > 0 ? cycleTime / config.blocks.length : 0;

        let changed = false;
        const newBlocks = [...config.blocks];
        const baseStartTime = newBlocks[0].startTime;

        for (let i = 1; i < newBlocks.length; i++) {
            const offset = Math.round(computedHeadway * i); // Use round to get nearest minute
            const expectedStart = addMinutes(baseStartTime, offset);

            if (newBlocks[i].startTime !== expectedStart) {
                newBlocks[i] = { ...newBlocks[i], startTime: expectedStart };
                changed = true;
            }
        }

        if (changed) {
            setConfig({ ...config, blocks: newBlocks });
        }
    }, [config.cycleTime, config.blocks.length, config.blocks[0]?.startTime]);

    const addBlock = () => {
        const nextNum = config.blocks.length + 1;
        const newBlock: BlockConfig = {
            id: `${config.routeNumber || '10'}-${nextNum}`,
            startTime: '06:00',
            endTime: '22:00'
        };
        setConfig({
            ...config,
            blocks: [...config.blocks, newBlock]
        });
    };

    const removeBlock = (index: number) => {
        const newBlocks = [...config.blocks];
        newBlocks.splice(index, 1);
        setConfig({ ...config, blocks: newBlocks });
    };

    const updateBlock = (index: number, field: keyof BlockConfig, value: string) => {
        const newBlocks = [...config.blocks];
        newBlocks[index] = { ...newBlocks[index], [field]: value };
        setConfig({ ...config, blocks: newBlocks });
    };

    const cycleTime = config.cycleTime;
    const computedHeadway = config.blocks.length > 0 ? cycleTime / config.blocks.length : 0;

    return (
        <div className="h-full flex flex-col animate-in fade-in duration-500 overflow-hidden">
            <div className="flex justify-between items-start mb-6 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Build Schedule</h2>
                    <p className="text-gray-500">
                        Define your service parameters for <strong>{dayType}</strong>.
                    </p>
                </div>

                {/* Time Band Legend (Reference) */}
                <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                    <span className="text-xs font-bold text-gray-400 uppercase mr-2">Band References</span>
                    {bands.map(band => (
                        <div key={band.id} className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                            <span className="text-xs font-bold text-gray-700 whitespace-nowrap">
                                {band.id} <span className="text-gray-400 font-normal">({band.avg.toFixed(0)}m)</span>
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">

                {/* Left Column: Global Config */}
                <div className="lg:col-span-4 flex flex-col gap-4 overflow-y-auto pr-1">
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Bus className="text-brand-blue" size={20} />
                            <h3 className="text-md font-bold text-gray-900">Route Configuration</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-1">
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Route #</label>
                                <input
                                    type="text"
                                    value={config.routeNumber}
                                    onChange={e => setConfig({ ...config, routeNumber: e.target.value })}
                                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-gray-800 text-sm"
                                    placeholder="e.g. 100"
                                />
                            </div>

                            <div className="col-span-1">
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Recov. Dist.</label>
                                <select
                                    value={config.recoveryDistribution || 'End'}
                                    onChange={e => setConfig({ ...config, recoveryDistribution: e.target.value as 'End' | 'Proportional' })}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-gray-800 text-xs"
                                >
                                    <option value="End">End Only</option>
                                    <option value="Proportional">Proportional</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cycle Mode</label>
                            <div className="flex bg-gray-100 p-1 rounded-lg mb-3">
                                <button
                                    onClick={() => setConfig({ ...config, cycleMode: 'Strict' })}
                                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${(!config.cycleMode || config.cycleMode === 'Strict') ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Strict
                                </button>
                                <button
                                    onClick={() => setConfig({ ...config, cycleMode: 'Floating' })}
                                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${config.cycleMode === 'Floating' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Floating
                                </button>
                            </div>

                            {config.cycleMode === 'Floating' ? (
                                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Reference Cycle</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={config.cycleTime}
                                                onChange={e => setConfig({ ...config, cycleTime: parseInt(e.target.value) || 0 })}
                                                className="w-full pl-8 px-2 py-1.5 border border-gray-200 bg-gray-50 rounded-lg text-gray-600 font-medium text-sm"
                                            />
                                            <Clock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-brand-blue uppercase mb-1">Target Recov.</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={config.recoveryRatio || 15}
                                                onChange={e => setConfig({ ...config, recoveryRatio: parseInt(e.target.value) || 0 })}
                                                className="w-full pl-3 pr-6 py-1.5 border border-brand-blue/30 bg-blue-50/50 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-brand-blue text-sm"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-blue/50 font-bold text-xs">%</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Strict Cycle Time</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={config.cycleTime}
                                            onChange={e => setConfig({ ...config, cycleTime: parseInt(e.target.value) || 0 })}
                                            className="w-full pl-9 px-3 py-2 border border-brand-blue/30 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-gray-900 text-lg shadow-sm"
                                        />
                                        <Clock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-blue" />
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1">Total round-trip time (min)</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Calculated Stats (Compact) */}
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex flex-col gap-2">
                        <h3 className="text-xs font-bold text-blue-800 uppercase">Service Metrics</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className="text-xs text-blue-600 font-medium block">Headway</span>
                                <span className="text-xl font-bold text-blue-900">
                                    {Number.isInteger(computedHeadway) ? computedHeadway : computedHeadway.toFixed(1)}
                                    <span className="text-xs font-normal ml-0.5">m</span>
                                </span>
                            </div>
                            <div>
                                <span className="text-xs text-blue-600 font-medium block">Blocks</span>
                                <span className="text-xl font-bold text-blue-900">{config.blocks.length}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Block Definitions */}
                <div className="lg:col-span-8 flex flex-col h-full min-h-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <LayoutGrid size={20} className="text-gray-400" />
                            Block Configuration
                        </h3>
                        <button
                            onClick={addBlock}
                            className="flex items-center gap-2 text-brand-blue font-bold hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                        >
                            <Plus size={18} /> Add Block
                        </button>
                    </div>

                    <div className="flex-grow overflow-y-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase">Block ID</th>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase">Start Time</th>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase">End Time</th>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {config.blocks.map((block, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <input
                                                type="text"
                                                value={block.id}
                                                onChange={e => updateBlock(idx, 'id', e.target.value)}
                                                className="bg-transparent font-bold text-gray-900 focus:outline-none focus:underline w-24"
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="time"
                                                value={block.startTime}
                                                onChange={e => updateBlock(idx, 'startTime', e.target.value)}
                                                className={`${idx === 0 ? 'bg-white' : 'bg-gray-50'} border border-gray-200 rounded-md px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none`}
                                                title={idx > 0 ? "Auto-filled based on headway (editable)" : "Start time for Block 1"}
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="time"
                                                value={block.endTime}
                                                onChange={e => updateBlock(idx, 'endTime', e.target.value)}
                                                className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none"
                                            />
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => removeBlock(idx)}
                                                className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                disabled={config.blocks.length <= 1}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {config.blocks.length === 0 && (
                            <div className="p-8 text-center text-gray-400 italic">No blocks defined. Add a block to start.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
