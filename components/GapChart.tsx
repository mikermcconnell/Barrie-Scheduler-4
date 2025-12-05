import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
  Line
} from 'recharts';
import { TimeSlot, ZoneFilterType } from '../types';
import { MapPin } from 'lucide-react';

const CustomXAxisTick = ({ x, y, payload }: any) => {
  // We expect payload.value to be the time label (e.g. "08:00")
  // or we can use the index if needed. 
  // Given interval={0}, we get every data point.
  // Our data points are every 15 minutes.

  // We want to show labels ONLY on the hour (08:00, 09:00)
  // We want to show a small tick mark on half-hours (08:30)
  // We want to show nothing for :15 and :45

  // Check the label format
  const timeLabel = payload.value; // "HH:MM"
  const [hours, minutes] = timeLabel.split(':').map(Number);

  if (minutes === 0) {
    // Major Tick (Hour)
    return (
      <g transform={`translate(${x},${y})`}>
        <line y2={6} stroke="#9CA3AF" />
        <text x={0} y={0} dy={20} textAnchor="middle" fill="#9CA3AF" fontSize={12} fontWeight={700}>
          {timeLabel}
        </text>
      </g>
    );
  } else if (minutes === 30) {
    // Minor Tick (Half Hour) - No Label
    return (
      <g transform={`translate(${x},${y})`}>
        <line y2={4} stroke="#E5E7EB" />
      </g>
    );
  }

  // Hide others
  return null;
};

interface Props {
  data: TimeSlot[];
  zoneFilter: ZoneFilterType;
  onZoneFilterChange: (filter: ZoneFilterType) => void;
}

const CustomTooltip = ({ active, payload, label, viewMode }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as TimeSlot;

    // Dynamic tooltip data based on view
    let req = data.totalRequirement;
    let cover = data.totalActiveCoverage;
    let net = data.netDifference;
    let title = "Total System";

    if (viewMode === 'North') {
      req = data.northRequirement;
      cover = data.northCoverage;
      net = cover - req;
      title = "North Zone (Exclusive)";
    } else if (viewMode === 'South') {
      req = data.southRequirement;
      cover = data.southCoverage;
      net = cover - req;
      title = "South Zone (Exclusive)";
    } else if (viewMode === 'Floater') {
      req = data.floaterRequirement || 0;
      cover = data.floaterCoverage;
      net = cover - req;
      title = "Floater Zone (Exclusive)";
    }

    return (
      <div className="bg-white p-4 rounded-xl shadow-xl border-2 border-gray-100 z-50">
        <p className="font-extrabold text-gray-700 mb-2 border-b pb-1">{label} <span className="text-xs text-gray-400 font-normal">({title})</span></p>
        <div className="space-y-1 text-sm font-bold">
          <div className="flex justify-between gap-4">
            <span className="text-brand-blue">Requirement:</span>
            <span>{req}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-brand-green">Active {viewMode === 'Floater' ? 'Floaters' : 'Drivers'}:</span>
            <span>{cover}</span>
          </div>
          <div className={`flex justify-between gap-4 pt-1 border-t ${net < 0 ? 'text-brand-red' : 'text-brand-green'}`}>
            <span>{net < 0 ? 'Gap:' : 'Surplus:'}</span>
            <span>{net > 0 ? '+' : ''}{net}</span>
          </div>

        </div>
        <div className="flex justify-between gap-4 text-orange-400">
          <span>On Break:</span>
          <span>{(data as any).currentBreak}</span>
        </div>
      </div>
    );
  }
  return null;
};

