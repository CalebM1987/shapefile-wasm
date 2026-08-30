/**
 * Resolution of EPSG codes to the ESRI WKT that goes into a `.prj`.
 *
 * A handful of codes are compiled in. The rest — US UTM zones, NAD83 State
 * Plane and friends, about 116 in total — live in a separate ~60 KB module that
 * is imported on demand the first time a code is not already known. You never
 * have to load it explicitly, and bundlers keep it out of the initial chunk.
 *
 * The definitions are baked in at authoring time by `scripts/fetch-projections.mjs`,
 * which reads them from epsg.io. There is deliberately no lookup at runtime: a
 * `.prj` fetched over the network can fail quietly and leave an export with no
 * projection at all, which is far worse than a clear error at the call site.
 */

/** The codes almost every dataset uses. */
const BUILT_IN: Record<number, string> = {
  // WGS 84
  4326:
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  // NAD83
  4269:
    'GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  // NAD83 (2011)
  6318:
    'GEOGCS["GCS_NAD_1983_2011",DATUM["D_NAD_1983_2011",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  // WGS 84 / Pseudo-Mercator
  3857:
    'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]',
};

const registry = new Map<number, string>(
  Object.entries(BUILT_IN).map(([code, wkt]) => [Number(code), wkt]),
);

let bundledTableLoaded = false;

/**
 * Pulls in the bundled EPSG table on first need.
 *
 * Caller-registered definitions win: this fills gaps rather than overwriting,
 * so a local override of a standard code survives.
 */
async function loadBundledTable(): Promise<void> {
  if (bundledTableLoaded) return;
  bundledTableLoaded = true;

  const { epsgProjections } = await import('./generated/projections.js');
  for (const [code, wkt] of Object.entries(epsgProjections)) {
    const key = Number(code);
    if (!registry.has(key)) registry.set(key, wkt);
  }
}

/**
 * Loads the full bundled EPSG table immediately.
 *
 * Calling this is optional — {@link writeShapefile} loads the table by itself
 * when it meets a code it does not recognise. Reach for it when you would rather
 * pay the cost up front, or when you want {@link getProjection}, which is
 * synchronous, to see every code.
 *
 * @example
 * ```ts
 * await loadProjectionTable();
 * getProjection(26915); // NAD83 / UTM zone 15N
 * ```
 */
export async function loadProjectionTable(): Promise<void> {
  await loadBundledTable();
}

/**
 * Adds projections to the lookup table, replacing any existing entry for the
 * same code.
 *
 * Use it for in-house or local grid definitions that have no EPSG code, or to
 * override a standard definition with your own.
 *
 * @param projections Map of EPSG code to ESRI WKT.
 *
 * @example
 * ```ts
 * registerProjections({ 900914: 'PROJCS["County Grid", ... ]' });
 * await writeShapefileZip(data, { epsg: 900914 });
 * ```
 */
export function registerProjections(projections: Record<number, string>): void {
  for (const [code, wkt] of Object.entries(projections)) {
    registry.set(Number(code), wkt);
  }
}

/**
 * Looks up the ESRI WKT for an EPSG code.
 *
 * Synchronous, so it only sees codes that are already loaded: the four built-ins,
 * anything passed to {@link registerProjections}, and — once
 * {@link loadProjectionTable} has run, or after any write that needed it — the
 * full bundled table.
 *
 * @param epsg EPSG code, e.g. `4326`.
 * @returns The WKT, or `undefined` if the code is not currently loaded.
 */
export function getProjection(epsg: number): string | undefined {
  return registry.get(epsg);
}

/**
 * Every EPSG code currently loaded, ascending.
 *
 * Subject to the same caveat as {@link getProjection}: the bundled table is not
 * counted until it has been loaded.
 */
export function registeredProjections(): number[] {
  return [...registry.keys()].sort((a, b) => a - b);
}

/**
 * Turns `{ epsg }` / `{ wkt }` into `.prj` text, preferring an explicit WKT.
 *
 * Loads the bundled table if the code is not already known, and throws when it
 * still cannot be resolved — quietly omitting the `.prj` would leave data that
 * looks fine until someone opens it in the wrong coordinate system.
 *
 * @internal
 */
export async function resolveProjection(options: {
  epsg?: number | undefined;
  wkt?: string | undefined;
}): Promise<string | undefined> {
  if (options.wkt !== undefined) {
    const trimmed = options.wkt.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (options.epsg === undefined) return undefined;

  if (!registry.has(options.epsg)) {
    await loadBundledTable();
  }

  const found = registry.get(options.epsg);
  if (found === undefined) {
    throw new Error(
      `shapefile-wasm: EPSG:${options.epsg} is not in the projection table. ` +
        'Supply the definition yourself with registerProjections({ ' +
        `${options.epsg}: '<esri wkt>' }), or pass the WKT directly via { wkt }.`,
    );
  }
  return found;
}
