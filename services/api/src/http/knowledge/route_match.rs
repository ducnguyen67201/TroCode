pub(super) fn matches_knowledge(path: &str) -> bool {
    [
        "/v1/lesson-executions/",
        "/v1/live-rooms",
        "/v1/spaces",
        "/v1/activities",
        "/v1/runs",
        "/v1/attempts",
        "/v1/work-sessions",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
        || matches!(
            path,
            "/v1/uploads/complete" | "/v1/assignments/me" | "/v1/space-invites/redeem"
        )
}
