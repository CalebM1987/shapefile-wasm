use thiserror::Error;

/// Every failure mode the writer can produce, with enough context to point a
/// caller at the offending feature.
#[derive(Debug, Error)]
pub enum ShapefileError {
    #[error("could not read the input as GeoJSON: {0}")]
    Input(String),

    #[error("unsupported GeoJSON geometry type `{0}`")]
    UnsupportedGeometry(String),

    #[error(
        "a shapefile holds a single geometry type, but the input mixes {first} and {other} \
         (feature {index}); split the input or pass an explicit `shapeType`"
    )]
    MixedGeometry {
        first: String,
        other: String,
        index: usize,
    },

    #[error("feature {index}: {message}")]
    Feature { index: usize, message: String },

    #[error("GeometryCollection is not representable in a shapefile (feature {index})")]
    GeometryCollection { index: usize },

    #[error("the input contains no writable features")]
    Empty,

    #[error("field name `{0}` could not be reduced to a valid dBase field name")]
    FieldName(String),

    #[error("error writing geometry: {0}")]
    Shape(#[from] shapefile::Error),

    #[error("error writing attributes: {0}")]
    Dbf(#[from] dbase::Error),
}

pub type Result<T> = std::result::Result<T, ShapefileError>;

impl From<ShapefileError> for wasm_bindgen::JsValue {
    fn from(err: ShapefileError) -> Self {
        wasm_bindgen::JsError::new(&err.to_string()).into()
    }
}
