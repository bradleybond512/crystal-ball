import maplibregl from 'maplibre-gl';
import type { RouteResult, RouteCoord } from '@/services/routing-engine';
import type { GpsPosition } from '@/services/gps-tracker';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

function getMapStyle(): string | maplibregl.StyleSpecification {
  const cfg = getRuntimeConfigSnapshot();
  const mapboxKey = cfg.secrets['MAPBOX_API_KEY']?.value;
  const maptilerKey = cfg.secrets['MAPTILER_API_KEY']?.value;

  if (mapboxKey) {
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${mapboxKey}`;
  }
  if (maptilerKey) {
    return `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${maptilerKey}`;
  }

  return {
    version: 8 as const,
    sources: {
      osm: {
        type: 'raster' as const,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'osm-tiles',
        type: 'raster' as const,
        source: 'osm',
      },
    ],
  };
}

export class NavigationPanel {
  private container: HTMLElement;
  private root: HTMLDivElement;
  private mapContainer: HTMLDivElement;
  private directionsContainer: HTMLDivElement;
  private map: maplibregl.Map | null = null;
  private gpsMarker: maplibregl.Marker | null = null;
  private _visible = false;
  private onClose: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.root = document.createElement('div');
    this.mapContainer = document.createElement('div');
    this.directionsContainer = document.createElement('div');
  }

  setOnClose(fn: () => void): void {
    this.onClose = fn;
  }

  mount(): void {
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '999',
      background: '#0a0a0f',
      display: 'none',
      flexDirection: 'row',
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '12px',
      right: '12px',
      zIndex: '1001',
      background: 'rgba(0,0,0,0.7)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '4px',
      color: '#fff',
      fontSize: '16px',
      width: '32px',
      height: '32px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    closeBtn.addEventListener('click', () => this.onClose?.());

    // Map container (left 70%)
    Object.assign(this.mapContainer.style, {
      width: '70%',
      height: '100%',
      position: 'relative',
    });

    // Directions sidebar (right 30%)
    Object.assign(this.directionsContainer.style, {
      width: '30%',
      height: '100%',
      background: '#12121a',
      overflowY: 'auto',
      fontFamily: 'monospace',
      color: '#e0e0e0',
      boxSizing: 'border-box',
    });

    this.root.appendChild(closeBtn);
    this.root.appendChild(this.mapContainer);
    this.root.appendChild(this.directionsContainer);
    this.container.appendChild(this.root);
  }

  show(center?: RouteCoord): void {
    this.root.style.display = 'flex';
    this._visible = true;

    if (!this.map) {
      this.map = new maplibregl.Map({
        container: this.mapContainer,
        style: getMapStyle(),
        center: center ? [center.lon, center.lat] : [0, 20],
        zoom: center ? 13 : 2,
      });

      this.map.addControl(new maplibregl.NavigationControl(), 'top-left');
      this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
    } else if (center) {
      this.map.setCenter([center.lon, center.lat]);
    }
  }

  hide(): void {
    this.root.style.display = 'none';
    this._visible = false;
  }

  get visible(): boolean {
    return this._visible;
  }

  updateGpsPosition(pos: GpsPosition): void {
    if (!this.map) return;

    if (!this.gpsMarker) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: '#4a9eff',
        border: '2px solid #ffffff',
        boxShadow: '0 0 8px rgba(74,158,255,0.8)',
      });

      this.gpsMarker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat([pos.lon, pos.lat])
        .addTo(this.map);
    } else {
      this.gpsMarker.setLngLat([pos.lon, pos.lat]);
    }

    if (pos.heading !== null) {
      this.gpsMarker.setRotation(pos.heading);
    }
  }

  displayRoute(route: RouteResult): void {
    this.renderRouteOnMap(route);
    this.renderDirectionsList(route);
  }

  private renderRouteOnMap(route: RouteResult): void {
    if (!this.map) return;

    if (this.map.getLayer('route-line')) {
      this.map.removeLayer('route-line');
    }
    if (this.map.getSource('route')) {
      this.map.removeSource('route');
    }

    const coordinates = route.geometry.map((c) => [c.lon, c.lat] as [number, number]);

    this.map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    });

    this.map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#4a9eff',
        'line-width': 5,
        'line-opacity': 0.85,
      },
    });

    if (coordinates.length > 0) {
      const bounds = coordinates.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
      );
      this.map.fitBounds(bounds, { padding: 60 });
    }
  }

  private renderDirectionsList(route: RouteResult): void {
    while (this.directionsContainer.firstChild) {
      this.directionsContainer.removeChild(this.directionsContainer.firstChild);
    }

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '16px',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      background: '#0d0d15',
    });

    const distanceEl = document.createElement('div');
    distanceEl.textContent = formatDistance(route.distance);
    Object.assign(distanceEl.style, {
      fontSize: '20px',
      fontWeight: 'bold',
      color: '#4a9eff',
    });

    const durationEl = document.createElement('div');
    durationEl.textContent = formatDuration(route.duration);
    Object.assign(durationEl.style, {
      fontSize: '14px',
      color: '#aaa',
      marginTop: '2px',
    });

    const providerEl = document.createElement('div');
    providerEl.textContent = `via ${route.provider}`;
    Object.assign(providerEl.style, {
      fontSize: '11px',
      color: '#555',
      marginTop: '4px',
    });

    header.appendChild(distanceEl);
    header.appendChild(durationEl);
    header.appendChild(providerEl);
    this.directionsContainer.appendChild(header);

    // Steps
    route.steps.forEach((step, idx) => {
      const stepEl = document.createElement('div');
      Object.assign(stepEl.style, {
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: idx === 0 ? 'rgba(74,158,255,0.08)' : 'transparent',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
      });

      const numEl = document.createElement('div');
      numEl.textContent = String(idx + 1);
      Object.assign(numEl.style, {
        minWidth: '20px',
        color: '#4a9eff',
        fontSize: '12px',
        paddingTop: '2px',
      });

      const textWrap = document.createElement('div');
      Object.assign(textWrap.style, { flex: '1' });

      const instrEl = document.createElement('div');
      instrEl.textContent = step.instruction;
      Object.assign(instrEl.style, {
        fontSize: '13px',
        color: '#e0e0e0',
        lineHeight: '1.4',
      });

      textWrap.appendChild(instrEl);

      if (step.name) {
        const nameEl = document.createElement('div');
        nameEl.textContent = step.name;
        Object.assign(nameEl.style, {
          fontSize: '11px',
          color: '#888',
          marginTop: '2px',
        });
        textWrap.appendChild(nameEl);
      }

      const distEl = document.createElement('div');
      distEl.textContent = formatDistance(step.distance);
      Object.assign(distEl.style, {
        fontSize: '11px',
        color: '#555',
        marginTop: '4px',
      });
      textWrap.appendChild(distEl);

      stepEl.appendChild(numEl);
      stepEl.appendChild(textWrap);
      this.directionsContainer.appendChild(stepEl);
    });
  }

  destroy(): void {
    if (this.gpsMarker) {
      this.gpsMarker.remove();
      this.gpsMarker = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}
