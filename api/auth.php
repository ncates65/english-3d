<?php
declare(strict_types=1);

/**
 * Practice Buddy ("PB") — Multi-User Authentication & Guest Mode API
 * Endpoint: https://english-3d.com/study/api/auth.php
 *
 * Supports:
 *  - GET  (session/token/guest lookup)
 *  - POST action=guest    (create/resume lightweight Guest Mode account)
 *  - POST action=register (Email + Password registration + guest plan migration)
 *  - POST action=login    (Email + Password sign-in + guest plan migration)
 *  - POST action=google   (Google OAuth2 userinfo verification + account bind/login)
 *  - POST action=logout   (clear PHP session)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
sendJsonHeaders();

/**
 * Persist any browser-only local plans created while offline in Guest Mode
 * into MySQL when the guest upgrades to or signs into a permanent account.
 *
 * @param PDO $pdo
 * @param int $userId
 * @param string $userEmail
 * @param array<int, array<string, mixed>> $localPlans
 */
function importOfflineLocalPlansForUser(PDO $pdo, int $userId, string $userEmail, array $localPlans): int {
    if (empty($localPlans)) {
        return 0;
    }

    $imported = 0;
    $dupStmt = $pdo->prepare(
        'SELECT id FROM study_plans WHERE user_id = :uid AND topic_title = :title AND start_date = :sd AND master_by_date = :mbd LIMIT 1'
    );
    $planStmt = $pdo->prepare(
        'INSERT INTO study_plans
        (user_id, user_email, topic_title, executive_summary, core_concepts_json, source_links_json, extracted_context_cache, start_date, master_by_date)
        VALUES (:user_id, :user_email, :topic_title, :executive_summary, :core_concepts_json, :source_links_json, :extracted_context_cache, :start_date, :master_by_date)'
    );
    $sessionStmt = $pdo->prepare(
        'INSERT INTO study_sessions
        (plan_id, user_id, session_number, stage_number, stage_name, scheduled_date, day_offset, gap_days, cognitive_goal, prompts_json, verification_checklist_json, status, mastery_score, completed_at)
        VALUES (:plan_id, :user_id, :session_number, :stage_number, :stage_name, :scheduled_date, :day_offset, :gap_days, :cognitive_goal, :prompts_json, :verification_checklist_json, :status, :mastery_score, :completed_at)'
    );

    foreach ($localPlans as $plan) {
        if (!is_array($plan)) {
            continue;
        }
        $title = trim((string) ($plan['topicTitle'] ?? ''));
        $sessions = is_array($plan['sessions'] ?? null) ? $plan['sessions'] : [];
        $startDate = (string) ($plan['startDate'] ?? date('Y-m-d'));
        $masterByDate = (string) ($plan['masterByDate'] ?? date('Y-m-d', strtotime('+14 days')));

        if ($title === '' || empty($sessions)) {
            continue;
        }

        // Skip if already in MySQL for this user
        $dupStmt->execute([
            ':uid' => $userId,
            ':title' => mb_substr($title, 0, 255),
            ':sd' => $startDate,
            ':mbd' => $masterByDate,
        ]);
        if ($dupStmt->fetch()) {
            continue;
        }

        try {
            $pdo->beginTransaction();
            $planStmt->execute([
                ':user_id' => $userId,
                ':user_email' => mb_substr($userEmail, 0, 255),
                ':topic_title' => mb_substr($title, 0, 255),
                ':executive_summary' => (string) ($plan['executiveSummary'] ?? ''),
                ':core_concepts_json' => json_encode($plan['coreConcepts'] ?? [], JSON_UNESCAPED_UNICODE),
                ':source_links_json' => json_encode($plan['sourceLinks'] ?? [], JSON_UNESCAPED_UNICODE),
                ':extracted_context_cache' => (string) ($plan['extractedContextCache'] ?? ''),
                ':start_date' => $startDate,
                ':master_by_date' => $masterByDate,
            ]);
            $newPlanId = (int) $pdo->lastInsertId();

            foreach ($sessions as $idx => $sess) {
                if (!is_array($sess)) {
                    continue;
                }
                $status = ((string) ($sess['status'] ?? 'pending')) === 'completed' ? 'completed' : 'pending';
                $score = isset($sess['masteryScore']) && $sess['masteryScore'] !== null
                    ? max(0, min(100, (int) $sess['masteryScore']))
                    : null;
                $stageNum = isset($sess['stageNumber'])
                    ? max(1, min(5, (int) $sess['stageNumber']))
                    : max(1, min(5, $idx + 1));
                $rawPrompts = is_array($sess['promptItems'] ?? null) && !empty($sess['promptItems'])
                    ? $sess['promptItems']
                    : (is_array($sess['prompts'] ?? null) ? $sess['prompts'] : []);

                $sessionStmt->execute([
                    ':plan_id' => $newPlanId,
                    ':user_id' => $userId,
                    ':session_number' => (int) ($sess['sessionNumber'] ?? ($idx + 1)),
                    ':stage_number' => $stageNum,
                    ':stage_name' => mb_substr((string) ($sess['stageName'] ?? 'Stage 1: Schema Mapping'), 0, 160),
                    ':scheduled_date' => (string) ($sess['scheduledDate'] ?? $startDate),
                    ':day_offset' => (int) ($sess['dayOffset'] ?? 0),
                    ':gap_days' => (int) ($sess['gapDays'] ?? 0),
                    ':cognitive_goal' => (string) ($sess['cognitiveGoal'] ?? ''),
                    ':prompts_json' => json_encode($rawPrompts, JSON_UNESCAPED_UNICODE),
                    ':verification_checklist_json' => json_encode($sess['verificationChecklist'] ?? [], JSON_UNESCAPED_UNICODE),
                    ':status' => $status,
                    ':mastery_score' => $score,
                    ':completed_at' => $status === 'completed' ? date('Y-m-d H:i:s') : null,
                ]);
            }

            $pdo->commit();
            $imported++;
        } catch (Throwable) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
        }
    }

    return $imported;
}

