//! Derives a dBase table schema from GeoJSON properties.
//!
//! dBase is far stricter than GeoJSON: field names are capped at 11 bytes, every
//! column has one fixed type, and every record must supply a value for every
//! column. On top of that, `dbase` crops any value that overruns its declared
//! width — silently. So we make one pass over the data to learn the exact widths
//! needed, rather than guessing and corrupting the tail of long values.

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::error::{Result, ShapefileError};
use crate::input::Feature;

/// dBase caps field names at 11 bytes.
const MAX_NAME_BYTES: usize = 11;
/// Widest character field dBase can describe.
pub const MAX_CHARACTER_WIDTH: usize = 254;
/// More decimal places than an f64 can meaningfully round-trip.
const MAX_DECIMALS: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    Character { width: u8 },
    Numeric { width: u8, decimals: u8 },
    Logical,
}

impl FieldKind {
    pub fn label(&self) -> &'static str {
        match self {
            FieldKind::Character { .. } => "character",
            FieldKind::Numeric { .. } => "numeric",
            FieldKind::Logical => "logical",
        }
    }
}

/// One resolved column: where it came from, what it is called in the .dbf, and
/// how it is stored.
#[derive(Debug, Clone)]
pub struct Field {
    /// The GeoJSON property name.
    pub source: String,
    /// The (sanitised, truncated, de-duplicated) dBase field name.
    pub name: String,
    pub kind: FieldKind,
}

/// Everything we learned about one property while scanning the input.
#[derive(Default)]
struct Observation {
    saw_string: bool,
    saw_number: bool,
    saw_bool: bool,
    saw_nested: bool,
    /// Longest UTF-8 rendering, used to size character fields.
    max_text_bytes: usize,
    /// Most fraction digits needed by any observed number.
    max_decimals: usize,
    numbers: Vec<f64>,
}

impl Observation {
    fn record(&mut self, value: &Value) {
        match value {
            Value::Null => {}
            Value::String(text) => {
                self.saw_string = true;
                self.max_text_bytes = self.max_text_bytes.max(text.len());
            }
            Value::Bool(_) => {
                self.saw_bool = true;
                self.max_text_bytes = self.max_text_bytes.max(5); // "false"
            }
            Value::Number(number) => {
                self.saw_number = true;
                if let Some(as_f64) = number.as_f64() {
                    self.max_decimals = self.max_decimals.max(fraction_digits(as_f64));
                    self.numbers.push(as_f64);
                    self.max_text_bytes = self.max_text_bytes.max(shortest_text(as_f64).len());
                } else {
                    // Out of f64 range; it can only survive as text.
                    self.saw_nested = true;
                    self.max_text_bytes = self.max_text_bytes.max(number.to_string().len());
                }
            }
            other => {
                self.saw_nested = true;
                self.max_text_bytes = self.max_text_bytes.max(other.to_string().len());
            }
        }
    }

    fn resolve(&self, max_character_width: usize) -> FieldKind {
        let distinct_scalars = usize::from(self.saw_string)
            + usize::from(self.saw_number)
            + usize::from(self.saw_bool);

        if self.saw_nested || distinct_scalars > 1 {
            return character(self.max_text_bytes, max_character_width);
        }

        if self.saw_bool {
            return FieldKind::Logical;
        }

        if self.saw_number {
            // Find the widest precision that still fits inside a dBase field.
            // Anything that cannot fit at all falls back to text rather than
            // being cropped into a different number.
            let mut decimals = self.max_decimals.min(MAX_DECIMALS);
            loop {
                let width = self
                    .numbers
                    .iter()
                    .map(|value| format!("{value:.decimals$}").len())
                    .max()
                    .unwrap_or(1);
                if width <= MAX_CHARACTER_WIDTH {
                    return FieldKind::Numeric {
                        width: width.max(1) as u8,
                        decimals: decimals as u8,
                    };
                }
                if decimals == 0 {
                    return character(self.max_text_bytes, max_character_width);
                }
                decimals -= 1;
            }
        }

        // Only nulls were ever seen; a narrow text column keeps the file valid.
        character(self.max_text_bytes.max(1), max_character_width)
    }
}

