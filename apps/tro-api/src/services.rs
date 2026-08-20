use std::sync::Arc;

use axum::http::StatusCode;
use hmac::{Hmac, Mac};
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, QueryResult, Statement,
    TransactionTrait,
};
use serde::Serialize;
use sha2::Sha256;
use tro_domain::{PlanId, plan_limits};
use uuid::Uuid;

use crate::error::ApiError;

#[derive(Clone)]
pub(crate) struct HostedServices {
    database: DatabaseConnection,
    hmac_key: Arc<[u8]>,
}

impl std::fmt::Debug for HostedServices {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HostedServices")
            .finish_non_exhaustive()
    }
}

impl HostedServices {
    #[must_use]
    pub(crate) fn new(database: DatabaseConnection, hmac_key: String) -> Self {
        Self {
            database,
            hmac_key: Arc::from(hmac_key.into_bytes()),
        }
    }

    pub(crate) fn domain_digest(&self, domain: &[u8], value: &str) -> Result<Vec<u8>, ApiError> {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.hmac_key).map_err(|_| ApiError::internal())?;
        mac.update(domain);
        mac.update(value.as_bytes());
        Ok(mac.finalize().into_bytes().to_vec())
    }

    pub(crate) async fn access_status(&self, user_id: &str) -> Result<AccessStatus, ApiError> {
        let row = self
            .database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"SELECT users.plan,
                          users.blocked_at,
                          codes.max_users,
                          COUNT(usage.user_id)::INTEGER AS used_users
                   FROM users
                   LEFT JOIN access_code_redemptions own_redemption
                     ON own_redemption.user_id = users.id
                   LEFT JOIN access_codes codes
                     ON codes.id = own_redemption.access_code_id
                   LEFT JOIN access_code_redemptions usage
                     ON usage.access_code_id = codes.id
                   WHERE users.id = $1
                   GROUP BY users.id, users.plan, users.blocked_at, codes.id, codes.max_users",
                [user_id.into()],
            ))
            .await?;
        let Some(row) = row else {
            return Ok(AccessStatus::inactive());
        };
        access_status_from_row(&row, false)
    }

    #[allow(clippy::too_many_lines)]
    pub(crate) async fn redeem_access_code(
        &self,
        user_id: &str,
        code: &str,
    ) -> Result<(StatusCode, AccessStatus), ApiError> {
        let digest = self.access_code_digest(code).ok_or_else(|| {
            ApiError::new(StatusCode::BAD_REQUEST, "This access code is not valid.")
        })?;
        let transaction = self.database.begin().await?;
        let locked_user = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id, blocked_at IS NOT NULL AS blocked FROM users WHERE id = $1 FOR UPDATE",
                [user_id.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let blocked: bool = get(&locked_user, "blocked")?;
        if blocked {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "account_blocked",
                "This account has been blocked by an administrator.",
            ));
        }

        if let Some(existing) = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"SELECT codes.code_digest, codes.max_users, codes.plan,
                          NULL::TIMESTAMPTZ AS blocked_at,
                          COUNT(usage.user_id)::INTEGER AS used_users
                   FROM access_code_redemptions own_redemption
                   JOIN access_codes codes ON codes.id = own_redemption.access_code_id
                   JOIN access_code_redemptions usage ON usage.access_code_id = codes.id
                   WHERE own_redemption.user_id = $1
                   GROUP BY codes.id, codes.code_digest, codes.max_users, codes.plan",
                [user_id.into()],
            ))
            .await?
        {
            let existing_digest: Vec<u8> = get(&existing, "code_digest")?;
            if !constant_time_eq(&existing_digest, &digest) {
                transaction.rollback().await?;
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "This account is already linked to a different access code.",
                ));
            }
            let status = access_status_from_row(&existing, false)?;
            transaction.commit().await?;
            return Ok((StatusCode::OK, status));
        }

        let code_row = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id, max_users, paused_at, plan FROM access_codes WHERE code_digest = $1 FOR UPDATE",
                [digest.into()],
            ))
            .await?
            .ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "This access code is not valid.")
            })?;
        let code_id: Uuid = get(&code_row, "id")?;
        let max_users: i32 = get(&code_row, "max_users")?;
        let paused_at: Option<time::OffsetDateTime> = get(&code_row, "paused_at")?;
        let plan: String = get(&code_row, "plan")?;
        if paused_at.is_some() {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "code_paused",
                "This access code is paused.",
            ));
        }
        let used_row = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT COUNT(*)::INTEGER AS used_users FROM access_code_redemptions WHERE access_code_id = $1",
                [code_id.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let used_users: i32 = get(&used_row, "used_users")?;
        if used_users >= max_users {
            transaction.rollback().await?;
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "This access code has reached its user limit.",
            ));
        }
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO access_code_redemptions (user_id, access_code_id) VALUES ($1, $2)",
                [user_id.into(), code_id.into()],
            ))
            .await?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE users SET plan = $2, updated_at = NOW() WHERE id = $1",
                [user_id.into(), plan.clone().into()],
            ))
            .await?;
        transaction.commit().await?;
        Ok((
            StatusCode::CREATED,
            AccessStatus {
                max_users: Some(max_users),
                newly_redeemed: true,
                plan: Some(plan),
                state: "active",
                summary: "Access code accepted.",
                used_users: Some(used_users.saturating_add(1)),
            },
        ))
    }

    pub(crate) async fn consume_rate(
        &self,
        scope: &str,
        key: &str,
        limit: i32,
        window_ms: i64,
    ) -> Result<(), ApiError> {
        if scope.is_empty() || scope.len() > 64 || key.is_empty() || key.len() > 512 {
            return Err(ApiError::internal());
        }
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.hmac_key).map_err(|_| ApiError::internal())?;
        mac.update(b"trocode-rate-limit-v1\0");
        mac.update(scope.as_bytes());
        mac.update(b"\0");
        mac.update(key.as_bytes());
        let digest = mac.finalize().into_bytes().to_vec();
        let row = self
            .database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r"INSERT INTO api_rate_limit_buckets
                     (scope, identity_digest, window_started_at, request_count)
                   VALUES (
                     $1, $2,
                     TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM NOW()) * 1000 / $3) * $3 / 1000),
                     1
                   )
                   ON CONFLICT (scope, identity_digest, window_started_at)
                   DO UPDATE SET request_count = api_rate_limit_buckets.request_count + 1,
                                 updated_at = NOW()
                   RETURNING request_count,
                     GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                       (window_started_at + ($3 * INTERVAL '1 millisecond') - NOW())))::BIGINT)
                     AS retry_after",
                [scope.into(), digest.into(), window_ms.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let count: i32 = get(&row, "request_count")?;
        if count > limit {
            let retry_after: i64 = get(&row, "retry_after")?;
            return Err(ApiError {
                status: StatusCode::TOO_MANY_REQUESTS,
                code: Some("rate_limited"),
                message: "Too many requests. Please try again shortly.",
                retry_after: u64::try_from(retry_after).ok(),
            });
        }
        Ok(())
    }

    pub(crate) async fn create_agent_turn(
        &self,
        user_id: &str,
        plan: &str,
        client_turn_id: Uuid,
        task_id: Uuid,
    ) -> Result<(StatusCode, AgentTurn), ApiError> {
        let transaction = self.database.begin().await?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                [user_id.into()],
            ))
            .await?;
        if let Some(row) = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT id, client_turn_id, task_id, plan, status, would_deny, \
                 created_at::TEXT AS created_at FROM agent_turns \
                 WHERE user_id = $1 AND client_turn_id = $2",
                [user_id.into(), client_turn_id.into()],
            ))
            .await?
        {
            let turn = agent_turn_from_row(&row)?;
            if turn.task_id != task_id {
                transaction.rollback().await?;
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "This agent turn belongs to a different task.",
                ));
            }
            transaction.commit().await?;
            return Ok((StatusCode::OK, turn));
        }
        let plan_id = parse_plan(plan);
        let limits = plan_limits(plan_id);
        let count_row = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT COUNT(*)::BIGINT AS count FROM agent_turns WHERE user_id = $1 \
                 AND created_at >= date_trunc('week', NOW()) AND status <> 'released'",
                [user_id.into()],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let count: i64 = get(&count_row, "count")?;
        if count >= i64::from(limits.weekly_assignments) {
            transaction.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::PAYMENT_REQUIRED,
                "weekly_message_limit_reached",
                "The weekly message limit has been reached.",
            ));
        }
        let row = transaction
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "INSERT INTO agent_turns (client_turn_id, user_id, task_id, plan) \
                 VALUES ($1, $2, $3, $4) RETURNING id, client_turn_id, task_id, \
                 plan, status, would_deny, created_at::TEXT AS created_at",
                [
                    client_turn_id.into(),
                    user_id.into(),
                    task_id.into(),
                    plan.into(),
                ],
            ))
            .await?
            .ok_or_else(ApiError::internal)?;
        let turn = agent_turn_from_row(&row)?;
        transaction.commit().await?;
        Ok((StatusCode::CREATED, turn))
    }

    pub(crate) async fn budget_snapshot(
        &self,
        user_id: &str,
        task_id: Option<Uuid>,
        plan: &str,
    ) -> Result<BudgetSnapshot, ApiError> {
        #[derive(Debug, FromQueryResult)]
        struct Totals {
            day_settled: i64,
            day_reserved: i64,
            month_settled: i64,
            month_reserved: i64,
            task_settled: i64,
            task_reserved: i64,
            week_messages: i64,
            month_ends_at: String,
            month_starts_at: String,
            week_ends_at: String,
            week_starts_at: String,
        }
        let totals = Totals::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r"SELECT
              COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW()) AND status = 'settled'
                THEN actual_micro_usd ELSE 0 END), 0)::BIGINT AS day_settled,
              COALESCE(SUM(CASE WHEN created_at >= date_trunc('day', NOW()) AND status IN ('reserved','uncertain')
                THEN reserved_micro_usd ELSE 0 END), 0)::BIGINT AS day_reserved,
              COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW()) AND status = 'settled'
                THEN actual_micro_usd ELSE 0 END), 0)::BIGINT AS month_settled,
              COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', NOW()) AND status IN ('reserved','uncertain')
                THEN reserved_micro_usd ELSE 0 END), 0)::BIGINT AS month_reserved,
              COALESCE(SUM(CASE WHEN task_id = $2 AND status = 'settled' THEN actual_micro_usd ELSE 0 END), 0)::BIGINT AS task_settled,
              COALESCE(SUM(CASE WHEN task_id = $2 AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END), 0)::BIGINT AS task_reserved,
              (SELECT COUNT(*)::BIGINT FROM agent_turns WHERE user_id = $1
                AND created_at >= date_trunc('week', NOW()) AND status <> 'released') AS week_messages,
              (date_trunc('month', NOW()) + INTERVAL '1 month')::TEXT AS month_ends_at,
              date_trunc('month', NOW())::TEXT AS month_starts_at,
              (date_trunc('week', NOW()) + INTERVAL '1 week')::TEXT AS week_ends_at,
              date_trunc('week', NOW())::TEXT AS week_starts_at
             FROM model_budget_reservations WHERE user_id = $1",
            [user_id.into(), task_id.into()],
        ))
        .one(&self.database)
        .await?
        .ok_or_else(ApiError::internal)?;
        let limits = plan_limits(parse_plan(plan));
        Ok(BudgetSnapshot {
            actual_micro_usd: totals.month_settled,
            daily: BudgetPeriod::new(
                limits.daily_micro_usd,
                totals.day_reserved,
                totals.day_settled,
            ),
            enforcement_mode: "enforce",
            estimated_micro_usd: totals.month_reserved,
            messages: MessagePeriod {
                limit: limits.weekly_assignments,
                period_ends_at: totals.week_ends_at,
                period_starts_at: totals.week_starts_at,
                remaining: i64::from(limits.weekly_assignments)
                    .saturating_sub(totals.week_messages)
                    .max(0),
                used: totals.week_messages,
            },
            month_ends_at: totals.month_ends_at.clone(),
            monthly: BudgetPeriod::new(
                limits.monthly_micro_usd,
                totals.month_reserved,
                totals.month_settled,
            ),
            period_starts_at: totals.month_starts_at,
            plan: plan.to_owned(),
            pricing: Pricing {
                currency: "usd",
                monthly_cents: limits.monthly_price_cents,
            },
            task: BudgetPeriod::new(
                limits.task_micro_usd,
                totals.task_reserved,
                totals.task_settled,
            ),
            source: "hosted",
            warning_threshold_micro_usd: limits.monthly_micro_usd.saturating_mul(80) / 100,
        })
    }

    #[allow(clippy::too_many_lines)]
    pub(crate) async fn reserve_provider_call(
        &self,
        input: ProviderReservation<'_>,
    ) -> Result<(), ApiError> {
        let limits = plan_limits(parse_plan(input.plan));
        let transaction = self.database.begin().await?;
        transaction
            .execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                [input.user_id.into()],
            ))
            .await?;
        transaction.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE model_budget_reservations SET \
               status=CASE WHEN dispatched_at IS NULL THEN 'released' ELSE 'uncertain' END, \
               disposition=CASE WHEN dispatched_at IS NULL THEN 'expired_before_dispatch' ELSE 'ambiguous' END, \
               updated_at=NOW() \
             WHERE user_id=$1 AND status='reserved' \
               AND created_at<NOW()-($2*INTERVAL '1 millisecond')",
            [input.user_id.into(), input.reservation_ttl_ms.into()],
        )).await?;
        if transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT request_id FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2",
            [input.user_id.into(), input.request_id.into()],
        )).await?.is_some() {
            transaction.commit().await?;
            return Err(ApiError::coded(StatusCode::CONFLICT, "duplicate_request", "This model request was already accepted."));
        }
        if input.lane == "responses" {
            let turn_id = input.agent_turn_id.ok_or_else(|| {
                ApiError::coded(
                    StatusCode::FORBIDDEN,
                    "invalid_agent_turn",
                    "The agent turn is missing or invalid.",
                )
            })?;
            let turn = transaction
                .query_one_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "SELECT id,task_id,plan,status,provider_call_count FROM agent_turns \
                 WHERE id=$1 AND user_id=$2 FOR UPDATE",
                    [turn_id.into(), input.user_id.into()],
                ))
                .await?
                .ok_or_else(|| {
                    ApiError::coded(
                        StatusCode::FORBIDDEN,
                        "invalid_agent_turn",
                        "The agent turn is missing or invalid.",
                    )
                })?;
            if get::<Uuid>(&turn, "task_id")? != input.task_id
                || get::<String>(&turn, "plan")? != input.plan
                || get::<String>(&turn, "status")? == "released"
            {
                transaction.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::FORBIDDEN,
                    "invalid_agent_turn",
                    "The agent turn is missing or invalid.",
                ));
            }
            if get::<i32>(&turn, "provider_call_count")?
                >= i32::try_from(limits.provider_calls_per_task).unwrap_or(i32::MAX)
            {
                transaction.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::TOO_MANY_REQUESTS,
                    "agent_turn_call_limit_reached",
                    "This agent turn reached its model-call limit.",
                ));
            }
        }
        let totals = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT \
               COALESCE(SUM(CASE WHEN task_id=$2 AND status='settled' THEN actual_micro_usd WHEN task_id=$2 AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END),0)::BIGINT AS task, \
               COALESCE(SUM(CASE WHEN created_at>=date_trunc('day',NOW()) AND status='settled' THEN actual_micro_usd WHEN created_at>=date_trunc('day',NOW()) AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END),0)::BIGINT AS day, \
               COALESCE(SUM(CASE WHEN created_at>=date_trunc('month',NOW()) AND status='settled' THEN actual_micro_usd WHEN created_at>=date_trunc('month',NOW()) AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END),0)::BIGINT AS month \
             FROM model_budget_reservations WHERE user_id=$1",
            [input.user_id.into(), input.task_id.into()],
        )).await?.ok_or_else(ApiError::internal)?;
        let amount = input.reserved_micro_usd;
        let denial =
            if get::<i64>(&totals, "month")?.saturating_add(amount) > limits.monthly_micro_usd {
                Some((
                    "monthly_budget_exhausted",
                    "The monthly model budget has been reached.",
                ))
            } else if get::<i64>(&totals, "day")?.saturating_add(amount) > limits.daily_micro_usd {
                Some((
                    "daily_budget_exhausted",
                    "The daily model budget has been reached.",
                ))
            } else if get::<i64>(&totals, "task")?.saturating_add(amount) > limits.task_micro_usd {
                Some((
                    "task_budget_exhausted",
                    "This task needs another budget tranche before it can continue.",
                ))
            } else {
                None
            };
        if let Some((code, message)) = denial {
            transaction.rollback().await?;
            return Err(ApiError::coded(StatusCode::PAYMENT_REQUIRED, code, message));
        }
        if let Some(turn_id) = input.agent_turn_id {
            transaction.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE agent_turns SET provider_call_count=provider_call_count+1,updated_at=NOW() WHERE id=$1",
                [turn_id.into()],
            )).await?;
        }
        transaction.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO model_budget_reservations \
               (request_id,user_id,task_id,lane,model,catalog_version,reserved_micro_usd,status,agent_turn_id) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8)",
            [
                input.request_id.into(), input.user_id.into(), input.task_id.into(), input.lane.into(),
                input.model.into(), input.catalog_version.into(), amount.into(), input.agent_turn_id.into(),
            ],
        )).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn mark_dispatched(
        &self,
        user_id: &str,
        request_id: Uuid,
    ) -> Result<(), ApiError> {
        let transaction = self.database.begin().await?;
        let row = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE model_budget_reservations SET dispatched_at=COALESCE(dispatched_at,NOW()),updated_at=NOW() \
             WHERE user_id=$1 AND request_id=$2 AND status='reserved' RETURNING agent_turn_id",
            [user_id.into(), request_id.into()],
        )).await?.ok_or_else(ApiError::internal)?;
        if let Some(turn_id) = get::<Option<Uuid>>(&row, "agent_turn_id")? {
            transaction.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE agent_turns SET status='active',first_dispatched_at=COALESCE(first_dispatched_at,NOW()),updated_at=NOW() WHERE id=$1 AND status<>'released'",
                [turn_id.into()],
            )).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn mark_provider_uncertain(
        &self,
        user_id: &str,
        request_id: Uuid,
    ) -> Result<(), ApiError> {
        let transaction = self.database.begin().await?;
        let row = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE model_budget_reservations SET status='uncertain',disposition='ambiguous',updated_at=NOW() \
             WHERE user_id=$1 AND request_id=$2 AND status='reserved' RETURNING agent_turn_id",
            [user_id.into(), request_id.into()],
        )).await?;
        if let Some(row) = row
            && let Some(turn_id) = get::<Option<Uuid>>(&row, "agent_turn_id")?
        {
            transaction.execute_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "UPDATE agent_turns SET status='uncertain',updated_at=NOW() WHERE id=$1 AND status<>'released'",
                    [turn_id.into()],
                )).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn release_provider_call(
        &self,
        user_id: &str,
        request_id: Uuid,
    ) -> Result<(), ApiError> {
        let transaction = self.database.begin().await?;
        let row = transaction.query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE model_budget_reservations SET status='released',disposition='rejected_before_inference',updated_at=NOW() \
             WHERE user_id=$1 AND request_id=$2 AND status='reserved' RETURNING agent_turn_id",
            [user_id.into(), request_id.into()],
        )).await?;
        if let Some(row) = row
            && let Some(turn_id) = get::<Option<Uuid>>(&row, "agent_turn_id")?
        {
            transaction.execute_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "UPDATE agent_turns SET provider_call_count=GREATEST(provider_call_count-1,0), \
                     status=CASE WHEN NOT EXISTS (SELECT 1 FROM model_budget_reservations \
                       WHERE agent_turn_id=$1 AND status IN ('reserved','settled','uncertain')) THEN 'released' ELSE status END,updated_at=NOW() WHERE id=$1",
                    [turn_id.into()],
                )).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn settle_provider_call(
        &self,
        user_id: &str,
        request_id: Uuid,
        settlement: &UsageSettlement,
    ) -> Result<(), ApiError> {
        let transaction = self.database.begin().await?;
        transaction.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "INSERT INTO model_usage_events \
               (request_id,user_id,task_id,lane,model,catalog_version,input_tokens,cached_input_tokens, \
                output_tokens,reasoning_tokens,character_count,amount_micro_usd,usage_source,disposition,duration_ms,audio_duration_ms,provider_response_id) \
             SELECT request_id,user_id,task_id,lane,model,catalog_version,$3,$4,$5,$6,$7,$8,$9,'completed',$10,$11,$12 \
             FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2 \
             ON CONFLICT (user_id,request_id) DO NOTHING",
            [
                user_id.into(), request_id.into(), settlement.input_tokens.into(), settlement.cached_input_tokens.into(),
                settlement.output_tokens.into(), settlement.reasoning_tokens.into(), settlement.character_count.into(),
                settlement.actual_micro_usd.into(), settlement.source.into(), settlement.duration_ms.into(),
                settlement.audio_duration_ms.into(), settlement.response_id.clone().into(),
            ],
        )).await?;
        transaction.execute_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "UPDATE model_budget_reservations SET status='settled',actual_micro_usd=$3,disposition='completed',settled_at=NOW(),updated_at=NOW() \
             WHERE user_id=$1 AND request_id=$2 AND status='reserved'",
            [user_id.into(), request_id.into(), settlement.actual_micro_usd.into()],
        )).await?;
        transaction.commit().await?;
        Ok(())
    }

    fn access_code_digest(&self, value: &str) -> Option<Vec<u8>> {
        let normalized = value.trim().to_ascii_uppercase();
        let mut chars = normalized.chars();
        let first = chars.next()?;
        if !(4..=64).contains(&normalized.len())
            || !first.is_ascii_alphanumeric()
            || !chars.all(|character| {
                character.is_ascii_alphanumeric() || character == '_' || character == '-'
            })
        {
            return None;
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.hmac_key).ok()?;
        mac.update(b"trocode-access-code-v1\0");
        mac.update(normalized.as_bytes());
        Some(mac.finalize().into_bytes().to_vec())
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ProviderReservation<'a> {
    pub(crate) agent_turn_id: Option<Uuid>,
    pub(crate) catalog_version: &'a str,
    pub(crate) lane: &'a str,
    pub(crate) model: &'a str,
    pub(crate) plan: &'a str,
    pub(crate) request_id: Uuid,
    pub(crate) reservation_ttl_ms: i64,
    pub(crate) reserved_micro_usd: i64,
    pub(crate) task_id: Uuid,
    pub(crate) user_id: &'a str,
}

