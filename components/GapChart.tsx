import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Line
} from 'recharts';
import { TimeSlot, ZoneFilterType } from '../utils/demandTypes';
import { MapPin, ChevronUp, ChevronDown } from 'lucide-react';

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
  fillHeight?: boolean; // When true, fills parent container instead of fixed 550px
}

const CustomTooltip = ({ active, payload, label, viewMode }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as TimeSlot;

    // Dynamic tooltip data based on view
    let req = data.totalRequirement;
    let cover = data.totalActiveCoverage;
    let net = data.totalActiveCoverage - data.totalRequirement;
    let title = "Total System";
    let activeDrivers = data.totalActiveCoverage;

    if (viewMode === 'North') {
      req = data.northRequirement;
      cover = data.northCoverage;
      activeDrivers = cover;
      net = cover - req;
      title = "North Zone (Exclusive)";
    } else if (viewMode === 'South') {
      req = data.southRequirement;
      cover = data.southCoverage;
      activeDrivers = cover;
      net = cover - req;
      title = "South Zone (Exclusive)";
    } else if (viewMode === 'Floater') {
      req = data.floaterRequirement || 0;
      cover = data.floaterCoverage;
      activeDrivers = cover;
      net = cover - req;
      title = "Floater Drivers On Road";
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
            <span className="text-brand-green">
              {viewMode === 'All'
                ? 'Drivers on road:'
                : `${viewMode === 'Floater' ? 'Floater Drivers' : 'Active Drivers'}:`}
            </span>
            <span>{cover}</span>
          </div>
          {viewMode === 'Floater' && (
            <>
              <div className="flex justify-between gap-4 text-blue-600">
                <span>Assigned to North:</span>
                <span>{data.northRelief || 0}</span>
              </div>
              <div className="flex justify-between gap-4 text-green-600">
                <span>Assigned to South:</span>
                <span>{data.southRelief || 0}</span>
              </div>
              <div className="flex justify-between gap-4 text-gray-500">
                <span>Available After Relief:</span>
                <span>{data.floaterAvailableCoverage}</span>
              </div>
            </>
          )}
          {viewMode === 'All' && activeDrivers !== cover && (
            <div className="flex justify-between gap-4 text-gray-600">
              <span>Drivers on road:</span>
              <span>{activeDrivers}</span>
            </div>
          )}
          {viewMode === 'All' && data.totalOverlappingShifts !== activeDrivers && (
            <div className="flex justify-between gap-4 text-gray-500">
              <span>Overlapping shifts:</span>
              <span>{data.totalOverlappingShifts}</span>
            </div>
          )}
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

export const GapChart: React.FC<Props> = ({ data, zoneFilter, onZoneFilterChange, fillHeight = false }) => {

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
        (zoneFilter === 'Floater' ? (d.floaterCoverage - d.floaterRequirement) : (d.totalActiveCoverage - d.totalRequirement))),

    currentBreak: zoneFilter === 'North' ? d.northBreaks :
      (zoneFilter === 'South' ? d.southBreaks :
        (zoneFilter === 'Floater' ? d.floaterBreaks : d.driversOnBreak)),

    currentRelief: zoneFilter === 'North' ? (d.northRelief || 0) :
      (zoneFilter === 'South' ? (d.southRelief || 0) : 0),

    surplusBar: Math.max(0, zoneFilter === 'North' ? ((d.northCoverage + (d.northRelief || 0)) - d.northRequirement) :
      (zoneFilter === 'South' ? ((d.southCoverage + (d.southRelief || 0)) - d.southRequirement) :
        (zoneFilter === 'Floater' ? (d.floaterCoverage - d.floaterRequirement) : (d.totalActiveCoverage - d.totalRequirement)))),

    gapBar: Math.min(0, zoneFilter === 'North' ? ((d.northCoverage + (d.northRelief || 0)) - d.northRequirement) :
      (zoneFilter === 'South' ? ((d.southCoverage + (d.southRelief || 0)) - d.southRequirement) :
        (zoneFilter === 'Floater' ? (d.floaterCoverage - d.floaterRequirement) : (d.totalActiveCoverage - d.totalRequirement)))),
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
    // Ensure we show at least down to -3 to allow visibility of negative gaps, or deeper if data exists
    return Math.min(-3, minNet < 0 ? Math.floor(minNet) : 0);
  }, [chartData]);

  const [isExpanded, setIsExpanded] = React.useState(true);

  return (
    <div className={`w-full bg-white p-6 rounded-3xl border-2 border-gray-200 shadow-sm relative overflow-hidden transition-all duration-300 ${isExpanded ? (fillHeight ? 'h-full' : 'h-[550px]') : 'h-auto'}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
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
        {isExpanded && (
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
        )}
      </div>

      {isExpanded && (
        <>
          <div className="flex gap-4 text-xs font-bold text-gray-500 mb-2 justify-end">
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 border-t-2 border-dashed border-brand-blue"></div>
              <span>Demand Line</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-brand-green"></div>
              <span>
                {zoneFilter === 'All'
                  ? 'Drivers On Road Line'
                  : zoneFilter === 'Floater'
                    ? 'Floater Drivers On Road'
                    : 'Active Drivers Line'}
              </span>
            </div>
            {(zoneFilter === 'North' || zoneFilter === 'South') && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-purple-500"></div>
                <span>Floater Relief (+/-)</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-brand-red"></div>
              <span>Gap Bars</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-brand-green"></div>
              <span>Surplus Bars</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 border-t-2 border-dashed border-orange-400"></div>
              <span>On Break Line</span>
            </div>
          </div>
          {zoneFilter === 'All' && (
            <div className="mb-4 text-xs font-semibold text-gray-500 text-right">
              System-wide green line shows active drivers on the road. Hover a point to compare raw drivers, overlapping shifts, and breaks.
            </div>
          )}
          {zoneFilter === 'Floater' && (
            <div className="mb-4 text-xs font-semibold text-gray-500 text-right">
              Floater view shows all active floater drivers on the road. Tooltip rows show North-first relief assignments and remaining floater availability after relief.
            </div>
          )}

          <ResponsiveContainer width="100%" height="85%">
            <ComposedChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 0, bottom: 30 }}
              barGap={0}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis
                dataKey="timeLabel"
                height={44}
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

              {/* Net Difference Bars (Gap/Surplus) */}
              <Bar
                dataKey="surplusBar"
                barSize={6}
                radius={[4, 4, 4, 4]}
                name="Surplus"
                fill="#A3E635"
                fillOpacity={1}
                animationDuration={500}
              />
              <Bar
                dataKey="gapBar"
                barSize={6}
                radius={[4, 4, 4, 4]}
                name="Gap"
                fill="#F87171"
                fillOpacity={1}
                animationDuration={500}
              />

              {/* Floater Relief Bars - Purple, only in North/South views */}
              {(zoneFilter === 'North' || zoneFilter === 'South') && (
                <Bar
                  dataKey="currentRelief"
                  barSize={6}
                  radius={[3, 3, 3, 3]}
                  name="Floater Relief"
                  fill="#9333EA"
                  fillOpacity={0.7}
                  animationDuration={500}
                />
              )}

              {/* Keep coverage solid and demand dashed so both remain visible when values overlap exactly. */}
              <Line
                type="stepAfter"
                dataKey="currentCover"
                stroke="#2F7D12"
                strokeWidth={5}
                dot={false}
                activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2, fill: '#2F7D12' }}
                name={zoneFilter === 'All'
                  ? 'Drivers On Road Line'
                  : zoneFilter === 'Floater'
                    ? 'Floater Drivers On Road'
                    : 'Active Drivers Line'}
                isAnimationActive={false}
              />

              {/* Demand/Requirement Line - Blue stepped line */}
              <Line
                type="stepAfter"
                dataKey="currentReq"
                stroke="#1CB0F6"
                strokeWidth={2.5}
                strokeDasharray="7 4"
                dot={false}
                activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2, fill: '#1CB0F6' }}
                name="Demand Line"
                isAnimationActive={false}
              />

              {/* Drivers On Break - Dashed orange line */}
              <Line
                type="stepAfter"
                dataKey="currentBreak"
                stroke="#F59E0B"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 4 }}
                name="On Break"
                isAnimationActive={false}
              />

              {/* Original Coverage Ghost Line - Only in combined */}
              {zoneFilter === 'All' && (
                <Line
                  type="stepAfter"
                  dataKey="originalActiveCoverage"
                  stroke="#9CA3AF"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={false}
                  activeDot={false}
                  name="Original"
                  isAnimationActive={false}
                />
              )}

            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
};
