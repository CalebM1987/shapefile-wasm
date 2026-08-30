//! Turns parsed GeoJSON geometries into concrete shapefile shapes.
//!
//! The shapefile format has no single "geometry" type — each dimensionality is a
//! separate Rust type — so the conversion is generic over the point type and the
//! caller picks the concrete one from the resolved [`Dimension`].

use shapefile::record::multipoint::GenericMultipoint;
use shapefile::record::polygon::GenericPolygon;
use shapefile::record::polyline::GenericPolyline;
use shapefile::record::traits::{GrowablePoint, HasXY, ShrinkablePoint};
use shapefile::{Point, PointM, PointZ, PolygonRing, NO_DATA};

use crate::error::{Result, ShapefileError};
use crate::input::{Geometry, Position};

/// Which ordinates end up in the output file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dimension {
    /// Plain 2D — `Point`, `Polyline`, `Polygon`, `Multipoint`.
    Xy,
    /// 2D plus a measure — the third GeoJSON ordinate is read as M.
    Xym,
    /// 3D — the third ordinate is Z, M is left as "no data".
    Xyz,
    /// 3D plus a measure — the fourth ordinate is M.
    Xyzm,
}

impl Dimension {
    pub fn label(self) -> &'static str {
        match self {
            Dimension::Xy => "xy",
            Dimension::Xym => "xym",
            Dimension::Xyz => "xyz",
            Dimension::Xyzm => "xyzm",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "xy" | "2d" => Some(Dimension::Xy),
            "xym" => Some(Dimension::Xym),
            "xyz" | "3d" => Some(Dimension::Xyz),
            "xyzm" | "xyzm4" | "4d" => Some(Dimension::Xyzm),
            _ => None,
        }
    }

    /// Picks a dimension from how many ordinates the richest coordinate carried.
    pub fn from_arity(max_arity: usize) -> Self {
        match max_arity {
            0..=2 => Dimension::Xy,
            3 => Dimension::Xyz,
            _ => Dimension::Xyzm,
        }
    }

    /// The suffix ESRI uses for this dimensionality, e.g. `PolylineZ`.
    pub fn suffix(self) -> &'static str {
        match self {
            Dimension::Xy => "",
            Dimension::Xym => "M",
            Dimension::Xyz | Dimension::Xyzm => "Z",
        }
    }
}

/// Builds a concrete shapefile point from a GeoJSON position.
pub trait FromPosition: Copy {
    fn from_position(position: &Position, dimension: Dimension) -> Self;
}

impl FromPosition for Point {
    fn from_position(position: &Position, _dimension: Dimension) -> Self {
        Point::new(position.x, position.y)
    }
}

impl FromPosition for PointM {
    fn from_position(position: &Position, _dimension: Dimension) -> Self {
        // Only ever selected for `Xym`, where the third ordinate is the measure.
        PointM::new(position.x, position.y, position.third.unwrap_or(NO_DATA))
    }
}

impl FromPosition for PointZ {
    fn from_position(position: &Position, dimension: Dimension) -> Self {
        let z = position.third.unwrap_or(0.0);
        let m = match dimension {
            Dimension::Xyzm => position.fourth.unwrap_or(NO_DATA),
            _ => NO_DATA,
        };
        PointZ::new(position.x, position.y, z, m)
    }
}

/// The trait soup the shapefile constructors require of a point type.
pub trait ShapePoint:
    FromPosition + Copy + PartialEq + HasXY + GrowablePoint + ShrinkablePoint
{
}

impl<T> ShapePoint for T where
    T: FromPosition + Copy + PartialEq + HasXY + GrowablePoint + ShrinkablePoint
{
}

fn convert<P: ShapePoint>(positions: &[Position], dimension: Dimension) -> Vec<P> {
    positions
        .iter()
        .map(|position| P::from_position(position, dimension))
        .collect()
}

