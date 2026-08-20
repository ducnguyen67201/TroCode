async fn select_files_impl(
    window: &tauri::Window,
    state: &DesktopState,
    request: &Value,
) -> CommandResult<Value> {
    let role = required_string(request, "role")?.to_owned();
    if !matches!(role.as_str(), "reference" | "instructions" | "rubric" | "starter" | "submission") {
        return Err(invalid_hosted_request());
    }
    let selection_kind = required_string(request, "selectionKind")?;
    let mut files = Vec::new();
    if selection_kind == "folder" {
        let selected = window.dialog().file().blocking_pick_folder();
        let Some(selected) = selected else { return Ok(Value::Null); };
        let root = selected.into_path().map_err(|_| command_error("selection_invalid", "The selected folder is invalid."))?;
        collect_folder_files(&root, &mut files).await?;
    } else if selection_kind == "files" {
        let selected = window.dialog().file()
            .add_filter("Knowledge files", &["txt", "md", "markdown", "pdf", "rs", "ts", "tsx", "js", "json", "py", "go", "java", "kt", "sql", "toml", "yaml", "yml", "csv"])
            .blocking_pick_files();
        let Some(selected) = selected else { return Ok(Value::Null); };
        let paths = selected.into_iter().map(|value| value.into_path().map_err(|_| command_error("selection_invalid", "A selected file is invalid."))).collect::<Result<Vec<_>, _>>()?;
        let common_root = paths.first().and_then(|path| path.parent()).map(Path::to_path_buf)
            .ok_or_else(|| command_error("selection_invalid", "A selected file has no parent folder."))?;
        for path in paths { add_selected_file(&path, &common_root, &mut files).await?; }
    } else {
        return Err(invalid_hosted_request());
    }
    if files.is_empty() {
        return Err(command_error("selection_empty", "No supported text, Markdown, or PDF files were found."));
    }
    if files.len() > 100 {
        return Err(command_error("selection_too_large", "Select at most 100 files."));
    }
    let total_bytes = files.iter().try_fold(0_u64, |total, file| total.checked_add(file.byte_size))
        .ok_or_else(|| command_error("selection_too_large", "The selected files are too large."))?;
    if total_bytes > 250 * 1024 * 1024 {
        return Err(command_error("selection_too_large", "The selected files exceed the 250 MiB batch limit."));
    }
    let mut collision_keys = std::collections::HashSet::new();
    for file in &files {
        if !collision_keys.insert(file.relative_path.to_lowercase()) {
            return Err(command_error("selection_conflict", "The selected files contain conflicting relative paths."));
        }
    }
    let selection_id = Uuid::new_v4();
    let previews = files.iter().map(|file| json!({
        "displayName": file.display_name,
        "relativePath": file.relative_path,
        "mediaType": file.media_type,
        "byteSize": file.byte_size,
    })).collect::<Vec<_>>();
    state.inner.knowledge_selections.write().await.insert(selection_id, KnowledgeSelection { files, role: role.clone() });
    Ok(json!({ "selectionId": selection_id, "role": role, "files": previews, "totalBytes": total_bytes }))
}

async fn collect_folder_files(root: &Path, files: &mut Vec<SelectedKnowledgeFile>) -> CommandResult<()> {
    let root = tokio::fs::canonicalize(root).await.map_err(|_| command_error("selection_invalid", "The selected folder is invalid."))?;
    let mut directories = vec![(root.clone(), 0_u8)];
    let excluded = [".git", ".hg", ".svn", ".next", ".turbo", "build", "dist", "node_modules", "__pycache__", ".venv", "venv"];
    while let Some((directory, depth)) = directories.pop() {
        if depth > 25 { return Err(command_error("selection_too_deep", "The selected folder is nested too deeply.")); }
        let mut entries = tokio::fs::read_dir(&directory).await.map_err(|_| command_error("selection_invalid", "The selected folder could not be read."))?;
        let mut paths = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(|_| command_error("selection_invalid", "The selected folder could not be read."))? { paths.push(entry.path()); }
        paths.sort();
        for path in paths {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else { continue; };
            if name.starts_with('.') || excluded.contains(&name) { continue; }
            let metadata = tokio::fs::symlink_metadata(&path).await.map_err(|_| command_error("selection_invalid", "A selected path could not be inspected."))?;
            if metadata.file_type().is_symlink() { continue; }
            if metadata.is_dir() { directories.push((path, depth.saturating_add(1))); }
            else if metadata.is_file() { add_selected_file(&path, &root, files).await?; }
            if files.len() > 100 { return Err(command_error("selection_too_large", "Select at most 100 files.")); }
        }
    }
    Ok(())
}

