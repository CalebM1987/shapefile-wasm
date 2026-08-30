//! Reads shapefile components back into GeoJSON.
//!
//! Two things make this more than a mechanical transcription:
//!
//! * A shapefile polygon is a flat bag of rings with no nesting, so the holes
//!   have to be matched back to the ring that contains them before GeoJSON can
//!   describe them.
//! * A .dbf carries no encoding of its own. The caller passes whatever the
//!   companion .cpg said, and we fall back to UTF-8.

use std::io::Cursor;

use serde::Deserialize;
use serde_json::{Map, Number, Value};

use shapefile::record::traits::{HasM, HasXY, HasZ};
use shapefile::{Multipatch, Patch, Point, PointM, PointZ, Shape, ShapeReader, NO_DATA};

use crate::error::{Result, ShapefileError};

/// Caller-tunable knobs for reading.
/// `#[serde(default)]` fills absent fields from `Default`, so the derived impl
/// and the deserialised defaults are the same thing by construction.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ReadOptions {
    /// Character set of the .dbf, normally taken from the companion .cpg file.
    pub encoding: Option<String>,
    /// Emit shapefile M (measure) values as a trailing ordinate. GeoJSON has no
    /// notion of measures, so this is off by default.
    pub include_m: bool,
    /// Contents of the companion `.prj`, surfaced as `wkt` on the result.
    /// Passed through by the TypeScript layer; nothing here parses it.
    pub prj: Option<String>,
}

impl ReadOptions {
    /// `DynEncoding` is not exported by `dbase`, so the encoding is applied to
    /// the builder inside the match rather than returned from it.
    fn reader_builder(&self) -> dbase::ReaderBuilder {
        let builder = dbase::ReaderBuilder::new();

        let requested = self
            .encoding
            .as_deref()
            .unwrap_or("utf-8")
            .trim()
            .to_ascii_lowercase()
            .replace(['-', '_', ' '], "");

        // .cpg files are wildly inconsistent, so match generously.
        match requested.as_str() {
            "utf8" | "utf8bom" | "65001" | "" => builder.with_encoding(dbase::UnicodeLossy),
            "cp1252" | "windows1252" | "iso88591" | "latin1" | "ansi" | "1252" => {
                builder.with_encoding(yore::code_pages::CP1252)
            }
            "cp1250" | "windows1250" | "1250" => builder.with_encoding(yore::code_pages::CP1250),
            "cp1251" | "windows1251" | "1251" => builder.with_encoding(yore::code_pages::CP1251),
            "cp1253" | "windows1253" | "1253" => builder.with_encoding(yore::code_pages::CP1253),
            "cp1254" | "windows1254" | "1254" => builder.with_encoding(yore::code_pages::CP1254),
            "cp1255" | "windows1255" | "1255" => builder.with_encoding(yore::code_pages::CP1255),
            "cp1256" | "windows1256" | "1256" => builder.with_encoding(yore::code_pages::CP1256),
            "cp437" | "437" | "oem" => builder.with_encoding(yore::code_pages::CP437),
            "cp850" | "850" => builder.with_encoding(yore::code_pages::CP850),
            "cp852" | "852" => builder.with_encoding(yore::code_pages::CP852),
            "cp865" | "865" => builder.with_encoding(yore::code_pages::CP865),
            "cp866" | "866" => builder.with_encoding(yore::code_pages::CP866),
            "cp874" | "874" => builder.with_encoding(yore::code_pages::CP874),
            // An unrecognised label is far better handled as UTF-8 than as a
            // hard failure; worst case a few characters come back replaced.
            _ => builder.with_encoding(dbase::UnicodeLossy),
        }
    }
}

/// Reads a `.shp` (and optionally its `.dbf`) into a GeoJSON FeatureCollection.
pub fn read(shp: &[u8], dbf: Option<&[u8]>, options: &ReadOptions) -> Result<Value> {
    let reader = ShapeReader::new(Cursor::new(shp))?;
    let shapes = reader.read()?;

    // Shapes and records are paired positionally. Reading them separately (as
    // opposed to `shapefile::Reader`) means a truncated .dbf degrades to missing
    // attributes instead of failing the whole file.
    let records = match dbf {
        Some(bytes) => read_records(bytes, options)?,
        None => Vec::new(),
    };

    let mut features = Vec::with_capacity(shapes.len());
    for (index, shape) in shapes.iter().enumerate() {
        let mut feature = Map::new();
        feature.insert("type".into(), Value::String("Feature".into()));
        feature.insert(
            "geometry".into(),
            shape_to_geometry(shape, options.include_m, index)?,
        );
        feature.insert(
            "properties".into(),
            records
                .get(index)
                .cloned()
                .map(Value::Object)
                .unwrap_or(Value::Object(Map::new())),
        );
        features.push(Value::Object(feature));
    }

    let mut collection = Map::new();
    collection.insert("type".into(), Value::String("FeatureCollection".into()));
    collection.insert("features".into(), Value::Array(features));
    if let Some(prj) = &options.prj {
        // Non-standard, but the alternative is silently losing the projection.
        collection.insert("wkt".into(), Value::String(prj.clone()));
    }

    Ok(Value::Object(collection))
}

