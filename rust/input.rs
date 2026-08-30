//! Parsing of the GeoJSON that comes in from JavaScript.
//!
//! We deliberately walk `serde_json::Value` by hand instead of pulling in the
//! `geojson` crate: it keeps the wasm binary small and lets us accept the
//! slightly-off shapes that real-world data tends to have (a bare geometry, a
//! bare feature, a plain array of features).

use serde_json::{Map, Value};

use crate::error::{Result, ShapefileError};

/// A single coordinate, normalised to four ordinates so downstream code never
/// has to worry about how many were actually present.
#[derive(Debug, Clone, Copy)]
pub struct Position {
    pub x: f64,
    pub y: f64,
    /// Third ordinate as written in the source, if any.
    pub third: Option<f64>,
    /// Fourth ordinate as written in the source, if any.
    pub fourth: Option<f64>,
}

impl Position {
    fn parse(value: &Value, index: usize) -> Result<Self> {
        let array = value.as_array().ok_or_else(|| ShapefileError::Feature {
            index,
            message: "a coordinate must be an array of numbers".into(),
        })?;

        if array.len() < 2 {
            return Err(ShapefileError::Feature {
                index,
                message: format!("a coordinate needs at least x and y, got {}", array.len()),
            });
        }

        let ordinate = |slot: usize| -> Result<f64> {
            array[slot].as_f64().ok_or_else(|| ShapefileError::Feature {
                index,
                message: format!("coordinate ordinate {slot} is not a number"),
            })
        };

        Ok(Self {
            x: ordinate(0)?,
            y: ordinate(1)?,
            third: if array.len() > 2 {
                Some(ordinate(2)?)
            } else {
                None
            },
            fourth: if array.len() > 3 {
                Some(ordinate(3)?)
            } else {
                None
            },
        })
    }

    /// How many ordinates the source actually carried (2, 3 or 4).
    pub fn arity(&self) -> usize {
        2 + usize::from(self.third.is_some()) + usize::from(self.fourth.is_some())
    }
}

/// A GeoJSON geometry, reduced to the six types a shapefile can represent.
#[derive(Debug, Clone)]
pub enum Geometry {
    Point(Position),
    MultiPoint(Vec<Position>),
    LineString(Vec<Position>),
    MultiLineString(Vec<Vec<Position>>),
    Polygon(Vec<Vec<Position>>),
    MultiPolygon(Vec<Vec<Vec<Position>>>),
}

impl Geometry {
    /// The shapefile geometry family this GeoJSON type has to be written as.
    pub fn family(&self) -> Family {
        match self {
            Geometry::Point(_) => Family::Point,
            Geometry::MultiPoint(_) => Family::Multipoint,
            Geometry::LineString(_) | Geometry::MultiLineString(_) => Family::Polyline,
            Geometry::Polygon(_) | Geometry::MultiPolygon(_) => Family::Polygon,
        }
    }

    /// Visits every position in the geometry, for bounds and dimension probing.
    pub fn for_each_position(&self, mut visit: impl FnMut(&Position)) {
        match self {
            Geometry::Point(p) => visit(p),
            Geometry::MultiPoint(ps) | Geometry::LineString(ps) => ps.iter().for_each(visit),
            Geometry::MultiLineString(parts) | Geometry::Polygon(parts) => {
                parts.iter().flatten().for_each(visit)
            }
            Geometry::MultiPolygon(polys) => polys.iter().flatten().flatten().for_each(visit),
        }
    }

    fn parse(value: &Value, index: usize) -> Result<Self> {
        let object = value.as_object().ok_or_else(|| ShapefileError::Feature {
            index,
            message: "geometry must be an object".into(),
        })?;

        let kind =
            object
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| ShapefileError::Feature {
                    index,
                    message: "geometry is missing a `type`".into(),
                })?;

        if kind == "GeometryCollection" {
            return Err(ShapefileError::GeometryCollection { index });
        }

        let coordinates = object
            .get("coordinates")
            .ok_or_else(|| ShapefileError::Feature {
                index,
                message: format!("{kind} geometry is missing `coordinates`"),
            })?;

