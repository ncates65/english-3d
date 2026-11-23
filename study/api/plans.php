<?php
declare(strict_types=1);

/**
 * Practice Buddy ("PB") — Study Plans, Scheduled Sessions & Recall Attempts CRUD API
 * Endpoint: https://english-3d.com/study/api/plans.php
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/spacing_helpers.php';
sendJsonHeaders();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

// =============================================================================
// GET — Fetch All Plans for Current User, Single Plan, or Single Session
// =============================================================================
if ($method === 'GET') {
    $pdo = getDbConnection();
    $currentUser = resolveEffectiveUserRow($pdo, []);
    $currentUserId = (int) $currentUser['id'];

    if (isset($_GET['session_id']) && is_numeric($_GET['session_id'])) {
        $sessionId = (int) $_GET['session_id'];
        $stmt = $pdo->prepare('SELECT plan_id FROM study_sessions WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $sessionId]);
        $row = $stmt->fetch();
        if (!$row) {
            respondJson(['ok' => false, 'error' => 'Session not found.'], 404);
        }
        $plans = loadStudyPlans($pdo, (int) $row['plan_id']);
        respondJson([
            'ok' => true,
            'plan' => $plans[0] ?? null,
            'targetSessionId' => $sessionId,
            'user' => formatUserRow($currentUser),
        ]);
    }

    if (isset($_GET['plan_id']) && is_numeric($_GET['plan_id'])) {
        $plans = loadStudyPlans($pdo, (int) $_GET['plan_id']);
        if (empty($plans)) {
            respondJson(['ok' => false, 'error' => 'Study plan not found.'], 404);
        }
        respondJson([
            'ok' => true,
            'plan' => $plans[0],
            'user' => formatUserRow($currentUser),
        ]);
    }

    $plans = loadStudyPlans($pdo, null, $currentUserId);
    respondJson([
        'ok' => true,
        'plans' => $plans,
        'user' => formatUserRow($currentUser),
        'config' => [
            'googleOAuthClientId' => GOOGLE_OAUTH_CLIENT_ID,
            'appBaseUrl' => APP_BASE_URL,
            'geminiModel' => GEMINI_MODEL,
        ],
    ]);
}

// =============================================================================
// POST — Create Plan, Reschedule Session, Adaptive Booster, Save Recall, Delete
// =============================================================================
if ($method === 'POST') {
    $pdo = getDbConnection();
    $body = getJsonBody();
    $action = $action !== '' ? $action : (string) ($body['action'] ?? 'create_plan');
    $currentUser = resolveEffectiveUserRow($pdo, $body);
    $currentUserId = (int) $currentUser['id'];

    // -------------------------------------------------------------------------
    // Action 1: create_plan — Save a newly generated Study Plan & its Sessions
    // -------------------------------------------------------------------------
    if ($action === 'create_plan') {
        $userEmail = trim((string) ($currentUser['email'] ?: ($body['userEmail'] ?? 'learner@english-3d.com')));
        $topicTitle = trim((string) ($body['topicTitle'] ?? ''));
        $executiveSummary = trim((string) ($body['executiveSummary'] ?? ''));
        $coreConcepts = is_array($body['coreConcepts'] ?? null) ? $body['coreConcepts'] : [];
        $sourceLinks = is_array($body['sourceLinks'] ?? null) ? $body['sourceLinks'] : [];
        $extractedContextCache = (string) ($body['extractedContextCache'] ?? '');
        $startDate = (string) ($body['startDate'] ?? date('Y-m-d'));
        $masterByDate = (string) ($body['masterByDate'] ?? date('Y-m-d', strtotime('+14 days')));
        $sessions = is_array($body['sessions'] ?? null) ? $body['sessions'] : [];

        if ($topicTitle === '' || empty($sessions)) {
            respondJson([
                'ok' => false,
                'error' => 'topicTitle and at least one scheduled session are required.',
            ], 400);
        }

        $studyMode = ((string) ($body['studyMode'] ?? 'deepening')) === 'spiral_chunking' ? 'spiral_chunking' : 'deepening';
        $targetChunkCount = max(1, min(10, (int) ($body['targetChunkCount'] ?? 1)));
        $studyWindowMinutes = max(10, min(240, (int) ($body['studyWindowMinutes'] ?? 30)));
        $blueprintPayload = is_array($body['blueprint'] ?? null) ? $body['blueprint'] : null;

        try {
            $pdo->beginTransaction();

            $planStmt = $pdo->prepare(
                'INSERT INTO study_plans
                (user_id, user_email, topic_title, study_mode, target_chunk_count, study_window_minutes, executive_summary, core_concepts_json, blueprint_json, source_links_json, extracted_context_cache, start_date, master_by_date)
                VALUES (:user_id, :user_email, :topic_title, :study_mode, :target_chunk_count, :study_window_minutes, :executive_summary, :core_concepts_json, :blueprint_json, :source_links_json, :extracted_context_cache, :start_date, :master_by_date)'
            );
            $planStmt->execute([
                ':user_id' => $currentUserId,
                ':user_email' => mb_substr($userEmail, 0, 255),
                ':topic_title' => mb_substr($topicTitle, 0, 255),
                ':study_mode' => $studyMode,
                ':target_chunk_count' => $targetChunkCount,
                ':study_window_minutes' => $studyWindowMinutes,
                ':executive_summary' => $executiveSummary,
                ':core_concepts_json' => json_encode($coreConcepts, JSON_UNESCAPED_UNICODE),
                ':blueprint_json' => $blueprintPayload !== null ? json_encode($blueprintPayload, JSON_UNESCAPED_UNICODE) : null,
                ':source_links_json' => json_encode($sourceLinks, JSON_UNESCAPED_UNICODE),
                ':extracted_context_cache' => $extractedContextCache,
                ':start_date' => $startDate,
                ':master_by_date' => $masterByDate,
            ]);

            $planId = (int) $pdo->lastInsertId();

            $sessionStmt = $pdo->prepare(
                'INSERT INTO study_sessions
                (plan_id, user_id, session_number, stage_number, stage_name, stage_key, scheduled_date, original_scheduled_date, day_offset, gap_days, cognitive_goal, chunk_scope_json, continuity_hook, prompts_json, verification_checklist_json, status, recalibration_count, mastery_score, completed_at)
                VALUES (:plan_id, :user_id, :session_number, :stage_number, :stage_name, :stage_key, :scheduled_date, :original_scheduled_date, :day_offset, :gap_days, :cognitive_goal, :chunk_scope_json, :continuity_hook, :prompts_json, :verification_checklist_json, :status, :recalibration_count, :mastery_score, :completed_at)'
            );

            $attemptStmt = $pdo->prepare(
                'INSERT INTO recall_attempts
                (session_id, user_response_text, ai_score, strengths_json, missing_concepts_json, corrective_feedback, cognitive_stage_check, follow_up_question)
                VALUES (:session_id, :user_response_text, :ai_score, :strengths_json, :missing_concepts_json, :corrective_feedback, :cognitive_stage_check, :follow_up_question)'
            );

            foreach ($sessions as $idx => $session) {
                $rawStatus = (string) ($session['status'] ?? 'pending');
                $status = in_array($rawStatus, ['completed', 'merged'], true) ? $rawStatus : 'pending';
                $masteryScore = isset($session['masteryScore']) && $session['masteryScore'] !== null
                    ? max(0, min(100, (int) $session['masteryScore']))
                    : null;
                $rawCompletedAt = trim((string) ($session['completedAt'] ?? ''));
                $completedTs = $rawCompletedAt !== '' ? strtotime($rawCompletedAt) : false;
                $completedAt = $status === 'completed'
                    ? ($completedTs !== false ? date('Y-m-d H:i:s', $completedTs) : date('Y-m-d H:i:s'))
                    : null;

                $sessNum = (int) ($session['sessionNumber'] ?? ($idx + 1));
                $stageName = pbNormalizeStageLabel((string) ($session['stageName'] ?? 'Stage 1: Schema Mapping'));
                $stageKey = trim((string) ($session['stageKey'] ?? ''));
                $stageNum = isset($session['stageNumber'])
                    ? max(1, min(5, (int) $session['stageNumber']))
                    : pbInferStageNumber($stageName, $sessNum, $stageKey);
                if ($stageKey === '') {
                    $stageKey = match ($stageNum) {
                        1 => 'schema_mapping',
                        2 => 'closed_book_free_recall',
                        3 => 'elaborative_interrogation',
                        4 => 'application_edge_cases',
                        default => 'mastery_verification',
                    };
                }

                $schedDate = (string) ($session['scheduledDate'] ?? $startDate);
                $origSchedDate = !empty($session['originalScheduledDate']) ? (string) $session['originalScheduledDate'] : $schedDate;

                $promptsPayload = is_array($session['promptItems'] ?? null) && !empty($session['promptItems'])
                    ? $session['promptItems']
                    : (is_array($session['prompts'] ?? null) ? $session['prompts'] : []);

                $sessionStmt->execute([
                    ':plan_id' => $planId,
                    ':user_id' => $currentUserId,
                    ':session_number' => $sessNum,
                    ':stage_number' => $stageNum,
                    ':stage_name' => mb_substr($stageName, 0, 160),
                    ':stage_key' => mb_substr($stageKey, 0, 64),
                    ':scheduled_date' => $schedDate,
                    ':original_scheduled_date' => $origSchedDate,
                    ':day_offset' => (int) ($session['dayOffset'] ?? 0),
                    ':gap_days' => (int) ($session['gapDays'] ?? 0),
                    ':cognitive_goal' => (string) ($session['cognitiveGoal'] ?? ''),
                    ':chunk_scope_json' => is_array($session['chunkScope'] ?? null) ? json_encode($session['chunkScope'], JSON_UNESCAPED_UNICODE) : null,
                    ':continuity_hook' => isset($session['continuityHook']) ? (string) $session['continuityHook'] : '',
                    ':prompts_json' => json_encode($promptsPayload, JSON_UNESCAPED_UNICODE),
                    ':verification_checklist_json' => json_encode($session['verificationChecklist'] ?? [], JSON_UNESCAPED_UNICODE),
                    ':status' => $status,
                    ':recalibration_count' => (int) ($session['recalibrationCount'] ?? 0),
                    ':mastery_score' => $masteryScore,
                    ':completed_at' => $completedAt,
                ]);

                $newSessionId = (int) $pdo->lastInsertId();
                $attempts = is_array($session['attempts'] ?? null) ? $session['attempts'] : [];
                foreach ($attempts as $att) {
                    $attText = trim((string) ($att['userResponseText'] ?? ''));
                    if ($attText === '') {
                        continue;
                    }
                    $attemptStmt->execute([
                        ':session_id' => $newSessionId,
                        ':user_response_text' => $attText,
                        ':ai_score' => max(0, min(100, (int) ($att['aiScore'] ?? $masteryScore ?? 0))),
                        ':strengths_json' => json_encode($att['strengths'] ?? [], JSON_UNESCAPED_UNICODE),
                        ':missing_concepts_json' => json_encode($att['missingConcepts'] ?? [], JSON_UNESCAPED_UNICODE),
                        ':corrective_feedback' => (string) ($att['correctiveFeedback'] ?? ''),
                        ':cognitive_stage_check' => (string) ($att['cognitiveStageCheck'] ?? ''),
                        ':follow_up_question' => (string) ($att['followUpQuestion'] ?? ''),
                    ]);
                }
            }

            $pdo->commit();
            $createdPlans = loadStudyPlans($pdo, $planId);
            respondJson([
                'ok' => true,
                'plan' => $createdPlans[0] ?? null,
            ], 201);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            respondJson([
                'ok' => false,
                'error' => 'Failed to persist study plan.',
                'details' => $e->getMessage(),
            ], 500);
        }
    }

    // -------------------------------------------------------------------------
    // Action 2: reschedule_session / recalibrate_plan — Three-Tier Recalibration
    // -------------------------------------------------------------------------
    if ($action === 'reschedule_session' || $action === 'recalibrate_plan') {
        $planId = (int) ($body['planId'] ?? 0);
        $sessionId = (int) ($body['sessionId'] ?? 0);
        $anchorDate = trim((string) ($body['anchorDate'] ?? $body['newScheduledDate'] ?? date('Y-m-d')));
        $resolutionMode = trim((string) ($body['resolutionMode'] ?? $body['mode'] ?? 'auto'));

        if (!in_array($resolutionMode, ['auto', 'extend_7_days', 'final_sprint_today', 'tier1_only'], true)) {
            $resolutionMode = 'auto';
        }

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $anchorDate)) {
            respondJson(['ok' => false, 'error' => 'Valid YYYY-MM-DD anchorDate / newScheduledDate is required.'], 400);
        }

        if ($planId <= 0 && $sessionId > 0) {
            $lookupStmt = $pdo->prepare('SELECT plan_id FROM study_sessions WHERE id = :id LIMIT 1');
            $lookupStmt->execute([':id' => $sessionId]);
            $row = $lookupStmt->fetch();
            if ($row) {
                $planId = (int) $row['plan_id'];
            }
        }

        if ($planId <= 0) {
            respondJson(['ok' => false, 'error' => 'Valid planId or sessionId is required.'], 404);
        }

        $recal = recalibratePlanSchedule($pdo, $planId, $anchorDate, $resolutionMode);
        if (empty($recal['ok'])) {
            respondJson($recal, 500);
        }
        respondJson($recal);
    }

    // -------------------------------------------------------------------------
    // Action 3: add_booster_session — Adaptive Spacing Hook (+2 Days) when score < 70
    // -------------------------------------------------------------------------
    if ($action === 'add_booster_session') {
        $sessionId = (int) ($body['sessionId'] ?? 0);
        $missingConcepts = is_array($body['missingConcepts'] ?? null) ? $body['missingConcepts'] : [];
        $followUpQuestion = trim((string) ($body['followUpQuestion'] ?? ''));

        $stmt = $pdo->prepare(
            'SELECT s.*, p.start_date
             FROM study_sessions s
             INNER JOIN study_plans p ON p.id = s.plan_id
             WHERE s.id = :id LIMIT 1'
        );
        $stmt->execute([':id' => $sessionId]);
        $sourceSession = $stmt->fetch();

        if (!$sourceSession) {
            respondJson(['ok' => false, 'error' => 'Original session not found.'], 404);
        }

        $planId = (int) $sourceSession['plan_id'];
        $sessionOwnerId = (int) ($sourceSession['user_id'] ?? $currentUserId);
        $baseDate = (string) $sourceSession['scheduled_date'];
        $today = date('Y-m-d');
        $anchorDate = $baseDate > $today ? $baseDate : $today;
        $boosterDate = pbAddCalendarDays($anchorDate, 2);

        $startDate = (string) $sourceSession['start_date'];
        $dayOffset = max(1, pbDiffCalendarDays($startDate, $boosterDate));

        // Build targeted remedial prompts from missed concepts + Socratic follow-up
        $remedialItems = [];
        if ($followUpQuestion !== '') {
            $remedialItems[] = [
                'prompt_text' => "Socratic Remediation: {$followUpQuestion}",
                'chunk_tag' => 'Review: Remediation',
                'expected_rubric_points' => array_slice(array_map('strval', $missingConcepts), 0, 3),
            ];
        }
        foreach (array_slice($missingConcepts, 0, 3) as $concept) {
            $remedialItems[] = [
                'prompt_text' => "Closed-Book Corrective Retrieval: Explain the mechanism, boundaries, and significance of \"{$concept}\" without consulting notes.",
                'chunk_tag' => 'Review: Remediation',
                'expected_rubric_points' => ["Accurately reconstructs {$concept} from memory", 'Links mechanism to core topic'],
            ];
        }
        if (empty($remedialItems)) {
            $origUnpacked = unpackPromptsPayload(json_decode((string) $sourceSession['prompts_json'], true));
            $remedialItems = array_slice($origUnpacked['promptItems'], 0, 3);
        }

        $checklist = !empty($missingConcepts)
            ? array_map(static fn($c) => "Accurately retrieved and articulated: {$c}", $missingConcepts)
            : (json_decode((string) $sourceSession['verification_checklist_json'], true) ?: []);

        $countStmt = $pdo->prepare('SELECT COALESCE(MAX(session_number), 0) + 1 AS next_num FROM study_sessions WHERE plan_id = :pid');
        $countStmt->execute([':pid' => $planId]);
        $nextNum = (int) ($countStmt->fetch()['next_num'] ?? 1);
        $stageNum = isset($sourceSession['stage_number']) ? max(1, min(5, (int) $sourceSession['stage_number'])) : 4;

        $insertStmt = $pdo->prepare(
            'INSERT INTO study_sessions
            (plan_id, user_id, session_number, stage_number, stage_name, stage_key, scheduled_date, original_scheduled_date, day_offset, gap_days, cognitive_goal, prompts_json, verification_checklist_json, status, recalibration_count)
            VALUES (:plan_id, :user_id, :session_number, :stage_number, :stage_name, :stage_key, :scheduled_date, :original_scheduled_date, :day_offset, :gap_days, :cognitive_goal, :prompts_json, :verification_checklist_json, :status, 0)'
        );
        $insertStmt->execute([
            ':plan_id' => $planId,
            ':user_id' => $sessionOwnerId,
            ':session_number' => $nextNum,
            ':stage_number' => $stageNum,
            ':stage_name' => 'Adaptive Booster — Targeted Error Remediation (+2d)',
            ':stage_key' => 'adaptive_booster',
            ':scheduled_date' => $boosterDate,
            ':original_scheduled_date' => $boosterDate,
            ':day_offset' => $dayOffset,
            ':gap_days' => 2,
            ':cognitive_goal' => 'Consolidate fragile memory traces and eliminate retrieval gaps identified in Session #' . $sourceSession['session_number'] . '.',
            ':prompts_json' => json_encode($remedialItems, JSON_UNESCAPED_UNICODE),
            ':verification_checklist_json' => json_encode($checklist, JSON_UNESCAPED_UNICODE),
            ':status' => 'pending',
        ]);

        $boosterId = (int) $pdo->lastInsertId();
        $updatedPlans = loadStudyPlans($pdo, $planId);

        respondJson([
            'ok' => true,
            'boosterSessionId' => $boosterId,
            'scheduledDate' => $boosterDate,
            'plan' => $updatedPlans[0] ?? null,
        ], 201);
    }

    // -------------------------------------------------------------------------
    // Action 4: update_calendar_sync — Store Google Calendar / Tasks Event IDs
    // -------------------------------------------------------------------------
    if ($action === 'update_calendar_sync') {
        $mappings = is_array($body['mappings'] ?? null) ? $body['mappings'] : [];
        $stmt = $pdo->prepare('UPDATE study_sessions SET calendar_event_id = :event_id WHERE id = :id');
        foreach ($mappings as $item) {
            if (!empty($item['sessionId']) && !empty($item['calendarEventId'])) {
                $stmt->execute([
                    ':event_id' => (string) $item['calendarEventId'],
                    ':id' => (int) $item['sessionId'],
                ]);
            }
        }
        respondJson(['ok' => true, 'updatedCount' => count($mappings)]);
    }

    // -------------------------------------------------------------------------
    // Action 5: save_recall_attempt — Persist graded recall attempt & mark completed
    // -------------------------------------------------------------------------
    if ($action === 'save_recall_attempt') {
        $sessionId = (int) ($body['sessionId'] ?? 0);
        $userResponseText = trim((string) ($body['userResponseText'] ?? ''));

        if ($sessionId <= 0 || $userResponseText === '') {
            respondJson([
                'ok' => false,
                'error' => 'sessionId and userResponseText are required to save a recall attempt.',
            ], 400);
        }

        $score = max(0, min(100, (int) ($body['masteryScore'] ?? $body['aiScore'] ?? 0)));
        $accuratePoints = is_array($body['whatYouNailed'] ?? null)
            ? $body['whatYouNailed']
            : (is_array($body['accuratePoints'] ?? null)
                ? $body['accuratePoints']
                : (is_array($body['strengths'] ?? null) ? $body['strengths'] : []));
        $missedConcepts = is_array($body['missingToReview'] ?? null)
            ? $body['missingToReview']
            : (is_array($body['missedOrInaccurateConcepts'] ?? null)
                ? $body['missedOrInaccurateConcepts']
                : (is_array($body['missingConcepts'] ?? null) ? $body['missingConcepts'] : []));
        $coachFeedback = (string) ($body['coachFeedback'] ?? $body['correctiveFeedback'] ?? '');
        $cognitiveStageCheck = (string) ($body['cognitiveStageCheck'] ?? '');
        $socraticQuestion = (string) ($body['socraticFollowUpQuestion'] ?? $body['followUpQuestion'] ?? '');

        $rawCompletedAt = trim((string) ($body['completedAt'] ?? ''));
        $completedTs = $rawCompletedAt !== '' ? strtotime($rawCompletedAt) : false;
        $completedAt = $completedTs !== false ? date('Y-m-d H:i:s', $completedTs) : date('Y-m-d H:i:s');

        $lookupStmt = $pdo->prepare('SELECT plan_id, scheduled_date FROM study_sessions WHERE id = :id LIMIT 1');
        $lookupStmt->execute([':id' => $sessionId]);
        $sessRow = $lookupStmt->fetch();
        if (!$sessRow) {
            respondJson(['ok' => false, 'error' => 'Target study session not found in MySQL.'], 404);
        }
        $planId = (int) $sessRow['plan_id'];
        $sessScheduledDate = (string) ($sessRow['scheduled_date'] ?? '');

        try {
            $pdo->beginTransaction();

            $attStmt = $pdo->prepare(
                'INSERT INTO recall_attempts
                (session_id, user_response_text, ai_score, strengths_json, missing_concepts_json, corrective_feedback, cognitive_stage_check, follow_up_question)
                VALUES (:session_id, :user_response_text, :ai_score, :strengths_json, :missing_concepts_json, :corrective_feedback, :cognitive_stage_check, :follow_up_question)'
            );
            $attStmt->execute([
                ':session_id' => $sessionId,
                ':user_response_text' => $userResponseText,
                ':ai_score' => $score,
                ':strengths_json' => json_encode($accuratePoints, JSON_UNESCAPED_UNICODE),
                ':missing_concepts_json' => json_encode($missedConcepts, JSON_UNESCAPED_UNICODE),
                ':corrective_feedback' => $coachFeedback,
                ':cognitive_stage_check' => $cognitiveStageCheck,
                ':follow_up_question' => $socraticQuestion,
            ]);
            $attemptId = (int) $pdo->lastInsertId();

            $updStmt = $pdo->prepare(
                "UPDATE study_sessions
                 SET status = 'completed', mastery_score = :score, completed_at = :completed_at
                 WHERE id = :id"
            );
            $updStmt->execute([
                ':score' => $score,
                ':completed_at' => $completedAt,
                ':id' => $sessionId,
            ]);

            $pdo->commit();

            // Completion-Anchored Hook: auto-run Tier 1 recalibration if completing an overdue session
            $recalibrated = false;
            $refreshedPlan = null;
            $today = date('Y-m-d');
            if ($sessScheduledDate !== '' && $sessScheduledDate < $today) {
                $recal = recalibratePlanSchedule($pdo, $planId, $today, 'tier1_only');
                if (!empty($recal['recalibrated']) && !empty($recal['plan'])) {
                    $recalibrated = true;
                    $refreshedPlan = $recal['plan'];
                }
            }
            if ($refreshedPlan === null) {
                $updatedPlans = loadStudyPlans($pdo, $planId);
                $refreshedPlan = $updatedPlans[0] ?? null;
            }

            respondJson([
                'ok' => true,
                'attemptId' => $attemptId,
                'completedAt' => $completedAt,
                'recalibrated' => $recalibrated,
                'plan' => $refreshedPlan,
            ], 201);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            respondJson([
                'ok' => false,
                'error' => 'Failed to persist recall attempt in MySQL.',
                'details' => $e->getMessage(),
            ], 500);
        }
    }

    // -------------------------------------------------------------------------
    // Action 6: delete_plan — POST fallback for hosts/WAFs that block HTTP DELETE
    // -------------------------------------------------------------------------
    if ($action === 'delete_plan') {
        $planId = (int) ($body['planId'] ?? $_GET['plan_id'] ?? 0);
        if ($planId <= 0) {
            respondJson(['ok' => false, 'error' => 'Valid planId is required.'], 400);
        }

        $stmt = $pdo->prepare('DELETE FROM study_plans WHERE id = :id AND user_id = :uid');
        $stmt->execute([':id' => $planId, ':uid' => $currentUserId]);

        respondJson(['ok' => true, 'deletedPlanId' => $planId]);
    }

    respondJson(['ok' => false, 'error' => "Unknown POST action: {$action}"], 400);
}

// =============================================================================
// DELETE — Delete a Study Plan (cascades to sessions and recall_attempts)
// =============================================================================
if ($method === 'DELETE') {
    $pdo = getDbConnection();
    $currentUser = resolveEffectiveUserRow($pdo, []);
    $currentUserId = (int) $currentUser['id'];
    $planId = isset($_GET['plan_id']) ? (int) $_GET['plan_id'] : 0;
    if ($planId <= 0) {
        respondJson(['ok' => false, 'error' => 'Valid plan_id is required.'], 400);
    }

    $stmt = $pdo->prepare('DELETE FROM study_plans WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $planId, ':uid' => $currentUserId]);

    respondJson(['ok' => true, 'deletedPlanId' => $planId]);
}

respondJson(['ok' => false, 'error' => 'Method not allowed.'], 405);
