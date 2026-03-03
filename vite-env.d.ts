/// <reference types="vite/client" />

declare module 'leaflet.heat' {
    import * as L from 'leaflet';

    interface HeatLayerOptions {
        minOpacity?: number;
        maxZoom?: number;
        max?: number;
        radius?: number;
        blur?: number;
        gradient?: Record<number, string>;
    }

    interface HeatLayer extends L.Layer {
        setLatLngs(latlngs: Array<[number, number, number?]>): this;
        addLatLng(latlng: [number, number, number?]): this;
        setOptions(options: HeatLayerOptions): this;
        redraw(): this;
    }

    function heatLayer(
        latlngs: Array<[number, number, number?]>,
        options?: HeatLayerOptions,
    ): HeatLayer;

    export = heatLayer;
}

declare namespace L {
    function heatLayer(
        latlngs: Array<[number, number, number?]>,
        options?: import('leaflet.heat').HeatLayerOptions,
    ): import('leaflet.heat').HeatLayer;
}
