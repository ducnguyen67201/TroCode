use super::{ApiResult, Value, invalid, js_string_len, json, trimmed_string};

pub(super) fn normalize_activity_definition(input: &Value) -> ApiResult<Value> {
    let _ = input.as_object().ok_or_else(invalid)?;
    let title = trimmed_string(input, "title", 1, 240)?;
    let objective = trimmed_string(input, "objective", 1, 4_000)?;
    let instructions = trimmed_string(input, "instructions", 1, 24_000)?;
    let launch_target = input
        .get("launchTarget")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "none" | "workspace" | "current_surface"))
        .ok_or_else(invalid)?;

    let empty_guidance = Value::Object(serde_json::Map::new());
    let guidance = input.get("guidancePolicy").unwrap_or(&empty_guidance);
    if !guidance.is_object() {
        return Err(invalid());
    }
    let answer_reveal = match guidance.get("answerReveal") {
        None => "allowed",
        Some(value) => value.as_str().ok_or_else(invalid)?,
    };
    let hint_mode = match guidance.get("hintMode") {
        None => "guided",
        Some(value) => value.as_str().ok_or_else(invalid)?,
    };
    let max_hint_level = match guidance.get("maxHintLevel") {
        None => 3,
        Some(value) => value.as_i64().ok_or_else(invalid)?,
    };
    if !matches!(answer_reveal, "allowed" | "after_attempt" | "never")
        || !matches!(hint_mode, "direct" | "guided" | "socratic")
        || !(0..=5).contains(&max_hint_level)
    {
        return Err(invalid());
    }

    let raw_criteria = match input.get("criteria") {
        None => &[][..],
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
    };
    if raw_criteria.len() > 40 {
        return Err(invalid());
    }
    let mut criteria = Vec::with_capacity(raw_criteria.len());
    for criterion in raw_criteria {
        let id = trimmed_string(criterion, "id", 1, 80)?;
        if !id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'_' | b'-'))
        }) {
            return Err(invalid());
        }
        let criterion_title = trimmed_string(criterion, "title", 1, 240)?;
        let description = match criterion.get("description") {
            None => String::new(),
            Some(value) => value
                .as_str()
                .map(str::trim)
                .filter(|value| js_string_len(value) <= 2_000)
                .map(ToOwned::to_owned)
                .ok_or_else(invalid)?,
        };
        let raw_tags = match criterion.get("tags") {
            None => &[][..],
            Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
        };
        if raw_tags.len() > 20 {
            return Err(invalid());
        }
        let tags = raw_tags
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::trim)
                    .filter(|value| (1..=80).contains(&js_string_len(value)))
                    .map(ToOwned::to_owned)
                    .ok_or_else(invalid)
            })
            .collect::<ApiResult<Vec<_>>>()?;
        criteria.push(json!({
            "id": id,
            "title": criterion_title,
            "description": description,
            "tags": tags,
        }));
    }

    let empty_completion = Value::Object(serde_json::Map::new());
    let completion = input.get("completionPolicy").unwrap_or(&empty_completion);
    if !completion.is_object() {
        return Err(invalid());
    }
    let requires_submission = match completion.get("requiresSubmission") {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };
    let requires_facilitator_confirmation = match completion.get("requiresFacilitatorConfirmation")
    {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };

    let empty_session = Value::Object(serde_json::Map::new());
    let session = input.get("sessionPolicy").unwrap_or(&empty_session);
    if !session.is_object() {
        return Err(invalid());
    }
    let allow_room_join = match session.get("allowRoomJoin") {
        None => false,
        Some(value) => value.as_bool().ok_or_else(invalid)?,
    };
    let raw_origins = match session.get("allowedOrigins") {
        None => &[][..],
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
    };
    if raw_origins.len() > 20 {
        return Err(invalid());
    }
    let allowed_origins = raw_origins
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::trim)
                .filter(|value| js_string_len(value) <= 2_000)
                .and_then(crate::classroom::validated_origin)
                .ok_or_else(invalid)
        })
        .collect::<ApiResult<Vec<_>>>()?;

    Ok(json!({
        "title": title,
        "objective": objective,
        "instructions": instructions,
        "launchTarget": launch_target,
        "guidancePolicy": {
            "answerReveal": answer_reveal,
            "hintMode": hint_mode,
            "maxHintLevel": max_hint_level,
        },
        "criteria": criteria,
        "completionPolicy": {
            "requiresSubmission": requires_submission,
            "requiresFacilitatorConfirmation": requires_facilitator_confirmation,
        },
        "sessionPolicy": {
            "allowRoomJoin": allow_room_join,
            "allowedOrigins": allowed_origins,
        },
    }))
}
