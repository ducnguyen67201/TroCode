use std::time::Duration;

use serde_json::json;
use trocode_api::{
    PgPool, auth::AccessCodeRepository, db, knowledge::KnowledgeService, postgres::PgPoolOptions,
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;

struct Fixture {
    pool: PgPool,
    teacher: String,
    students: Vec<String>,
    code: Uuid,
    space: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let value = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL required");
        let url = Url::parse(&value).unwrap();
        assert!(
            matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
                && url.path().ends_with("_test")
        );
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&value)
            .await
            .unwrap();
        db::migrate(&pool).await.unwrap();
        let nonce = Uuid::new_v4();
        let teacher = format!("class-access-teacher-{nonce}");
        let students = (0..3)
            .map(|n| format!("class-access-student-{n}-{nonce}"))
            .collect::<Vec<_>>();
        for user in std::iter::once(&teacher).chain(students.iter()) {
            query("INSERT INTO users(id,email,name,classroom_role)VALUES($1,$2,'Class access test',$3)")
                .bind(user).bind(format!("{user}@example.test"))
                .bind(if user == &teacher { "teacher" } else { "student" })
                .execute(&pool).await.unwrap();
        }
        let code = query_scalar(
            "INSERT INTO access_codes(code_digest,max_users,plan)VALUES($1,10,'pro')RETURNING id",
        )
        .bind([nonce.as_bytes().as_slice(), nonce.as_bytes().as_slice()].concat())
        .fetch_one(&pool)
        .await
        .unwrap();
        query("INSERT INTO access_code_redemptions(user_id,access_code_id)VALUES($1,$2)")
            .bind(&teacher)
            .bind(code)
            .execute(&pool)
            .await
            .unwrap();
        let space = query_scalar("INSERT INTO knowledge_spaces(client_id,owner_user_id,name)VALUES($1,$2,'Access regression')RETURNING id")
            .bind(nonce).bind(&teacher).fetch_one(&pool).await.unwrap();
        query("INSERT INTO knowledge_space_members(space_id,user_id,role)VALUES($1,$2,'owner')")
            .bind(space)
            .bind(&teacher)
            .execute(&pool)
            .await
            .unwrap();
        Self {
            pool,
            teacher,
            students,
            code,
            space,
        }
    }

    fn access(&self) -> AccessCodeRepository {
        AccessCodeRepository::new(self.pool.clone(), "classroom-access-test-key")
    }

    async fn roster(&self, index: usize) {
        query(
            "INSERT INTO knowledge_space_members(space_id,user_id,role)VALUES($1,$2,'participant')",
        )
        .bind(self.space)
        .bind(&self.students[index])
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn clean(self) {
        query("DELETE FROM knowledge_spaces WHERE id=$1")
            .bind(self.space)
            .execute(&self.pool)
            .await
            .unwrap();
        query("DELETE FROM access_code_redemptions WHERE access_code_id=$1")
            .bind(self.code)
            .execute(&self.pool)
            .await
            .unwrap();
        query("DELETE FROM access_codes WHERE id=$1")
            .bind(self.code)
            .execute(&self.pool)
            .await
            .unwrap();
        let mut users = self.students;
        users.push(self.teacher);
        query("DELETE FROM users WHERE id=ANY($1::text[])")
            .bind(users)
            .execute(&self.pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
#[ignore = "requires disposable local PostgreSQL TEST_DATABASE_URL"]
async fn existing_and_new_rosters_receive_access_without_a_code() {
    let f = Fixture::new().await;
    let access = f.access();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "inactive"
    );
    f.roster(0).await; // An existing roster created before this change.
    let status = access.get_status(&f.students[0]).await.unwrap();
    assert_eq!(status.state, "active");
    assert_eq!(status.plan.as_deref(), Some("pro"));
    assert_eq!(status.used_users, Some(2));
    let (first, second) = tokio::join!(
        access.get_status(&f.students[0]),
        access.get_status(&f.students[0])
    );
    assert_eq!(first.unwrap().used_users, Some(2));
    assert_eq!(second.unwrap().used_users, Some(2));
    // Pausing new claims must not revoke an existing redemption.
    query("UPDATE access_codes SET paused_at=NOW() WHERE id=$1")
        .bind(f.code)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "active"
    );
    query("UPDATE access_codes SET paused_at=NULL WHERE id=$1")
        .bind(f.code)
        .execute(&f.pool)
        .await
        .unwrap();
    let knowledge = KnowledgeService::new(f.pool.clone(), None, "classroom-access-test-key");
    knowledge.add_members(&f.teacher, f.space, &json!({
        "clientId": Uuid::new_v4(), "emails": [format!("{}@example.test", f.students[1])], "role": "participant",
    })).await.unwrap();
    assert_eq!(
        access
            .get_status(&f.students[1])
            .await
            .unwrap()
            .plan
            .as_deref(),
        Some("pro")
    );
    f.clean().await;
}

#[tokio::test]
#[ignore = "requires disposable local PostgreSQL TEST_DATABASE_URL"]
async fn conflicting_classes_and_organization_seats_do_not_replace_access() {
    let f = Fixture::new().await;
    let other = Fixture::new().await;
    let access = f.access();
    f.roster(0).await;
    query("INSERT INTO knowledge_space_members(space_id,user_id,role)VALUES($1,$2,'participant')")
        .bind(other.space)
        .bind(&f.students[0])
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap_err().code,
        Some("classroom_access_ambiguous")
    );
    query("DELETE FROM knowledge_space_members WHERE space_id=$1 AND user_id=$2")
        .bind(other.space)
        .bind(&f.students[0])
        .execute(&f.pool)
        .await
        .unwrap();
    query("UPDATE access_codes SET distribution_mode='organization' WHERE id=$1")
        .bind(other.code)
        .execute(&f.pool)
        .await
        .unwrap();
    let organization: Uuid = query_scalar("INSERT INTO organizations(access_code_id,name)VALUES($1,'Reserved organization')RETURNING id")
        .bind(other.code).fetch_one(&f.pool).await.unwrap();
    query("INSERT INTO organization_memberships(organization_id,email,email_normalized,role)VALUES($1,$2,$2,'member')")
        .bind(organization).bind(format!("{}@example.test", f.students[0])).execute(&f.pool).await.unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "inactive"
    );
    query("DELETE FROM organization_memberships WHERE organization_id=$1")
        .bind(organization)
        .execute(&f.pool)
        .await
        .unwrap();
    query("DELETE FROM organizations WHERE id=$1")
        .bind(organization)
        .execute(&f.pool)
        .await
        .unwrap();
    query("UPDATE access_codes SET distribution_mode='shared' WHERE id=$1")
        .bind(other.code)
        .execute(&f.pool)
        .await
        .unwrap();
    query("INSERT INTO access_code_redemptions(user_id,access_code_id)VALUES($1,$2)")
        .bind(&f.students[0])
        .bind(other.code)
        .execute(&f.pool)
        .await
        .unwrap();
    query("UPDATE users SET plan='pro' WHERE id=$1")
        .bind(&f.students[0])
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "active"
    );
    let retained: Uuid =
        query_scalar("SELECT access_code_id FROM access_code_redemptions WHERE user_id=$1")
            .bind(&f.students[0])
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(retained, other.code);
    other.clean().await;
    f.clean().await;
}

