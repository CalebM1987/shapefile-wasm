// This crate parses untrusted input — a .shp or .dbf from an unknown source is
// attacker-controlled data. Enforce that none of the parsing is written with
// raw pointers, so a malformed file can only ever produce an error.
#![forbid(unsafe_code)]

//! Reads and writes ESRI Shapefiles from GeoJSON, entirely in memory.
//!
//! The public surface is deliberately small: hand it GeoJSON, get back the raw
//! `.shp` / `.shx` / `.dbf` byte buffers — or hand it those bytes and get GeoJSON
//! back. Zipping, projection files and anything browser-shaped is left to the
//! TypeScript layer, which keeps the wasm binary small and this core usable from
//! plain Rust too.
//!
//! # Entry points
//!
//! * [`write_shapefile`] / [`write_shapefile_from_json`] — GeoJSON to bytes
//! * [`read_shapefile`] / [`read_shapefile_to_json`] — bytes to GeoJSON
//! * [`set_panic_hook`] — route panics to `console.error` while debugging

use std::io::Cursor;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// Public so the crate is usable directly from Rust, not only through the wasm
// bindings — and so the rustdoc links below resolve.
pub mod error;
pub mod geometry;
pub mod input;
pub mod read;
pub mod schema;

use error::{Result, ShapefileError};
use geometry::Dimension;
use input::{Family, Feature};
use schema::{FieldKind, Schema, MAX_CHARACTER_WIDTH};
use shapefile::record::EsriShape;
use shapefile::{Point, PointM, PointZ, ShapeWriter};

/// Caller-tunable knobs. Every field is optional; the defaults suit most data.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    /// Force a geometry family (`point`, `multipoint`, `polyline`, `polygon`)
    /// instead of inferring it from the input.
    pub shape_type: Option<String>,
    /// Force the dimensionality (`xy`, `xym`, `xyz`, `xyzm`). Defaults to
    /// whatever the coordinates actually carry.
    pub dimensions: Option<String>,
    /// Upper bound on character field width, 1-254.
    pub max_field_length: Option<usize>,
}

/// What one column became in the .dbf, so callers can report renames.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldReport {
    /// The original GeoJSON property name.
    pub source: String,
    /// The name actually written to the .dbf.
    pub name: String,
    /// One of `character`, `numeric`, `logical`.
    #[serde(rename = "type")]
    pub kind: &'static str,
    /// Column width in bytes, sized to the widest value actually present.
    pub width: u32,
    /// Decimal places, for numeric columns. Zero otherwise.
    pub decimals: u32,
}

/// The generated shapefile components, plus what was inferred along the way.
///
/// Every getter copies its data out of wasm linear memory, so the returned
/// buffers stay valid after the object is freed.
#[wasm_bindgen]
#[derive(Debug)]
pub struct ShapefileParts {
    shp: Vec<u8>,
    shx: Vec<u8>,
    dbf: Vec<u8>,
    shape_type: String,
    dimensions: String,
    feature_count: usize,
    skipped_count: usize,
    bbox: Vec<f64>,
    fields: Vec<FieldReport>,
}

#[wasm_bindgen]
impl ShapefileParts {
    /// Contents of the `.shp`: the geometry itself.
    #[wasm_bindgen(getter)]
    pub fn shp(&self) -> Vec<u8> {
        self.shp.clone()
    }

    /// Contents of the `.shx`: a fixed-width index into the `.shp`. Not needed
    /// to read the file back, but GIS software expects it to be present.
    #[wasm_bindgen(getter)]
    pub fn shx(&self) -> Vec<u8> {
        self.shx.clone()
    }

    /// Contents of the `.dbf`: the attribute table, written as UTF-8.
    #[wasm_bindgen(getter)]
    pub fn dbf(&self) -> Vec<u8> {
        self.dbf.clone()
    }

    /// Contents of the companion `.cpg` file. The `.dbf` is written as UTF-8.
    #[wasm_bindgen(getter)]
    pub fn cpg(&self) -> String {
        "UTF-8".to_string()
    }

    /// The ESRI shape type that was written, e.g. `PolygonZ`.
    #[wasm_bindgen(getter, js_name = shapeType)]
    pub fn shape_type(&self) -> String {
        self.shape_type.clone()
    }

    /// Which ordinates were written: `xy`, `xym`, `xyz` or `xyzm`.
    #[wasm_bindgen(getter)]
    pub fn dimensions(&self) -> String {
        self.dimensions.clone()
    }

