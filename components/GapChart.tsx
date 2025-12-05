import React from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell
} from 'recharts';
import { TimeSlot } from '../types';

interface Props {
  data: TimeSlot[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as TimeSlot;
    return (
      <div className="bg-white p-4 rounded-xl shadow-xl border-2 border-gray-100 z-50">
        <p className="font-extrabold text-gray-700 mb-2">{label}</p>
        <div className="space-y-1 text-sm font-bold">
          <p className="text-brand-blue">Requirement: {data.totalRequirement}</p>
          <p className="text-brand-green">Active Coverage: {data.totalActiveCoverage}</p>
          <p className={`${data.netDifference < 0 ? 'text-brand-red' : 'text-brand-green'}`}>
            Net: {data.netDifference > 0 ? '+' : ''}{data.netDifference}
          </p>
          <p className="text-orange-400 text-xs">Drivers on Break: {data.driversOnBreak}</p>
        </div>
      </div>
    );
  }
  return null;
};

export const GapChart: React.FC<Props> = ({ data }) => {
  // Filter data to only show reasonable operating hours (e.g., 5am to 1am) for better visual
  const displayData = data.filter(d => {
    const h = Math.floor(d.timestamp / 60);
    return h >= 5 || h <= 1; // 05:00 to 01:00 (next day)
  });

  return (
    <div className="h-[500px] w-full bg-white p-6 rounded-3xl border-2 border-gray-200 shadow-sm relative overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-extrabold text-gray-700">Gap Analysis & Coverage</h2>
        <div className="flex gap-4 text-sm font-bold text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-brand-blue"></div>
            <span>Demand</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-brand-green"></div>
            <span>Actual Supply</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-brand-red"></div>
            <span>Deficit</span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="85%">
        <ComposedChart
          data={displayData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          barGap={0}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            interval={7} // Show every 2 hours roughly
          />
          <YAxis
            tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f3f4f6', opacity: 0.4 }} />

          <ReferenceLine y={0} stroke="#E5E7EB" />

          {/* Net Difference Bars */}
          <Bar dataKey="netDifference" barSize={8} radius={[4, 4, 4, 4]}>
            {displayData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.netDifference < 0 ? '#FF4B4B' : '#58CC02'}
                fillOpacity={0.8}
              />
            ))}
          </Bar>

          {/* Drivers on Break Line (Dashed) */}
          <Line
            type="stepAfter"
            dataKey="driversOnBreak"
            stroke="#FDBA74"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            name="On Break"
          />

          {/* Requirement Line (Demand) */}
          <Line
            type="monotone"
            dataKey="totalRequirement"
            stroke="#1CB0F6"
            strokeWidth={4}
            dot={{ r: 4, fill: '#1CB0F6', strokeWidth: 0 }}
            activeDot={{ r: 6 }}
            name="Requirement"
          />

          {/* Coverage Line (Supply) */}
          <Line
            type="monotone"
            dataKey="totalActiveCoverage"
            stroke="#58CC02"
            strokeWidth={4}
            dot={false}
            activeDot={{ r: 6 }}
            name="Active Coverage"
          />

          {/* Original Coverage Line (Ghost) */}
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

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};