#[derive(Debug, Clone)]
pub(crate) struct UsageSettlement {
    pub(crate) actual_micro_usd: i64,
    pub(crate) audio_duration_ms: i64,
    pub(crate) cached_input_tokens: i64,
    pub(crate) character_count: i64,
    pub(crate) duration_ms: i64,
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) reasoning_tokens: i64,
    pub(crate) response_id: Option<String>,
    pub(crate) source: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessStatus {
    max_users: Option<i32>,
    #[serde(skip_serializing_if = "is_false")]
    newly_redeemed: bool,
    plan: Option<String>,
    state: &'static str,
    summary: &'static str,
    used_users: Option<i32>,
}

impl AccessStatus {
    const fn inactive() -> Self {
        Self {
            max_users: None,
            newly_redeemed: false,
            plan: None,
            state: "inactive",
            summary: "The signed-in account could not be found.",
            used_users: None,
        }
    }

    pub(crate) fn is_active(&self) -> bool {
        matches!(self.state, "active")
    }
}

#[allow(clippy::trivially_copy_pass_by_ref)]
const fn is_false(value: &bool) -> bool {
    !*value
}

fn access_status_from_row(
    row: &QueryResult,
    newly_redeemed: bool,
) -> Result<AccessStatus, ApiError> {
    let plan: String = get(row, "plan")?;
    let blocked_at: Option<time::OffsetDateTime> = get(row, "blocked_at")?;
    let max_users: Option<i32> = get(row, "max_users")?;
    let used_users: Option<i32> = get(row, "used_users")?;
    Ok(AccessStatus {
        max_users,
        newly_redeemed,
        plan: Some(plan),
        state: if blocked_at.is_some() {
            "inactive"
        } else {
            "active"
        },
        summary: if blocked_at.is_some() {
            "This account has been blocked by an administrator."
        } else if max_users.is_some() {
            "Access code accepted."
        } else {
            "Free plan active."
        },
        used_users,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentTurn {
    pub(crate) client_turn_id: Uuid,
    pub(crate) created_at: String,
    pub(crate) id: Uuid,
    pub(crate) plan: String,
    pub(crate) status: String,
    pub(crate) task_id: Uuid,
    pub(crate) would_deny: bool,
}

fn agent_turn_from_row(row: &QueryResult) -> Result<AgentTurn, ApiError> {
    Ok(AgentTurn {
        client_turn_id: get(row, "client_turn_id")?,
        created_at: get(row, "created_at")?,
        id: get(row, "id")?,
        plan: get(row, "plan")?,
        status: get(row, "status")?,
        task_id: get(row, "task_id")?,
        would_deny: get(row, "would_deny")?,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetSnapshot {
    actual_micro_usd: i64,
    daily: BudgetPeriod,
    enforcement_mode: &'static str,
    estimated_micro_usd: i64,
    messages: MessagePeriod,
    month_ends_at: String,
    monthly: BudgetPeriod,
    period_starts_at: String,
    plan: String,
    pricing: Pricing,
    task: BudgetPeriod,
    source: &'static str,
    warning_threshold_micro_usd: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_field_names)]
struct BudgetPeriod {
    limit_micro_usd: i64,
    remaining_micro_usd: i64,
    reserved_micro_usd: i64,
    settled_micro_usd: i64,
}

impl BudgetPeriod {
    fn new(limit: i64, reserved: i64, settled: i64) -> Self {
        Self {
            limit_micro_usd: limit,
            remaining_micro_usd: limit
                .saturating_sub(reserved.saturating_add(settled))
                .max(0),
            reserved_micro_usd: reserved,
            settled_micro_usd: settled,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessagePeriod {
    limit: u32,
    period_ends_at: String,
    period_starts_at: String,
    remaining: i64,
    used: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pricing {
    currency: &'static str,
    monthly_cents: u32,
}

fn parse_plan(plan: &str) -> PlanId {
    match plan {
        "basic" => PlanId::Basic,
        "pro" => PlanId::Pro,
        "max" => PlanId::Max,
        _ => PlanId::Free,
    }
}

fn get<T: sea_orm::TryGetable>(row: &QueryResult, column: &str) -> Result<T, ApiError> {
    row.try_get("", column).map_err(|_| ApiError::internal())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}