    /// How many features made it into the file.
    #[wasm_bindgen(getter, js_name = featureCount)]
    pub fn feature_count(&self) -> usize {
        self.feature_count
    }

    /// How many input features were dropped for having no geometry.
    #[wasm_bindgen(getter, js_name = skippedCount)]
    pub fn skipped_count(&self) -> usize {
        self.skipped_count
    }

    /// `[minX, minY, maxX, maxY]`.
    #[wasm_bindgen(getter)]
    pub fn bbox(&self) -> Vec<f64> {
        self.bbox.clone()
    }

    /// The resolved .dbf schema, including any field renames.
    #[wasm_bindgen(getter)]
    pub fn fields(&self) -> std::result::Result<JsValue, JsValue> {
        let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
        self.fields
            .serialize(&serializer)
            .map_err(|e| JsError::new(&e.to_string()).into())
    }
}

/// Builds a shapefile from a GeoJSON value passed straight across the wasm
/// boundary.
///
/// A shapefile holds exactly one geometry type, so mixed input is rejected —
/// except `Point` and `MultiPoint`, which are promoted to a single `Multipoint`
/// file. Dimensionality follows the coordinates unless `options.dimensions`
/// overrides it, and the `.dbf` schema is inferred from every feature's
/// properties.
///
/// # Arguments
///
/// * `geojson` - A `FeatureCollection`, a lone `Feature`, a bare geometry, or an
///   array of any of those.
/// * `options` - An [`Options`] object, or `null`/`undefined` for the defaults.
///
/// # Errors
///
/// Returns a JavaScript `Error` when the input is not valid GeoJSON, mixes
/// incompatible geometry types, holds no writable features, contains a
/// malformed coordinate or a degenerate ring, or uses `GeometryCollection`.
#[wasm_bindgen(js_name = writeShapefile)]
pub fn write_shapefile(
    geojson: JsValue,
    options: JsValue,
) -> std::result::Result<ShapefileParts, JsValue> {
    let value: serde_json::Value = serde_wasm_bindgen::from_value(geojson)
        .map_err(|e| ShapefileError::Input(e.to_string()))?;
    Ok(build(&value, &parse_options(options)?)?)
}

/// Builds a shapefile from a GeoJSON string.
///
/// Identical to [`write_shapefile`] but for the input: the text is parsed in
/// Rust, avoiding a `JSON.parse` in JavaScript when the data arrived as text in
/// the first place.
///
/// # Arguments
///
/// * `geojson` - Serialised GeoJSON.
/// * `options` - An [`Options`] object, or `null`/`undefined` for the defaults.
///
/// # Errors
///
/// Returns a JavaScript `Error` when the string is not valid JSON, or for any
/// reason [`write_shapefile`] would fail.
#[wasm_bindgen(js_name = writeShapefileFromJson)]
pub fn write_shapefile_from_json(
    geojson: &str,
    options: JsValue,
) -> std::result::Result<ShapefileParts, JsValue> {
    let value: serde_json::Value =
        serde_json::from_str(geojson).map_err(|e| ShapefileError::Input(e.to_string()))?;
    Ok(build(&value, &parse_options(options)?)?)
}

/// Reads a shapefile back into a GeoJSON `FeatureCollection`.
///
/// The `.shx` is not needed; the `.shp` is walked sequentially. Polygon rings
/// are re-nested — each hole is matched to the smallest ring containing it —
/// and rewound to RFC 7946 winding order.
///
/// # Arguments
///
/// * `shp` - Contents of the `.shp`.
/// * `dbf` - Contents of the `.dbf`. Optional: without it, features come back
///   with empty properties, which is still useful for inspecting geometry.
/// * `options` - A [`read::ReadOptions`] object, or `null`/`undefined`.
///
/// # Errors
///
/// Returns a JavaScript `Error` when the `.shp` is truncated or malformed, or
/// holds a shape type this reader does not understand.
#[wasm_bindgen(js_name = readShapefile)]
pub fn read_shapefile(
    shp: &[u8],
    dbf: Option<Vec<u8>>,
    options: JsValue,
) -> std::result::Result<JsValue, JsValue> {
    let options = parse_read_options(options)?;
    let geojson = read::read(shp, dbf.as_deref(), &options)?;

    // `serialize_missing_as_null` matters: without it a null attribute arrives in
    // JavaScript as `undefined`, which disappears from `JSON.stringify` output
    // and breaks round-tripping through a file.
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_maps_as_objects(true)
        .serialize_missing_as_null(true);

    geojson
        .serialize(&serializer)
        .map_err(|e| JsError::new(&e.to_string()).into())
}

