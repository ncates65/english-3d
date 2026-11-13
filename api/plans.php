<?php
declare(strict_types=1);

/**
 * SpacedPractice AI — Study Plans, Scheduled Sessions & Recall Attempts CRUD API
 * Endpoint: https://english-3D.com/study/api/plans.php
 */

require_once __DIR__ . '/config.php';
sendJsonHeaders();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

/**
 * Format a raw database study_sessions row into a typed frontend structure.
 *
 * @param array<string, mixed> $row
 * @param array<int, array<string, mixed>> $attempts
 * @return array<string, mixed>
 */
function formatSessionRow(array $row, array $attempts = []): array {
    return [
        'id' => (int) $row['id'],
        'planId' => (int) $row['plan_id'],
        'sessionNumber' => (int) $row['session_number'],
        'stageName' => (string) $row['stage_name'],
        'scheduledDate' => (string) $row['scheduled_date'],
        'dayOffset' => (int) $row['day_offset'],
        'gapDays' => (int) $row['gap_days'],
        'cognitiveGoal' => (string) $row['cognitive_goal'],
        'prompts' => json_decode((string) $row['prompts_json'], true) ?: [],
        'verificationChecklist' => json_decode((string) $row['verification_checklist_json'], true) ?: [],
        'status' => (string) $row['status'],
        'masteryScore' => $row['mastery_score'] !== null ? (int) $row['mastery_score'] : null,
        'calendarEventId' => $row['calendar_event_id'] !== null ? (string) $row['calendar_event_id'] : null,
        'completedAt' => $row['completed_at'] !== null ? (string) $row['completed_at'] : null,
        'attempts' => $attempts,
    ];
}

/**
 * Format a raw database recall_attempts row.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function formatAttemptRow(array $row): array {
    return [
        'id' => (int) $row['id'],
        'sessionId' => (int) $row['session_id'],
        'userResponseText' => (string) $row['user_response_text'],
        'aiScore' => (int) $row['ai_score'],
        'strengths' => json_decode((string) $row['strengths_json'], true) ?: [],
        'missingConcepts' => json_decode((string) $row['missing_concepts_json'], true) ?: [],
        'correctiveFeedback' => (string) $row['corrective_feedback'],
        'followUpQuestion' => (string) $row['follow_up_question'],
        'createdAt' => (string) $row['created_at'],
    ];
}

/**
 * Load full study plan(s) with nested sessions and recall attempts.
 *
 * @param PDO $pdo
 * @param int|null $planId
 * @param string|null $userEmail
 * @return array<int, array<string, mixed>>
 */
