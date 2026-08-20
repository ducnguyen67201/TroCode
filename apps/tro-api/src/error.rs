use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

#[derive(Debug)]
pub(crate) struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) code: Option<&'static str>,
    pub(crate) message: &'static str,
    pub(crate) retry_after: Option<u64>,
}

impl ApiError {
    #[must_use]
    pub(crate) const fn new(status: StatusCode, message: &'static str) -> Self {
        Self {
            status,
            code: None,
            message,
            retry_after: None,
        }
    }

    #[must_use]
    pub(crate) const fn coded(
        status: StatusCode,
        code: &'static str,
        message: &'static str,
    ) -> Self {
        Self {
            status,
            code: Some(code),
            message,
            retry_after: None,
        }
    }

    #[must_use]
    pub(crate) const fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "An internal error occurred.",
        )
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    error: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(ErrorBody {
                code: self.code,
                error: self.message,
            }),
        )
            .into_response();
        if let Some(seconds) = self.retry_after
            && let Ok(value) = seconds.to_string().parse()
        {
            response.headers_mut().insert("retry-after", value);
        }
        response
    }
}

impl From<sea_orm::DbErr> for ApiError {
    fn from(error: sea_orm::DbErr) -> Self {
        tracing::error!(event = "request.failed", code = "database_error", error = %error);
        Self::internal()
    }
}