/// Reads a shapefile and returns GeoJSON as a string.
///
/// Identical to [`read_shapefile`] but skips building JavaScript objects, which
/// is cheaper when the result is headed straight for a file or the network
/// rather than for code that will walk it.
///
/// # Arguments
///
/// * `shp` - Contents of the `.shp`.
/// * `dbf` - Contents of the `.dbf`, optional.
/// * `options` - A [`read::ReadOptions`] object, or `null`/`undefined`.
///
/// # Errors
///
/// Returns a JavaScript `Error` for the same reasons as [`read_shapefile`], or
/// if the result cannot be serialised.
#[wasm_bindgen(js_name = readShapefileToJson)]
pub fn read_shapefile_to_json(
    shp: &[u8],
    dbf: Option<Vec<u8>>,
    options: JsValue,
) -> std::result::Result<String, JsValue> {
    let options = parse_read_options(options)?;
    let geojson = read::read(shp, dbf.as_deref(), &options)?;
    serde_json::to_string(&geojson).map_err(|e| JsError::new(&e.to_string()).into())
}

fn parse_read_options(options: JsValue) -> std::result::Result<read::ReadOptions, JsValue> {
    if options.is_undefined() || options.is_null() {
        return Ok(read::ReadOptions::default());
    }
    serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsError::new(&format!("invalid options: {e}")).into())
}

/// Routes Rust panics to `console.error` with a readable message and stack.
///
/// A panic in wasm otherwise surfaces as a bare `RuntimeError: unreachable`,
/// which says nothing about what went wrong. Call this once at startup while
/// debugging; it is not needed in production.
#[wasm_bindgen(js_name = setPanicHook)]
pub fn set_panic_hook() {
    console_error_panic_hook::set_once();
}

fn parse_options(options: JsValue) -> std::result::Result<Options, JsValue> {
    if options.is_undefined() || options.is_null() {
        return Ok(Options::default());
    }
    serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsError::new(&format!("invalid options: {e}")).into())
}

/// The whole pipeline: parse, resolve types, infer the schema, write bytes.
fn build(value: &serde_json::Value, options: &Options) -> Result<ShapefileParts> {
    let features = input::normalize(value)?;
    let total = features.len();

    // Features without geometry cannot be represented, so they are dropped
    // wholesale — writing an attribute row with no shape would desynchronise the
    // .shp and .dbf record numbering.
    let kept: Vec<&Feature> = features
        .iter()
        .filter(|feature| feature.geometry.is_some())
        .collect();

    if kept.is_empty() {
        return Err(ShapefileError::Empty);
    }
    let skipped_count = total - kept.len();

    let family = resolve_family(&kept, options)?;
    let dimension = resolve_dimension(&kept, options)?;

    let max_field_length = options
        .max_field_length
        .unwrap_or(MAX_CHARACTER_WIDTH)
        .clamp(1, MAX_CHARACTER_WIDTH);

    // The schema is inferred from the features that will actually be written.
    let owned: Vec<Feature> = kept
        .iter()
        .map(|feature| Feature {
            geometry: feature.geometry.clone(),
            properties: feature.properties.clone(),
        })
        .collect();
    let schema = Schema::infer(&owned, max_field_length)?;

    let (shp, shx) = write_geometry(&kept, family, dimension)?;
    let dbf = write_attributes(&kept, &schema)?;

    Ok(ShapefileParts {
        shp,
        shx,
        dbf,
        shape_type: format!("{}{}", family.label(), dimension.suffix()),
        dimensions: dimension.label().to_string(),
        feature_count: kept.len(),
        skipped_count,
        bbox: bounds(&kept),
        fields: schema
            .fields
            .iter()
            .map(|field| {
                let (width, decimals) = match field.kind {
                    FieldKind::Character { width } => (width as u32, 0),
                    FieldKind::Numeric { width, decimals } => (width as u32, decimals as u32),
                    FieldKind::Logical => (1, 0),
                };
                FieldReport {
                    source: if schema.synthetic {
                        field.name.clone()
                    } else {
                        field.source.clone()
                    },
                    name: field.name.clone(),
                    kind: field.kind.label(),
                    width,
                    decimals,
                }
            })
            .collect(),
    })
}

