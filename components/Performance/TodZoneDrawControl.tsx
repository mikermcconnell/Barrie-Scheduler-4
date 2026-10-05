import { useCallback, useEffect, useRef } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { useControl, useMap } from 'react-map-gl/mapbox';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import type { TodZonePolygon } from '../../utils/todZones/todZoneTypes';

interface TodZoneDrawControlProps {
    polygons: TodZonePolygon[];
    activeZoneCode: string;
    onChange: (polygons: TodZonePolygon[]) => void;
}

type EditableMapboxDraw = MapboxDraw & {
    set: (collection: GeoJSON.FeatureCollection) => string[];
    setFeatureProperty: (featureId: string, property: string, value: unknown) => void;
};

function toFeatureCollection(polygons: TodZonePolygon[]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: polygons.map(polygon => ({
            id: polygon.id,
            type: 'Feature',
            properties: { zoneCode: polygon.zoneCode, pocketName: polygon.pocketName },
            geometry: { type: 'Polygon', coordinates: [polygon.coordinates] },
        })),
    };
}

function fromDraw(draw: MapboxDraw): TodZonePolygon[] {
    return draw.getAll().features.flatMap((feature, index) => {
        if (feature.geometry.type !== 'Polygon') return [];
        const properties = feature.properties ?? {};
        return [{
            id: String(feature.id ?? `zone-polygon-${Date.now()}-${index}`),
            zoneCode: String(properties.zoneCode ?? ''),
            pocketName: String(properties.pocketName ?? `Zone ${String(properties.zoneCode ?? '')} area`),
            coordinates: feature.geometry.coordinates[0] as [number, number][],
        }];
    });
}

export const TodZoneDrawControl: React.FC<TodZoneDrawControlProps> = ({ polygons, activeZoneCode, onChange }) => {
    const { current: mapRef } = useMap();
    const activeZoneRef = useRef(activeZoneCode);
    const onChangeRef = useRef(onChange);
    const localSignatureRef = useRef('');
    useEffect(() => { activeZoneRef.current = activeZoneCode; }, [activeZoneCode]);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    const draw = useControl<MapboxDraw>(() => new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: 'simple_select',
        userProperties: true,
    } as unknown as ConstructorParameters<typeof MapboxDraw>[0]), { position: 'top-right' });
    const editableDraw = draw as EditableMapboxDraw;

    const emit = useCallback(() => {
        const next = fromDraw(draw);
        localSignatureRef.current = JSON.stringify(next);
        onChangeRef.current(next);
    }, [draw]);

    useEffect(() => {
        const signature = JSON.stringify(polygons);
        if (signature === localSignatureRef.current) return;
        editableDraw.set(toFeatureCollection(polygons));
        localSignatureRef.current = signature;
    }, [editableDraw, polygons]);

    useEffect(() => {
        const map = mapRef?.getMap();
        if (!map) return;
        // Mapbox Draw custom events are not included in mapbox-gl's public event typings.
        const eventMap = map as any;
        const handleCreate = (event: { features: GeoJSON.Feature[] }) => {
            for (const feature of event.features) {
                if (feature.id == null) continue;
                editableDraw.setFeatureProperty(String(feature.id), 'zoneCode', activeZoneRef.current);
                editableDraw.setFeatureProperty(String(feature.id), 'pocketName', `Zone ${activeZoneRef.current} area`);
            }
            emit();
        };
        eventMap.on('draw.create', handleCreate);
        eventMap.on('draw.update', emit);
        eventMap.on('draw.delete', emit);
        return () => {
            eventMap.off('draw.create', handleCreate);
            eventMap.off('draw.update', emit);
            eventMap.off('draw.delete', emit);
        };
    }, [draw, editableDraw, emit, mapRef]);

    return null;
};
