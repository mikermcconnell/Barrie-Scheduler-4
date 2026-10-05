import React, { useEffect, useMemo, useRef, useState } from "react";
import { consolidateSpecializedTransitDataset, mergeSpecializedTransitLocations, remapSpecializedTransitBuckets } from "../../utils/specialized-transit/locationMerges";
import {
  Accessibility,
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  FileUp,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { accessLocalSpecializedTransitReports } from "../../utils/specialized-transit/localStore";
import {
  useSpecializedTransitDatasetQuery,
  useSpecializedTransitMetadataQuery,
} from "../../hooks/useSpecializedTransitData";
import {
  extractPdf,
  parseCommonLocationLines,
  parseMonthlySpecializedLines,
  normalizeSpecializedLocationName,
  sourceFileFromExtract,
} from "../../utils/specialized-transit/parser";
import {
  clearLocalSpecializedTransitDataset,
  isLocalSpecializedTransitMode,
  saveSpecializedTransitDataset,
} from "../../utils/specialized-transit/service";
import type {
  SpecializedTransitLocationV1,
  SpecializedTransitMonthV1,
} from "../../utils/specialized-transit/types";
import {
  findSpecializedTransitLocationCandidates,
  getSpecializedTransitCoordinateCollisionIds,
  resolveSpecializedTransitLocations,
  type SpecializedTransitLocationCandidate,
} from "../../utils/specialized-transit/locationResolver";
import { getSpecializedTransitPermanentGeocodingUsage } from "../../utils/specialized-transit/permanentGeocodingBudget";
import {
  buildSpecializedTransitUnmappedResearchText,
  getSpecializedTransitUnmappedResearchRows,
} from "../../utils/specialized-transit/unmappedLocationExport";
import { isInBarrieAnalysisArea } from "../../utils/transit-app/transitAppGeo";
import {
  SpecializedTransitMap,
  type SpecializedTransitMapPoint,
} from "./SpecializedTransitMap";

interface SpecializedTransitModuleProps {
  teamId: string;
  canManage: boolean;
  includedDates?: string[];
}

type LocationQueueFilter = "needs-review" | "unmapped" | "collisions" | "all";
const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface LocationEditDraft {
  id: string;
  displayName: string;
  latitude: string;
  longitude: string;
  mergeTargetId: string;
  coordinateSource: SpecializedTransitLocationV1["coordinateSource"];
}

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

function Kpi({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-black text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{detail}</div>
    </div>
  );
}

function hasReusableCoordinates(
  location: SpecializedTransitLocationV1,
): boolean {
  return (
    location.latitude !== null &&
    location.longitude !== null &&
    ["gtfs-stop", "known-place", "mapbox-permanent", "manual"].includes(
      String(location.coordinateSource),
    )
  );
}

function locationResolutionNotice(
  resolved: Awaited<ReturnType<typeof resolveSpecializedTransitLocations>>,
  unresolvedLabel: string,
): string {
  const requestFailures = resolved.unresolved.filter(
    (item) => item.reason === "request-failed",
  ).length;
  const budgetFailures = resolved.unresolved.filter(
    (item) => item.reason === "budget-exhausted",
  ).length;
  const details = [
    requestFailures > 0
      ? `${requestFailures.toLocaleString()} Permanent Geocoding requests failed; confirm Mapbox billing and token access.`
      : "",
    budgetFailures > 0
      ? `${budgetFailures.toLocaleString()} searches were stopped by the 999-request monthly browser limit.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${resolved.geocodes.length.toLocaleString()} trusted locations mapped; ${resolved.unresolved.length.toLocaleString()} ${unresolvedLabel}.${details ? ` ${details}` : ""}`;
}

export const SpecializedTransitModule: React.FC<
  SpecializedTransitModuleProps
> = (props) => {
  const { user } = useAuth();
  return <SpecializedTransitContent key={`${props.teamId}:${user?.uid ?? "signed-out"}`} {...props} />;
};

const SpecializedTransitContent: React.FC<SpecializedTransitModuleProps> = ({ teamId, canManage }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const metadataQuery = useSpecializedTransitMetadataQuery(teamId);
  const datasetQuery = useSpecializedTransitDatasetQuery(
    teamId,
    !!metadataQuery.data,
    metadataQuery.data,
  );
  const dataset = useMemo(() => datasetQuery.data ? consolidateSpecializedTransitDataset(datasetQuery.data) : null, [datasetQuery.data]);
  const localMode = isLocalSpecializedTransitMode();
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [monthlyFile, setMonthlyFile] = useState<File | null>(null);
  const [commonFile, setCommonFile] = useState<File | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [showImporter, setShowImporter] = useState(false);
  const [filesBusy, setFilesBusy] = useState(true);
  const [fileNotice, setFileNotice] = useState("");
  const [fileError, setFileError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!user || !canManage) {
      setFilesBusy(false);
      return;
    }
    void accessLocalSpecializedTransitReports(teamId, user.uid, 'load')
      .then((saved) => {
        if (cancelled || !saved) return;
        setMonthlyFile(new File([saved.monthly.bytes], saved.monthly.name, saved.monthly));
        setCommonFile(new File([saved.common.bytes], saved.common.name, saved.common));
        setFileNotice("Saved report files restored from this browser.");
      })
      .catch(() => { if (!cancelled) setFileError("Saved report files could not be restored. Try reopening this tab."); })
      .finally(() => { if (!cancelled) setFilesBusy(false); });
    return () => { cancelled = true; };
  }, [teamId, user?.uid, canManage]);

  const handleSaveFiles = async () => {
    if (!user || !monthlyFile || !commonFile) return;
    setFilesBusy(true);
    setFileError("");
    setFileNotice("");
    try {
      const serialize = async (file: File) => ({
        name: file.name, type: file.type, lastModified: file.lastModified,
        bytes: await file.arrayBuffer(),
      });
      const [monthly, common] = await Promise.all([serialize(monthlyFile), serialize(commonFile)]);
      await accessLocalSpecializedTransitReports(teamId, user.uid, 'save', { monthly, common });
      setFileNotice("Report files saved in this browser. They will be ready when you return.");
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Report files could not be saved.");
    } finally {
      setFilesBusy(false);
    }
  };

  const handleForgetFiles = async () => {
    if (!user) return;
    setFilesBusy(true);
    setFileError("");
    try {
      await accessLocalSpecializedTransitReports(teamId, user.uid, 'clear');
      setMonthlyFile(null);
      setCommonFile(null);
      setFileNotice("Saved report files removed from this browser. Imported dashboard data is retained.");
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Saved files could not be removed.");
    } finally {
      setFilesBusy(false);
    }
  };
  const [locationEdit, setLocationEdit] = useState<LocationEditDraft | null>(
    null,
  );
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationCandidates, setLocationCandidates] = useState<
    SpecializedTransitLocationCandidate[]
  >([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const candidateRequest = useRef(0);
  const currentLocationEdit = useRef(locationEdit);
  currentLocationEdit.current = locationEdit;
  useEffect(() => () => { candidateRequest.current += 1; }, []);
  const [locationQueueFilter, setLocationQueueFilter] =
    useState<LocationQueueFilter>("needs-review");
  const [resolutionNotice, setResolutionNotice] = useState("");
  const [permanentUsage, setPermanentUsage] = useState(() =>
    getSpecializedTransitPermanentGeocodingUsage(),
  );
  const unmappedResearchRows = useMemo(
    () => (dataset ? getSpecializedTransitUnmappedResearchRows(dataset) : []),
    [dataset],
  );

  const months = Object.keys(dataset?.months ?? {}).sort();
  const activeMonthKey =
    selectedMonth && dataset?.months[selectedMonth]
      ? selectedMonth
      : (months.at(-1) ?? "");
  const month = activeMonthKey
    ? (dataset?.months[activeMonthKey] ?? null)
    : null;
  const activeDateSet = useMemo(() => {
    if (!month) return new Set<string>();
    const monthDates = Object.keys(month.dailyTotals);
    return new Set(monthDates);
  }, [month]);
  const mapPoints = useMemo<SpecializedTransitMapPoint[]>(() => {
    if (!month || !dataset) return [];
    const totals = new Map<string, { pickups: number; dropoffs: number }>();
    for (const bucket of month.activityBuckets) {
      if (!activeDateSet.has(bucket.date)) continue;
      const current = totals.get(bucket.locationId) ?? {
        pickups: 0,
        dropoffs: 0,
      };
      current.pickups += bucket.pickups;
      current.dropoffs += bucket.dropoffs;
      totals.set(bucket.locationId, current);
    }
    return [...totals.entries()]
      .flatMap(([locationId, totalsForLocation]) => {
        const location = dataset.locations[locationId];
        return location ? [{ location, ...totalsForLocation }] : [];
      })
      .sort((a, b) => b.pickups + b.dropoffs - (a.pickups + a.dropoffs));
  }, [activeDateSet, dataset, month]);
  const dailyChart = useMemo(() => {
    if (!month) return [];
    const totals = new Map(
      DAY_ORDER.map((day) => [day, { total: 0, days: 0 }]),
    );
    for (const [date, value] of Object.entries(month.dailyTotals)) {
      if (!activeDateSet.has(date)) continue;
      const day = new Intl.DateTimeFormat("en-CA", {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date(`${date}T12:00:00Z`));
      const entry = totals.get(day)!;
      entry.total += value;
      entry.days += 1;
    }
    return DAY_ORDER.map((day) => ({
      day: day.slice(0, 3),
      average: totals.get(day)!.days
        ? totals.get(day)!.total / totals.get(day)!.days
        : 0,
    }));
  }, [activeDateSet, month]);
  const hourlyChart = useMemo(
    () =>
      month
        ? Object.entries(month.hourlyTotals)
            .map(([hour, total]) => ({
              hour: `${hour.padStart(2, "0")}:00`,
              total,
            }))
            .sort((a, b) => a.hour.localeCompare(b.hour))
        : [],
    [month],
  );
  const trend = months.map((key) => ({
    month: key,
    trips: dataset!.months[key].reportedTrips,
  }));
  const coordinateCollisionIds = useMemo(
    () =>
      getSpecializedTransitCoordinateCollisionIds(
        Object.values(dataset?.locations ?? {}),
      ),
    [dataset],
  );
  const displayMapPoints = useMemo(
    () =>
      mapPoints.map(
        (point) =>
          !coordinateCollisionIds.has(point.location.id) ||
          point.location.status === "reviewed" ||
          point.location.coordinateSource === "known-place"
            ? point
            : { ...point, location: { ...point.location, latitude: null, longitude: null } },
      ),
    [coordinateCollisionIds, mapPoints],
  );
  const mappedActivity = displayMapPoints
    .filter(
      (point) =>
        point.location.latitude !== null && point.location.longitude !== null,
    )
    .reduce((sum, point) => sum + point.pickups + point.dropoffs, 0);
  const totalActivity = mapPoints.reduce(
    (sum, point) => sum + point.pickups + point.dropoffs,
    0,
  );
  const locationQuality = useMemo(() => {
    const locations = Object.values(dataset?.locations ?? {});
    return {
      unresolved: locations.filter((location) => location.status === "unmapped")
        .length,
      automatic: locations.filter((location) => location.status === "automatic")
        .length,
      reviewed: locations.filter((location) => location.status === "reviewed")
        .length,
      collisions: coordinateCollisionIds.size,
    };
  }, [coordinateCollisionIds, dataset]);
  const visibleLocationPoints = useMemo(
    () =>
      mapPoints
        .filter((point) => {
          if (locationQueueFilter === "unmapped")
            return point.location.status === "unmapped";
          if (locationQueueFilter === "collisions")
            return coordinateCollisionIds.has(point.location.id);
          if (locationQueueFilter === "needs-review")
            return (
              point.location.status !== "reviewed" ||
              coordinateCollisionIds.has(point.location.id)
            );
          return true;
        })
        .slice(0, locationQueueFilter === "all" ? 50 : 100),
    [coordinateCollisionIds, locationQueueFilter, mapPoints],
  );

  const handleParseAndPublish = async () => {
    if (!monthlyFile || !commonFile || !user) return;
    setError("");
    try {
      setProgress("Reading monthly report...");
      const monthlyExtract = await extractPdf(monthlyFile);
      const parsedMonthly = parseMonthlySpecializedLines(monthlyExtract.lines);
      setProgress("Reading common locations...");
      const commonExtract = await extractPdf(commonFile, (page, total) =>
        setProgress(`Reading common locations: page ${page} of ${total}`),
      );
      const parsedCommon = parseCommonLocationLines(commonExtract.lines);
      const merged = mergeSpecializedTransitLocations(parsedCommon.locations, dataset?.locations ?? {});
      const common = {
        ...parsedCommon,
        locations: Object.fromEntries([...new Set(Object.values(merged.redirects))].map(id => [id, merged.locations[id]])),
        activityBuckets: remapSpecializedTransitBuckets(parsedCommon.activityBuckets, merged.redirects),
      };
      if (parsedMonthly.reportMonth !== common.reportMonth)
        throw new Error("The two reports cover different service months.");
      if (common.commonLocationBookings > parsedMonthly.reportedTrips)
        throw new Error(
          "Common-location bookings exceed the monthly Specialized Transit total.",
        );
      const gap = parsedMonthly.reportedTrips - common.commonLocationBookings;
      const monthlySource = sourceFileFromExtract(monthlyExtract);
      const commonSource = sourceFileFromExtract(commonExtract);
      const existingMonth = dataset?.months[common.reportMonth];
      const duplicate =
        !!existingMonth &&
        existingMonth.sources.monthlyReport.sha256 === monthlySource.sha256 &&
        existingMonth.sources.commonLocationsReport.sha256 ===
          commonSource.sha256;
      if (duplicate) {
        setSelectedMonth(common.reportMonth);
        setShowImporter(false);
        setResolutionNotice(
          "These reports are already saved. No Permanent Geocoding requests were used.",
        );
        return;
      }
      const existingLocations = dataset?.locations ?? {};
      const locations: Record<string, SpecializedTransitLocationV1> = {
        ...existingLocations,
      };
      const toGeocode: Array<{
        id: string;
        label: string;
        geocodeQuery: string;
      }> = [];
      for (const location of Object.values(common.locations)) {
        const previous = existingLocations[location.id];
        if (previous) {
          const reusable = hasReusableCoordinates(previous);
          locations[location.id] =
            previous.status === "reviewed" || reusable
              ? {
                  ...previous,
                  aliases: [
                    ...new Set([...previous.aliases, ...location.aliases]),
                  ],
                }
              : {
                  ...previous,
                  aliases: [
                    ...new Set([...previous.aliases, ...location.aliases]),
                  ],
                  latitude: null,
                  longitude: null,
                  status: "unmapped",
                  coordinateSource: null,
                  relevance: null,
                };
          if (previous.status !== "reviewed" && !reusable) {
            toGeocode.push({
              id: location.id,
              label: location.displayName,
              geocodeQuery: location.displayName,
            });
          }
        } else {
          locations[location.id] = location;
          toGeocode.push({
            id: location.id,
            label: location.displayName,
            geocodeQuery: location.displayName,
          });
        }
      }
      if (toGeocode.length > 0) {
        setProgress(`Locating ${toGeocode.length} common locations...`);
        try {
          const geocoded = await resolveSpecializedTransitLocations(toGeocode, {
            onProgress: (completed, total) =>
              setProgress(
                `Locating common locations: ${completed} of ${total}`,
              ),
          });
          for (const result of geocoded.geocodes) {
            const location = locations[result.originId];
            if (!location) continue;
            locations[result.originId] = {
              ...location,
              latitude: result.latitude,
              longitude: result.longitude,
              status: "automatic",
              coordinateSource: result.source,
              relevance: result.relevance,
            };
          }
          setResolutionNotice(locationResolutionNotice(geocoded, "need review"));
        } catch {
          // A missing Mapbox token must not prevent privacy-safe aggregate publication.
        }
        setPermanentUsage(getSpecializedTransitPermanentGeocodingUsage());
      }
      const now = new Date().toISOString();
      const monthValue: SpecializedTransitMonthV1 = {
        reportMonth: parsedMonthly.reportMonth,
        reportedTrips: parsedMonthly.reportedTrips,
        priorYearPercent: parsedMonthly.priorYearPercent,
        commonLocationBookings: common.commonLocationBookings,
        commonLocationCoverage:
          parsedMonthly.reportedTrips > 0
            ? common.commonLocationBookings / parsedMonthly.reportedTrips
            : 0,
        reconciliationGap: gap,
        reconciliationStatus:
          gap === 0 ? "reconciled" : "partial-common-location",
        reconciliationNote:
          gap > 0
            ? "Common-location export is a subset of the reported monthly total."
            : "",
        serviceDateRange: common.serviceDateRange,
        dailyTotals: common.dailyTotals,
        hourlyTotals: common.hourlyTotals,
        activityBuckets: common.activityBuckets,
        recurringDemand: common.recurringDemand,
        sources: {
          monthlyReport: monthlySource,
          commonLocationsReport: commonSource,
        },
        importedAt: now,
        importedBy: user.uid,
      };
      setProgress(
        localMode ? "Saving to this browser..." : "Publishing aggregate...",
      );
      const saved = await saveSpecializedTransitDataset({
        teamId,
        userId: user.uid,
        expectedRevision: dataset?.revision ?? 0,
        months: {
          ...(dataset?.months ?? {}),
          [monthValue.reportMonth]: monthValue,
        },
        locations,
      });
      queryClient.setQueryData(
        ["specializedTransitMetadata", teamId],
        saved.metadata,
      );
      queryClient.setQueryData(
        ["specializedTransitDataset", teamId, saved.metadata.storagePath],
        saved.dataset,
      );
      setSelectedMonth(monthValue.reportMonth);
      setShowImporter(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The reports could not be parsed and published.",
      );
    } finally {
      setProgress("");
    }
  };

  const beginLocationEdit = (location: SpecializedTransitLocationV1) => {
    candidateRequest.current += 1;
    setCandidateLoading(false);
    setLocationEdit({
      id: location.id,
      displayName: location.displayName,
      latitude: location.latitude === null ? "" : String(location.latitude),
      longitude: location.longitude === null ? "" : String(location.longitude),
      mergeTargetId: "",
      coordinateSource: location.coordinateSource,
    });
    setLocationCandidates([]);
    setError("");
  };

  const handleFindLocationCandidates = async () => {
    if (!locationEdit) return;
    const request = ++candidateRequest.current;
    const draft = locationEdit;
    const isCurrent = () => request === candidateRequest.current && currentLocationEdit.current?.id === draft.id && currentLocationEdit.current?.displayName === draft.displayName;
    setCandidateLoading(true);
    setError("");
    try {
      const candidates = await findSpecializedTransitLocationCandidates({
        id: locationEdit.id,
        label: locationEdit.displayName,
      });
      if (!isCurrent()) return;
      setLocationCandidates(candidates);
      if (candidates.length === 0)
        setError(
          "No Barrie candidates were found. Enter the coordinates manually or merge this alias.",
        );
    } catch (cause) {
      if (!isCurrent()) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Location suggestions could not be loaded.",
      );
    } finally {
      setPermanentUsage(getSpecializedTransitPermanentGeocodingUsage());
      if (request === candidateRequest.current) setCandidateLoading(false);
    }
  };

  const handleRecheckLocations = async () => {
    if (!dataset || !user) return;
    setError("");
    setResolutionNotice("");
    const locations = { ...dataset.locations };
    const targets = Object.values(locations).filter(
      (location) =>
        location.status !== "reviewed" && !hasReusableCoordinates(location),
    );
    if (targets.length === 0) {
      setResolutionNotice(
        "Every location is already saved or reviewed. No Permanent Geocoding requests were used.",
      );
      return;
    }
    for (const target of targets) {
      locations[target.id] = {
        ...target,
        latitude: null,
        longitude: null,
        status: "unmapped",
        coordinateSource: null,
        relevance: null,
      };
    }
    try {
      setProgress(`Rechecking ${targets.length.toLocaleString()} locations...`);
      const resolved = await resolveSpecializedTransitLocations(
        targets.map((location) => ({
          id: location.id,
          label: location.displayName,
        })),
        {
          onProgress: (completed, total) =>
            setProgress(`Rechecking locations: ${completed} of ${total}`),
        },
      );
      for (const result of resolved.geocodes) {
        const location = locations[result.originId];
        if (!location) continue;
        locations[result.originId] = {
          ...location,
          latitude: result.latitude,
          longitude: result.longitude,
          status: "automatic",
          coordinateSource: result.source,
          relevance: result.relevance,
        };
      }
      setProgress(
        localMode
          ? "Saving corrected locations to this browser..."
          : "Publishing corrected locations...",
      );
      const saved = await saveSpecializedTransitDataset({
        teamId,
        userId: user.uid,
        expectedRevision: dataset.revision,
        months: dataset.months,
        locations,
      });
      queryClient.setQueryData(
        ["specializedTransitMetadata", teamId],
        saved.metadata,
      );
      queryClient.setQueryData(
        ["specializedTransitDataset", teamId, saved.metadata.storagePath],
        saved.dataset,
      );
      setResolutionNotice(
        locationResolutionNotice(resolved, "remain in the review queue"),
      );
      setLocationQueueFilter("needs-review");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Locations could not be rechecked.",
      );
    } finally {
      setPermanentUsage(getSpecializedTransitPermanentGeocodingUsage());
      setProgress("");
    }
  };

  const handleCopyUnmappedLocations = async () => {
    if (!dataset || unmappedResearchRows.length === 0) {
      setResolutionNotice("There are no unmapped locations to copy.");
      return;
    }
    setError("");
    try {
      await navigator.clipboard.writeText(
        buildSpecializedTransitUnmappedResearchText(dataset),
      );
      setResolutionNotice(
        `${unmappedResearchRows.length.toLocaleString()} unmapped locations copied in activity-priority order. Paste the list into this chat.`,
      );
    } catch {
      setError(
        "The browser blocked clipboard access. Keep this tab active and try Copy unmapped list again.",
      );
    }
  };

  const handleLocationSave = async () => {
    if (!dataset || !user || !locationEdit) return;
    const source = dataset.locations[locationEdit.id];
    if (!source) return;
    const displayName = normalizeSpecializedLocationName(
      locationEdit.displayName,
    );
    const latitude =
      locationEdit.latitude.trim() === ""
        ? null
        : Number(locationEdit.latitude);
    const longitude =
      locationEdit.longitude.trim() === ""
        ? null
        : Number(locationEdit.longitude);
    if (!displayName) {
      setError("Location name is required.");
      return;
    }
    if (
      (latitude === null) !== (longitude === null) ||
      (latitude !== null &&
        (!Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !isInBarrieAnalysisArea(latitude, longitude!)))
    ) {
      setError("Enter both coordinates inside Barrie, or leave both blank.");
      return;
    }
    setLocationSaving(true);
    setError("");
    try {
      const locations = { ...dataset.locations };
      let months = dataset.months;
      if (locationEdit.mergeTargetId) {
        const target = locations[locationEdit.mergeTargetId];
        if (!target || target.id === source.id)
          throw new Error("Select a different valid merge target.");
        locations[target.id] = {
          ...target,
          aliases: [
            ...new Set([
              ...target.aliases,
              source.displayName,
              ...source.aliases,
            ]),
          ],
        };
        delete locations[source.id];
        months = Object.fromEntries(
          Object.entries(dataset.months).map(([monthKey, monthValue]) => {
            const consolidated = new Map<
              string,
              (typeof monthValue.activityBuckets)[number]
            >();
            for (const bucket of monthValue.activityBuckets) {
              const locationId =
                bucket.locationId === source.id ? target.id : bucket.locationId;
              const key = `${bucket.date}|${bucket.hour}|${locationId}`;
              const existing = consolidated.get(key) ?? {
                ...bucket,
                locationId,
                pickups: 0,
                dropoffs: 0,
              };
              existing.pickups += bucket.pickups;
              existing.dropoffs += bucket.dropoffs;
              consolidated.set(key, existing);
            }
            return [
              monthKey,
              { ...monthValue, activityBuckets: [...consolidated.values()] },
            ];
          }),
        );
      } else {
        locations[source.id] = {
          ...source,
          displayName,
          aliases: [
            ...new Set([...source.aliases, source.displayName, displayName]),
          ],
          latitude,
          longitude,
          status: latitude === null ? "unmapped" : "reviewed",
          coordinateSource:
            latitude === null
              ? null
              : (locationEdit.coordinateSource ?? "manual"),
          relevance: latitude === null ? null : 1,
        };
      }
      const saved = await saveSpecializedTransitDataset({
        teamId,
        userId: user.uid,
        expectedRevision: dataset.revision,
        months,
        locations,
      });
      queryClient.setQueryData(
        ["specializedTransitMetadata", teamId],
        saved.metadata,
      );
      queryClient.setQueryData(
        ["specializedTransitDataset", teamId, saved.metadata.storagePath],
        saved.dataset,
      );
      setLocationEdit(null);
      setLocationCandidates([]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The location could not be saved.",
      );
    } finally {
      setLocationSaving(false);
    }
  };

  const handleClearLocalData = async () => {
    if (
      !window.confirm(
        "Clear the Specialized Transit dashboard data stored in this browser? Saved report files will be retained so you can parse them again.",
      )
    )
      return;
    setError("");
    try {
      await clearLocalSpecializedTransitDataset(teamId);
      queryClient.removeQueries({
        queryKey: ["specializedTransitDataset", teamId],
      });
      queryClient.setQueryData(["specializedTransitMetadata", teamId], null);
      setSelectedMonth("");
      setLocationEdit(null);
      setLocationCandidates([]);
      setShowImporter(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Local Specialized Transit data could not be cleared.",
      );
    }
  };

  if (metadataQuery.isLoading || datasetQuery.isLoading)
    return (
      <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm text-gray-500">
        <Loader2 className="animate-spin text-cyan-600" size={18} /> Loading
        Specialized Transit data...
      </div>
    );
  if (metadataQuery.isError || datasetQuery.isError)
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
      >
        Specialized Transit data could not be loaded. Check access and try
        again.
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Accessibility className="text-cyan-700" size={22} />
            <h2 className="text-xl font-bold text-gray-900">
              Specialized Transit
            </h2>
            {localMode && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                Local browser data
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Monthly demand, recurring-use indicators, and privacy-safe
            common-location activity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {months.length > 0 && (
            <select
              aria-label="Specialized Transit report month"
              value={activeMonthKey}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700"
            >
              {months.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                </option>
              ))}
            </select>
          )}
          {localMode && dataset && (
            <button
              type="button"
              onClick={() => void handleClearLocalData()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              <Trash2 size={15} /> Clear local data
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setShowImporter((value) => !value);
                setError("");
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white hover:bg-blue-600"
            >
              <FileUp size={16} />{" "}
              {showImporter ? "Close import" : "Import reports"}
            </button>
          )}
        </div>
      </div>

      {canManage && (showImporter || !dataset) && (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 text-cyan-700" size={20} />
            <div>
              <h3 className="font-bold text-gray-900">
                Privacy-safe report import
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                {localMode
                  ? "PDFs, identifiers, and the resulting aggregate remain in this browser. Nothing is uploaded to Firebase. New location names may still be sent to Mapbox for Barrie-bounded geocoding. Selecting Parse and view locally saves the privacy-minimized aggregate in this browser and updates the map."
                  : "PDFs and identifiers remain in this browser. Only aggregate counts and public common-location names are saved. New location names may be sent to Mapbox for Barrie-bounded geocoding. Selecting Parse and publish is your approval to save the privacy-minimized aggregate and update the map."}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-gray-700">
              Monthly Ridership Report
              <input
                key={monthlyFile?.name ?? "no-monthly-file"}
                type="file"
                disabled={filesBusy || !!progress}
                accept="application/pdf,.pdf"
                onChange={(event) =>
                  { setMonthlyFile(event.target.files?.[0] ?? null); setFileNotice(""); }
                }
                className="mt-1 block w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
              />
              {monthlyFile && <span className="mt-1 block font-normal">Selected: {monthlyFile.name}</span>}
            </label>
            <label className="text-xs font-bold text-gray-700">
              Ridership by Common Locations
              <input
                key={commonFile?.name ?? "no-common-file"}
                type="file"
                disabled={filesBusy || !!progress}
                accept="application/pdf,.pdf"
                onChange={(event) =>
                  { setCommonFile(event.target.files?.[0] ?? null); setFileNotice(""); }
                }
                className="mt-1 block w-full rounded-lg border border-gray-200 bg-white p-2 text-xs"
              />
              {commonFile && <span className="mt-1 block font-normal">Selected: {commonFile.name}</span>}
            </label>
          </div>
          <p className="mt-3 text-xs text-gray-600">Save the selected pair to reuse it after closing this tab or refreshing. Files stay in this browser for your account and team; saving another pair replaces these files. Clearing browser data removes them.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleSaveFiles()} disabled={filesBusy || !!progress || !monthlyFile || !commonFile || !user} className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold disabled:opacity-50">{filesBusy ? "Loading or saving files..." : "Save report files"}</button>
            <button type="button" onClick={() => void handleForgetFiles()} disabled={filesBusy || !!progress || !user} className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold disabled:opacity-50">Remove saved files</button>
          </div>
          {fileNotice && <p role="status" className="mt-2 text-xs text-gray-600">{fileNotice}</p>}
          {fileError && <p role="alert" className="mt-2 text-sm text-red-700">{fileError}</p>}
          <button
            type="button"
            disabled={!monthlyFile || !commonFile || !user || !!progress || filesBusy}
            onClick={() => void handleParseAndPublish()}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {progress ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <FileUp size={15} />
            )}
            {progress ||
              (localMode ? "Parse and view locally" : "Parse and publish")}
          </button>
          {error && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </div>
          )}
        </section>
      )}

      {!month ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <MapPin className="mx-auto text-gray-400" size={28} />
          <h3 className="mt-3 font-bold text-gray-900">
            {localMode
              ? "No local Specialized Transit data"
              : "No Specialized Transit month published"}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {localMode
              ? "Select both reports above to create a privacy-safe view stored only in this browser."
              : canManage
                ? "Select both August reports above to create the first privacy-safe management view."
                : "A manager has not published Specialized Transit aggregates yet."}
          </p>
        </div>
      ) : (
        <>
          <div
            className={`rounded-xl border p-4 ${month.reconciliationStatus === "reconciled" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
          >
            <div className="flex items-start gap-3">
              {month.reconciliationStatus === "reconciled" ? (
                <CheckCircle2 className="text-emerald-700" size={20} />
              ) : (
                <AlertTriangle className="text-amber-700" size={20} />
              )}
              <div>
                <div className="font-bold text-gray-900">
                  {month.reconciliationStatus === "reconciled"
                    ? "Reports reconcile"
                    : "Partial common-location coverage"}
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  {month.reportedTrips.toLocaleString()} monthly trips versus{" "}
                  {month.commonLocationBookings.toLocaleString()}{" "}
                  common-location bookings:{" "}
                  {month.reconciliationGap.toLocaleString()} difference,{" "}
                  {formatPercent(month.commonLocationCoverage)} coverage.
                </p>
                {month.reconciliationNote && (
                  <p className="mt-2 text-xs text-gray-600">
                    {month.reconciliationNote}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Reported trips"
              value={month.reportedTrips.toLocaleString()}
              detail={`${month.priorYearPercent ?? "—"}% of prior-year specialized ridership`}
            />
            <Kpi
              label="Common bookings"
              value={month.commonLocationBookings.toLocaleString()}
              detail={`${month.serviceDateRange.start} to ${month.serviceDateRange.end}`}
            />
            <Kpi
              label="Distinct ClientId values"
              value={month.recurringDemand.distinctClientIds.toLocaleString()}
              detail="Identifiers are not retained"
            />
            <Kpi
              label="Mapped activity"
              value={
                totalActivity
                  ? formatPercent(mappedActivity / totalActivity)
                  : "—"
              }
              detail={`${mappedActivity.toLocaleString()} of ${totalActivity.toLocaleString()} endpoint touches`}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm xl:col-span-2">
              <h3 className="font-bold text-gray-900">Exact monthly trend</h3>
              <p className="mt-1 text-xs text-gray-500">
                Begins with exact imported reports; chart values are never
                estimated from PDF graphics.
              </p>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => value.toLocaleString()}
                    />
                    <Line
                      type="monotone"
                      dataKey="trips"
                      stroke="#0891B2"
                      strokeWidth={3}
                      dot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {trend.length === 1 && (
                <p className="text-center text-xs text-amber-700">
                  Trend begins with this month; the line will grow as exact
                  reports are imported.
                </p>
              )}
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-bold text-gray-900">
                Recurring-demand indicators
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Aggregate frequency signals, not identified customers or
                confirmed subscription trips.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-xs text-gray-500">
                    Median bookings per ClientId
                  </div>
                  <div className="text-xl font-black text-gray-900">
                    {month.recurringDemand.medianBookingsPerClient.toLocaleString()}
                  </div>
                </div>
                {month.recurringDemand.thresholds
                  .filter(
                    (item) =>
                      item.minimumBookings === 8 || item.minimumBookings === 20,
                  )
                  .map((item) => (
                    <div
                      key={item.minimumBookings}
                      className="rounded-lg bg-gray-50 p-3"
                    >
                      <div className="text-sm font-bold text-gray-900">
                        {item.clientCount.toLocaleString()} ClientId values with{" "}
                        {item.minimumBookings}+ bookings
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatPercent(item.bookingShare)} of common-location
                        bookings
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="font-bold text-gray-900">
                Average bookings by day
              </h3>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) =>
                        value.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })
                      }
                    />
                    <Bar
                      dataKey="average"
                      fill="#0EA5E9"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-gray-900">
                    Scheduled pickup time
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    These are booked pickup times, not observed vehicle
                    arrivals.
                  </p>
                </div>
              </div>
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10 }}
                      interval={1}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="total" fill="#6366F1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="text-amber-700" size={18} />
                  <h3 className="font-bold text-gray-900">Location quality</h3>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-600">
                  Permanent Mapbox matches are searched once and saved for
                  reuse. Automatic matches require a meaningful name or address
                  match inside the Barrie analysis area; uncertain results and
                  repeated-coordinate clusters remain in review.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-white px-2.5 py-1 text-red-700">
                    {locationQuality.unresolved.toLocaleString()} unresolved
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-amber-700">
                    {locationQuality.automatic.toLocaleString()} automatic
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-violet-700">
                    {locationQuality.collisions.toLocaleString()} sharing
                    coordinates
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-emerald-700">
                    {locationQuality.reviewed.toLocaleString()} reviewed
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-cyan-800">
                    {permanentUsage.used.toLocaleString()} /{" "}
                    {permanentUsage.limit.toLocaleString()} permanent searches
                    in {permanentUsage.month}
                  </span>
                </div>
                {resolutionNotice && (
                  <p
                    role="status"
                    className="mt-3 text-xs font-semibold text-gray-700"
                  >
                    {resolutionNotice}
                  </p>
                )}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={unmappedResearchRows.length === 0}
                    onClick={() => void handleCopyUnmappedLocations()}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ClipboardCopy size={15} />
                    Copy unmapped list
                  </button>
                  <button
                    type="button"
                    disabled={!!progress || permanentUsage.remaining === 0}
                    onClick={() => void handleRecheckLocations()}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {progress ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{" "}
                    {progress || "Resolve unmapped locations"}
                  </button>
                </div>
              )}
            </div>
          </section>
          <SpecializedTransitMap points={displayMapPoints} />
          <details className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-gray-600">Location review tools</summary>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-gray-900">
                  Common-location review queue
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  Locations are ordered by activity in the selected scope.
                  Review unresolved and automatic coordinates or merge report
                  aliases.
                </p>
              </div>
              {canManage && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                  Automatic locations need review
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["needs-review", "Needs review"],
                  ["unmapped", "Unmapped"],
                  ["collisions", "Shared coordinates"],
                  ["all", "Top 50"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocationQueueFilter(value)}
                  className={`min-h-10 rounded-lg border px-3 text-xs font-bold ${locationQueueFilter === value ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {locationEdit && (
              <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50/40 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900">
                    Review common location
                  </h4>
                  <button
                    type="button"
                    aria-label="Close location editor"
                    onClick={() => {
                      setLocationEdit(null);
                      setLocationCandidates([]);
                    }}
                    className="rounded-md p-2 text-gray-500 hover:bg-white"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="text-xs font-bold text-gray-700 xl:col-span-2">
                    Display name
                    <input
                      value={locationEdit.displayName}
                      onChange={(event) =>
                        setLocationEdit({
                          ...locationEdit,
                          displayName: event.target.value,
                        })
                      }
                      className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-700">
                    Latitude
                    <input
                      inputMode="decimal"
                      value={locationEdit.latitude}
                    onChange={(event) =>
                      setLocationEdit({
                        ...locationEdit,
                        latitude: event.target.value,
                        coordinateSource: 'manual',
                      })
                      }
                      className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-700">
                    Longitude
                    <input
                      inputMode="decimal"
                      value={locationEdit.longitude}
                    onChange={(event) =>
                      setLocationEdit({
                        ...locationEdit,
                        longitude: event.target.value,
                        coordinateSource: 'manual',
                      })
                      }
                      className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-bold text-gray-700 md:col-span-2 xl:col-span-4">
                    Merge this alias into another location (optional)
                    <select
                      value={locationEdit.mergeTargetId}
                      onChange={(event) =>
                        setLocationEdit({
                          ...locationEdit,
                          mergeTargetId: event.target.value,
                        })
                      }
                      className="mt-1 min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal"
                    >
                      <option value="">Do not merge</option>
                      {Object.values(dataset.locations)
                        .filter((location) => location.id !== locationEdit.id)
                        .sort((a, b) =>
                          a.displayName.localeCompare(b.displayName),
                        )
                        .map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={candidateLoading}
                    onClick={() => void handleFindLocationCandidates()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-bold text-cyan-800 hover:bg-cyan-50 disabled:opacity-50"
                  >
                    {candidateLoading ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Search size={14} />
                    )}{" "}
                    Find suggestions
                  </button>
                  <span className="text-xs text-gray-500">
                    Suggestions are not applied until you save this review.
                  </span>
                </div>
                {locationCandidates.length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {locationCandidates.map((candidate) => (
                      <button
                        key={`${candidate.source}-${candidate.latitude}-${candidate.longitude}`}
                        type="button"
                        onClick={() =>
                          setLocationEdit({
                            ...locationEdit,
                            latitude: String(candidate.latitude),
                            longitude: String(candidate.longitude),
                            coordinateSource: candidate.source,
                          })
                        }
                        className="rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-cyan-300 hover:bg-cyan-50"
                      >
                        <div className="text-xs font-bold text-gray-900">
                          {candidate.displayName}
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          {candidate.source === "known-place"
                            ? "Barrie directory"
                            : `${Math.round(candidate.semanticScore * 100)}% name match`}{" "}
                          ·{" "}
                          {candidate.trusted
                            ? "trusted candidate"
                            : "manual review only"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  disabled={locationSaving}
                  onClick={() => void handleLocationSave()}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-700 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {locationSaving && (
                    <Loader2 className="animate-spin" size={15} />
                  )}
                  {locationEdit.mergeTargetId
                    ? "Merge and save revision"
                    : "Save reviewed location"}
                </button>
              </div>
            )}
            {error && !showImporter && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {error}
              </div>
            )}
            {visibleLocationPoints.length === 0 ? (
              <div className="mt-4 rounded-lg bg-gray-50 p-5 text-center text-sm text-gray-500">
                No locations match this review filter.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2 text-right">Pickups</th>
                      <th className="px-3 py-2 text-right">Drop-offs</th>
                      <th className="px-3 py-2">Map status</th>
                      {canManage && (
                        <th className="px-3 py-2">
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLocationPoints.map((point) => (
                      <tr
                        key={point.location.id}
                        className="border-t border-gray-100"
                      >
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {point.location.displayName}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {point.pickups.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {point.dropoffs.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={`rounded-full px-2 py-1 font-semibold ${point.location.status === "unmapped" ? "bg-red-50 text-red-700" : coordinateCollisionIds.has(point.location.id) ? "bg-violet-50 text-violet-700" : point.location.status === "reviewed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                          >
                            {point.location.status === "unmapped"
                              ? "Unmapped"
                              : coordinateCollisionIds.has(point.location.id)
                                ? "Shared coordinate"
                                : point.location.status === "reviewed"
                                  ? "Reviewed"
                                  : "Automatic"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => beginLocationEdit(point.location)}
                              className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-xs font-bold text-cyan-700 hover:bg-cyan-50"
                            >
                              <Pencil size={13} /> Review
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600">
            <div className="font-bold text-gray-900">Interpretation limits</div>
            <p className="mt-2">
              Trips are reported service activity; ClientId values are not
              verified unique people. Common-location bookings are a subset of
              the monthly total. The map excludes N/A/private endpoints and
              counts endpoint touches, not unique riders. Pickup times are
              scheduled, not actual. These reports do not measure on-time
              performance, denials, cancellations, vehicle productivity, travel
              time, occupancy, or cost.
            </p>
          </section>
        </>
      )}
    </div>
  );
};

export default SpecializedTransitModule;
