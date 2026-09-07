ALTER TABLE knowledge_class_sessions ADD COLUMN lesson_sequence BIGINT NOT NULL DEFAULT 0 CHECK (lesson_sequence BETWEEN 0 AND 9007199254740991);
CREATE TABLE knowledge_classroom_lessons (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES knowledge_class_sessions(id),
 client_id UUID NOT NULL, sequence BIGINT NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 target_run_id UUID NOT NULL, activity_version_id UUID NOT NULL, plan JSONB NOT NULL, canonical_plan TEXT NOT NULL CHECK(octet_length(canonical_plan)<=65536),
 CHECK(canonical_plan::jsonb=plan),
 plan_digest TEXT NOT NULL CHECK(plan_digest ~ '^[a-f0-9]{64}$'), created_by TEXT NOT NULL REFERENCES users(id),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','stopped')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '30 minutes'), stopped_at TIMESTAMPTZ,
 UNIQUE(session_id,client_id), UNIQUE(session_id,sequence),
 FOREIGN KEY(session_id,target_run_id,activity_version_id) REFERENCES knowledge_class_session_activities(session_id,run_id,activity_version_id)
);
CREATE TABLE knowledge_classroom_lesson_deliveries (
 lesson_id UUID NOT NULL REFERENCES knowledge_classroom_lessons(id), user_id TEXT NOT NULL REFERENCES users(id),
 anchor_attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id), target_attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id),
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','preparing','running','waiting_for_student','paused','blocked','stopped','failed','unknown','expired','finished')),
 revision BIGINT NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
 reason_code TEXT CHECK(reason_code IN ('device_busy','permission_required','unsupported','resource_unavailable','surface_unverified','outcome_unknown','network_unavailable','student_stop','session_ended','access_changed','expired','budget_exhausted','runtime_failed','existing_work','restart','opted_out')),
 step_id UUID, report JSONB, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 execution_id UUID UNIQUE, client_start_id UUID, client_instance_id UUID,
 PRIMARY KEY(lesson_id,user_id), UNIQUE(user_id,client_start_id),
 CHECK ((execution_id IS NULL AND client_start_id IS NULL) OR (execution_id IS NOT NULL AND client_start_id IS NOT NULL AND client_instance_id IS NOT NULL))
);
CREATE TABLE knowledge_classroom_lesson_steps (
 execution_id UUID NOT NULL REFERENCES knowledge_classroom_lesson_deliveries(execution_id), step_id UUID NOT NULL,
 attempt_number BIGINT NOT NULL CHECK(attempt_number BETWEEN 1 AND 20), task_id UUID NOT NULL UNIQUE,
 work_session_id UUID NOT NULL UNIQUE REFERENCES knowledge_activity_work_sessions(id), purpose TEXT NOT NULL CHECK(purpose IN ('work','help','check')),
 status TEXT NOT NULL DEFAULT 'accepted', revision BIGINT NOT NULL DEFAULT 0, reason TEXT,
 PRIMARY KEY(execution_id,step_id,attempt_number)
);
CREATE TABLE knowledge_classroom_lesson_devices (
 session_id UUID NOT NULL REFERENCES knowledge_class_sessions(id), user_id TEXT NOT NULL REFERENCES users(id), client_instance_id UUID NOT NULL,
 capabilities JSONB NOT NULL CHECK(octet_length(capabilities::text)<=4096), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(session_id,user_id,client_instance_id)
);
CREATE INDEX classroom_lesson_delivery_status ON knowledge_classroom_lesson_deliveries(lesson_id,status);
CREATE INDEX classroom_lesson_device_seen ON knowledge_classroom_lesson_devices(session_id,last_seen_at);