/// A GeoJSON geometry that should have been a point.
pub fn to_point<P: ShapePoint>(
    geometry: &Geometry,
    dimension: Dimension,
    index: usize,
) -> Result<P> {
    match geometry {
        Geometry::Point(position) => Ok(P::from_position(position, dimension)),
        other => Err(mismatch(other, "Point", index)),
    }
}

pub fn to_multipoint<P: ShapePoint>(
    geometry: &Geometry,
    dimension: Dimension,
    index: usize,
) -> Result<GenericMultipoint<P>> {
    // A lone Point is a legal one-element Multipoint, which is what lets mixed
    // Point/MultiPoint input share a file.
    let positions: Vec<Position> = match geometry {
        Geometry::MultiPoint(positions) => positions.clone(),
        Geometry::Point(position) => vec![*position],
        other => return Err(mismatch(other, "Multipoint", index)),
    };

    if positions.is_empty() {
        return Err(ShapefileError::Feature {
            index,
            message: "a multipoint needs at least one coordinate".into(),
        });
    }

    Ok(GenericMultipoint::new(convert::<P>(&positions, dimension)))
}

pub fn to_polyline<P: ShapePoint>(
    geometry: &Geometry,
    dimension: Dimension,
    index: usize,
) -> Result<GenericPolyline<P>> {
    let parts: Vec<Vec<Position>> = match geometry {
        Geometry::LineString(positions) => vec![positions.clone()],
        Geometry::MultiLineString(parts) => parts.clone(),
        other => return Err(mismatch(other, "Polyline", index)),
    };

    if parts.is_empty() {
        return Err(ShapefileError::Feature {
            index,
            message: "a polyline needs at least one part".into(),
        });
    }

    // `GenericPolyline::with_parts` asserts on short parts, which in wasm means
    // an abort with no message. Reject them here with something actionable.
    if let Some(short) = parts.iter().find(|part| part.len() < 2) {
        return Err(ShapefileError::Feature {
            index,
            message: format!(
                "every line needs at least 2 coordinates, found one with {}",
                short.len()
            ),
        });
    }

    let converted = parts
        .iter()
        .map(|part| convert::<P>(part, dimension))
        .collect();

    Ok(GenericPolyline::with_parts(converted))
}

pub fn to_polygon<P: ShapePoint>(
    geometry: &Geometry,
    dimension: Dimension,
    index: usize,
) -> Result<GenericPolygon<P>> {
    // A shapefile polygon is a flat list of rings, so a MultiPolygon collapses
    // into the same structure as a Polygon.
    let polygons: Vec<Vec<Vec<Position>>> = match geometry {
        Geometry::Polygon(rings) => vec![rings.clone()],
        Geometry::MultiPolygon(polygons) => polygons.clone(),
        other => return Err(mismatch(other, "Polygon", index)),
    };

    let mut rings: Vec<PolygonRing<P>> = Vec::new();
    for polygon in &polygons {
        for (ring_index, ring) in polygon.iter().enumerate() {
            if ring.len() < 3 {
                return Err(ShapefileError::Feature {
                    index,
                    message: format!(
                        "every polygon ring needs at least 3 coordinates, found one with {}",
                        ring.len()
                    ),
                });
            }
            let points = convert::<P>(ring, dimension);
            // GeoJSON puts the exterior ring first; the rest are holes.
            // `with_rings` fixes the winding order for us.
            rings.push(if ring_index == 0 {
                PolygonRing::Outer(points)
            } else {
                PolygonRing::Inner(points)
            });
        }
    }

    if rings.is_empty() {
        return Err(ShapefileError::Feature {
            index,
            message: "a polygon needs at least one ring".into(),
        });
    }

    Ok(GenericPolygon::with_rings(rings))
}

fn mismatch(geometry: &Geometry, expected: &str, index: usize) -> ShapefileError {
    ShapefileError::MixedGeometry {
        first: expected.to_string(),
        other: geometry.family().label().to_string(),
        index,
    }
}
