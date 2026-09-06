use std::{fs::OpenOptions, io::Write, path::Path};

use anyhow::Context;
use base64::{Engine, engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{
    Signer, SigningKey,
    pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey},
};
use rand::RngCore;
use serde::Serialize;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MembershipPayload {
    expires_at: String,
    issued_at: String,
    reference_code: String,
    version: u8,
}

pub fn membership_keygen(
    private_key_path: &Path,
    public_key_path: Option<&Path>,
) -> anyhow::Result<()> {
    let mut secret = [0_u8; 32];
    rand::rng().fill_bytes(&mut secret);
    let signing_key = SigningKey::from_bytes(&secret);
    let private_der = signing_key
        .to_pkcs8_der()
        .context("private key encoding failed")?;
    write_new(
        private_key_path,
        pem("PRIVATE KEY", private_der.as_bytes()).as_bytes(),
        true,
    )
    .context("private key creation failed")?;
    let public_der = signing_key
        .verifying_key()
        .to_public_key_der()
        .context("public key encoding failed")?;
    let public_base64 = STANDARD.encode(public_der.as_bytes());
    if let Some(path) = public_key_path {
        write_new(path, format!("{public_base64}\n").as_bytes(), false)
            .context("public key creation failed")?;
    }
    println!("{public_base64}");
    Ok(())
}

pub fn membership_issue(
    private_key_path: &Path,
    reference: &str,
    days: u16,
    now: Option<&str>,
) -> anyhow::Result<()> {
    let token = issue_membership_token(private_key_path, reference, days, now)?;
    println!("{token}");
    Ok(())
}

fn issue_membership_token(
    private_key_path: &Path,
    reference: &str,
    days: u16,
    now: Option<&str>,
) -> anyhow::Result<String> {
    anyhow::ensure!(
        (1..=3_650).contains(&days),
        "Membership duration must be a whole number from 1 to 3650 days."
    );
    let reference_code = reference.trim().to_ascii_uppercase();
    anyhow::ensure!(
        valid_reference(&reference_code),
        "Reference code must look like TRC-AAAA-BBBB-CCCC."
    );
    let issued_at = match now {
        Some(value) => OffsetDateTime::parse(value, &Rfc3339)
            .context("--now must be an ISO date.")?
            .to_offset(UtcOffset::UTC),
        None => OffsetDateTime::now_utc(),
    };
    let expires_at = issued_at
        .checked_add(time::Duration::days(i64::from(days)))
        .context("membership expiry overflow")?;
    let payload = MembershipPayload {
        expires_at: javascript_iso_timestamp(expires_at),
        issued_at: javascript_iso_timestamp(issued_at),
        reference_code,
        version: 1,
    };
    let encoded_payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload)?);
    let private_pem = std::fs::read_to_string(private_key_path)
        .with_context(|| format!("failed to read {}", private_key_path.display()))?;
    let private_der = decode_pem(&private_pem, "PRIVATE KEY")?;
    let signing_key = SigningKey::from_pkcs8_der(&private_der)
        .context("The membership private key must be Ed25519.")?;
    let signature = signing_key.sign(encoded_payload.as_bytes());
    Ok(format!(
        "{encoded_payload}.{}",
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    ))
}

fn javascript_iso_timestamp(value: OffsetDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        value.year(),
        u8::from(value.month()),
        value.day(),
        value.hour(),
        value.minute(),
        value.second(),
        value.nanosecond() / 1_000_000,
    )
}

fn valid_reference(value: &str) -> bool {
    let segments = value.split('-').collect::<Vec<_>>();
    segments.len() == 4
        && segments[0] == "TRC"
        && segments[1..].iter().all(|segment| {
            segment.len() == 4
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
        })
}

fn pem(label: &str, der: &[u8]) -> String {
    let encoded = STANDARD.encode(der);
    let body = encoded
        .as_bytes()
        .chunks(64)
        .filter_map(|chunk| std::str::from_utf8(chunk).ok())
        .collect::<Vec<_>>()
        .join("\n");
    format!("-----BEGIN {label}-----\n{body}\n-----END {label}-----\n")
}

fn decode_pem(value: &str, label: &str) -> anyhow::Result<Vec<u8>> {
    let begin = format!("-----BEGIN {label}-----");
    let end = format!("-----END {label}-----");
    let body = value
        .trim()
        .strip_prefix(&begin)
        .and_then(|value| value.strip_suffix(&end))
        .context("private key PEM envelope is invalid")?;
    STANDARD
        .decode(body.lines().map(str::trim).collect::<String>())
        .context("private key PEM body is invalid")
}

fn write_new(path: &Path, bytes: &[u8], private: bool) -> anyhow::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if private { 0o600 } else { 0o644 });
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};
    use std::path::PathBuf;

    fn create_private_key(directory: &Path) -> (PathBuf, SigningKey) {
        let private_path = directory.join("membership-private.pem");
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let private_der = signing_key.to_pkcs8_der().expect("PKCS#8");
        write_new(
            &private_path,
            pem("PRIVATE KEY", private_der.as_bytes()).as_bytes(),
            true,
        )
        .expect("private key");
        (private_path, signing_key)
    }

    #[test]
    fn issued_membership_is_signed_ed25519_with_stable_payload_shape() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let (private_path, signing_key) = create_private_key(directory.path());
        let token = issue_membership_token(
            &private_path,
            "trc-ab12-cd34-ef56",
            2,
            Some("2026-08-25T01:02:03Z"),
        )
        .expect("membership token");
        let (payload, encoded_signature) = token.split_once('.').expect("token segments");
        let signature_bytes = URL_SAFE_NO_PAD
            .decode(encoded_signature)
            .expect("signature base64");
        let signature = Signature::try_from(signature_bytes.as_slice()).expect("signature");
        signing_key
            .verifying_key()
            .verify(payload.as_bytes(), &signature)
            .expect("valid signature");
        let payload: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).expect("payload base64"))
                .expect("payload JSON");
        assert_eq!(payload["issuedAt"], "2026-08-25T01:02:03.000Z");
        assert_eq!(payload["expiresAt"], "2026-08-27T01:02:03.000Z");
        assert_eq!(payload["referenceCode"], "TRC-AB12-CD34-EF56");
        assert_eq!(payload["version"], 1);
    }

    #[test]
    fn membership_validation_rejects_bad_reference_and_duration() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let (private_path, _) = create_private_key(directory.path());
        assert!(issue_membership_token(&private_path, "bad", 2, None).is_err());
        assert!(issue_membership_token(&private_path, "TRC-AB12-CD34-EF56", 0, None).is_err());
    }
}