/**
 * Fetch verified Google profile info from an OAuth2 access token.
 *
 * @return array{sub: string, email: string, name: string}|null
 */
function verifyGoogleAccessToken(string $accessToken): ?array {
    $ch = curl_init('https://www.googleapis.com/oauth2/v3/userinfo');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $accessToken,
            'Accept: application/json',
        ],
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code >= 400) {
        return null;
    }
    $decoded = json_decode((string) $raw, true);
    if (!is_array($decoded) || empty($decoded['sub']) || empty($decoded['email'])) {
        return null;
    }

    return [
        'sub' => (string) $decoded['sub'],
        'email' => mb_strtolower(trim((string) $decoded['email'])),
        'name' => trim((string) ($decoded['name'] ?? $decoded['given_name'] ?? '')),
    ];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$pdo = getDbConnection();
startPbSession();

if ($method === 'GET') {
    $action = (string) ($_GET['action'] ?? 'me');
    if ($action === 'guest') {
        $guestToken = (string) ($_GET['guest_token'] ?? $_SERVER['HTTP_X_GUEST_TOKEN'] ?? '');
        $guestUser = getOrCreateGuestUser($pdo, $guestToken);
        $_SESSION['pb_user_id'] = (int) $guestUser['id'];
        $token = createAuthToken((int) $guestUser['id'], true);
        respondJson([
            'ok' => true,
            'user' => formatUserRow($guestUser),
            'token' => $token,
        ]);
    }

    $user = resolveCurrentUser($pdo, [], true);
    if ($user === null) {
        $guestUser = getOrCreateGuestUser($pdo, (string) ($_GET['guest_token'] ?? $_SERVER['HTTP_X_GUEST_TOKEN'] ?? ''));
        $_SESSION['pb_user_id'] = (int) $guestUser['id'];
        respondJson([
            'ok' => true,
            'user' => formatUserRow($guestUser),
            'token' => createAuthToken((int) $guestUser['id'], true),
        ]);
    }

    $isGuest = (bool) ((int) ($user['is_guest'] ?? 0));
    respondJson([
        'ok' => true,
        'user' => formatUserRow($user),
        'token' => createAuthToken((int) $user['id'], $isGuest),
    ]);
}

