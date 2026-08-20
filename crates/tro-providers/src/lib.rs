//! Bounded provider clients with zero automatic retries.

use std::time::Duration;

use bytes::Bytes;
use futures_util::Stream;
use reqwest::{Client, StatusCode, header};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

pub const RESPONSES_MAX_REQUEST_BYTES: usize = 4_000_000;
pub const RESPONSES_MAX_EVENT_BYTES: usize = 2_000_000;
pub const TRANSCRIPTION_MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub openai_base_url: String,
    pub openai_api_key: String,
    pub elevenlabs_base_url: String,
    pub elevenlabs_api_key: Option<String>,
}

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider rejected the request before inference")]
    Rejected { status: StatusCode },
    #[error("provider request has an uncertain outcome")]
    Uncertain,
    #[error("provider response exceeded its limit")]
    ResponseTooLarge,
    #[error("audio is not a supported PCM16 WAV")]
    InvalidWav,
    #[error("provider is not configured")]
    NotConfigured,
}

#[derive(Debug, Clone)]
pub struct ProviderClients {
    http: Client,
    config: ProviderConfig,
}

impl ProviderClients {
    /// Builds bounded, no-redirect provider HTTP clients.
    ///
    /// # Errors
    ///
    /// Returns a request client error when TLS or client construction fails.
    pub fn new(config: ProviderConfig) -> Result<Self, reqwest::Error> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_mins(2))
            .timeout(Duration::from_mins(3))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Tro-Rust/0.1")
            .build()?;
        Ok(Self { http, config })
    }

    /// Dispatches one bounded Responses request without automatic retries.
    ///
    /// # Errors
    ///
    /// Returns a provider error for oversize input, explicit rejection, or an
    /// uncertain network outcome.
    pub async fn responses(
        &self,
        request_id: Uuid,
        body: Value,
    ) -> Result<ProviderByteStream, ProviderError> {
        let encoded = serde_json::to_vec(&body).map_err(|_| ProviderError::Uncertain)?;
        if encoded.len() > RESPONSES_MAX_REQUEST_BYTES {
            return Err(ProviderError::ResponseTooLarge);
        }
        let response = self
            .http
            .post(format!("{}/v1/responses", self.config.openai_base_url))
            .bearer_auth(&self.config.openai_api_key)
            .header("x-request-id", request_id.to_string())
            .header(header::ACCEPT, "text/event-stream")
            .header(header::CONTENT_TYPE, "application/json")
            .body(encoded)
            .send()
            .await
            .map_err(|_| ProviderError::Uncertain)?;

        if !response.status().is_success() {
            return Err(ProviderError::Rejected {
                status: response.status(),
            });
        }
        Ok(ProviderByteStream { response })
    }

    /// Streams one `ElevenLabs` speech response without automatic retries.
    ///
    /// # Errors
    ///
    /// Returns a provider error when speech is not configured, rejected, or
    /// has an uncertain network outcome.
    pub async fn speech(
        &self,
        voice_id: &str,
        body: Value,
    ) -> Result<ProviderByteStream, ProviderError> {
        let api_key = self
            .config
            .elevenlabs_api_key
            .as_ref()
            .ok_or(ProviderError::NotConfigured)?;
        let response = self
            .http
            .post(format!(
                "{}/v1/text-to-speech/{voice_id}/stream",
                self.config.elevenlabs_base_url
            ))
            .header("xi-api-key", api_key)
            .header(header::ACCEPT, "audio/mpeg")
            .json(&body)
            .send()
            .await
            .map_err(|_| ProviderError::Uncertain)?;
        if !response.status().is_success() {
            return Err(ProviderError::Rejected {
                status: response.status(),
            });
        }
        Ok(ProviderByteStream { response })
    }

    /// Uploads one validated PCM16 mono WAV for transcription.
    ///
    /// # Errors
    ///
    /// Returns a provider error for invalid audio, oversize/invalid output,
    /// explicit rejection, or an uncertain network outcome.
    pub async fn transcribe(
        &self,
        wav: Vec<u8>,
        language: &str,
        safety_identifier: &str,
    ) -> Result<Value, ProviderError> {
        parse_pcm16_mono_wav(&wav)?;
        let audio = reqwest::multipart::Part::bytes(wav)
            .file_name("segment.wav")
            .mime_str("audio/wav")
            .map_err(|_| ProviderError::InvalidWav)?;
        let form = reqwest::multipart::Form::new()
            .text("model", "gpt-transcribe")
            .text("language", language.to_owned())
            .part("file", audio);
        let response = self
            .http
            .post(format!(
                "{}/v1/audio/transcriptions",
                self.config.openai_base_url
            ))
            .bearer_auth(&self.config.openai_api_key)
            .header("OpenAI-Safety-Identifier", safety_identifier)
            .multipart(form)
            .send()
            .await
            .map_err(|_| ProviderError::Uncertain)?;
        if !response.status().is_success() {
            return Err(ProviderError::Rejected {
                status: response.status(),
            });
        }
        let declared = response.content_length().unwrap_or(0);
        if declared > 1_000_000 {
            return Err(ProviderError::ResponseTooLarge);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| ProviderError::Uncertain)?;
        if bytes.len() > 1_000_000 {
            return Err(ProviderError::ResponseTooLarge);
        }
        serde_json::from_slice(&bytes).map_err(|_| ProviderError::Uncertain)
    }

    /// Exchanges one bounded realtime transcription SDP offer.
    ///
    /// # Errors
    ///
    /// Returns a provider error for oversize output or an uncertain network
    /// outcome.
    pub async fn realtime_transcription_call(
        &self,
        offer_sdp: String,
        language: &str,
        safety_identifier: &str,
    ) -> Result<ProviderBody, ProviderError> {
        let session = serde_json::json!({
            "type": "transcription",
            "audio": {
                "input": {
                    "noise_reduction": { "type": "far_field" },
                    "transcription": { "language": language, "model": "gpt-realtime-whisper" },
                    "turn_detection": null
                }
            }
        });
        let form = reqwest::multipart::Form::new()
            .text("sdp", offer_sdp)
            .text("session", session.to_string());
        let response = self
            .http
            .post(format!("{}/v1/realtime/calls", self.config.openai_base_url))
            .bearer_auth(&self.config.openai_api_key)
            .header("OpenAI-Safety-Identifier", safety_identifier)
            .multipart(form)
            .send()
            .await
            .map_err(|_| ProviderError::Uncertain)?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("application/sdp")
            .to_owned();
        if response.content_length().unwrap_or(0) > 5_000_000 {
            return Err(ProviderError::ResponseTooLarge);
        }
        let body = response
            .bytes()
            .await
            .map_err(|_| ProviderError::Uncertain)?;
        if body.len() > 5_000_000 {
            return Err(ProviderError::ResponseTooLarge);
        }
        Ok(ProviderBody {
            status,
            content_type,
            body,
        })
    }
}

