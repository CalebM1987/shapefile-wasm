/**
 * Public types.
 *
 * GeoJSON is described here rather than pulled from `@types/geojson` so the
 * package has no type-only dependency to keep in step.
 */

/**
 * A single coordinate: `[x, y]`, `[x, y, z]`, or `[x, y, z, m]`.
 *
 * Longitude/easting first, per GeoJSON. A third ordinate is read as Z and a
 * fourth as a measure unless {@link WriteOptions.dimensions} says otherwise.
 */
export type Position = number[];

/** A single point. */
export interface PointGeometry {
  /** Discriminant. */
  type: 'Point';
  /** The point's coordinate. */
  coordinates: Position;
}

/** A set of unconnected points, written as a shapefile `Multipoint`. */
export interface MultiPointGeometry {
  /** Discriminant. */
  type: 'MultiPoint';
  /** One coordinate per point. */
  coordinates: Position[];
}

/** A single connected line, written as a one-part shapefile `Polyline`. */
export interface LineStringGeometry {
  /** Discriminant. */
  type: 'LineString';
  /** Vertices in order; at least two. */
  coordinates: Position[];
}

/** Several disconnected lines, written as a multi-part `Polyline`. */
export interface MultiLineStringGeometry {
  /** Discriminant. */
  type: 'MultiLineString';
  /** One array of vertices per part. */
  coordinates: Position[][];
}

/** A polygon with an exterior ring and any number of holes. */
export interface PolygonGeometry {
  /** Discriminant. */
  type: 'Polygon';
  /** Exterior ring first, then holes. Rings should be closed. */
  coordinates: Position[][];
}

/** Several polygons, flattened into one shapefile `Polygon` record. */
export interface MultiPolygonGeometry {
  /** Discriminant. */
  type: 'MultiPolygon';
  /** One ring list per polygon, exterior first. */
  coordinates: Position[][][];
}

/**
 * Any geometry this package can represent.
 *
 * `GeometryCollection` is absent on purpose — a shapefile cannot express it, and
 * passing one is an error.
 */
export type Geometry =
  | PointGeometry
  | MultiPointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry;

/** A geometry together with its attributes. */
export interface Feature {
  /** Discriminant. */
  type: 'Feature';
  /**
   * The geometry, or `null`. Null-geometry features are skipped on write and
   * counted in {@link ShapefileParts.skippedCount}.
   */
  geometry: Geometry | null;
  /** Attributes, which become `.dbf` columns. May be `null` or empty. */
  properties: Record<string, unknown> | null;
  /** Optional identifier. Not written to the shapefile. */
  id?: string | number;
}

/** A set of features — the usual top-level GeoJSON document. */
export interface FeatureCollection {
  /** Discriminant. */
  type: 'FeatureCollection';
  /** The features. */
  features: Feature[];
  /**
   * Contents of the source `.prj`, when one was present.
   *
   * Not part of RFC 7946 — GeoJSON is defined as WGS 84 — but dropping it would
   * lose the only record of how the coordinates are actually projected.
   */
  wkt?: string;
}

/**
 * Anything the writer accepts: a collection, a lone feature, a bare geometry, or
 * an array of either.
 */
export type GeoJsonInput = FeatureCollection | Feature | Geometry | Feature[] | Geometry[];

/**
 * The four geometry families a shapefile can hold.
 *
 * Used with {@link WriteOptions.shapeType} to override inference.
 */
export type ShapeFamily = 'point' | 'multipoint' | 'polyline' | 'polygon';

/**
 * Which ordinates to write.
 *
 * - `auto` — follow the coordinates: 3 ordinates means Z, 4 means Z and a measure
 * - `xy` — 2D only, discarding anything further
 * - `xym` — read the third ordinate as a measure rather than Z
 * - `xyz` — 3D, no measures
 * - `xyzm` — 3D with measures
 */
export type Dimensions = 'auto' | 'xy' | 'xym' | 'xyz' | 'xyzm';

