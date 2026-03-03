/**
 * OD Heatmap Grid Module
 *
 * CSS grid matrix showing journey counts between stations.
 * Color scale: white (0) → light violet → dark violet (max).
 * Top N filter to keep the grid manageable.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Download, FileText } from 'lucide-react';
import { ChartCard } from './AnalyticsShared';
import type { ODMatrixDataSummary } from '../../utils/od-matrix/odMatrixTypes';

interface ODHeatmapGridModuleProps {
    data: ODMatrixDataSummary;
    containerRef?: React.RefObject<HTMLDivElement | null>;
    onExportStopExcel?: (stopName: string) => void;
    onExportStopPdf?: (stopName: string) => void;
}

type SortMode = 'volume' | 'origin' | 'destination' | 'alpha';
const SORT_OPTIONS: { key: SortMode; label: string }[] = [
    { key: 'volume', label: 'Total Volume' },
    { key: 'origin', label: 'Origin Volume' },
    { key: 'destination', label: 'Dest Volume' },
    { key: 'alpha', label: 'Alphabetical' },
];

function interpolateColor(value: number, max: number): string {
    if (value === 0 || max === 0) return '#ffffff';
    const ratio = Math.min(value / max, 1);
    // White → light violet → dark violet
    const r = Math.round(255 - ratio * 131); // 255 → 124
    const g = Math.round(255 - ratio * 197); // 255 → 58
    const b = Math.round(255 - ratio * 18);  // 255 → 237
    return `rgb(${r}, ${g}, ${b})`;
}

function textColorForBg(value: number, max: number): string {
    if (max === 0) return '#9ca3af';
    const ratio = value / max;
    return ratio > 0.45 ? '#ffffff' : '#374151';
}

export const ODHeatmapGridModule: React.FC<ODHeatmapGridModuleProps> = ({ data, containerRef, onExportStopExcel, onExportStopPdf }) => {
    const [topN, setTopN] = useState(30);
    const [sortMode, setSortMode] = useState<SortMode>('volume');
    const [compact, setCompact] = useState(false);
    const [search, setSearch] = useState('');
    const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
    const [selectedStation, setSelectedStation] = useState<string | null>(null);

    // Sort and filter stations
    const visibleStations = useMemo(() => {
        let stations = [...data.stations];

        if (search.trim()) {
            const q = search.toLowerCase();
            stations = stations.filter(s => s.name.toLowerCase().includes(q));
        }

        switch (sortMode) {
            case 'volume':
                stations.sort((a, b) => b.totalVolume - a.totalVolume);
                break;
            case 'origin':
                stations.sort((a, b) => b.totalOrigin - a.totalOrigin);
                break;
            case 'destination':
                stations.sort((a, b) => b.totalDestination - a.totalDestination);
                break;
            case 'alpha':
                stations.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }

        return stations.slice(0, topN);
    }, [data.stations, topN, sortMode, search]);

    // Build journey lookup map for O(1) cell access
    const journeyMap = useMemo(() => {
        const map = new Map<string, number>();
        data.pairs.forEach(p => {
            map.set(`${p.origin}|${p.destination}`, p.journeys);
        });
        return map;
    }, [data.pairs]);

    const getJourneys = useCallback((origin: string, dest: string): number => {
        return journeyMap.get(`${origin}|${dest}`) || 0;
    }, [journeyMap]);

    // Find max value for color scaling
    const maxValue = useMemo(() => {
        let max = 0;
        for (let r = 0; r < visibleStations.length; r++) {
            for (let c = 0; c < visibleStations.length; c++) {
                const val = getJourneys(visibleStations[r].name, visibleStations[c].name);
                if (val > max) max = val;
            }
        }
        return max;
    }, [visibleStations, getJourneys]);

    const stationNames = useMemo(() => visibleStations.map(s => s.name), [visibleStations]);
    const n = stationNames.length;

    return (
        <div className="space-y-4" ref={containerRef}>
            {/* Controls */}
            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-500 font-medium">Stations:</label>
                    <input
                        type="range"
                        min={10}
                        max={Math.min(50, data.stationCount)}
                        step={5}
                        value={topN}
                        onChange={(e) => setTopN(Number(e.target.value))}
                        className="w-24 accent-violet-500"
                    />
                    <span className="text-sm font-medium text-gray-700 w-6">{topN}</span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-medium">Sort:</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {SORT_OPTIONS.map(opt => (
                            <button
                                key={opt.key}
                                onClick={() => setSortMode(opt.key)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                    sortMode === opt.key
                                        ? 'bg-gray-900 text-white'
                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter stations..."
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent w-40"
                />

                <button
                    onClick={() => setCompact(!compact)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        compact
                            ? 'bg-violet-100 text-violet-700 border-violet-200'
                            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}
                >
                    {compact ? 'Color Only' : 'Show Numbers'}
                </button>
            </div>

            {/* Selected Station Bar */}
            {selectedStation && (onExportStopExcel || onExportStopPdf) && (
                <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-lg px-4 py-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-violet-500 uppercase tracking-wide">Selected</span>
                        <span className="text-sm font-bold text-violet-800">{selectedStation}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {onExportStopExcel && (
                            <button
                                onClick={() => onExportStopExcel(selectedStation)}
                                title={`Export stop Excel: ${selectedStation}`}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-white hover:text-gray-800 transition-colors"
                            >
                                <Download size={12} />
                                Excel
                            </button>
                        )}
                        {onExportStopPdf && (
                            <button
                                onClick={() => onExportStopPdf(selectedStation)}
                                title={`Export stop PDF: ${selectedStation}`}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-white hover:text-gray-800 transition-colors"
                            >
                                <FileText size={12} />
                                PDF
                            </button>
                        )}
                        <button
                            onClick={() => setSelectedStation(null)}
                            className="px-2 py-1 text-xs text-violet-400 hover:text-violet-600 transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            {/* Heatmap Grid */}
            <ChartCard
                title="Origin-Destination Heatmap"
                subtitle={`${n}×${n} matrix · max ${maxValue.toLocaleString()} journeys`}
            >
                <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
                    <div
                        className="inline-grid"
                        style={{
                            gridTemplateColumns: `140px repeat(${n}, ${compact ? '28px' : '52px'})`,
                            gridTemplateRows: `80px repeat(${n}, ${compact ? '28px' : '32px'})`,
                        }}
                    >
                        {/* Top-left corner */}
                        <div className="sticky left-0 top-0 z-30 bg-white border-b border-r border-gray-200 flex items-end pb-1 pr-1">
                            <span className="text-[9px] text-gray-400">Origin ↓ / Dest →</span>
                        </div>

                        {/* Column headers */}
                        {stationNames.map((name, ci) => (
                            <div
                                key={`ch-${ci}`}
                                className={`sticky top-0 z-20 bg-white border-b border-gray-200 flex items-end justify-center pb-1 ${
                                    hoveredCell?.col === ci ? 'bg-violet-50' : ''
                                }`}
                            >
                                <span
                                    className="text-[9px] text-gray-500 font-medium leading-tight text-center overflow-hidden"
                                    style={{
                                        writingMode: 'vertical-rl',
                                        transform: 'rotate(180deg)',
                                        maxHeight: 72,
                                    }}
                                    title={name}
                                >
                                    {name.length > 18 ? name.slice(0, 16) + '..' : name}
                                </span>
                            </div>
                        ))}

                        {/* Rows */}
                        {stationNames.map((rowName, ri) => (
                            <React.Fragment key={`row-${ri}`}>
                                {/* Row header */}
                                <div
                                    className={`sticky left-0 z-10 border-r border-gray-200 flex items-center pr-2 cursor-pointer transition-colors ${
                                        selectedStation === rowName
                                            ? 'bg-violet-100'
                                            : hoveredCell?.row === ri ? 'bg-violet-50' : 'bg-white'
                                    }`}
                                    onClick={() => setSelectedStation(prev => prev === rowName ? null : rowName)}
                                >
                                    <span
                                        className={`text-[10px] font-medium truncate ${
                                            selectedStation === rowName ? 'text-violet-700' : 'text-gray-600'
                                        }`}
                                        title={rowName}
                                    >
                                        {rowName.length > 20 ? rowName.slice(0, 18) + '..' : rowName}
                                    </span>
                                </div>

                                {/* Cells */}
                                {stationNames.map((colName, ci) => {
                                    const value = getJourneys(rowName, colName);
                                    const bg = interpolateColor(value, maxValue);
                                    const textColor = textColorForBg(value, maxValue);
                                    const isHovered = hoveredCell?.row === ri && hoveredCell?.col === ci;
                                    const isHighlightedAxis = hoveredCell?.row === ri || hoveredCell?.col === ci;

                                    return (
                                        <div
                                            key={`cell-${ri}-${ci}`}
                                            className={`flex items-center justify-center border-[0.5px] border-gray-100 cursor-default transition-shadow ${
                                                isHovered ? 'ring-2 ring-violet-500 z-10' : ''
                                            } ${isHighlightedAxis && !isHovered ? 'opacity-100' : ''}`}
                                            style={{ backgroundColor: bg }}
                                            title={`${rowName} → ${colName}: ${value.toLocaleString()} journeys`}
                                            onMouseEnter={() => setHoveredCell({ row: ri, col: ci })}
                                            onMouseLeave={() => setHoveredCell(null)}
                                        >
                                            {!compact && value > 0 && (
                                                <span
                                                    className="text-[9px] font-medium leading-none"
                                                    style={{ color: textColor }}
                                                >
                                                    {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                {/* Color legend */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
                    <span className="text-xs text-gray-400">0</span>
                    <div
                        className="h-3 flex-1 rounded"
                        style={{
                            background: 'linear-gradient(to right, #ffffff, #ede9fe, #c4b5fd, #8b5cf6, #7c3aed)',
                        }}
                    />
                    <span className="text-xs text-gray-400">{maxValue.toLocaleString()}</span>
                </div>
            </ChartCard>
        </div>
    );
};
