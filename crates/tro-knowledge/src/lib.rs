//! Knowledge Space object, extraction, chunking, and worker primitives.

use std::{io::Cursor, sync::Arc};

use async_trait::async_trait;
use bytes::Bytes;
use lopdf::Document;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::Semaphore;

pub const MAX_SOURCE_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_PDF_PAGES: usize = 500;
pub const MAX_EXTRACTED_CHARS: usize = 2_000_000;
pub const MAX_CHUNK_CHARS: usize = 1_200;
pub const CHUNK_OVERLAP_CHARS: usize = 150;
pub const MAX_CHUNKS: usize = 5_000;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum KnowledgeError {
    #[error("source exceeds its byte limit")]
    SourceTooLarge,
    #[error("source checksum does not match")]
    ChecksumMismatch,
    #[error("source media type is not supported")]
    UnsupportedMediaType,
    #[error("PDF is encrypted")]
    EncryptedPdf,
    #[error("PDF does not contain extractable text")]
    ScannedPdf,
    #[error("PDF exceeds extraction limits")]
    PdfLimit,
    #[error("source extraction failed")]
    ExtractionFailed,
    #[error("object operation has an uncertain result")]
    ObjectUncertain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectMetadata {
    pub byte_size: u64,
    pub media_type: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresignedOperation {
    pub method: &'static str,
    pub url: String,
    pub required_headers: Vec<(String, String)>,
    pub expires_in_seconds: u32,
}

#[async_trait]
pub trait PrivateObjectStore: Send + Sync {
    /// Reads metadata for exactly one private object.
    ///
    /// # Errors
    ///
    /// Returns a knowledge error when the object cannot be verified.
    async fn head(&self, object_key: &str) -> Result<ObjectMetadata, KnowledgeError>;
    /// Downloads an object without exceeding `max_bytes`.
    ///
    /// # Errors
    ///
    /// Returns a knowledge error for a rejected, oversized, or uncertain read.
    async fn get_bounded(
        &self,
        object_key: &str,
        max_bytes: usize,
    ) -> Result<Bytes, KnowledgeError>;
    /// Creates a short-lived upload ticket for exact expected metadata.
    ///
    /// # Errors
    ///
    /// Returns a knowledge error when a safe ticket cannot be created.
    async fn presign_put(
        &self,
        object_key: &str,
        metadata: &ObjectMetadata,
    ) -> Result<PresignedOperation, KnowledgeError>;
    /// Creates a short-lived download ticket for one private object.
    ///
    /// # Errors
    ///
    /// Returns a knowledge error when a safe ticket cannot be created.
    async fn presign_get(&self, object_key: &str) -> Result<PresignedOperation, KnowledgeError>;
}

/// Confirms that an object-store `HEAD` result exactly matches admission data.
///
/// # Errors
///
/// Returns [`KnowledgeError::ChecksumMismatch`] for any size, media-type, or
/// checksum mismatch.
pub fn reconcile_head(
    expected: &ObjectMetadata,
    actual: &ObjectMetadata,
) -> Result<(), KnowledgeError> {
    if expected.byte_size != actual.byte_size || expected.media_type != actual.media_type {
        return Err(KnowledgeError::ChecksumMismatch);
    }
    if !constant_time_text_eq(&expected.sha256, &actual.sha256) {
        return Err(KnowledgeError::ChecksumMismatch);
    }
    Ok(())
}

fn constant_time_text_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.as_bytes()
        .iter()
        .zip(right.as_bytes())
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedChunk {
    pub ordinal: u32,
    pub body: String,
    pub locator: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct Extractor {
    permits: Arc<Semaphore>,
}

impl Extractor {
    #[must_use]
    pub fn new(max_parallel: usize) -> Self {
        Self {
            permits: Arc::new(Semaphore::new(max_parallel.max(1))),
        }
    }

    /// Extracts and chunks one bounded text or PDF source.
    ///
    /// # Errors
    ///
    /// Returns a knowledge error for oversized, unsupported, encrypted,
    /// scanned, malformed, or extraction-limit-exceeding input.
    pub async fn extract(
        &self,
        media_type: &str,
        bytes: Bytes,
    ) -> Result<Vec<ExtractedChunk>, KnowledgeError> {
        if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
            return Err(KnowledgeError::SourceTooLarge);
        }
        let permit = self
            .permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| KnowledgeError::ExtractionFailed)?;
        let media_type = media_type.to_owned();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            match media_type.as_str() {
                "text/plain" | "text/markdown" => {
                    let text = String::from_utf8(bytes.to_vec())
                        .map_err(|_| KnowledgeError::ExtractionFailed)?;
                    chunk_text(&text, None)
                }
                "application/pdf" => extract_pdf(&bytes),
                _ => Err(KnowledgeError::UnsupportedMediaType),
            }
        })
        .await
        .map_err(|_| KnowledgeError::ExtractionFailed)?
    }
}

fn extract_pdf(bytes: &[u8]) -> Result<Vec<ExtractedChunk>, KnowledgeError> {
    let document =
        Document::load_from(Cursor::new(bytes)).map_err(|_| KnowledgeError::ExtractionFailed)?;
    if document.is_encrypted() {
        return Err(KnowledgeError::EncryptedPdf);
    }
    let pages = document.get_pages();
    if pages.is_empty() || pages.len() > MAX_PDF_PAGES {
        return Err(KnowledgeError::PdfLimit);
    }
    let mut all = String::new();
    for page in pages.keys() {
        let remaining = MAX_EXTRACTED_CHARS.saturating_sub(all.chars().count());
        if remaining == 0 {
            return Err(KnowledgeError::PdfLimit);
        }
        let text = document
            .extract_text_with_limit(&[*page], remaining)
            .map_err(|_| KnowledgeError::ExtractionFailed)?;
        all.push_str(&text);
        all.push('\n');
    }
    if all.trim().is_empty() {
        return Err(KnowledgeError::ScannedPdf);
    }
    chunk_text(&all, Some("pdf"))
}

fn chunk_text(text: &str, source: Option<&str>) -> Result<Vec<ExtractedChunk>, KnowledgeError> {
    if text.chars().count() > MAX_EXTRACTED_CHARS {
        return Err(KnowledgeError::PdfLimit);
    }
    let normalized = text.replace('\0', "");
    let characters = normalized.chars().collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut start = 0_usize;
    while start < characters.len() {
        let end = start.saturating_add(MAX_CHUNK_CHARS).min(characters.len());
        let body = characters[start..end].iter().collect::<String>();
        if !body.trim().is_empty() {
            if chunks.len() >= MAX_CHUNKS {
                return Err(KnowledgeError::PdfLimit);
            }
            let ordinal = u32::try_from(chunks.len()).map_err(|_| KnowledgeError::PdfLimit)?;
            chunks.push(ExtractedChunk {
                ordinal,
                body: body.trim().to_owned(),
                locator: serde_json::json!({ "source": source, "startCharacter": start }),
            });
        }
        if end == characters.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP_CHARS);
    }
    if chunks.is_empty() {
        return Err(KnowledgeError::ExtractionFailed);
    }
    Ok(chunks)
}

#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::{ObjectMetadata, reconcile_head, sha256_hex};

    #[test]
    fn head_reconciliation_is_exact() {
        let expected = ObjectMetadata {
            byte_size: 3,
            media_type: String::from("text/plain"),
            sha256: sha256_hex(b"tro"),
        };
        assert!(reconcile_head(&expected, &expected).is_ok());
        let mut changed = expected.clone();
        changed.byte_size = 4;
        assert!(reconcile_head(&expected, &changed).is_err());
    }
}