fn character(observed: usize, cap: usize) -> FieldKind {
    let width = observed.clamp(1, cap.clamp(1, MAX_CHARACTER_WIDTH));
    FieldKind::Character { width: width as u8 }
}

/// Rust's `Display` for f64 is the shortest representation that round-trips, and
/// never uses exponent notation — exactly what a .dbf wants.
fn shortest_text(value: f64) -> String {
    if value.is_finite() {
        format!("{value}")
    } else {
        String::new()
    }
}

fn fraction_digits(value: f64) -> usize {
    let text = shortest_text(value);
    match text.split_once('.') {
        Some((_, fraction)) => fraction.len(),
        None => 0,
    }
}

/// Reduces a GeoJSON property name to something dBase will accept, keeping the
/// result unique within the table.
fn sanitize_name(source: &str, taken: &mut HashMap<String, usize>) -> Result<String> {
    let mut cleaned: String = source
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();

    // dBase readers expect a name to start with a letter.
    if !cleaned
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
    {
        cleaned.insert(0, 'F');
    }

    cleaned.truncate(MAX_NAME_BYTES);
    let cleaned = cleaned.trim_end_matches('_').to_string();
    let base = if cleaned.is_empty() {
        "FIELD".to_string()
    } else {
        cleaned
    };

    let next = taken.entry(base.clone()).or_insert(0);
    *next += 1;
    if *next == 1 {
        return Ok(base);
    }

    // Collision: make room for a numeric suffix inside the 11-byte budget.
    for attempt in *next..(*next + 1000) {
        let suffix = attempt.to_string();
        let keep = MAX_NAME_BYTES.saturating_sub(suffix.len() + 1);
        let mut candidate = base.clone();
        candidate.truncate(keep);
        let candidate = format!("{candidate}_{suffix}");
        if !taken.contains_key(&candidate) {
            taken.insert(candidate.clone(), 1);
            return Ok(candidate);
        }
    }

    Err(ShapefileError::FieldName(source.to_string()))
}

/// Marker for the column we invent when the input carries no properties at all.
const SYNTHETIC_FID: &str = "\u{0}fid";

/// The full set of columns, in the order they first appeared in the input.
pub struct Schema {
    pub fields: Vec<Field>,
    /// True when the only column is the one we synthesised.
    pub synthetic: bool,
}

impl Schema {
    pub fn infer(features: &[Feature], max_character_width: usize) -> Result<Self> {
        let mut order: Vec<String> = Vec::new();
        let mut observations: HashMap<String, Observation> = HashMap::new();

        for feature in features {
            for (key, value) in &feature.properties {
                let entry = observations.entry(key.clone()).or_insert_with(|| {
                    order.push(key.clone());
                    Observation::default()
                });
                entry.record(value);
            }
        }

        let mut taken = HashMap::new();
        let mut fields = Vec::with_capacity(order.len());
        for source in order {
            let kind = observations[&source].resolve(max_character_width);
            let name = sanitize_name(&source, &mut taken)?;
            fields.push(Field { source, name, kind });
        }

        // A .dbf with zero columns is technically writable but many GIS readers
        // reject it, so give attribute-less input a sequential id instead.
        if fields.is_empty() {
            fields.push(Field {
                source: SYNTHETIC_FID.to_string(),
                name: "FID".to_string(),
                kind: FieldKind::Numeric {
                    width: 11,
                    decimals: 0,
                },
            });
            return Ok(Self {
                fields,
                synthetic: true,
            });
        }

        Ok(Self {
            fields,
            synthetic: false,
        })
    }