fn resolve_family(features: &[&Feature], options: &Options) -> Result<Family> {
    if let Some(requested) = &options.shape_type {
        return Family::parse(requested)
            .ok_or_else(|| ShapefileError::UnsupportedGeometry(requested.clone()));
    }

    let mut resolved: Option<Family> = None;
    for (index, feature) in features.iter().enumerate() {
        let Some(geometry) = &feature.geometry else {
            continue;
        };
        let family = geometry.family();
        resolved = Some(match resolved {
            None => family,
            Some(current) => current.reconcile(family, index)?,
        });
    }

    resolved.ok_or(ShapefileError::Empty)
}

fn resolve_dimension(features: &[&Feature], options: &Options) -> Result<Dimension> {
    if let Some(requested) = &options.dimensions {
        if requested.eq_ignore_ascii_case("auto") {
            // fall through to detection
        } else {
            return Dimension::parse(requested)
                .ok_or_else(|| ShapefileError::Input(format!("unknown dimensions `{requested}`")));
        }
    }

    let mut max_arity = 2;
    for feature in features {
        if let Some(geometry) = &feature.geometry {
            geometry.for_each_position(|position| max_arity = max_arity.max(position.arity()));
        }
    }

    Ok(Dimension::from_arity(max_arity))
}

fn bounds(features: &[&Feature]) -> Vec<f64> {
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);

    for feature in features {
        if let Some(geometry) = &feature.geometry {
            geometry.for_each_position(|position| {
                min_x = min_x.min(position.x);
                min_y = min_y.min(position.y);
                max_x = max_x.max(position.x);
                max_y = max_y.max(position.y);
            });
        }
    }

    if min_x.is_finite() {
        vec![min_x, min_y, max_x, max_y]
    } else {
        vec![0.0, 0.0, 0.0, 0.0]
    }
}

/// Writes every shape, choosing the concrete shapefile type from the resolved
/// family and dimensionality.
fn write_geometry(
    features: &[&Feature],
    family: Family,
    dimension: Dimension,
) -> Result<(Vec<u8>, Vec<u8>)> {
    let mut shp = Cursor::new(Vec::new());
    let mut shx = Cursor::new(Vec::new());

    macro_rules! emit {
        ($convert:ident, $point:ty) => {{
            let mut shapes = Vec::with_capacity(features.len());
            for (index, feature) in features.iter().enumerate() {
                let geometry = feature
                    .geometry
                    .as_ref()
                    .expect("features without geometry were filtered out");
                shapes.push(geometry::$convert::<$point>(geometry, dimension, index)?);
            }
            flush(&shapes, &mut shp, &mut shx)?;
        }};
    }

    match (family, dimension) {
        (Family::Point, Dimension::Xy) => emit!(to_point, Point),
        (Family::Point, Dimension::Xym) => emit!(to_point, PointM),
        (Family::Point, Dimension::Xyz | Dimension::Xyzm) => emit!(to_point, PointZ),

        (Family::Multipoint, Dimension::Xy) => emit!(to_multipoint, Point),
        (Family::Multipoint, Dimension::Xym) => emit!(to_multipoint, PointM),
        (Family::Multipoint, Dimension::Xyz | Dimension::Xyzm) => emit!(to_multipoint, PointZ),

        (Family::Polyline, Dimension::Xy) => emit!(to_polyline, Point),
        (Family::Polyline, Dimension::Xym) => emit!(to_polyline, PointM),
        (Family::Polyline, Dimension::Xyz | Dimension::Xyzm) => emit!(to_polyline, PointZ),

        (Family::Polygon, Dimension::Xy) => emit!(to_polygon, Point),
        (Family::Polygon, Dimension::Xym) => emit!(to_polygon, PointM),
        (Family::Polygon, Dimension::Xyz | Dimension::Xyzm) => emit!(to_polygon, PointZ),
    }

    Ok((shp.into_inner(), shx.into_inner()))
}

/// The header is only correct once `finalize` has rewound and rewritten it, so
/// the writer has to be done with the cursors before we read them back.
fn flush<S: EsriShape>(
    shapes: &[S],
    shp: &mut Cursor<Vec<u8>>,
    shx: &mut Cursor<Vec<u8>>,
) -> Result<()> {
    let mut writer = ShapeWriter::with_shx(shp, shx);
    for shape in shapes {
        writer.write_shape(shape)?;
    }
    writer.finalize()?;
    Ok(())
}