if ($method !== 'POST') {
    respondJson(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$body = getJsonBody();
$action = (string) ($_GET['action'] ?? ($body['action'] ?? ''));
$creds = extractRequestAuthCredentials($body);
$guestToken = $creds['guestToken'];
$localPlans = is_array($body['localPlans'] ?? null) ? $body['localPlans'] : [];

// -----------------------------------------------------------------------------
// Action 1: Continue as Guest
// -----------------------------------------------------------------------------
if ($action === 'guest') {
    $guestUser = getOrCreateGuestUser($pdo, $guestToken);
    $_SESSION['pb_user_id'] = (int) $guestUser['id'];
    respondJson([
        'ok' => true,
        'user' => formatUserRow($guestUser),
        'token' => createAuthToken((int) $guestUser['id'], true),
    ]);
}

// -----------------------------------------------------------------------------
// Action 2: Register with Email + Password (with automatic guest plan migration)
// -----------------------------------------------------------------------------
if ($action === 'register') {
    $email = mb_strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    $displayName = trim((string) ($body['displayName'] ?? ''));

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respondJson(['ok' => false, 'error' => 'Please enter a valid email address.'], 400);
    }
    if (mb_strlen($password) < 6) {
        respondJson(['ok' => false, 'error' => 'Password must be at least 6 characters long.'], 400);
    }
    if ($displayName === '') {
        $displayName = explode('@', $email)[0] ?: 'Learner';
    }
    $displayName = mb_substr($displayName, 0, 100);

    $existingStmt = $pdo->prepare('SELECT id FROM `users` WHERE `email` = :email LIMIT 1');
    $existingStmt->execute([':email' => $email]);
    if ($existingStmt->fetch()) {
        respondJson(['ok' => false, 'error' => 'An account with this email already exists. Please sign in instead.'], 409);
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);

    // Check if upgrading an existing guest row or inserting a fresh permanent row
    $upgradedFromGuest = false;
    $userId = 0;

    if ($guestToken !== '') {
        $gStmt = $pdo->prepare('SELECT id FROM `users` WHERE `guest_token` = :gt AND `is_guest` = 1 LIMIT 1');
        $gStmt->execute([':gt' => $guestToken]);
        $gRow = $gStmt->fetch();
        if ($gRow) {
            $userId = (int) $gRow['id'];
            $upd = $pdo->prepare(
                'UPDATE `users`
                 SET `email` = :email, `password_hash` = :ph, `display_name` = :dn, `is_guest` = 0, `guest_token` = NULL
                 WHERE `id` = :id'
            );
            $upd->execute([
                ':email' => $email,
                ':ph' => $passwordHash,
                ':dn' => $displayName,
                ':id' => $userId,
            ]);
            $pdo->prepare('UPDATE `study_plans` SET `user_email` = :email WHERE `user_id` = :uid')
                ->execute([':email' => $email, ':uid' => $userId]);
            $upgradedFromGuest = true;
        }
    }

    if ($userId === 0) {
        $ins = $pdo->prepare(
            'INSERT INTO `users` (`email`, `password_hash`, `display_name`, `is_guest`) VALUES (:email, :ph, :dn, 0)'
        );
        $ins->execute([
            ':email' => $email,
            ':ph' => $passwordHash,
            ':dn' => $displayName,
        ]);
        $userId = (int) $pdo->lastInsertId();
    }

    $migratedCount = $upgradedFromGuest
        ? (int) $pdo->query("SELECT COUNT(*) FROM study_plans WHERE user_id = {$userId}")->fetchColumn()
        : migrateGuestDataToUser($pdo, $guestToken, $userId, $email);
    $migratedCount += importOfflineLocalPlansForUser($pdo, $userId, $email, $localPlans);

    $_SESSION['pb_user_id'] = $userId;
    $userStmt = $pdo->prepare('SELECT * FROM `users` WHERE `id` = :id LIMIT 1');
    $userStmt->execute([':id' => $userId]);
    $userRow = $userStmt->fetch();

    respondJson([
        'ok' => true,
        'user' => formatUserRow($userRow ?: ['id' => $userId, 'email' => $email, 'display_name' => $displayName, 'is_guest' => 0]),
        'token' => createAuthToken($userId, false),
        'migratedPlansCount' => $migratedCount,
    ], 201);
}

// -----------------------------------------------------------------------------
// Action 3: Login with Email + Password (with guest plan migration)
// -----------------------------------------------------------------------------
if ($action === 'login') {
    $email = mb_strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');

    if ($email === '' || $password === '') {
        respondJson(['ok' => false, 'error' => 'Email and password are required.'], 400);
    }

    $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `email` = :email AND `is_guest` = 0 LIMIT 1');
    $stmt->execute([':email' => $email]);
    $userRow = $stmt->fetch();

    if (!$userRow || empty($userRow['password_hash']) || !password_verify($password, (string) $userRow['password_hash'])) {
        respondJson(['ok' => false, 'error' => 'Invalid email or password.'], 401);
    }

    $userId = (int) $userRow['id'];
    $migratedCount = migrateGuestDataToUser($pdo, $guestToken, $userId, $email);
    $migratedCount += importOfflineLocalPlansForUser($pdo, $userId, $email, $localPlans);

    $_SESSION['pb_user_id'] = $userId;
    respondJson([
        'ok' => true,
        'user' => formatUserRow($userRow),
        'token' => createAuthToken($userId, false),
        'migratedPlansCount' => $migratedCount,
    ]);
}

// -----------------------------------------------------------------------------
// Action 4: Continue with Google OAuth2 (verified via Google UserInfo API)
// -----------------------------------------------------------------------------
if ($action === 'google') {
    $accessToken = trim((string) ($body['accessToken'] ?? ''));
    if ($accessToken === '') {
        respondJson(['ok' => false, 'error' => 'Google OAuth accessToken is required.'], 400);
    }

    $profile = verifyGoogleAccessToken($accessToken);
    if ($profile === null) {
        respondJson(['ok' => false, 'error' => 'Could not verify Google OAuth session. Please try again.'], 401);
    }

    $googleId = $profile['sub'];
    $email = $profile['email'];
    $displayName = $profile['name'] !== '' ? mb_substr($profile['name'], 0, 100) : (explode('@', $email)[0] ?: 'Google Learner');

    $stmt = $pdo->prepare(
        'SELECT * FROM `users` WHERE `google_id` = :gid OR `email` = :email LIMIT 1'
    );
    $stmt->execute([
        ':gid' => $googleId,
        ':email' => $email,
    ]);
    $existing = $stmt->fetch();

    if ($existing) {
        $userId = (int) $existing['id'];
        $upd = $pdo->prepare(
            'UPDATE `users`
             SET `google_id` = :gid, `email` = :email, `display_name` = COALESCE(NULLIF(:dn, \'\'), `display_name`), `is_guest` = 0, `guest_token` = NULL
             WHERE `id` = :id'
        );
        $upd->execute([
            ':gid' => $googleId,
            ':email' => $email,
            ':dn' => $displayName,
            ':id' => $userId,
        ]);
    } else {
        $ins = $pdo->prepare(
            'INSERT INTO `users` (`email`, `display_name`, `google_id`, `is_guest`) VALUES (:email, :dn, :gid, 0)'
        );
        $ins->execute([
            ':email' => $email,
            ':dn' => $displayName,
            ':gid' => $googleId,
        ]);
        $userId = (int) $pdo->lastInsertId();
    }

    $migratedCount = migrateGuestDataToUser($pdo, $guestToken, $userId, $email);
    $migratedCount += importOfflineLocalPlansForUser($pdo, $userId, $email, $localPlans);

    $_SESSION['pb_user_id'] = $userId;
    $userStmt = $pdo->prepare('SELECT * FROM `users` WHERE `id` = :id LIMIT 1');
    $userStmt->execute([':id' => $userId]);
    $userRow = $userStmt->fetch();

    respondJson([
        'ok' => true,
        'user' => formatUserRow($userRow ?: ['id' => $userId, 'email' => $email, 'display_name' => $displayName, 'google_id' => $googleId, 'is_guest' => 0]),
        'token' => createAuthToken($userId, false),
        'migratedPlansCount' => $migratedCount,
    ]);
}

// -----------------------------------------------------------------------------
// Action 5: Sign Out
// -----------------------------------------------------------------------------
if ($action === 'logout') {
    unset($_SESSION['pb_user_id']);
    respondJson(['ok' => true]);
}

respondJson(['ok' => false, 'error' => "Unsupported auth action: {$action}"], 400);

