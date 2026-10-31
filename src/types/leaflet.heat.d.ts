declare module "leaflet.heat";

declare namespace L {
  interface HeatLatLngTuple extends Array<number> {
    0: number; // lat
    1: number; // lng
    2?: number; // intensity / weight
  }

  interface HeatMapOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: { [key: number]: string };
  }

  interface HeatLayer {
    addTo(map: any): this;
    setLatLngs(latlngs: Array<HeatLatLngTuple | [number, number]>): this;
    addLatLng(latlng: HeatLatLngTuple | [number, number]): this;
    setOptions(options: HeatMapOptions): this;
    redraw(): this;
  }

  function heatLayer(
    latlngs: Array<HeatLatLngTuple | [number, number]>,
    options?: HeatMapOptions
  ): HeatLayer;
}