async fn add_selected_file(path: &Path, root: &Path, files: &mut Vec<SelectedKnowledgeFile>) -> CommandResult<()> {
    let Some(media_type) = knowledge_media_type(path) else { return Ok(()); };
    let canonical = tokio::fs::canonicalize(path).await.map_err(|_| command_error("selection_invalid", "A selected file is invalid."))?;
    let metadata = tokio::fs::symlink_metadata(&canonical).await.map_err(|_| command_error("selection_invalid", "A selected file could not be inspected."))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() == 0 || metadata.len() > 25 * 1024 * 1024 {
        return Err(command_error("selection_invalid", "Each file must be a regular file between 1 byte and 25 MiB."));
    }
    let relative = canonical.strip_prefix(root).unwrap_or_else(|_| canonical.file_name().map_or(&canonical, Path::new));
    if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err(command_error("selection_invalid", "A selected file has an invalid relative path."));
    }
    let relative_path = relative.components().filter_map(|part| match part { std::path::Component::Normal(value) => value.to_str(), _ => None }).collect::<Vec<_>>().join("/");
    if relative_path.is_empty() || relative_path.len() > 2_000 { return Err(command_error("selection_invalid", "A selected file has an invalid relative path.")); }
    let display_name = canonical.file_name().and_then(|name| name.to_str()).ok_or_else(|| command_error("selection_invalid", "A selected file name is invalid."))?.to_owned();
    files.push(SelectedKnowledgeFile {
        absolute_path: canonical,
        byte_size: metadata.len(),
        client_id: Uuid::new_v4(),
        display_name,
        media_type: media_type.to_owned(),
        modified: metadata.modified().map_err(|_| command_error("selection_invalid", "A selected file timestamp is invalid."))?,
        relative_path,
    });
    Ok(())
}

fn knowledge_media_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Some("text/markdown"),
        "pdf" => Some("application/pdf"),
        "txt" | "c" | "cc" | "cpp" | "cs" | "css" | "csv" | "go" | "h" | "hpp" | "html" | "ini" | "java" | "js" | "json" | "jsx" | "kt" | "mjs" | "py" | "rb" | "rs" | "sh" | "sql" | "toml" | "ts" | "tsx" | "xml" | "yaml" | "yml" => Some("text/plain"),
        _ => None,
    }
}

