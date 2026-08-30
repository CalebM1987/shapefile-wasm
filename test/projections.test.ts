/** The projection registry and how it feeds the .prj. */
import { beforeEach, describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';

import {
  getProjection,
  registerProjections,
  registeredProjections,
  writeShapefile,
  writeShapefileZip,
} from '../src/index.js';
import { CITIES } from './fixtures.js';

describe('built-in projections', () => {
  it('knows the handful of codes almost everything uses', () => {
    expect(getProjection(4326)).toMatch(/GCS_WGS_1984/);
    expect(getProjection(4269)).toMatch(/GCS_North_American_1983/);
    expect(getProjection(3857)).toMatch(/Mercator_Auxiliary_Sphere/);
    expect(getProjection(6318)).toMatch(/GCS_NAD_1983_2011/);
  });

  it('reports nothing for a code it does not hold', () => {
    expect(getProjection(999999)).toBeUndefined();
  });

  it('lists what it has', () => {
    expect(registeredProjections()).toContain(4326);
  });
});

describe('resolving a projection for a write', () => {
  it('writes the WKT for a known EPSG code', async () => {
    const parts = await writeShapefile(CITIES, { epsg: 4326 });
    expect(parts.prj).toMatch(/GCS_WGS_1984/);
  });

  it('omits the .prj when nothing was asked for', async () => {
    const parts = await writeShapefile(CITIES);
    expect(parts.prj).toBeUndefined();
  });

  it('prefers an explicit WKT over the EPSG lookup', async () => {
    const parts = await writeShapefile(CITIES, { epsg: 4326, wkt: 'CUSTOM["local grid"]' });
    expect(parts.prj).toBe('CUSTOM["local grid"]');
  });

  it('treats a blank WKT as no projection at all', async () => {
    const parts = await writeShapefile(CITIES, { wkt: '   ' });
    expect(parts.prj).toBeUndefined();
  });

  it('fails loudly on an unregistered code instead of dropping the .prj', async () => {
    // Silently omitting the projection is the worst outcome: the data looks fine
    // until someone opens it in the wrong coordinate system.
    await expect(writeShapefile(CITIES, { epsg: 999999 })).rejects.toThrow(
      /not in the projection table/,
    );
  });

  it('points at the fix in the error message', async () => {
    await expect(writeShapefile(CITIES, { epsg: 999999 })).rejects.toThrow(
      /registerProjections/,
    );
  });
});

describe('the optional full table', () => {
  beforeEach(async () => {
    const { epsgProjections } = await import('../src/generated/projections.js');
    registerProjections(epsgProjections);
  });

  it('adds the UTM and State Plane codes', () => {
    expect(getProjection(26915)).toMatch(/NAD_1983_UTM_Zone_15N/);
    expect(getProjection(32615)).toMatch(/WGS_1984_UTM_Zone_15N/);
  });

  it('carries more than a hundred definitions', () => {
    expect(registeredProjections().length).toBeGreaterThan(100);
  });

  it('writes the registered WKT into the archive', async () => {
    const zip = await writeShapefileZip(CITIES, { fileName: 'utm', epsg: 26915 });
    const prj = new TextDecoder().decode(unzipSync(zip)['utm.prj']);

    expect(prj).toMatch(/NAD_1983_UTM_Zone_15N/);
    expect(prj.startsWith('PROJCS[')).toBe(true);
  });

  it('lets a caller override a built-in definition', () => {
    registerProjections({ 4326: 'OVERRIDDEN' });
    expect(getProjection(4326)).toBe('OVERRIDDEN');

    // Put it back so test order cannot matter.
    registerProjections({
      4326:
        'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
    });
    expect(getProjection(4326)).toMatch(/GCS_WGS_1984/);
  });
});