        match kind {
            "Point" => Ok(Geometry::Point(Position::parse(coordinates, index)?)),
            "MultiPoint" => Ok(Geometry::MultiPoint(parse_line(coordinates, index)?)),
            "LineString" => Ok(Geometry::LineString(parse_line(coordinates, index)?)),
            "MultiLineString" => Ok(Geometry::MultiLineString(parse_lines(coordinates, index)?)),
            "Polygon" => Ok(Geometry::Polygon(parse_lines(coordinates, index)?)),
            "MultiPolygon" => {
                let outer = coordinates
                    .as_array()
                    .ok_or_else(|| ShapefileError::Feature {
                        index,
                        message: "MultiPolygon coordinates must be an array".into(),
                    })?;
                outer
                    .iter()
                    .map(|poly| parse_lines(poly, index))
                    .collect::<Result<Vec<_>>>()
                    .map(Geometry::MultiPolygon)
            }
            other => Err(ShapefileError::UnsupportedGeometry(other.to_string())),
        }
    }
}

fn parse_line(value: &Value, index: usize) -> Result<Vec<Position>> {
    let array = value.as_array().ok_or_else(|| ShapefileError::Feature {
        index,
        message: "expected an array of coordinates".into(),
    })?;
    array
        .iter()
        .map(|pos| Position::parse(pos, index))
        .collect()
}

fn parse_lines(value: &Value, index: usize) -> Result<Vec<Vec<Position>>> {
    let array = value.as_array().ok_or_else(|| ShapefileError::Feature {
        index,
        message: "expected an array of coordinate arrays".into(),
    })?;
    array.iter().map(|line| parse_line(line, index)).collect()
}

/// The four shapefile geometry families we can emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Point,
    Multipoint,
    Polyline,
    Polygon,
}

impl Family {
    pub fn label(self) -> &'static str {
        match self {
            Family::Point => "Point",
            Family::Multipoint => "Multipoint",
            Family::Polyline => "Polyline",
            Family::Polygon => "Polygon",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "point" => Some(Family::Point),
            "multipoint" => Some(Family::Multipoint),
            "polyline" | "linestring" | "line" => Some(Family::Polyline),
            "polygon" => Some(Family::Polygon),
            _ => None,
        }
    }

    /// Resolves the single family a whole dataset will be written as.
    ///
    /// Point and MultiPoint coexist happily by promoting everything to
    /// Multipoint; anything else genuinely cannot share one file.
    pub fn reconcile(self, other: Family, index: usize) -> Result<Family> {
        if self == other {
            return Ok(self);
        }
        match (self, other) {
            (Family::Point, Family::Multipoint) | (Family::Multipoint, Family::Point) => {
                Ok(Family::Multipoint)
            }
            _ => Err(ShapefileError::MixedGeometry {
                first: self.label().to_string(),
                other: other.label().to_string(),
                index,
            }),
        }
    }
}

/// One row of the eventual shapefile: a geometry plus its attribute bag.
pub struct Feature {
    pub geometry: Option<Geometry>,
    pub properties: Map<String, Value>,
}

/// Accepts a FeatureCollection, a lone Feature, a lone geometry, or an array of
/// any of those, and flattens it to a feature list.
pub fn normalize(root: &Value) -> Result<Vec<Feature>> {
    match root {
        Value::Array(items) => {
            let mut features = Vec::with_capacity(items.len());
            for (index, item) in items.iter().enumerate() {
                features.push(parse_feature(item, index)?);
            }
            Ok(features)
        }
        Value::Object(object) => match object.get("type").and_then(Value::as_str) {
            Some("FeatureCollection") => {
                let items = object
                    .get("features")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        ShapefileError::Input("FeatureCollection has no `features` array".into())
                    })?;
                let mut features = Vec::with_capacity(items.len());
                for (index, item) in items.iter().enumerate() {
                    features.push(parse_feature(item, index)?);
                }
                Ok(features)
            }
            Some(_) => Ok(vec![parse_feature(root, 0)?]),
            None => Err(ShapefileError::Input(
                "expected a GeoJSON object with a `type` member".into(),
            )),
        },
        _ => Err(ShapefileError::Input(
            "expected a GeoJSON object or an array of features".into(),
        )),
    }
}

fn parse_feature(value: &Value, index: usize) -> Result<Feature> {
    let object = value.as_object().ok_or_else(|| ShapefileError::Feature {
        index,
        message: "expected an object".into(),
    })?;

    // A bare geometry is a perfectly reasonable thing to hand us.
    if object.get("type").and_then(Value::as_str) != Some("Feature") {
        return Ok(Feature {
            geometry: Some(Geometry::parse(value, index)?),
            properties: Map::new(),
        });
    }

    let geometry = match object.get("geometry") {
        None | Some(Value::Null) => None,
        Some(geometry) => Some(Geometry::parse(geometry, index)?),
    };

    let properties = match object.get("properties") {
        Some(Value::Object(map)) => map.clone(),
        _ => Map::new(),
    };

    Ok(Feature {
        geometry,
        properties,
    })
}
