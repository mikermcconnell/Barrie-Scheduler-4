import React from 'react';
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
            >
                {showNavigation && <NavigationControl position="bottom-right" />}
                {showScale && <ScaleControl position="bottom-left" unit="metric" />}
                {children}
            </Map>
        </div>
    );
};
