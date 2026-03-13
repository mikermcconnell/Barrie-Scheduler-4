import React from 'react';
import { SummaryMetrics } from '../utils/demandTypes';
import { Clock, TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  metrics: SummaryMetrics;
}

const Card: React.FC<{ 
  title: string; 
  value: string | number; 
  icon: React.ReactNode; 
  colorClass: string;
  subtext?: string;
}> = ({ title, value, icon, colorClass, subtext }) => (
  <div className="bg-white rounded-2xl border-2 border-gray-200 p-4 flex items-start space-x-4 shadow-sm hover:shadow-md transition-shadow">
    <div className={`p-3 rounded-xl ${colorClass} text-white shadow-inner`}>
      {icon}
    </div>
    <div>
      <h3 className="text-gray-500 font-bold text-xs uppercase tracking-wider">{title}</h3>
      <div className="text-2xl font-extrabold text-gray-800 mt-1">{value}</div>
      {subtext && <div className="text-xs text-gray-400 font-semibold mt-1">{subtext}</div>}
    </div>
  </div>
);

export const SummaryCards: React.FC<Props> = ({ metrics }) => {
  const isDeficit = metrics.netDiffHours < 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <Card 
        title="Master Demand" 
        value={`${metrics.totalMasterHours}h`} 
        icon={<Clock size={24} />} 
        colorClass="bg-brand-blue"
        subtext="Scheduled Service Hours"
      />
      <Card 
        title="MVT Supply" 
        value={`${metrics.totalShiftHours}h`} 
        icon={<TrendingUp size={24} />} 
        colorClass="bg-brand-yellow"
        subtext="Driver Payable Hours"
      />
      <Card 
        title="Net Difference" 
        value={`${metrics.netDiffHours > 0 ? '+' : ''}${metrics.netDiffHours}h`} 
        icon={isDeficit ? <AlertCircle size={24} /> : <CheckCircle2 size={24} />} 
        colorClass={isDeficit ? "bg-brand-red" : "bg-brand-green"}
        subtext={isDeficit ? "Under Service" : "Over Service"}
      />
      <Card 
        title="Coverage Score" 
        value={`${metrics.coveragePercent}%`} 
        icon={<div className="font-black text-lg">%</div>} 
        colorClass="bg-purple-500"
        subtext="Demand Met"
      />
    </div>
  );
};
