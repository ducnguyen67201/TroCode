use super::ClassroomService;
use super::lesson_contracts::{LessonPlan, LessonResource};
use super::lessons::unavailable;
use crate::{Row, error::ApiError, query};
use uuid::Uuid;

pub(crate) struct LessonOriginal {
    pub source_version_id: Uuid,
    pub name: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub object_key: String,
}

impl ClassroomService {
    pub(crate) async fn lesson_original(
        &self,
        user: &str,
        anchor: Uuid,
        lesson: Uuid,
        resource: Uuid,
    ) -> Result<LessonOriginal, ApiError> {
        let mut tx = self.begin().await?;
        // Includes active classroom membership, lesson expiry, attempt ownership and source locks.
        let row = self
            .lesson_authority(&mut tx, user, anchor, lesson, true)
            .await?;
        let plan: LessonPlan =
            serde_json::from_value(row.get("plan")).map_err(ApiError::internal)?;
        let source = match plan.resources.iter().find(|item| item.id() == resource) {
            Some(LessonResource::SourceText {
                source_version_id, ..
            }) => *source_version_id,
            _ => return Err(unavailable()),
        };
        let file = query("SELECT sources.virtual_path,versions.media_type,versions.byte_size,versions.sha256,versions.object_key FROM knowledge_activity_version_sources pins JOIN knowledge_source_versions versions ON versions.id=pins.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id JOIN knowledge_activity_runs runs ON runs.id=$3 AND runs.space_id=sources.space_id WHERE pins.activity_version_id=$1 AND versions.id=$2 AND versions.state='ready' AND sources.archived_at IS NULL AND sources.role IN ('reference','instructions')")
            .bind(plan.activity_version_id).bind(source).bind(plan.target_run_id)
            .fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        let original = LessonOriginal {
            source_version_id: source,
            name: file.get("virtual_path"),
            media_type: file.get("media_type"),
            byte_size: file.get("byte_size"),
            sha256: file.get("sha256"),
            object_key: file.get("object_key"),
        };
        if !(1..=25 * 1024 * 1024).contains(&original.byte_size) {
            return Err(unavailable());
        }
        tx.commit().await?;
        Ok(original)
    }
}