export const GapChart: React.FC<Props> = ({ data, zoneFilter, onZoneFilterChange }) => {

  // Filter data to only show reasonable operating hours (e.g., 5am to 1am) for better visual
  const displayData = data.filter(d => {
    const h = Math.floor(d.timestamp / 60);
    return h >= 5 || h <= 1; // 05:00 to 01:00 (next day)
  });

  // Calculate dynamic data keys based on mode
  const chartData = displayData.map(d => ({
    ...d,
    currentReq: zoneFilter === 'North' ? d.northRequirement :
      (zoneFilter === 'South' ? d.southRequirement :
        (zoneFilter === 'Floater' ? d.floaterRequirement : d.totalRequirement)),

    currentCover: zoneFilter === 'North' ? d.northCoverage :
      (zoneFilter === 'South' ? d.southCoverage :
        (zoneFilter === 'Floater' ? d.floaterCoverage : d.totalActiveCoverage)),

    currentNet: zoneFilter === 'North' ? ((d.northCoverage + (d.northRelief || 0)) - d.northRequirement) :
      (zoneFilter === 'South' ? ((d.southCoverage + (d.southRelief || 0)) - d.southRequirement) :
        (zoneFilter === 'Floater' ? (d.floaterCoverage - d.floaterRequirement) : d.netDifference)),

    currentBreak: zoneFilter === 'North' ? d.northBreaks :
      (zoneFilter === 'South' ? d.southBreaks :
        (zoneFilter === 'Floater' ? d.floaterBreaks : d.driversOnBreak)),

    currentRelief: zoneFilter === 'North' ? (d.northRelief || 0) :
      (zoneFilter === 'South' ? (d.southRelief || 0) : 0),
  }));

  // Calculate stable Y-Axis max (round up to nearest 5)
  const maxValue = React.useMemo(() => {
    return Math.max(...displayData.map(d => {
      const req = zoneFilter === 'North' ? d.northRequirement :
        (zoneFilter === 'South' ? d.southRequirement :
          (zoneFilter === 'Floater' ? d.floaterRequirement || 0 : d.totalRequirement));

      const cov = zoneFilter === 'North' ? d.northCoverage :
        (zoneFilter === 'South' ? d.southCoverage :
          (zoneFilter === 'Floater' ? d.floaterCoverage : d.totalActiveCoverage));

      return Math.max(req, cov);
    }));
  }, [displayData, zoneFilter]);

  const domainMax = Math.ceil((maxValue + 1) / 5) * 5;

  // Calculate min value for gaps (negative net)
  const minValue = React.useMemo(() => {
    const minNet = Math.min(...chartData.map(d => d.currentNet));
    return minNet < 0 ? Math.floor(minNet / 1) * 1 : 0; // Ensure we capture the full negative depth
  }, [chartData]);

  return (
    <div className="h-[550px] w-full bg-white p-6 rounded-3xl border-2 border-gray-200 shadow-sm relative overflow-hidden transition-all duration-300">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-700 flex items-center gap-2">
            Gap Analysis
            <span className={`text-sm px-3 py-1 rounded-full border ${zoneFilter === 'North' ? 'bg-blue-50 text-blue-600 border-blue-200' :
              zoneFilter === 'South' ? 'bg-green-50 text-green-600 border-green-200' :
                zoneFilter === 'Floater' ? 'bg-purple-50 text-purple-600 border-purple-200' :
                  'bg-gray-100 text-gray-500 border-gray-200'
              }`}>
              {zoneFilter === 'All' ? 'System Wide' : `${zoneFilter} Only`}
            </span>
          </h2>
        </div>

        {/* Zone Toggles */}
        <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
          <button
            onClick={() => onZoneFilterChange('All')}
            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${zoneFilter === 'All' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            All
          </button>
          <button
            onClick={() => onZoneFilterChange('North')}
            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${zoneFilter === 'North' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <MapPin size={14} /> North
          </button>
          <button
            onClick={() => onZoneFilterChange('South')}
            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${zoneFilter === 'South' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <MapPin size={14} /> South
          </button>
          <button
            onClick={() => onZoneFilterChange('Floater')}
            className={`px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${zoneFilter === 'Floater' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <MapPin size={14} /> Floater
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-xs font-bold text-gray-500 mb-2 justify-end">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-brand-blue"></div>
          <span>Demand</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-brand-green"></div>
          <span>{zoneFilter === 'Floater' ? 'Active Floaters' : 'Active Drivers'}</span>
        </div>
        {(zoneFilter === 'North' || zoneFilter === 'South') && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-200 border border-purple-400"></div>
            <span>Floater Break Relief</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-brand-red"></div>
          <span>Gap</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-1 border-t-2 border-dashed border-orange-400"></div>
          <span>On Break</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="80%">
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
          barGap={0}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis
            dataKey="timeLabel"
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={<CustomXAxisTick />}
          />
          <YAxis
            tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            domain={[minValue, domainMax]}
            allowDataOverflow={true}
          />
          <Tooltip content={<CustomTooltip viewMode={zoneFilter} />} cursor={{ fill: '#f3f4f6', opacity: 0.4 }} />

          <ReferenceLine y={0} stroke="#E5E7EB" />

          {/* Net Difference Bars */}
          <Bar
            dataKey="currentNet"
            barSize={8}
            radius={[4, 4, 4, 4]}
            name="Relief Coverage"
            animationDuration={500}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.currentNet < 0 ? '#FF4B4B' : '#58CC02'}
                fillOpacity={0.8}
              />
            ))}
          </Bar>

          {/* Coverage Line - Detailed Line on top */}
          <Line
            type="monotone"
            dataKey="currentCover"
            stroke="#58CC02"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 6 }}
            name="Active Drivers"
            animationDuration={500}
            zIndex={20}
          />

          {/* Original Coverage Ghost Line - Only in combined */}
          {zoneFilter === 'All' && (
            <Line
              type="monotone"
              dataKey="originalActiveCoverage"
              stroke="#9CA3AF"
              strokeWidth={2}
              strokeDasharray="3 3"
              dot={false}
              activeDot={false}
              name="Original"
            />
          )}

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};