fn read_records(dbf: &[u8], options: &ReadOptions) -> Result<Vec<Map<String, Value>>> {
    let mut reader = options.reader_builder().build(Cursor::new(dbf))?;

    // `dbase::Record` is a hash map, so grab the declared field order first;
    // otherwise the GeoJSON properties come out shuffled.
    let field_names: Vec<String> = reader
        .fields()
        .iter()
        .map(|field| field.name().to_string())
        .filter(|name| name != "DeletionFlag")
        .collect();

    let records = reader.read()?;

    Ok(records
        .into_iter()
        .map(|record| {
            let mut properties = Map::new();
            for name in &field_names {
                let value = record.get(name).map(field_to_json).unwrap_or(Value::Null);
                properties.insert(name.clone(), value);
            }
            properties
        })
        .collect())
}

/// dBase pads character fields out to their declared width; `dbase` strips that
/// padding on read and offers no way to keep it, so values always arrive trimmed.
fn field_to_json(value: &dbase::FieldValue) -> Value {
    use dbase::FieldValue;

    let text = |value: &String| Value::String(value.clone());

    match value {
        FieldValue::Character(Some(value)) => text(value),
        FieldValue::Memo(value) => text(value),
        FieldValue::Character(None) => Value::Null,
        FieldValue::Numeric(Some(value)) => number(*value),
        FieldValue::Numeric(None) => Value::Null,
        FieldValue::Float(Some(value)) => number(*value as f64),
        FieldValue::Float(None) => Value::Null,
        FieldValue::Logical(Some(value)) => Value::Bool(*value),
        FieldValue::Logical(None) => Value::Null,
        FieldValue::Integer(value) => Value::Number(Number::from(*value)),
        FieldValue::Currency(value) | FieldValue::Double(value) => number(*value),
        FieldValue::Date(Some(date)) => Value::String(format!(
            "{:04}-{:02}-{:02}",
            date.year(),
            date.month(),
            date.day()
        )),
        FieldValue::Date(None) => Value::Null,
        FieldValue::DateTime(stamp) => {
            let date = stamp.date();
            let time = stamp.time();
            Value::String(format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
                date.year(),
                date.month(),
                date.day(),
                time.hours(),
                time.minutes(),
                time.seconds()
            ))
        }
    }
}

