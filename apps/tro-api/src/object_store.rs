use std::time::Duration;

use anyhow::Context;
use aws_config::BehaviorVersion;
use aws_sdk_s3::{
    Client,
    config::{Credentials, Region},
    presigning::PresigningConfig,
    types::ChecksumMode,
};
use serde_json::{Value, json};

use crate::config::KnowledgeObjectStoreConfig;

#[derive(Clone)]
pub(crate) struct KnowledgeObjectStore {
    bucket: String,
    client: Client,
}

impl std::fmt::Debug for KnowledgeObjectStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("KnowledgeObjectStore")
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub(crate) struct ObjectHead {
    pub(crate) byte_size: i64,
    pub(crate) checksum_sha256_base64: Option<String>,
    pub(crate) media_type: Option<String>,
}

impl KnowledgeObjectStore {
    pub(crate) async fn new(config: &KnowledgeObjectStoreConfig) -> anyhow::Result<Self> {
        let credentials = Credentials::new(
            config.access_key_id.clone(),
            config.secret_access_key.clone(),
            None,
            None,
            "tro-api",
        );
        let mut loader = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .credentials_provider(credentials);
        if let Some(endpoint) = &config.endpoint {
            loader = loader.endpoint_url(endpoint);
        }
        let shared = loader.load().await;
        let sdk_config = aws_sdk_s3::config::Builder::from(&shared)
            .force_path_style(config.force_path_style)
            .build();
        Ok(Self {
            bucket: config.bucket.clone(),
            client: Client::from_conf(sdk_config),
        })
    }

    pub(crate) async fn presign_put(
        &self,
        object_key: &str,
        byte_size: i64,
        media_type: &str,
        checksum_sha256_base64: &str,
    ) -> anyhow::Result<Value> {
        let request = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(object_key)
            .content_length(byte_size)
            .content_type(media_type)
            .checksum_sha256(checksum_sha256_base64)
            .presigned(PresigningConfig::expires_in(Duration::from_mins(5))?)
            .await
            .context("could not presign object upload")?;
        let headers = request
            .headers()
            .map(|(name, value)| (name.to_owned(), Value::String(value.to_owned())))
            .collect::<serde_json::Map<_, _>>();
        Ok(json!({ "url": request.uri(), "headers": headers, "expiresInSeconds": 300 }))
    }

    pub(crate) async fn presign_get(&self, object_key: &str) -> anyhow::Result<Value> {
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(object_key)
            .checksum_mode(ChecksumMode::Enabled)
            .presigned(PresigningConfig::expires_in(Duration::from_mins(2))?)
            .await
            .context("could not presign object download")?;
        Ok(json!({ "url": request.uri(), "expiresInSeconds": 120 }))
    }

    pub(crate) async fn head(&self, object_key: &str) -> anyhow::Result<ObjectHead> {
        let output = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(object_key)
            .checksum_mode(ChecksumMode::Enabled)
            .send()
            .await
            .context("could not inspect uploaded object")?;
        Ok(ObjectHead {
            byte_size: output.content_length().unwrap_or_default(),
            checksum_sha256_base64: output.checksum_sha256().map(str::to_owned),
            media_type: output.content_type().map(str::to_owned),
        })
    }
}
