import React from 'react';
import Map, { NavigationControl, ScaleControl, MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

/** Barrie, ON city center */
const BARRIE_CENTER = { longitude: -79.69, latitude: 44.38 };

export interface MapBaseProps {
    longitude?: number;
    latitude?: number;
    zoom?: number;
    mapStyle?: string;
    interactive?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    onLoad?: () => void;
    showNavigation?: boolean;
    showScale?: boolean;
    mapRef?: React.RefObject<MapRef | null>;
}

export const MapBase: React.FC<MapBaseProps> = ({
    longitude = BARRIE_CENTER.longitude,
    latitude = BARRIE_CENTER.latitude,
    zoom = 13,
    mapStyle = 'mapbox://styles/mapbox/light-v11',
    interactive = true,
    className,
    style,
    children,
    onLoad,
    showNavigation,
    showScale,
    mapRef,
}) => {
    return (
        <div className={className} style={{ width: '100%', height: '100%', minHeight: 300 }}>
            <Map
                ref={mapRef}
                mapboxAccessToken={MAPBOX_TOKEN}
                initialViewState={{ longitude, latitude, zoom }}
                mapStyle={mapStyle}
                interactive={interactive}
                style={{ width: '100%', height: '100%', ...style }}
                onLoad={onLoad}
                scrollZoom={true}
                dragRotate={false}
                pitchWithRotate={false}
            >
                {showNavigation && <NavigationControl position="bottom-right" />}
                {showScale && <ScaleControl position="bottom-left" unit="metric" />}
                {children}
            </Map>
        </div>
    );
};