async fn upload_selection_impl(
    state: &DesktopState,
    selection_id: Uuid,
    initiate_path: &str,
    submission_attempt_id: Option<String>,
) -> CommandResult<Value> {
    let selection = state.inner.knowledge_selections.write().await.remove(&selection_id)
        .ok_or_else(|| command_error("selection_expired", "That file selection expired. Select the files again."))?;
    let mut prepared = Vec::with_capacity(selection.files.len());
    for file in selection.files {
        let metadata = tokio::fs::symlink_metadata(&file.absolute_path).await
            .map_err(|_| command_error("selection_changed", "A selected file changed. Review the selection again."))?;
        let canonical = tokio::fs::canonicalize(&file.absolute_path).await
            .map_err(|_| command_error("selection_changed", "A selected file changed. Review the selection again."))?;
        if canonical != file.absolute_path || metadata.file_type().is_symlink() || !metadata.is_file()
            || metadata.len() != file.byte_size || metadata.modified().ok() != Some(file.modified)
        {
            return Err(command_error("selection_changed", "A selected file changed. Review the selection again."));
        }
        let bytes = tokio::fs::read(&file.absolute_path).await
            .map_err(|_| command_error("selection_read_failed", "A selected file could not be read."))?;
        if bytes.len() != usize::try_from(file.byte_size).map_err(|_| invalid_hosted_request())? {
            return Err(command_error("selection_changed", "A selected file changed. Review the selection again."));
        }
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        prepared.push((file, bytes, sha256));
    }
    let role = if submission_attempt_id.is_some() { "submission" } else { selection.role.as_str() };
    let body = json!({ "files": prepared.iter().map(|(file, _, sha256)| json!({
        "clientId": file.client_id,
        "relativePath": file.relative_path,
        "displayName": file.display_name,
        "mediaType": file.media_type,
        "byteSize": file.byte_size,
        "sha256": sha256,
        "role": role,
    })).collect::<Vec<_>>() });
    let initiated = hosted_json(state, Method::POST, initiate_path, Some(body), true).await?;
    let uploads = initiated.get("uploads").and_then(Value::as_array)
        .ok_or_else(|| command_error("hosted_invalid_response", "The upload service returned an invalid file batch."))?;
    if uploads.len() != prepared.len() {
        return Err(command_error("hosted_invalid_response", "The upload service returned an incomplete file batch."));
    }
    let mut uploaded = 0_u32;
    let mut processing = 0_u32;
    for (index, upload) in uploads.iter().enumerate() {
        let (_, bytes, _) = prepared.get(index).ok_or_else(|| command_error("hosted_invalid_response", "The upload service returned an invalid file batch."))?;
        if let Some(ticket) = upload.get("upload").filter(|value| !value.is_null()) {
            let raw_url = ticket.get("url").and_then(Value::as_str)
                .ok_or_else(|| command_error("hosted_invalid_response", "The upload ticket was invalid."))?;
            validate_external_url(raw_url)?;
            let mut put = state.inner.hosted.http.put(raw_url).body(bytes.clone());
            if let Some(headers) = ticket.get("headers").and_then(Value::as_object) {
                for (name, value) in headers {
                    let value = value.as_str().ok_or_else(|| command_error("hosted_invalid_response", "The upload ticket headers were invalid."))?;
                    put = put.header(name, value);
                }
            }
            match put.send().await {
                Ok(response) if response.status().is_success() => uploaded = uploaded.saturating_add(1),
                Ok(_) => return Err(command_error("upload_rejected", "Object storage rejected the selected file.")),
                Err(_) => {
                    // Admission is unknown. The completion call performs an exact HEAD reconciliation.
                }
            }
        }
        let source_version_id = upload.get("sourceVersionId").and_then(Value::as_str)
            .ok_or_else(|| command_error("hosted_invalid_response", "The upload response was invalid."))?;
        let completed = hosted_json(
            state,
            Method::POST,
            "/v1/uploads/complete",
            Some(json!({ "clientId": Uuid::new_v4(), "sourceVersionId": source_version_id })),
            true,
        ).await?;
        if matches!(completed.get("state").and_then(Value::as_str), Some("processing" | "ready")) {
            processing = processing.saturating_add(1);
        }
    }
    if let Some(attempt_id) = submission_attempt_id {
        let _ = hosted_json(
            state,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/submissions/commit"),
            Some(json!({ "clientId": Uuid::new_v4() })),
            true,
        ).await?;
    }
    Ok(json!({ "uploaded": uploaded, "processing": processing, "cancelled": false }))
}

async fn prepare_starter_impl(
    window: &tauri::Window,
    state: &DesktopState,
    request: &Value,
) -> CommandResult<Value> {
    let attempt_id = required_string(request, "attemptId")?;
    let attempt = hosted_json(state, Method::GET, &format!("/v1/attempts/{attempt_id}"), None, true).await?;
    if attempt.pointer("/definition/launchTarget").and_then(Value::as_str) != Some("workspace") {
        return Err(command_error("starter_not_workspace", "This Activity does not use a Workspace."));
    }
    let starter = hosted_json(state, Method::GET, &format!("/v1/attempts/{attempt_id}/starter-files"), None, true).await?;
    let files = starter.get("files").and_then(Value::as_array)
        .filter(|files| !files.is_empty())
        .ok_or_else(|| command_error("starter_empty", "This Activity has no starter files."))?;
    let Some(parent) = window.dialog().file().blocking_pick_folder() else { return Ok(Value::Null); };
    let parent = parent.into_path().map_err(|_| command_error("starter_destination_invalid", "The starter destination is invalid."))?;
    let parent = tokio::fs::canonicalize(parent).await.map_err(|_| command_error("starter_destination_invalid", "The starter destination is invalid."))?;
    let staging = parent.join(format!(".trocode-starter-{}", Uuid::new_v4()));
    tokio::fs::create_dir(&staging).await.map_err(|_| command_error("starter_write_failed", "The starter staging folder could not be created."))?;
    let title = attempt.pointer("/definition/title").and_then(Value::as_str).unwrap_or("trocode-activity");
    let folder = starter_folder_name(title);
    let final_path = parent.join(format!("{folder}-{}", &Uuid::new_v4().to_string()[..8]));
    let result = write_starter_files(state, files, &staging).await;
    if let Err(error) = result {
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(error);
    }
    if tokio::fs::rename(&staging, &final_path).await.is_err() {
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(command_error("starter_write_failed", "The starter folder could not be finalized."));
    }
    let workspace = state.inner.workspaces.register(&final_path).await
        .map_err(|_| command_error("workspace_registration_failed", "The starter Workspace could not be registered."))?;
    Ok(json!({
        "selectionId": workspace.id,
        "displayName": workspace.display_name,
        "selectedAt": time_string(),
        "runtime": {
            "available": true,
            "runtimeVersion": env!("CARGO_PKG_VERSION"),
            "summary": "Rust workspace tools are available."
        }
    }))
}