fn number(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

/// True when a measure ordinate carries the shapefile "no data" sentinel.
fn has_measure(m: f64) -> bool {
    m > NO_DATA && m.is_finite()
}

fn position_xy(point: &Point) -> Value {
    Value::Array(vec![number(point.x), number(point.y)])
}

fn position_m(point: &PointM, include_m: bool) -> Value {
    let mut ordinates = vec![number(point.x()), number(point.y())];
    if include_m && has_measure(point.m()) {
        ordinates.push(number(point.m()));
    }
    Value::Array(ordinates)
}

fn position_z(point: &PointZ, include_m: bool) -> Value {
    let mut ordinates = vec![number(point.x()), number(point.y()), number(point.z())];
    if include_m && has_measure(point.m()) {
        ordinates.push(number(point.m()));
    }
    Value::Array(ordinates)
}

fn geometry(kind: &str, coordinates: Value) -> Value {
    let mut object = Map::new();
    object.insert("type".into(), Value::String(kind.into()));
    object.insert("coordinates".into(), coordinates);
    Value::Object(object)
}

/// Wraps a list of parts as a LineString when there is exactly one, and a
/// MultiLineString otherwise — GeoJSON prefers the simpler type.
fn lines(parts: Vec<Value>) -> Value {
    if parts.len() == 1 {
        geometry("LineString", parts.into_iter().next().unwrap())
    } else {
        geometry("MultiLineString", Value::Array(parts))
    }
}

fn points(points: Vec<Value>) -> Value {
    geometry("MultiPoint", Value::Array(points))
}

fn shape_to_geometry(shape: &Shape, include_m: bool, index: usize) -> Result<Value> {
    let geometry = match shape {
        Shape::NullShape => Value::Null,

        Shape::Point(point) => geometry("Point", position_xy(point)),
        Shape::PointM(point) => geometry("Point", position_m(point, include_m)),
        Shape::PointZ(point) => geometry("Point", position_z(point, include_m)),

        Shape::Multipoint(shape) => points(shape.points().iter().map(position_xy).collect()),
        Shape::MultipointM(shape) => points(
            shape
                .points()
                .iter()
                .map(|point| position_m(point, include_m))
                .collect(),
        ),
        Shape::MultipointZ(shape) => points(
            shape
                .points()
                .iter()
                .map(|point| position_z(point, include_m))
                .collect(),
        ),

        Shape::Polyline(shape) => lines(
            shape
                .parts()
                .iter()
                .map(|part| Value::Array(part.iter().map(position_xy).collect()))
                .collect(),
        ),
        Shape::PolylineM(shape) => lines(
            shape
                .parts()
                .iter()
                .map(|part| Value::Array(part.iter().map(|p| position_m(p, include_m)).collect()))
                .collect(),
        ),
        Shape::PolylineZ(shape) => lines(
            shape
                .parts()
                .iter()
                .map(|part| Value::Array(part.iter().map(|p| position_z(p, include_m)).collect()))
                .collect(),
        ),

        Shape::Polygon(shape) => rings_to_geometry(
            shape
                .rings()
                .iter()
                .map(|ring| Ring::from_points(ring, |point| (point.x, point.y), position_xy))
                .collect(),
        ),
        Shape::PolygonM(shape) => rings_to_geometry(
            shape
                .rings()
                .iter()
                .map(|ring| {
                    Ring::from_points(
                        ring,
                        |point| (point.x(), point.y()),
                        |point| position_m(point, include_m),
                    )
                })
                .collect(),
        ),
        Shape::PolygonZ(shape) => rings_to_geometry(
            shape
                .rings()
                .iter()
                .map(|ring| {
                    Ring::from_points(
                        ring,
                        |point| (point.x(), point.y()),
                        |point| position_z(point, include_m),
                    )
                })
                .collect(),
        ),

        Shape::Multipatch(shape) => multipatch_to_geometry(shape, include_m, index)?,
    };

    Ok(geometry)
}

/// A polygon ring reduced to what the nesting logic needs: plain XY for the
/// containment maths, plus the already-formatted GeoJSON positions.
struct Ring {
    outer: bool,
    xy: Vec<(f64, f64)>,
    positions: Vec<Value>,
}

impl Ring {
    fn from_points<P, F, G>(ring: &shapefile::PolygonRing<P>, to_xy: F, to_position: G) -> Self
    where
        F: Fn(&P) -> (f64, f64),
        G: Fn(&P) -> Value,
    {
        let (outer, points) = match ring {
            shapefile::PolygonRing::Outer(points) => (true, points),
            shapefile::PolygonRing::Inner(points) => (false, points),
        };
        Self {
            outer,
            xy: points.iter().map(&to_xy).collect(),
            positions: points.iter().map(&to_position).collect(),
        }
    }

    /// Twice the signed area. Positive means counter-clockwise.
    fn signed_area(&self) -> f64 {
        let mut total = 0.0;
        for window in self.xy.windows(2) {
            let (x1, y1) = window[0];
            let (x2, y2) = window[1];
            total += (x2 - x1) * (y2 + y1);
        }
        -total
    }

    fn contains(&self, point: (f64, f64)) -> bool {
        // Standard ray casting; the ring is already closed.
        let (px, py) = point;
        let mut inside = false;
        for window in self.xy.windows(2) {
            let (x1, y1) = window[0];
            let (x2, y2) = window[1];
            if (y1 > py) != (y2 > py) {
                let slope = (x2 - x1) / (y2 - y1);
                if px < x1 + (py - y1) * slope {
                    inside = !inside;
                }
            }
        }
        inside
    }

    /// GeoJSON (RFC 7946) wants exteriors counter-clockwise and holes clockwise;
    /// shapefiles use the opposite convention.
    fn oriented(mut self, counter_clockwise: bool) -> Vec<Value> {
        let is_ccw = self.signed_area() > 0.0;
        if is_ccw != counter_clockwise {
            self.positions.reverse();
        }
        self.positions
    }
}

/// Rebuilds GeoJSON polygon nesting from a shapefile's flat ring list.
fn rings_to_geometry(rings: Vec<Ring>) -> Value {
    let (outers, inners): (Vec<Ring>, Vec<Ring>) = rings.into_iter().partition(|ring| ring.outer);

    if outers.is_empty() {
        // Malformed input: no ring was marked as an exterior. Treat each one as
        // its own polygon rather than dropping the geometry entirely.
        let polygons: Vec<Value> = inners
            .into_iter()
            .map(|ring| Value::Array(vec![Value::Array(ring.oriented(true))]))
            .collect();
        return finish_polygons(polygons);
    }

    // Each hole belongs to the smallest exterior ring that contains it. Using
    // the smallest matters when polygons are nested inside one another.
    let mut assignments: Vec<Vec<Value>> = outers.iter().map(|_| Vec::new()).collect();
    for inner in inners {
        let probe = match inner.xy.first() {
            Some(point) => *point,
            None => continue,
        };

        let best = outers
            .iter()
            .enumerate()
            .filter(|(_, outer)| outer.contains(probe))
            .min_by(|(_, a), (_, b)| {
                a.signed_area()
                    .abs()
                    .partial_cmp(&b.signed_area().abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(index, _)| index);

        // An unmatched hole is a data error; parking it on the first ring keeps
        // the output valid GeoJSON.
        let target = best.unwrap_or(0);
        assignments[target].push(Value::Array(inner.oriented(false)));
    }

    let polygons: Vec<Value> = outers
        .into_iter()
        .zip(assignments)
        .map(|(outer, holes)| {
            let mut ring_list = vec![Value::Array(outer.oriented(true))];
            ring_list.extend(holes);
            Value::Array(ring_list)
        })
        .collect();

    finish_polygons(polygons)
}

fn finish_polygons(polygons: Vec<Value>) -> Value {
    if polygons.len() == 1 {
        geometry("Polygon", polygons.into_iter().next().unwrap())
    } else {
        geometry("MultiPolygon", Value::Array(polygons))
    }
}

/// Multipatch has no GeoJSON equivalent. Triangle strips and fans are expanded
/// into individual triangles so the surface survives as a MultiPolygon; the
/// alternative is discarding the geometry.
fn multipatch_to_geometry(shape: &Multipatch, include_m: bool, index: usize) -> Result<Value> {
    let mut polygons: Vec<Value> = Vec::new();
    let mut pending_outer: Option<Vec<Value>> = None;

    let close = |points: &[PointZ]| -> Vec<Value> {
        let mut positions: Vec<Value> = points.iter().map(|p| position_z(p, include_m)).collect();
        if positions.len() > 2 && positions.first() != positions.last() {
            positions.push(positions[0].clone());
        }
        positions
    };

    for patch in shape.patches() {
        match patch {
            Patch::TriangleStrip(points) => {
                for triangle in points.windows(3) {
                    polygons.push(Value::Array(vec![Value::Array(close(triangle))]));
                }
            }
            Patch::TriangleFan(points) => {
                if points.len() >= 3 {
                    for pair in points[1..].windows(2) {
                        let triangle = [points[0], pair[0], pair[1]];
                        polygons.push(Value::Array(vec![Value::Array(close(&triangle))]));
                    }
                }
            }
            Patch::OuterRing(points) => {
                if let Some(previous) = pending_outer.take() {
                    polygons.push(Value::Array(vec![Value::Array(previous)]));
                }
                pending_outer = Some(close(points));
            }
            Patch::InnerRing(points) => {
                // An inner ring belongs to the outer ring that preceded it.
                let hole = Value::Array(close(points));
                match polygons.last_mut() {
                    Some(Value::Array(rings)) if pending_outer.is_none() => rings.push(hole),
                    _ => {
                        if let Some(outer) = pending_outer.take() {
                            polygons.push(Value::Array(vec![Value::Array(outer), hole]));
                        }
                    }
                }
            }
            Patch::FirstRing(points) | Patch::Ring(points) => {
                if let Some(previous) = pending_outer.take() {
                    polygons.push(Value::Array(vec![Value::Array(previous)]));
                }
                polygons.push(Value::Array(vec![Value::Array(close(points))]));
            }
        }
    }

    if let Some(outer) = pending_outer.take() {
        polygons.push(Value::Array(vec![Value::Array(outer)]));
    }

    if polygons.is_empty() {
        return Err(ShapefileError::Feature {
            index,
            message: "multipatch contained no renderable patches".into(),
        });
    }

    Ok(finish_polygons(polygons))
}