function loadStudyPlans(PDO $pdo, ?int $planId = null, ?string $userEmail = null): array {
    if ($planId !== null) {
        $stmt = $pdo->prepare('SELECT * FROM study_plans WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $planId]);
    } elseif ($userEmail !== null && $userEmail !== '') {
        $stmt = $pdo->prepare('SELECT * FROM study_plans WHERE user_email = :email ORDER BY created_at DESC');
        $stmt->execute([':email' => $userEmail]);
    } else {
        $stmt = $pdo->query('SELECT * FROM study_plans ORDER BY created_at DESC');
    }

    $planRows = $stmt->fetchAll();
    if (!$planRows) {
        return [];
    }

    $planIds = array_map(static fn(array $r): int => (int) $r['id'], $planRows);
    $placeholders = implode(',', array_fill(0, count($planIds), '?'));

    $sessionStmt = $pdo->prepare(
        "SELECT * FROM study_sessions WHERE plan_id IN ({$placeholders}) ORDER BY scheduled_date ASC, session_number ASC"
    );
    $sessionStmt->execute($planIds);
    $sessionRows = $sessionStmt->fetchAll();

    $sessionIds = array_map(static fn(array $s): int => (int) $s['id'], $sessionRows);
    $attemptsBySession = [];

    if (!empty($sessionIds)) {
        $sPlaceholders = implode(',', array_fill(0, count($sessionIds), '?'));
        $attemptStmt = $pdo->prepare(
            "SELECT * FROM recall_attempts WHERE session_id IN ({$sPlaceholders}) ORDER BY created_at DESC"
        );
        $attemptStmt->execute($sessionIds);
        foreach ($attemptStmt->fetchAll() as $aRow) {
            $sid = (int) $aRow['session_id'];
            $attemptsBySession[$sid][] = formatAttemptRow($aRow);
        }
    }

    $sessionsByPlan = [];
    foreach ($sessionRows as $sRow) {
        $pid = (int) $sRow['plan_id'];
        $sid = (int) $sRow['id'];
        $sessionsByPlan[$pid][] = formatSessionRow($sRow, $attemptsBySession[$sid] ?? []);
    }

    $result = [];
    foreach ($planRows as $pRow) {
        $pid = (int) $pRow['id'];
        $result[] = [
            'id' => $pid,
            'userEmail' => (string) $pRow['user_email'],
            'topicTitle' => (string) $pRow['topic_title'],
            'executiveSummary' => (string) $pRow['executive_summary'],
            'coreConcepts' => json_decode((string) $pRow['core_concepts_json'], true) ?: [],
            'sourceLinks' => json_decode((string) $pRow['source_links_json'], true) ?: [],
            'extractedContextCache' => (string) $pRow['extracted_context_cache'],
            'startDate' => (string) $pRow['start_date'],
            'masterByDate' => (string) $pRow['master_by_date'],
            'createdAt' => (string) $pRow['created_at'],
            'sessions' => $sessionsByPlan[$pid] ?? [],
        ];
    }

    return $result;
}

// =============================================================================
// GET — Fetch All Plans, Single Plan by plan_id, or Single Session by session_id
// =============================================================================
if ($method === 'GET') {
    $pdo = getDbConnection();

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
        ]);
    }

    if (isset($_GET['plan_id']) && is_numeric($_GET['plan_id'])) {
        $plans = loadStudyPlans($pdo, (int) $_GET['plan_id']);
        if (empty($plans)) {
            respondJson(['ok' => false, 'error' => 'Study plan not found.'], 404);
        }
        respondJson(['ok' => true, 'plan' => $plans[0]]);
    }

    $userEmail = isset($_GET['user_email']) ? trim((string) $_GET['user_email']) : null;
    $plans = loadStudyPlans($pdo, null, $userEmail);
    respondJson([
        'ok' => true,
        'plans' => $plans,
        'config' => [
            'googleOAuthClientId' => GOOGLE_OAUTH_CLIENT_ID,
            'appBaseUrl' => APP_BASE_URL,
            'geminiModel' => GEMINI_MODEL,
        ],
    ]);
}