/** Settings for converting GeoJSON into a shapefile. */
export interface WriteOptions {
  /**
   * Force a geometry family instead of inferring it from the data.
   *
   * Useful when a batch happens to contain only `Point` features but downstream
   * consumers expect `Multipoint`.
   */
  shapeType?: ShapeFamily;
  /**
   * Force the dimensionality.
   *
   * By default a third ordinate is read as Z and a fourth as a measure; pass
   * `'xym'` to treat the third as a measure instead.
   */
  dimensions?: Dimensions;
  /**
   * Cap on `.dbf` character column width, 1–254. Defaults to 254.
   *
   * Columns are otherwise sized to the longest value present. Lowering this
   * shrinks the file at the cost of truncating long text.
   */
  maxFieldLength?: number;
}

/** How one GeoJSON property was mapped into a `.dbf` column. */
export interface FieldDescriptor {
  /** The original GeoJSON property name, however long. */
  source: string;
  /**
   * The column name written to the `.dbf`: at most 11 bytes, sanitised, and
   * unique within the table. Compare with {@link source} to spot renames.
   */
  name: string;
  /**
   * The dBase column type inferred from the values seen. Properties holding more
   * than one type, or objects and arrays, fall back to `character`.
   */
  type: 'character' | 'numeric' | 'logical';
  /** Column width in bytes, sized to the widest value present. */
  width: number;
  /** Decimal places, for `numeric` columns. `0` otherwise. */
  decimals: number;
}

/** The raw components of a shapefile, as produced by `writeShapefile`. */
export interface ShapefileParts {
  /** Geometry. The main file. */
  shp: Uint8Array;
  /** Index into the `.shp`. Not needed to read the file back, but expected by GIS software. */
  shx: Uint8Array;
  /** The dBase attribute table, written as UTF-8. */
  dbf: Uint8Array;
  /** Contents of the `.cpg`. Always `"UTF-8"`, matching how the `.dbf` is written. */
  cpg: string;
  /** Contents of the `.prj`. Present only when a projection was given. */
  prj?: string;
  /** The ESRI shape type written, e.g. `Point`, `PolygonZ`. */
  shapeType: string;
  /** Which ordinates were written. */
  dimensions: Exclude<Dimensions, 'auto'>;
  /** Features written to the file. */
  featureCount: number;
  /** Input features dropped for having no geometry. */
  skippedCount: number;
  /** Bounds of the data as `[minX, minY, maxX, maxY]`. */
  bbox: [number, number, number, number];
  /** How each property became a column, in file order. */
  fields: FieldDescriptor[];
}

/** Where the `.prj` text comes from. */
export interface ProjectionOptions {
  /**
   * EPSG code for the `.prj`.
   *
   * Resolved against the built-in codes, anything registered via
   * `registerProjections`, and — loaded on demand — the bundled table of 116
   * definitions. An unresolvable code throws rather than silently omitting the
   * `.prj`.
   */
  epsg?: number;
  /** Raw ESRI WKT for the `.prj`. Takes precedence over {@link epsg}. */
  wkt?: string;
}

/** Settings for producing a zipped bundle. */
export interface ZipOptions extends WriteOptions, ProjectionOptions {
  /**
   * Base name for the files inside the archive. Defaults to `"shapefile"`.
   *
   * Any directory and extension are stripped, and characters Windows reserves
   * are replaced, since the archive is likely to be unzipped there.
   */
  fileName?: string;
  /** DEFLATE level, 0–9. Defaults to 6. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Settings for reading a shapefile back into GeoJSON. */
export interface ReadOptions {
  /**
   * Character set of the `.dbf`.
   *
   * Taken from the companion `.cpg` when reading an archive, and defaulting to
   * UTF-8. Legacy code pages are supported — `cp1252`, `cp437`, `cp850` and the
   * other common Windows and OEM pages. An unrecognised label falls back to
   * UTF-8 rather than failing.
   */
  encoding?: string;
  /**
   * Emit shapefile M (measure) values as a trailing ordinate.
   *
   * Off by default, because GeoJSON has no concept of measures and consumers do
   * not expect a fourth number in a position.
   *
   * Note that dBase pads character columns to a fixed width and the underlying
   * reader always strips that padding, so text always comes back trimmed.
   */
  includeM?: boolean;
}

/** One shapefile found inside an archive. */
export interface ShapefileLayer {
  /** Base name of the layer, without extension or directory. */
  name: string;
  /** The layer's features. Carries `wkt` when the layer had a `.prj`. */
  geojson: FeatureCollection;
  /** Contents of the `.prj`, if the archive had one for this layer. */
  prj?: string;
  /** The character set used to decode the `.dbf`. */
  encoding: string;
}
