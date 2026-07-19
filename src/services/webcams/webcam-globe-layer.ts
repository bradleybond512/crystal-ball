import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  HeightReference,
  JulianDate,
  NearFarScalar,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from 'cesium';
import { escapeHtml } from '@/utils/sanitize';
import type { WebcamFeed } from './webcam-types';
import { resolveFrameUrl, needsFrameResolve } from './frame-resolver';
import { resolveWebcamPick } from './webcam-pick';

const HIGH_SALIENCE_CATEGORIES = ['fire', 'volcano', 'coastal'] as const;

const CATEGORY_PIN_COLOR: Record<string, Color> = {
  fire: Color.fromCssColorString('#f85149'),
  volcano: Color.fromCssColorString('#bc8cff'),
  coastal: Color.fromCssColorString('#3fb950'),
  weather: Color.fromCssColorString('#58a6ff'),
  stream: Color.fromCssColorString('#56d4dd'),
  traffic: Color.fromCssColorString('#d29922'),
  nature: Color.fromCssColorString('#7ee787'),
};

const CATEGORY_GLYPH: Record<string, string> = {
  fire: '🔥',
  volcano: '🌋',
  coastal: '🌊',
  weather: '☁',
  stream: '💧',
  traffic: '🚗',
  nature: '🌲',
};

export interface WebcamGlobeLayerOptions {
  fetchFeeds?: () => Promise<WebcamFeed[]>;
  /** When true, only fire/volcano/coastal categories are plotted.
   *  Defaults to false (all feeds shown). */
  salientOnly?: boolean;
}

export class GlobeWebcamLayer {
  private viewer: Viewer;
  private dataSource: CustomDataSource | null = null;
  private entities = new Map<string, Entity>();
  private mounted = false;
  private clickHandler: ScreenSpaceEventHandler | null = null;
  private feedById = new Map<string, WebcamFeed>();
  private fetchFeeds: () => Promise<WebcamFeed[]>;
  private salientOnly: boolean;

  constructor(viewer: Viewer, options: WebcamGlobeLayerOptions = {}) {
    this.viewer = viewer;
    this.fetchFeeds = options.fetchFeeds ?? (() => Promise.resolve([]));
    this.salientOnly = options.salientOnly ?? false;
  }

