import React from 'react';
import {createRoot} from 'react-dom/client';
import {PerformanceWorkspace} from '../../components/Performance/PerformanceWorkspace';
import type {DailySummary, DayType, OTPBreakdown, PerformanceDataSummary} from '../../utils/performanceDataTypes';
function otp(total: number, onTime: number, early = 0, late = total - onTime - early): OTPBreakdown {
  return {
    total,
    onTime,
    early,
    late,
    onTimePercent: total > 0 ? (onTime / total) * 100 : 0,
    earlyPercent: total > 0 ? (early / total) * 100 : 0,
    latePercent: total > 0 ? (late / total) * 100 : 0,
    avgDeviationSeconds: late > 0 ? 420 : 0,
  };
}

function buildDay(
  date: string,
  {
    dayType = 'weekday',
    systemOtp = otp(100, 85, 5, 10),
    routeOtp = systemOtp,
    dataQualityTotal = 100,
    missingAVL = 0,
    missingAPC = 0,
  }: {
    dayType?: DayType;
    systemOtp?: OTPBreakdown;
    routeOtp?: OTPBreakdown;
    dataQualityTotal?: number;
    missingAVL?: number;
    missingAPC?: number;
  } = {},
): DailySummary {
  return {
    date,
    dayType,
    system: {
      otp: systemOtp,
      totalRidership: 100,
      totalBoardings: 100,
      totalAlightings: 95,
      vehicleCount: 2,
      tripCount: 10,
      wheelchairTrips: 0,
      avgSystemLoad: 10,
      peakLoad: 20,
    },
    byRoute: [{
      routeId: '1',
      routeName: 'Main',
      otp: routeOtp,
      ridership: 100,
      alightings: 95,
      tripCount: 10,
      serviceHours: 5,
      avgLoad: 10,
      maxLoad: 20,
      avgDeviationSeconds: routeOtp.avgDeviationSeconds,
      wheelchairTrips: 0,
    }],
    byHour: [{
      hour: 8,
      otp: systemOtp,
      boardings: 40,
      alightings: 35,
      avgLoad: 10,
    }],
    byStop: [],
    byTrip: [{
      tripId: `trip-${date}`,
      tripName: '08:00 Main',
      block: 'B1',
      routeId: '1',
      routeName: 'Main',
      direction: 'North',
      terminalDepartureTime: '08:00',
      otp: routeOtp,
      boardings: 20,
      maxLoad: 15,
    }],
    loadProfiles: [],
    missedTrips: {
      totalScheduled: 10,
      totalMatched: 10,
      totalMissed: 0,
      missedPct: 0,
      notPerformedCount: 0,
      lateOver15Count: 0,
      byRoute: [],
      trips: [],
    },
    dataQuality: {
      totalRecords: dataQualityTotal,
      inBetweenFiltered: 0,
      missingAVL,
      missingAPC,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 8,
  };
}

function summary(days: DailySummary[], dateRange = { start: '2026-03-01', end: '2026-03-31' }): PerformanceDataSummary {
  return {
    dailySummaries: days,
    metadata: {
      importedAt: '2026-04-01T12:00:00.000Z',
      importedBy: 'test',
      dateRange,
      dayCount: days.length,
      totalRecords: days.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0),
    },
    schemaVersion: 8,
  };
}


const dates=['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20'];
const days=dates.map((date,i)=>buildDay(date,{dayType:i<5?'weekday':i===5?'saturday':'sunday'}));
const data=summary(days,{start:dates[0],end:dates[6]});
createRoot(document.getElementById('root')!).render(<div className="p-4 mx-auto max-w-7xl"><PerformanceWorkspace data={data} onBack={()=>{}} onReimport={()=>{}} /></div>);