// =============================================================================
// POST — Create Plan, Schedule Adaptive Booster Session (+2 Days), or Sync Event IDs
// =============================================================================
if ($method === 'POST') {
    $pdo = getDbConnection();
    $body = getJsonBody();
    $action = $action !== '' ? $action : (string) ($body['action'] ?? 'create_plan');

    // -------------------------------------------------------------------------
    // Action 1: create_plan — Save a newly generated Study Plan & its Sessions
    // -------------------------------------------------------------------------
    if ($action === 'create_plan') {
        $userEmail = trim((string) ($body['userEmail'] ?? 'learner@english-3d.com'));
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

        try {
            $pdo->beginTransaction();

            $planStmt = $pdo->prepare(
                'INSERT INTO study_plans
                (user_email, topic_title, executive_summary, core_concepts_json, source_links_json, extracted_context_cache, start_date, master_by_date)
                VALUES (:user_email, :topic_title, :executive_summary, :core_concepts_json, :source_links_json, :extracted_context_cache, :start_date, :master_by_date)'
            );
            $planStmt->execute([
                ':user_email' => $userEmail,
                ':topic_title' => $topicTitle,
                ':executive_summary' => $executiveSummary,
                ':core_concepts_json' => json_encode($coreConcepts, JSON_UNESCAPED_UNICODE),
                ':source_links_json' => json_encode($sourceLinks, JSON_UNESCAPED_UNICODE),
                ':extracted_context_cache' => $extractedContextCache,
                ':start_date' => $startDate,
                ':master_by_date' => $masterByDate,
            ]);

            $planId = (int) $pdo->lastInsertId();

            $sessionStmt = $pdo->prepare(
                'INSERT INTO study_sessions
                (plan_id, session_number, stage_name, scheduled_date, day_offset, gap_days, cognitive_goal, prompts_json, verification_checklist_json, status)
                VALUES (:plan_id, :session_number, :stage_name, :scheduled_date, :day_offset, :gap_days, :cognitive_goal, :prompts_json, :verification_checklist_json, :status)'
            );

            foreach ($sessions as $idx => $session) {
                $sessionStmt->execute([
                    ':plan_id' => $planId,
                    ':session_number' => (int) ($session['sessionNumber'] ?? ($idx + 1)),
                    ':stage_name' => (string) ($session['stageName'] ?? 'Active Recall Session'),
                    ':scheduled_date' => (string) ($session['scheduledDate'] ?? $startDate),
                    ':day_offset' => (int) ($session['dayOffset'] ?? 0),
                    ':gap_days' => (int) ($session['gapDays'] ?? 0),
                    ':cognitive_goal' => (string) ($session['cognitiveGoal'] ?? ''),
                    ':prompts_json' => json_encode($session['prompts'] ?? [], JSON_UNESCAPED_UNICODE),
                    ':verification_checklist_json' => json_encode($session['verificationChecklist'] ?? [], JSON_UNESCAPED_UNICODE),
                    ':status' => 'pending',
                ]);
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
    // Action 2: add_booster_session — Adaptive Spacing Hook (+2 Days) when score < 70
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
        $baseDate = (string) $sourceSession['scheduled_date'];
        $today = date('Y-m-d');
        $anchorDate = $baseDate > $today ? $baseDate : $today;
        $boosterDate = date('Y-m-d', strtotime($anchorDate . ' +2 days'));

        $startDate = (string) $sourceSession['start_date'];
        $dayOffset = max(1, (int) round((strtotime($boosterDate) - strtotime($startDate)) / 86400));

        // Build targeted remedial prompts from missed concepts + Socratic follow-up
        $remedialPrompts = [];
        if ($followUpQuestion !== '') {
            $remedialPrompts[] = "Socratic Remediation: {$followUpQuestion}";
        }
        foreach (array_slice($missingConcepts, 0, 3) as $concept) {
            $remedialPrompts[] = "Closed-Book Corrective Retrieval: Explain the mechanism, boundaries, and significance of \"{$concept}\" without consulting notes.";
        }
        if (empty($remedialPrompts)) {
            $origPrompts = json_decode((string) $sourceSession['prompts_json'], true) ?: [];
            $remedialPrompts = array_slice($origPrompts, 0, 3);
        }

        $checklist = !empty($missingConcepts)
            ? array_map(static fn($c) => "Accurately retrieved and articulated: {$c}", $missingConcepts)
            : (json_decode((string) $sourceSession['verification_checklist_json'], true) ?: []);

        // Count existing sessions to assign session_number and re-order cleanly
        $countStmt = $pdo->prepare('SELECT COALESCE(MAX(session_number), 0) + 1 AS next_num FROM study_sessions WHERE plan_id = :pid');
        $countStmt->execute([':pid' => $planId]);
        $nextNum = (int) ($countStmt->fetch()['next_num'] ?? 1);

        $insertStmt = $pdo->prepare(
            'INSERT INTO study_sessions
            (plan_id, session_number, stage_name, scheduled_date, day_offset, gap_days, cognitive_goal, prompts_json, verification_checklist_json, status)
            VALUES (:plan_id, :session_number, :stage_name, :scheduled_date, :day_offset, :gap_days, :cognitive_goal, :prompts_json, :verification_checklist_json, :status)'
        );
        $insertStmt->execute([
            ':plan_id' => $planId,
            ':session_number' => $nextNum,
            ':stage_name' => 'Adaptive Booster — Targeted Error Remediation (+2d)',
            ':scheduled_date' => $boosterDate,
            ':day_offset' => $dayOffset,
            ':gap_days' => 2,
            ':cognitive_goal' => 'Consolidate fragile memory traces and eliminate retrieval gaps identified in Session #' . $sourceSession['session_number'] . '.',
            ':prompts_json' => json_encode($remedialPrompts, JSON_UNESCAPED_UNICODE),
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
    // Action 3: update_calendar_sync — Store Google Calendar / Tasks Event IDs
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

    respondJson(['ok' => false, 'error' => "Unknown POST action: {$action}"], 400);
}

// =============================================================================
// DELETE — Delete a Study Plan (cascades to sessions and recall_attempts)
// =============================================================================
if ($method === 'DELETE') {
    $pdo = getDbConnection();
    $planId = isset($_GET['plan_id']) ? (int) $_GET['plan_id'] : 0;
    if ($planId <= 0) {
        respondJson(['ok' => false, 'error' => 'Valid plan_id is required.'], 400);
    }

    $stmt = $pdo->prepare('DELETE FROM study_plans WHERE id = :id');
    $stmt->execute([':id' => $planId]);

    respondJson(['ok' => true, 'deletedPlanId' => $planId]);
}

respondJson(['ok' => false, 'error' => 'Method not allowed.'], 405);