#[derive(Debug)]
pub struct ProviderBody {
    pub status: StatusCode,
    pub content_type: String,
    pub body: Bytes,
}

pub struct ProviderByteStream {
    response: reqwest::Response,
}

impl std::fmt::Debug for ProviderByteStream {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderByteStream")
            .finish_non_exhaustive()
    }
}

impl ProviderByteStream {
    #[must_use]
    pub fn content_type(&self) -> Option<&str> {
        self.response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
    }

    pub fn into_stream(self) -> impl Stream<Item = Result<Bytes, reqwest::Error>> {
        self.response.bytes_stream()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavMetadata {
    pub byte_count: usize,
    pub duration_ms: u64,
    pub sample_rate: u32,
}

/// Validates and measures a bounded 16 kHz PCM16 mono WAV container.
///
/// # Errors
///
/// Returns [`ProviderError::InvalidWav`] when the container, format, declared
/// length, sample rate, or byte bounds are invalid.
pub fn parse_pcm16_mono_wav(bytes: &[u8]) -> Result<WavMetadata, ProviderError> {
    if bytes.len() < 44 || bytes.len() > TRANSCRIPTION_MAX_AUDIO_BYTES {
        return Err(ProviderError::InvalidWav);
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" || &bytes[12..16] != b"fmt " {
        return Err(ProviderError::InvalidWav);
    }
    let audio_format = u16::from_le_bytes([bytes[20], bytes[21]]);
    let channels = u16::from_le_bytes([bytes[22], bytes[23]]);
    let sample_rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
    let bits = u16::from_le_bytes([bytes[34], bytes[35]]);
    if audio_format != 1 || channels != 1 || sample_rate != 16_000 || bits != 16 {
        return Err(ProviderError::InvalidWav);
    }
    let data_marker = bytes
        .windows(4)
        .position(|window| window == b"data")
        .ok_or(ProviderError::InvalidWav)?;
    let length_offset = data_marker
        .checked_add(4)
        .ok_or(ProviderError::InvalidWav)?;
    let payload_offset = length_offset
        .checked_add(4)
        .ok_or(ProviderError::InvalidWav)?;
    let length_bytes = bytes
        .get(length_offset..payload_offset)
        .ok_or(ProviderError::InvalidWav)?;
    let declared = u32::from_le_bytes(
        length_bytes
            .try_into()
            .map_err(|_| ProviderError::InvalidWav)?,
    ) as usize;
    if payload_offset.checked_add(declared) != Some(bytes.len()) || declared == 0 {
        return Err(ProviderError::InvalidWav);
    }
    let sample_count = declared / 2;
    let duration_ms = u64::try_from(sample_count)
        .map_err(|_| ProviderError::InvalidWav)?
        .saturating_mul(1_000)
        / u64::from(sample_rate);
    Ok(WavMetadata {
        byte_count: bytes.len(),
        duration_ms,
        sample_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::{ProviderError, parse_pcm16_mono_wav};

    #[test]
    fn rejects_non_wav_input() {
        assert!(matches!(
            parse_pcm16_mono_wav(b"not audio"),
            Err(ProviderError::InvalidWav)
        ));
    }
}
