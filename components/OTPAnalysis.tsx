
import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  ReferenceLine, ScatterChart, Scatter, Cell 
} from 'recharts';
import { OTPRecord, OTPMetrics } from '../types';
import { generateMockOTPData, analyzeConnectionSuccess } from '../utils/otpParser';
import { FileUpload } from './FileUpload';
import { Filter, Calendar, MapPin, Train, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

export const OTPAnalysis: React.FC = () => {
  const [data, setData] = useState<OTPRecord[]>([]);
  const [selectedStop, setSelectedStop] = useState<string>("Barrie South GO");
  const [targetConnectionTime, setTargetConnectionTime] = useState<string>("07:22"); // Example Train Time
  const [transferBuffer, setTransferBuffer] = useState<number>(5); // 5 minutes to walk to train

  // Load initial mock data
  React.useEffect(() => {
    setData(generateMockOTPData());
  }, []);

  const metrics: OTPMetrics = useMemo(() => {
    if (data.length === 0) return { totalTrips: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0, connectionSuccessPercent: 0, avgDeviation: 0 };

    const total = data.length;
    const onTime = data.filter(d => d.status === 'On Time').length;
    const early = data.filter(d => d.status === 'Early').length;
    const late = data.filter(d => d.status === 'Late').length;
    const deviationSum = data.reduce((acc, curr) => acc + curr.deviation, 0);

    const connectionSuccess = analyzeConnectionSuccess(data, targetConnectionTime, transferBuffer);

    return {
      totalTrips: total,
      onTimePercent: Math.round((onTime / total) * 100),
      earlyPercent: Math.round((early / total) * 100),
      latePercent: Math.round((late / total) * 100),
      connectionSuccessPercent: Math.round(connectionSuccess),
      avgDeviation: parseFloat((deviationSum / total).toFixed(1))
    };
  }, [data, targetConnectionTime, transferBuffer]);

  const handleFileUpload = (file: File) => {
      // In real implementation: Parse file here.
      alert(`File uploaded: ${file.name}. Using simulated "Actual" data for demonstration.`);
      setData(generateMockOTPData());
  };

  // Prepare Chart Data
  const scatterData = data.map((d, index) => ({
    x: d.date, // Just using index for simplicity in prototype, normally Date
    y: d.actualMinutes,
    scheduled: d.scheduledMinutes,
    status: d.status,
    deviation: d.deviation,
    tooltipTime: d.actualTime,
    tooltipDate: d.date
  }));

  const trainMins = parseInt(targetConnectionTime.split(':')[0]) * 60 + parseInt(targetConnectionTime.split(':')[1]);
  const connectionCutoff = trainMins - transferBuffer;

  return (
    <div className="animate-in fade-in zoom-in-95 duration-500 max-w-7xl mx-auto">
      
      {/* Header Section */}
      <div className="mb-8">
        <h2 className="text-3xl font-extrabold text-gray-800">Actual On-Time Performance</h2>
        <p className="text-gray-500 font-bold mt-2">Analyze trip reliability and connection protection based on actual AVL/CAD data.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-8">
        
        {/* Left Control Panel */}
        <div className="lg:col-span-1 space-y-6">
           {/* KPI Card Main */}
           <div className={`p-6 rounded-3xl border-2 ${metrics.connectionSuccessPercent > 90 ? 'bg-green-50 border-brand-green' : 'bg-red-50 border-brand-red'}`}>
              <div className="flex items-center gap-2 mb-2">
                 <Train size={20} className={metrics.connectionSuccessPercent > 90 ? 'text-brand-green' : 'text-brand-red'} />
                 <span className="text-xs font-black uppercase tracking-wider text-gray-500">Connection Success</span>
              </div>
              <div className={`text-5xl font-black ${metrics.connectionSuccessPercent > 90 ? 'text-brand-green' : 'text-brand-red'}`}>
                  {metrics.connectionSuccessPercent}%
              </div>
              <p className="text-xs font-bold text-gray-400 mt-2">Trips meeting the {targetConnectionTime} Train</p>
           </div>

           {/* Controls */}
           <div className="bg-white p-6 rounded-3xl border-2 border-gray-200 shadow-sm">
              <h3 className="font-extrabold text-gray-700 mb-4 flex items-center gap-2">
                  <Filter size={18} /> Analysis Config
              </h3>
              
              <div className="space-y-4">
                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Stop Name</label>
                      <div className="relative">
                        <select 
                            value={selectedStop}
                            onChange={(e) => setSelectedStop(e.target.value)}
                            className="w-full bg-gray-50 border-2 border-gray-200 rounded-xl p-2 pl-9 font-bold text-gray-700 focus:border-brand-blue outline-none appearance-none"
                        >
                            <option>Barrie South GO</option>
                            <option>Downtown Terminal</option>
                            <option>Georgian College</option>
                            <option>Allandale Waterfront</option>
                        </select>
                        <MapPin size={16} className="absolute left-3 top-3 text-gray-400" />
                      </div>
                  </div>

                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Target Connection (Train)</label>
                      <input 
                        type="time" 
                        value={targetConnectionTime}
                        onChange={(e) => setTargetConnectionTime(e.target.value)}
                        className="w-full bg-gray-50 border-2 border-gray-200 rounded-xl p-2 font-bold text-gray-700 focus:border-brand-blue outline-none"
                      />
                  </div>

                   <div>
                      <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Transfer Buffer (Min)</label>
                      <input 
                        type="number" 
                        value={transferBuffer}
                        onChange={(e) => setTransferBuffer(Number(e.target.value))}
                        className="w-full bg-gray-50 border-2 border-gray-200 rounded-xl p-2 font-bold text-gray-700 focus:border-brand-blue outline-none"
                      />
                      <p className="text-[10px] text-gray-400 mt-1 font-semibold">Min time needed to walk from Bus to Train.</p>
                  </div>
              </div>
           </div>

           {/* Metrics List */}
           <div className="bg-white p-6 rounded-3xl border-2 border-gray-200 shadow-sm space-y-4">
               <div className="flex justify-between items-center">
                   <span className="text-sm font-bold text-gray-500">Total Trips Analyzed</span>
                   <span className="font-extrabold text-gray-800">{metrics.totalTrips}</span>
               </div>
               <div className="flex justify-between items-center">
                   <span className="text-sm font-bold text-gray-500">Avg. Deviation</span>
                   <span className={`font-extrabold ${metrics.avgDeviation > 3 ? 'text-red-500' : 'text-gray-800'}`}>
                       {metrics.avgDeviation > 0 ? '+' : ''}{metrics.avgDeviation} min
                   </span>
               </div>
               <hr className="border-gray-100"/>
               <div className="flex justify-between items-center">
                   <span className="text-sm font-bold text-brand-green">On Time (-1 / +5)</span>
                   <span className="font-extrabold text-brand-green">{metrics.onTimePercent}%</span>
               </div>
               <div className="flex justify-between items-center">
                   <span className="text-sm font-bold text-brand-red">Late (> 5 min)</span>
                   <span className="font-extrabold text-brand-red">{metrics.latePercent}%</span>
               </div>
               <div className="flex justify-between items-center">
                   <span className="text-sm font-bold text-brand-yellow">Early (> 1 min)</span>
                   <span className="font-extrabold text-brand-yellow">{metrics.earlyPercent}%</span>
               </div>
           </div>

        </div>

        {/* Main Visualization Area */}
        <div className="lg:col-span-3 space-y-6">
            
            {/* Connection Reliability Chart */}
            <div className="bg-white p-6 rounded-3xl border-2 border-gray-200 shadow-sm h-[500px]">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-extrabold text-gray-800">Connection Reliability Timeline</h3>
                        <p className="text-sm font-bold text-gray-400">Past 30 Days @ {selectedStop}</p>
                    </div>
                    <div className="flex gap-4 text-xs font-bold">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-brand-green"></div> Success</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-brand-red"></div> Missed Connection</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-gray-800 h-1"></div> Train Depart</div>
                    </div>
                </div>

                <ResponsiveContainer width="100%" height="85%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 10, fontWeight: 700, fill: '#9CA3AF' }} 
                            interval={4}
                            angle={-45}
                            textAnchor="end"
                            height={60}
                        />
                        <YAxis 
                            type="number" 
                            domain={['dataMin - 5', 'dataMax + 5']} 
                            tickFormatter={(val) => {
                                const h = Math.floor(val/60);
                                const m = val%60;
                                return `${h}:${m.toString().padStart(2,'0')}`;
                            }}
                            tick={{ fontSize: 12, fontWeight: 700, fill: '#9CA3AF' }}
                            width={50}
                        />
                        <Tooltip 
                            cursor={{ strokeDasharray: '3 3' }}
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload;
                                    return (
                                        <div className="bg-white p-4 rounded-xl shadow-xl border-2 border-gray-100 z-50">
                                            <p className="font-extrabold text-gray-700 mb-1">{d.tooltipDate}</p>
                                            <p className="text-sm font-bold text-gray-500">Actual Arrival: <span className="text-gray-800">{d.tooltipTime}</span></p>
                                            <p className={`text-sm font-bold ${d.y > connectionCutoff ? 'text-red-500' : 'text-green-500'}`}>
                                                {d.y > connectionCutoff ? 'Missed Connection' : 'Connection Made'}
                                            </p>
                                            <p className="text-xs text-gray-400 mt-2">Train: {targetConnectionTime}</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        
                        {/* The Buffer Zone (Safe Area) */}
                        <ReferenceLine y={connectionCutoff} stroke="#F59E0B" strokeDasharray="5 5" label={{ value: 'Last Safe Arrival', position: 'insideBottomRight', fill: '#F59E0B', fontSize: 10, fontWeight: 'bold' }} />
                        
                        {/* The Train Departure */}
                        <ReferenceLine y={trainMins} stroke="#1F2937" strokeWidth={2} label={{ value: `Train Departs ${targetConnectionTime}`, position: 'insideTopRight', fill: '#1F2937', fontSize: 12, fontWeight: 'bold' }} />

                        <Scatter name="Arrivals" data={scatterData} shape="circle">
                            {scatterData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.y > connectionCutoff ? '#EF4444' : '#22C55E'} />
                            ))}
                        </Scatter>
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
            
            <div className="bg-gray-50 rounded-3xl p-6 border-2 border-dashed border-gray-300 text-center">
                 <h4 className="text-gray-500 font-bold mb-4">Have real data? Import Excel Export</h4>
                 <div className="max-w-md mx-auto">
                    <FileUpload onFileUpload={handleFileUpload} />
                 </div>
            </div>

        </div>
      </div>
    </div>
  );
};