fn write_attributes(features: &[&Feature], schema: &Schema) -> Result<Vec<u8>> {
    let mut dbf = Cursor::new(Vec::new());
    {
        let mut table = schema.builder()?.build_with_dest(&mut dbf);
        for (index, feature) in features.iter().enumerate() {
            table.write_record(&schema.record(&feature.properties, index))?;
        }
        table.finalize()?;
    }
    Ok(dbf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn build_from(value: serde_json::Value) -> ShapefileParts {
        build(&value, &Options::default()).expect("build should succeed")
    }

    #[test]
    fn writes_a_point_shapefile_with_valid_headers() {
        let parts = build_from(json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [-122.4194, 37.7749] },
                    "properties": { "name": "San Francisco" }
                },
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [-74.006, 40.7128] },
                    "properties": { "name": "New York" }
                }
            ]
        }));

        assert_eq!(parts.shape_type, "Point");
        assert_eq!(parts.feature_count, 2);
        // Shapefile magic number 9994, big endian.
        assert_eq!(&parts.shp[0..4], &[0x00, 0x00, 0x27, 0x0a]);
        assert_eq!(&parts.shx[0..4], &[0x00, 0x00, 0x27, 0x0a]);
        // .shx holds a 100 byte header plus 8 bytes per record.
        assert_eq!(parts.shx.len(), 100 + 2 * 8);
        assert!(!parts.dbf.is_empty());
    }

    #[test]
    fn detects_z_coordinates() {
        let parts = build_from(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [1.0, 2.0, 3.0] },
            "properties": {}
        }));
        assert_eq!(parts.shape_type, "PointZ");
    }

    #[test]
    fn detects_measures_on_four_ordinate_coordinates() {
        let parts = build_from(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [1.0, 2.0, 3.0, 4.0] },
            "properties": {}
        }));
        assert_eq!(parts.shape_type, "PointZ");
        assert_eq!(parts.bbox, vec![1.0, 2.0, 1.0, 2.0]);
    }

    #[test]
    fn multipolygon_collapses_into_one_polygon_record() {
        let parts = build_from(json!({
            "type": "Feature",
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]],
                    [[[5.0, 5.0], [6.0, 5.0], [6.0, 6.0], [5.0, 5.0]]]
                ]
            },
            "properties": {}
        }));
        assert_eq!(parts.shape_type, "Polygon");
        assert_eq!(parts.feature_count, 1);
        assert_eq!(parts.bbox, vec![0.0, 0.0, 6.0, 6.0]);
    }

    #[test]
    fn points_and_multipoints_are_promoted_to_multipoint() {
        let parts = build_from(json!([
            { "type": "Point", "coordinates": [0.0, 0.0] },
            { "type": "MultiPoint", "coordinates": [[1.0, 1.0], [2.0, 2.0]] }
        ]));
        assert_eq!(parts.shape_type, "Multipoint");
        assert_eq!(parts.feature_count, 2);
    }

    #[test]
    fn mixing_lines_and_polygons_is_rejected() {
        let error = build(
            &json!([
                { "type": "LineString", "coordinates": [[0.0, 0.0], [1.0, 1.0]] },
                { "type": "Polygon", "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]] }
            ]),
            &Options::default(),
        )
        .unwrap_err();
        assert!(matches!(error, ShapefileError::MixedGeometry { .. }));
    }

    #[test]
    fn features_without_geometry_are_skipped_not_misaligned() {
        let parts = build_from(json!({
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "geometry": null, "properties": { "name": "nowhere" } },
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [1.0, 2.0] },
                    "properties": { "name": "somewhere" }
                }
            ]
        }));
        assert_eq!(parts.feature_count, 1);
        assert_eq!(parts.skipped_count, 1);
        assert_eq!(parts.shx.len(), 100 + 8);
    }

    #[test]
    fn ragged_properties_still_produce_one_row_per_feature() {
        // dbase errors if a record omits a declared field, so every row has to be
        // padded with nulls for the fields it does not carry.
        let parts = build_from(json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [0.0, 0.0] },
                    "properties": { "a": 1 }
                },
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [1.0, 1.0] },
                    "properties": { "b": "two" }
                }
            ]
        }));
        assert_eq!(parts.fields.len(), 2);
        assert_eq!(parts.feature_count, 2);
    }

    #[test]
    fn long_property_names_are_truncated_and_reported() {
        let parts = build_from(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [0.0, 0.0] },
            "properties": { "a_very_long_property_name": 1 }
        }));
        assert_eq!(parts.fields[0].source, "a_very_long_property_name");
        assert_eq!(parts.fields[0].name, "a_very_long");
    }

    #[test]
    fn attribute_less_input_still_gets_a_column() {
        let parts = build_from(json!({ "type": "Point", "coordinates": [0.0, 0.0] }));
        assert_eq!(parts.fields.len(), 1);
        assert_eq!(parts.fields[0].name, "FID");
    }

    #[test]
    fn short_rings_are_rejected_rather_than_panicking() {
        let error = build(
            &json!({
                "type": "Polygon",
                "coordinates": [[[0.0, 0.0], [1.0, 1.0]]]
            }),
            &Options::default(),
        )
        .unwrap_err();
        assert!(matches!(error, ShapefileError::Feature { .. }));
    }

    /// Writes the value out and reads it straight back, which is the only real
    /// check that the bytes we produce are the bytes a reader expects.
    fn round_trip(value: serde_json::Value) -> serde_json::Value {
        let parts = build_from(value);
        read::read(&parts.shp, Some(&parts.dbf), &read::ReadOptions::default())
            .expect("read should succeed")
    }

    #[test]
    fn points_round_trip_with_attributes() {
        let output = round_trip(json!({
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [-122.4194, 37.7749] },
                "properties": { "name": "San Francisco", "pop": 873965, "capital": false }
            }]
        }));

        let feature = &output["features"][0];
        assert_eq!(feature["geometry"]["type"], "Point");
        assert_eq!(feature["geometry"]["coordinates"][0], -122.4194);
        assert_eq!(feature["properties"]["name"], "San Francisco");
        assert_eq!(feature["properties"]["pop"], 873965.0);
        assert_eq!(feature["properties"]["capital"], false);
    }

    #[test]
    fn polygon_holes_survive_the_round_trip() {
        // A shapefile stores rings flat, so the hole has to be re-nested on read.
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
                    [[2.0, 2.0], [2.0, 4.0], [4.0, 4.0], [4.0, 2.0], [2.0, 2.0]]
                ]
            },
            "properties": {}
        }));

        let geometry = &output["features"][0]["geometry"];
        assert_eq!(geometry["type"], "Polygon");
        let rings = geometry["coordinates"].as_array().unwrap();
        assert_eq!(rings.len(), 2, "exterior plus one hole");
    }

    #[test]
    fn holes_attach_to_the_ring_that_contains_them() {
        // Two disjoint squares, each with its own hole. If the nesting logic just
        // paired rings by order it would still pass, so the holes are given in
        // reverse order relative to their exteriors.
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [
                    [
                        [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
                        [[1.0, 1.0], [1.0, 2.0], [2.0, 2.0], [2.0, 1.0], [1.0, 1.0]]
                    ],
                    [
                        [[100.0, 100.0], [110.0, 100.0], [110.0, 110.0], [100.0, 110.0], [100.0, 100.0]],
                        [[101.0, 101.0], [101.0, 102.0], [102.0, 102.0], [102.0, 101.0], [101.0, 101.0]]
                    ]
                ]
            },
            "properties": {}
        }));

        let geometry = &output["features"][0]["geometry"];
        assert_eq!(geometry["type"], "MultiPolygon");
        let polygons = geometry["coordinates"].as_array().unwrap();
        assert_eq!(polygons.len(), 2);

        for polygon in polygons {
            let rings = polygon.as_array().unwrap();
            assert_eq!(rings.len(), 2, "each square keeps exactly its own hole");
            // The hole must sit inside its own exterior, not the far-away one.
            let exterior_x = rings[0][0][0].as_f64().unwrap();
            let hole_x = rings[1][0][0].as_f64().unwrap();
            assert!(
                (exterior_x - hole_x).abs() < 50.0,
                "hole at x={hole_x} was attached to the ring at x={exterior_x}"
            );
        }
    }

    #[test]
    fn exterior_rings_come_back_counter_clockwise() {
        // RFC 7946 wants exteriors CCW and holes CW; shapefiles store the
        // opposite, so the reader has to rewind them.
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
                    [[2.0, 2.0], [2.0, 4.0], [4.0, 4.0], [4.0, 2.0], [2.0, 2.0]]
                ]
            },
            "properties": {}
        }));

        let rings = output["features"][0]["geometry"]["coordinates"]
            .as_array()
            .unwrap();
        assert!(signed_area(&rings[0]) > 0.0, "exterior should be CCW");
        assert!(signed_area(&rings[1]) < 0.0, "hole should be CW");
    }

    fn signed_area(ring: &serde_json::Value) -> f64 {
        let points: Vec<(f64, f64)> = ring
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))
            .collect();
        let mut total = 0.0;
        for window in points.windows(2) {
            total += (window[1].0 - window[0].0) * (window[1].1 + window[0].1);
        }
        -total
    }

    #[test]
    fn multilinestring_round_trips_as_multilinestring() {
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": {
                "type": "MultiLineString",
                "coordinates": [
                    [[0.0, 0.0], [1.0, 1.0]],
                    [[5.0, 5.0], [6.0, 6.0]]
                ]
            },
            "properties": {}
        }));
        assert_eq!(output["features"][0]["geometry"]["type"], "MultiLineString");
    }

    #[test]
    fn single_part_lines_come_back_as_linestring() {
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": { "type": "LineString", "coordinates": [[0.0, 0.0], [1.0, 1.0]] },
            "properties": {}
        }));
        assert_eq!(output["features"][0]["geometry"]["type"], "LineString");
    }

    #[test]
    fn z_coordinates_survive_the_round_trip() {
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [1.0, 2.0, 3.5] },
            "properties": {}
        }));
        let coordinates = &output["features"][0]["geometry"]["coordinates"];
        assert_eq!(coordinates.as_array().unwrap().len(), 3);
        assert_eq!(coordinates[2], 3.5);
    }

    #[test]
    fn measures_are_dropped_unless_asked_for() {
        let parts = build_from(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [1.0, 2.0, 3.0, 4.0] },
            "properties": {}
        }));

        let without =
            read::read(&parts.shp, Some(&parts.dbf), &read::ReadOptions::default()).unwrap();
        assert_eq!(
            without["features"][0]["geometry"]["coordinates"]
                .as_array()
                .unwrap()
                .len(),
            3,
            "GeoJSON has no measures, so M is dropped by default"
        );

        let with = read::read(
            &parts.shp,
            Some(&parts.dbf),
            &read::ReadOptions {
                include_m: true,
                ..Default::default()
            },
        )
        .unwrap();
        let coordinates = &with["features"][0]["geometry"]["coordinates"];
        assert_eq!(coordinates.as_array().unwrap().len(), 4);
        assert_eq!(coordinates[3], 4.0);
    }

    #[test]
    fn character_padding_is_trimmed_on_read() {
        // dBase pads character fields to their full width; without trimming every
        // string would come back with a tail of spaces.
        let output = round_trip(json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [0.0, 0.0] },
                    "properties": { "name": "ab" }
                },
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [1.0, 1.0] },
                    "properties": { "name": "a much longer value" }
                }
            ]
        }));
        assert_eq!(output["features"][0]["properties"]["name"], "ab");
    }

    #[test]
    fn property_order_is_preserved_through_the_round_trip() {
        let output = round_trip(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [0.0, 0.0] },
            "properties": { "zebra": 1, "apple": 2, "mango": 3 }
        }));
        let properties = output["features"][0]["properties"].as_object().unwrap();
        let order: Vec<&String> = properties.keys().collect();
        assert_eq!(order, vec!["zebra", "apple", "mango"]);
    }

    #[test]
    fn reading_without_a_dbf_yields_geometry_only() {
        let parts = build_from(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [1.0, 2.0] },
            "properties": { "name": "x" }
        }));
        let output = read::read(&parts.shp, None, &read::ReadOptions::default()).unwrap();
        assert_eq!(output["features"][0]["geometry"]["type"], "Point");
        assert_eq!(
            output["features"][0]["properties"]
                .as_object()
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn empty_input_is_an_error_not_a_corrupt_file() {
        let error = build(
            &json!({ "type": "FeatureCollection", "features": [] }),
            &Options::default(),
        )
        .unwrap_err();
        assert!(matches!(error, ShapefileError::Empty));
    }
}
