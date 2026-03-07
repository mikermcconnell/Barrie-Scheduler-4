import { useEffect, useRef, useCallback } from 'react';
import { useControl, useMap } from 'react-map-gl/mapbox';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

export interface DrawControlProps {
    /** Called when a polygon is created. Receives [lng, lat] coordinate pairs. */
    onCreate?: (coords: [number, number][]) => void;
    /** Called when a polygon is edited. Receives updated [lng, lat] coordinate pairs. */
    onUpdate?: (coords: [number, number][]) => void;
    /** Called when a polygon is deleted. */
    onDelete?: () => void;
    /** Position of the draw controls on the map. Defaults to 'top-right'. */
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    /** Polygon fill color. Defaults to blue. */
    fillColor?: string;
    /** Polygon line color. Defaults to blue. */
    lineColor?: string;
}

function extractCoords(e: { features: GeoJSON.Feature[] }): [number, number][] | null {
    const feature = e.features[0];
    if (!feature || feature.geometry.type !== 'Polygon') return null;
    return (feature.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][];
}

export const DrawControl: React.FC<DrawControlProps> = ({
    onCreate,
    onUpdate,
    onDelete,
    position = 'top-right',
    fillColor = '#3B82F6',
    lineColor = '#1D4ED8',
}) => {
    const onCreateRef = useRef(onCreate);
    const onUpdateRef = useRef(onUpdate);
    const onDeleteRef = useRef(onDelete);

    useEffect(() => { onCreateRef.current = onCreate; }, [onCreate]);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
    useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

    const { current: mapRef } = useMap();

    const handleCreate = useCallback((e: { features: GeoJSON.Feature[] }) => {
        const coords = extractCoords(e);
        if (coords && onCreateRef.current) onCreateRef.current(coords);
    }, []);

    const handleUpdate = useCallback((e: { features: GeoJSON.Feature[] }) => {
        const coords = extractCoords(e);
        if (coords && onUpdateRef.current) onUpdateRef.current(coords);
    }, []);

    const handleDelete = useCallback(() => {
        if (onDeleteRef.current) onDeleteRef.current();
    }, []);

    const draw = useControl<MapboxDraw>(
        () => new MapboxDraw({
            displayControlsDefault: false,
            controls: { polygon: true, trash: true },
            defaultMode: 'simple_select',
            styles: [
                {
                    id: 'gl-draw-polygon-fill',
                    type: 'fill',
                    filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                    paint: { 'fill-color': fillColor, 'fill-opacity': 0.25 },
                },
                {
                    id: 'gl-draw-polygon-stroke',
                    type: 'line',
                    filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                    paint: { 'line-color': lineColor, 'line-width': 2 },
                },
                {
                    id: 'gl-draw-point',
                    type: 'circle',
                    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
                    paint: { 'circle-radius': 5, 'circle-color': lineColor },
                },
            ],
        }),
        { position }
    );

    // Register draw events on the map instance
    // mapbox-gl-draw fires custom events not in mapbox-gl's type defs
    useEffect(() => {
        const map = mapRef?.getMap();
        if (!map) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = map as any;
        m.on('draw.create', handleCreate);
        m.on('draw.update', handleUpdate);
        m.on('draw.delete', handleDelete);

        return () => {
            m.off('draw.create', handleCreate);
            m.off('draw.update', handleUpdate);
            m.off('draw.delete', handleDelete);
        };
    }, [mapRef, handleCreate, handleUpdate, handleDelete]);

    // The default trash button only deletes selected features. After any map
    // interaction (clicking markers, panning) the polygon gets deselected and
    // trash does nothing. Override: delete ALL features regardless of selection.
    useEffect(() => {
        const map = mapRef?.getMap();
        if (!map || !draw) return;

        const container = map.getContainer();
        const trashBtn = container.querySelector('.mapbox-gl-draw_trash') as HTMLElement | null;
        if (!trashBtn) return;

        const handleTrashClick = (e: MouseEvent) => {
            const allFeatures = draw.getAll();
            if (allFeatures.features.length === 0) return;
            e.stopPropagation();
            draw.deleteAll();
            // API calls don't fire draw events, so invoke callback directly
            if (onDeleteRef.current) onDeleteRef.current();
        };

        trashBtn.addEventListener('click', handleTrashClick, true);
        return () => {
            trashBtn.removeEventListener('click', handleTrashClick, true);
        };
    }, [mapRef, draw]);

    return null;
};