  async mount(): Promise<void> {
    if (this.mounted) return;
    this.mounted = true;
    this.dataSource = new CustomDataSource('webcam-pins');
    await this.viewer.dataSources.add(this.dataSource);

    // With all categories plotted this can be thousands of pins — cluster
    // nearby ones into a counted bubble so the globe stays legible/performant.
    // Zooming in declusters down to the individually-clickable pins.
    const clustering = this.dataSource.clustering;
    clustering.enabled = true;
    clustering.pixelRange = 42;
    clustering.minimumClusterSize = 4;
    clustering.clusterEvent.addEventListener((clustered, cluster) => {
      cluster.billboard.show = false;
      cluster.point.show = true;
      cluster.point.color = Color.fromCssColorString('#1f6feb');
      cluster.point.outlineColor = Color.BLACK;
      cluster.point.outlineWidth = 1;
      cluster.point.pixelSize = Math.min(30, 14 + String(clustered.length).length * 5);
      cluster.label.show = true;
      cluster.label.text = String(clustered.length);
      cluster.label.font = 'bold 12px sans-serif';
      cluster.label.fillColor = Color.WHITE;
    });

    this.clickHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.clickHandler.setInputAction((event: { position: Cartesian2 }) => {
      const picked: unknown = this.viewer.scene.pick(event.position);
      if (!picked || typeof picked !== 'object') return;
      const entityId = (picked as { id?: unknown }).id;
      // Route the pick: a clustered pin (array of entities) zooms in to expand
      // so the individual cams become reachable; an individual pin opens its
      // viewer. resolveWebcamPick keeps this decision unit-testable.
      const result = resolveWebcamPick(entityId, this.feedById);
      if (result?.kind === 'cluster') this.zoomToCluster(result.entities);
      else if (result?.kind === 'feed') this.dispatchSelect(result.feed);
    }, ScreenSpaceEventType.LEFT_CLICK);

    await this.refresh();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.clickHandler) {
      this.clickHandler.destroy();
      this.clickHandler = null;
    }
    this.entities.clear();
    this.feedById.clear();
    if (this.dataSource) {
      this.viewer.dataSources.remove(this.dataSource, true);
      this.dataSource = null;
    }
  }

  async refresh(): Promise<void> {
    if (!this.dataSource) return;
    const allFeeds = await this.fetchFeeds();
    const feeds = this.salientOnly
      ? allFeeds.filter((f) => HIGH_SALIENCE_CATEGORIES.includes(f.category as typeof HIGH_SALIENCE_CATEGORIES[number]))
      : allFeeds;
    this.dataSource.entities.removeAll();
    this.entities.clear();
    this.feedById.clear();
    for (const feed of feeds) {
      this.feedById.set(feed.id, feed);
      const entity = new Entity({
        id: feed.id,
        position: Cartesian3.fromDegrees(feed.lon, feed.lat),
        point: {
          color: CATEGORY_PIN_COLOR[feed.category] ?? Color.WHITE,
          pixelSize: 10,
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new NearFarScalar(1.5e5, 1.4, 1.5e7, 0.6),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2.5e7),
        },
        label: {
          text: CATEGORY_GLYPH[feed.category] ?? '●',
          font: '14px sans-serif',
          fillColor: Color.WHITE,
          showBackground: false,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 5e6),
        },
        description: this.buildDescription(feed),
      });
      this.dataSource.entities.add(entity);
      this.entities.set(feed.id, entity);
      // FAA feeds carry a /api/ resolver URL (JSON, not an image) — resolve it
      // and swap the real https image into the info box once available.
      if (needsFrameResolve(feed.snapshotUrl)) {
        void resolveFrameUrl(feed.snapshotUrl).then((url) => {
          if (url && this.entities.get(feed.id) === entity) {
            entity.description = new ConstantProperty(this.buildDescription(feed, url));
          }
        });
      }
    }
  }

  setSalientOnly(value: boolean): void {
    this.salientOnly = value;
    void this.refresh();
  }

  private buildDescription(feed: WebcamFeed, imageUrl: string = feed.snapshotUrl): string {
    // Only embed an <img> for a directly-loadable URL — a /api/ resolver path
    // would render as a broken image (it returns JSON, not bytes). FAA feeds get
    // their real image swapped in asynchronously after resolveFrameUrl().
    const imgTag = imageUrl && !needsFrameResolve(imageUrl)
      ? `<img src="${escapeHtml(imageUrl)}" style="max-width:200px;margin-top:4px;border-radius:3px;"/>`
      : '';
    return `<div style="font-family:sans-serif;padding:6px;">
      <strong>${escapeHtml(feed.name)}</strong><br/>
      <small>${escapeHtml(feed.source)} · ${escapeHtml(feed.category)}</small><br/>
      ${imgTag}
    </div>`;
  }

  /** Fly the camera to frame a clicked cluster so it declusters into its
   *  individually-clickable pins. */
  private zoomToCluster(entities: readonly unknown[]): void {
    const now = JulianDate.now();
    const positions: Cartesian3[] = [];
    for (const e of entities) {
      if (e instanceof Entity && e.position) {
        const p = e.position.getValue(now);
        if (p) positions.push(p);
      }
    }
    if (positions.length === 0) return;
    this.viewer.camera.flyToBoundingSphere(BoundingSphere.fromPoints(positions), {
      duration: 0.8,
    });
  }

  private dispatchSelect(feed: WebcamFeed): void {
    window.dispatchEvent(new CustomEvent('webcam:select', { detail: { feedId: feed.id, feed } }));
  }
}