async fn write_starter_files(
    state: &DesktopState,
    files: &[Value],
    staging: &Path,
) -> CommandResult<()> {
    let mut seen = std::collections::HashSet::new();
    for file in files {
        let relative = file.get("relativePath").and_then(Value::as_str)
            .ok_or_else(|| command_error("starter_invalid", "Starter material contains an invalid path."))?;
        let path = safe_relative_path(relative)?;
        if !seen.insert(relative.to_lowercase()) {
            return Err(command_error("starter_conflict", "Starter material contains conflicting paths."));
        }
        let raw_url = file.pointer("/download/url").and_then(Value::as_str)
            .ok_or_else(|| command_error("starter_invalid", "Starter download ticket was invalid."))?;
        validate_external_url(raw_url)?;
        let response = state.inner.hosted.http.get(raw_url).send().await
            .map_err(|_| command_error("starter_download_failed", "A starter file could not be downloaded."))?;
        if !response.status().is_success() {
            return Err(command_error("starter_download_failed", "Object storage rejected a starter download."));
        }
        if response.content_length().unwrap_or(0) > 25 * 1024 * 1024 {
            return Err(command_error("starter_invalid", "A starter file exceeded its byte limit."));
        }
        let bytes = response.bytes().await.map_err(|_| command_error("starter_download_failed", "A starter file could not be read."))?;
        let expected_size = file.get("byteSize").and_then(Value::as_u64).ok_or_else(|| command_error("starter_invalid", "Starter metadata was invalid."))?;
        let expected_hash = file.get("sha256").and_then(Value::as_str).ok_or_else(|| command_error("starter_invalid", "Starter metadata was invalid."))?;
        if bytes.len() != usize::try_from(expected_size).map_err(|_| invalid_hosted_request())?
            || format!("{:x}", Sha256::digest(&bytes)) != expected_hash
        {
            return Err(command_error("starter_integrity_failed", "Starter download did not match the published file."));
        }
        let destination = staging.join(&path);
        if !destination.starts_with(staging) { return Err(command_error("starter_invalid", "Starter material escaped its destination.")); }
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|_| command_error("starter_write_failed", "A starter folder could not be created."))?;
        }
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        let mut output = options.open(&destination).await.map_err(|_| command_error("starter_write_failed", "A starter file could not be created."))?;
        output.write_all(&bytes).await.map_err(|_| command_error("starter_write_failed", "A starter file could not be written."))?;
        output.flush().await.map_err(|_| command_error("starter_write_failed", "A starter file could not be finalized."))?;
    }
    Ok(())
}

fn safe_relative_path(value: &str) -> CommandResult<PathBuf> {
    if value.is_empty() || value.len() > 2_000 || value.contains('\\') { return Err(command_error("starter_invalid", "Starter material contains an invalid path.")); }
    let path = PathBuf::from(value);
    if path.is_absolute() || path.components().any(|part| !matches!(part, std::path::Component::Normal(_))) {
        return Err(command_error("starter_invalid", "Starter material contains an invalid path."));
    }
    Ok(path)
}

fn validate_external_url(value: &str) -> CommandResult<()> {
    let parsed = url::Url::parse(value).map_err(|_| command_error("external_url_invalid", "The object URL was invalid."))?;
    if parsed.scheme() == "https" || (parsed.scheme() == "http" && matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"))) {
        Ok(())
    } else {
        Err(command_error("external_url_invalid", "Object transfers require HTTPS."))
    }
}

fn starter_folder_name(title: &str) -> String {
    let mut output = String::new();
    let mut separator = false;
    for character in title.chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
            separator = false;
        } else if !separator && !output.is_empty() {
            output.push('-');
            separator = true;
        }
        if output.len() >= 64 { break; }
    }
    while output.ends_with('-') { output.pop(); }
    if output.is_empty() { String::from("trocode-activity") } else { output }
}
