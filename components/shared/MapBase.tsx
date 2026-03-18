import React, { useCallback, useEffect, useRef, useState } from 'react';
import Map, { NavigationControl, ScaleControl, MapRef } from 'react-map-gl/mapbox';
import type { MapMouseEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

/** Barrie, ON city center */
const BARRIE_CENTER = { longitude: -79.69, latitude: 44.38 };

export interface MapBaseProps {
    longitude?: number;
    latitude?: number;
    zoom?: number;
    mapStyle?: string;
    preserveDrawingBuffer?: boolean;
    interactive?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    onLoad?: () => void;
    showNavigation?: boolean;
    showScale?: boolean;
    mapRef?: React.RefObject<MapRef | null>;
    /** Layer IDs that receive pointer events (required for onMouseMove/onClick feature queries) */
    interactiveLayerIds?: string[];
    onMouseMove?: (e: MapMouseEvent) => void;
    onMouseLeave?: (e: MapMouseEvent) => void;
    onClick?: (e: MapMouseEvent) => void;
}

export const MapBase: React.FC<MapBaseProps> = ({
    longitude = BARRIE_CENTER.longitude,
    latitude = BARRIE_CENTER.latitude,
    zoom = 13,
    mapStyle = 'mapbox://styles/mapbox/light-v11',
    preserveDrawingBuffer = false,
    interactive = true,
    className,
    style,
    children,
    onLoad,
    showNavigation,
    showScale,
    mapRef,
    interactiveLayerIds,
    onMouseMove,
    onMouseLeave,
    onClick,
}) => {
    const [mapFailed, setMapFailed] = useState(false);
    const isMountedRef = useRef(true);
    const mapFailedRef = useRef(false);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        mapFailedRef.current = false;
        setMapFailed(false);
    }, [latitude, longitude, mapStyle, zoom]);

    const handleMapError = useCallback((event: unknown) => {
        console.error('Mapbox map error', event);

        // react-map-gl can surface map/layer errors while a child Layer is still
        // rendering. Defer the fallback state change to avoid setState-in-render
        // warnings from React.
        queueMicrotask(() => {
            if (!isMountedRef.current || mapFailedRef.current) return;
            mapFailedRef.current = true;
            setMapFailed(true);
        });
    }, []);

    if (!MAPBOX_TOKEN) {
        return (
            <div className={className} style={{ width: '100%', height: '100%', minHeight: 300, ...style }}>
                <div className="grid h-full min-h-[300px] place-items-center border border-dashed border-amber-300 bg-amber-50 p-6 text-center" style={{ borderRadius: 'inherit' }}>
                    <div className="max-w-sm">
                        <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-amber-700">Map unavailable</div>
                        <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-900">
                            <code>VITE_MAPBOX_TOKEN</code> is missing, so the map cannot load on this local environment.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (mapFailed) {
        return (
            <div className={className} style={{ width: '100%', height: '100%', minHeight: 300, ...style }}>
                <div className="grid h-full min-h-[300px] place-items-center border border-dashed border-amber-300 bg-amber-50 p-6 text-center" style={{ borderRadius: 'inherit' }}>
                    <div className="max-w-sm">
                        <div className="text-sm font-extrabold uppercase tracking-[0.16em] text-amber-700">Map failed to load</div>
                        <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-900">
                            Mapbox could not initialize. Check the token, browser console, and network access.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={className} style={{ width: '100%', height: '100%', minHeight: 300 }}>
            <Map
                ref={mapRef}
                mapboxAccessToken={MAPBOX_TOKEN}
                initialViewState={{ longitude, latitude, zoom }}
                mapStyle={mapStyle}
                preserveDrawingBuffer={preserveDrawingBuffer}
                interactive={interactive}
                style={{ width: '100%', height: '100%', ...style }}
                onLoad={onLoad}
                scrollZoom={true}
                dragRotate={false}
                pitchWithRotate={false}
                interactiveLayerIds={interactiveLayerIds}
                onMouseMove={onMouseMove}
                onMouseLeave={onMouseLeave}
                onClick={onClick}
                onError={handleMapError}
            >
                {showNavigation && <NavigationControl position="bottom-right" />}
                {showScale && <ScaleControl position="bottom-left" unit="metric" />}
                {children}
            </Map>
        </div>
    );
};