#[tokio::test]
#[ignore = "requires disposable local PostgreSQL TEST_DATABASE_URL"]
async fn classroom_access_checks_eligibility_pause_and_concurrent_capacity() {
    let f = Fixture::new().await;
    let access = f.access();
    f.roster(0).await;
    f.roster(1).await;
    query("UPDATE knowledge_space_members SET removed_at=NOW() WHERE space_id=$1 AND user_id=$2")
        .bind(f.space)
        .bind(&f.students[0])
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "inactive"
    );
    query("UPDATE knowledge_space_members SET removed_at=NULL WHERE space_id=$1")
        .bind(f.space)
        .execute(&f.pool)
        .await
        .unwrap();
    query("UPDATE knowledge_spaces SET archived_at=NOW() WHERE id=$1")
        .bind(f.space)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "inactive"
    );
    query("UPDATE knowledge_spaces SET archived_at=NULL WHERE id=$1")
        .bind(f.space)
        .execute(&f.pool)
        .await
        .unwrap();
    query("UPDATE users SET blocked_at=NOW() WHERE id=$1")
        .bind(&f.students[0])
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "inactive"
    );
    query("UPDATE users SET blocked_at=NULL WHERE id=$1")
        .bind(&f.students[0])
        .execute(&f.pool)
        .await
        .unwrap();
    query("UPDATE access_codes SET distribution_mode='organization' WHERE id=$1")
        .bind(f.code)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap().state,
        "inactive"
    );
    query("UPDATE access_codes SET distribution_mode='shared',paused_at=NOW() WHERE id=$1")
        .bind(f.code)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        access.get_status(&f.students[0]).await.unwrap_err().code,
        Some("classroom_access_paused")
    );
    query("UPDATE access_codes SET paused_at=NULL,max_users=2 WHERE id=$1")
        .bind(f.code)
        .execute(&f.pool)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        access.get_status(&f.students[0]),
        access.get_status(&f.students[1])
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let error = a.err().or_else(|| b.err()).unwrap();
    assert_eq!(error.code, Some("classroom_access_full"));
    // An unavailable sponsored seat must not prevent choosing the Free plan.
    for student in &f.students[..2] {
        assert_eq!(access.continue_free(student).await.unwrap().state, "active");
    }
    let used: i64 =
        query_scalar("SELECT COUNT(*) FROM access_code_redemptions WHERE access_code_id=$1")
            .bind(f.code)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(used, 2);
    f.clean().await;
}