    pub fn builder(&self) -> Result<dbase::TableWriterBuilder> {
        // A .dbf carries no encoding of its own; we write UTF-8 and advertise it
        // in the companion .cpg file.
        let mut builder = dbase::TableWriterBuilder::with_encoding(dbase::UnicodeLossy);

        for field in &self.fields {
            let name = dbase::FieldName::try_from(field.name.as_str())
                .map_err(|_| ShapefileError::FieldName(field.source.clone()))?;
            builder = match field.kind {
                FieldKind::Character { width } => builder.add_character_field(name, width),
                FieldKind::Numeric { width, decimals } => {
                    builder.add_numeric_field(name, width, decimals)
                }
                FieldKind::Logical => builder.add_logical_field(name),
            };
        }

        Ok(builder)
    }

    /// Builds a record that supplies a value for *every* column — `dbase` treats
    /// a missing key as a hard error rather than a null.
    pub fn record(&self, properties: &Map<String, Value>, index: usize) -> dbase::Record {
        let mut record = dbase::Record::default();

        for field in &self.fields {
            if field.source == SYNTHETIC_FID {
                record.insert(
                    field.name.clone(),
                    dbase::FieldValue::Numeric(Some(index as f64)),
                );
                continue;
            }
            let value = properties.get(&field.source).unwrap_or(&Value::Null);
            record.insert(field.name.clone(), to_field_value(value, field.kind));
        }

        record
    }
}

fn to_field_value(value: &Value, kind: FieldKind) -> dbase::FieldValue {
    match kind {
        FieldKind::Logical => dbase::FieldValue::Logical(value.as_bool()),
        FieldKind::Numeric { .. } => dbase::FieldValue::Numeric(match value {
            Value::Number(number) => number.as_f64().filter(|n| n.is_finite()),
            _ => None,
        }),
        FieldKind::Character { width } => {
            let text = match value {
                Value::Null => return dbase::FieldValue::Character(None),
                Value::String(text) => text.clone(),
                Value::Number(number) => number
                    .as_f64()
                    .map(shortest_text)
                    .unwrap_or_else(|| number.to_string()),
                Value::Bool(flag) => flag.to_string(),
                other => other.to_string(),
            };
            dbase::FieldValue::Character(Some(truncate_utf8(text, width as usize)))
        }
    }
}

/// `dbase` crops overlong values at the byte level, which would split a
/// multi-byte character and produce invalid UTF-8. Cut on a char boundary first.
fn truncate_utf8(mut text: String, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text;
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_names_are_truncated_and_deduplicated() {
        let mut taken = HashMap::new();
        assert_eq!(
            sanitize_name("population", &mut taken).unwrap(),
            "population"
        );
        // "population_density" truncates to the same 11 bytes, so it gains a suffix.
        assert_eq!(
            sanitize_name("population_density", &mut taken).unwrap(),
            "populatio_2"
        );
        assert_eq!(
            sanitize_name("population", &mut taken).unwrap(),
            "populatio_3"
        );
    }

    #[test]
    fn names_starting_with_a_digit_get_a_prefix() {
        let mut taken = HashMap::new();
        assert_eq!(sanitize_name("2020_pop", &mut taken).unwrap(), "F2020_pop");
    }

    #[test]
    fn numeric_width_covers_the_widest_value() {
        let mut observation = Observation::default();
        observation.record(&serde_json::json!(1.5));
        observation.record(&serde_json::json!(-12345.25));
        match observation.resolve(MAX_CHARACTER_WIDTH) {
            FieldKind::Numeric { width, decimals } => {
                assert_eq!(decimals, 2);
                // "-12345.25" is 9 bytes.
                assert_eq!(width, 9);
            }
            other => panic!("expected numeric, got {other:?}"),
        }
    }

    #[test]
    fn mixed_types_fall_back_to_text() {
        let mut observation = Observation::default();
        observation.record(&serde_json::json!("a"));
        observation.record(&serde_json::json!(1));
        assert!(matches!(
            observation.resolve(MAX_CHARACTER_WIDTH),
            FieldKind::Character { .. }
        ));
    }

    #[test]
    fn truncation_respects_char_boundaries() {
        assert_eq!(truncate_utf8("héllo".to_string(), 2), "h");
    }
}
