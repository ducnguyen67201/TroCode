use crate::error::ApiResult;
use axum::{
    http::{Method, Uri},
    response::Response,
};
pub(super) fn handle(enabled: bool, method: &Method, uri: &Uri) -> ApiResult<Option<Response>> {
    if !enabled || method != Method::GET || uri.path() != "/classroom-test/python-editor" {
        return Ok(None);
    }
    let mut response = super::bytes_response(
        http::StatusCode::OK,
        "text/html; charset=utf-8",
        include_str!("../../tests/fixtures/classroom-python-editor.html"),
    )?;
    response
        .headers_mut()
        .insert("cache-control", http::HeaderValue::from_static("no-store"));
    response.headers_mut().insert("content-security-policy",http::HeaderValue::from_static("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
    Ok(Some(response))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_requires_server_configuration() {
        let uri = "/classroom-test/python-editor?enabled=true"
            .parse()
            .unwrap();
        assert!(handle(false, &Method::GET, &uri).unwrap().is_none());
        assert!(handle(true, &Method::GET, &uri).unwrap().is_some());
        assert!(handle(true, &Method::POST, &uri).unwrap().is_none());
    }
}
