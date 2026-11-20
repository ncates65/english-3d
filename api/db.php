<?php
declare(strict_types=1);

/**
 * Practice Buddy ("PB") — PDO Database Connection, Schema Migration & User Helpers
 * Production URL: https://english-3d.com/study/api/db.php
 */

if (!defined('PB_DB_LOADING')) {
    define('PB_DB_LOADING', true);
}

if (!defined('DB_HOST')) {
    require_once __DIR__ . '/config.php';
}

function dbHasColumn(PDO $pdo, string $table, string $column): bool {
    $stmt = $pdo->prepare(
        "SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tbl
           AND COLUMN_NAME = :col
         LIMIT 1"
    );
    $stmt->execute([
        ':tbl' => $table,
        ':col' => $column,
    ]);
    return (bool) $stmt->fetch();
}

function dbHasIndex(PDO $pdo, string $table, string $indexName): bool {
    $stmt = $pdo->prepare(
        "SELECT INDEX_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tbl
           AND INDEX_NAME = :idx
         LIMIT 1"
    );
    $stmt->execute([
        ':tbl' => $table,
        ':idx' => $indexName,
    ]);
    return (bool) $stmt->fetch();
}

function dbGetColumnType(PDO $pdo, string $table, string $column): string {
    $stmt = $pdo->prepare(
        "SELECT COLUMN_TYPE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tbl
           AND COLUMN_NAME = :col
         LIMIT 1"
    );
    $stmt->execute([
        ':tbl' => $table,
        ':col' => $column,
    ]);
    $row = $stmt->fetch();
    return $row ? strtolower((string) ($row['COLUMN_TYPE'] ?? '')) : '';
}

function dbHasForeignKey(PDO $pdo, string $table, string $constraintName): bool {
    $stmt = $pdo->prepare(
        "SELECT CONSTRAINT_NAME
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tbl
           AND CONSTRAINT_NAME = :cname
           AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         LIMIT 1"
    );
    $stmt->execute([
        ':tbl' => $table,
        ':cname' => $constraintName,
    ]);
    return (bool) $stmt->fetch();
}

function ensureDefaultFallbackUser(PDO $pdo): int {
    $stmt = $pdo->prepare("SELECT id FROM `users` WHERE `email` = :email LIMIT 1");
    $stmt->execute([':email' => 'learner@english-3d.com']);
    $row = $stmt->fetch();
    if ($row) {
        return (int) $row['id'];
    }

    $ins = $pdo->prepare(
        "INSERT INTO `users` (`email`, `display_name`, `is_guest`) VALUES (:email, :display_name, 0)"
    );
    $ins->execute([
        ':email' => 'learner@english-3d.com',
        ':display_name' => 'Demo Learner',
    ]);
    return (int) $pdo->lastInsertId();
}

function ensureDatabaseTables(PDO $pdo): void {
    static $tablesEnsured = false;
    if ($tablesEnsured) {
        return;
    }

    // 1. Users table (registered + OAuth + lightweight Guest Mode accounts)
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `users` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `email` VARCHAR(255) UNIQUE DEFAULT NULL,
            `password_hash` VARCHAR(255) DEFAULT NULL,
            `display_name` VARCHAR(100) NOT NULL DEFAULT 'Guest Learner',
            `google_id` VARCHAR(255) DEFAULT NULL,
            `is_guest` TINYINT(1) NOT NULL DEFAULT 0,
            `guest_token` VARCHAR(64) UNIQUE DEFAULT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            INDEX `idx_users_email` (`email`),
            INDEX `idx_users_guest_token` (`guest_token`),
            INDEX `idx_users_google_id` (`google_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $defaultUserId = ensureDefaultFallbackUser($pdo);

    // 2. Study Plans table
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `study_plans` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `user_id` INT UNSIGNED NOT NULL,
            `user_email` VARCHAR(255) NOT NULL DEFAULT 'learner@english-3d.com',
            `topic_title` VARCHAR(255) NOT NULL,
            `study_mode` ENUM('deepening', 'spiral_chunking') NOT NULL DEFAULT 'deepening',
            `target_chunk_count` TINYINT UNSIGNED NOT NULL DEFAULT 1,
            `study_window_minutes` INT UNSIGNED NOT NULL DEFAULT 30,
            `executive_summary` TEXT NOT NULL,
            `core_concepts_json` JSON NOT NULL,
            `blueprint_json` JSON NULL,
            `source_links_json` JSON NOT NULL,
            `extracted_context_cache` LONGTEXT NOT NULL,
            `start_date` DATE NOT NULL,
            `master_by_date` DATE NOT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            INDEX `idx_study_plans_user_id` (`user_id`),
            INDEX `idx_study_plans_user_email` (`user_email`),
            INDEX `idx_study_plans_dates` (`start_date`, `master_by_date`),
            CONSTRAINT `fk_study_plans_user`
                FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // 3. Study Sessions table
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `study_sessions` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `plan_id` INT UNSIGNED NOT NULL,
            `user_id` INT UNSIGNED NOT NULL,
            `session_number` INT NOT NULL,
            `stage_number` INT NOT NULL DEFAULT 1,
            `stage_name` VARCHAR(160) NOT NULL,
            `stage_key` VARCHAR(64) NOT NULL DEFAULT 'schema_mapping',
            `scheduled_date` DATE NOT NULL,
            `original_scheduled_date` DATE NULL,
            `day_offset` INT NOT NULL DEFAULT 0,
            `gap_days` INT NOT NULL DEFAULT 0,
            `cognitive_goal` TEXT NOT NULL,
            `chunk_scope_json` JSON NULL,
            `continuity_hook` TEXT NULL,
            `prompts_json` JSON NOT NULL,
            `verification_checklist_json` JSON NOT NULL,
            `status` ENUM('pending', 'completed', 'merged') NOT NULL DEFAULT 'pending',
            `merged_into_session_id` INT UNSIGNED NULL,
            `recalibration_count` INT UNSIGNED NOT NULL DEFAULT 0,
            `mastery_score` INT DEFAULT NULL,
            `calendar_event_id` VARCHAR(255) DEFAULT NULL,
            `completed_at` TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (`id`),
            INDEX `idx_study_sessions_plan_id` (`plan_id`),
            INDEX `idx_study_sessions_user_id` (`user_id`),
            INDEX `idx_study_sessions_scheduled_date` (`scheduled_date`),
            INDEX `idx_study_sessions_status` (`status`),
            CONSTRAINT `fk_study_sessions_plan`
                FOREIGN KEY (`plan_id`) REFERENCES `study_plans` (`id`)
                ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_study_sessions_user`
                FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // 4. Recall Attempts table
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `recall_attempts` (
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `session_id` INT UNSIGNED NOT NULL,
            `user_response_text` TEXT NOT NULL,
            `ai_score` INT NOT NULL,
            `strengths_json` JSON NOT NULL,
            `missing_concepts_json` JSON NOT NULL,
            `corrective_feedback` TEXT NOT NULL,
            `cognitive_stage_check` TEXT NULL,
            `follow_up_question` TEXT NOT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            INDEX `idx_recall_attempts_session_id` (`session_id`),
            CONSTRAINT `fk_recall_attempts_session`
                FOREIGN KEY (`session_id`) REFERENCES `study_sessions` (`id`)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    // -------------------------------------------------------------------------
    // Incremental migrations for existing installations
    // -------------------------------------------------------------------------
    if (!dbHasColumn($pdo, 'study_plans', 'user_id')) {
        $pdo->exec("ALTER TABLE `study_plans` ADD COLUMN `user_id` INT UNSIGNED NOT NULL DEFAULT {$defaultUserId} AFTER `id`");
    }
    $pdo->exec(
        "UPDATE `study_plans`
         SET `user_id` = {$defaultUserId}
         WHERE `user_id` = 0 OR `user_id` NOT IN (SELECT `id` FROM `users`)"
    );
    if (!dbHasIndex($pdo, 'study_plans', 'idx_study_plans_user_id')) {
        $pdo->exec("ALTER TABLE `study_plans` ADD INDEX `idx_study_plans_user_id` (`user_id`)");
    }
    if (!dbHasForeignKey($pdo, 'study_plans', 'fk_study_plans_user')) {
        try {
            $pdo->exec(
                "ALTER TABLE `study_plans`
                 ADD CONSTRAINT `fk_study_plans_user`
                 FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                 ON DELETE CASCADE ON UPDATE CASCADE"
            );
        } catch (PDOException) {
            // Skip if existing column type differs slightly; index remains active
        }
    }

    if (!dbHasColumn($pdo, 'study_sessions', 'user_id')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `user_id` INT UNSIGNED NOT NULL DEFAULT {$defaultUserId} AFTER `plan_id`");
        $pdo->exec(
            "UPDATE `study_sessions` s
             INNER JOIN `study_plans` p ON p.id = s.plan_id
             SET s.user_id = p.user_id"
        );
    }
    $pdo->exec(
        "UPDATE `study_sessions` s
         INNER JOIN `study_plans` p ON p.id = s.plan_id
         SET s.user_id = p.user_id
         WHERE s.user_id = 0 OR s.user_id NOT IN (SELECT `id` FROM `users`)"
    );
    if (!dbHasIndex($pdo, 'study_sessions', 'idx_study_sessions_user_id')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD INDEX `idx_study_sessions_user_id` (`user_id`)");
    }
    if (!dbHasForeignKey($pdo, 'study_sessions', 'fk_study_sessions_user')) {
        try {
            $pdo->exec(
                "ALTER TABLE `study_sessions`
                 ADD CONSTRAINT `fk_study_sessions_user`
                 FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
                 ON DELETE CASCADE ON UPDATE CASCADE"
            );
        } catch (PDOException) {
            // Skip if existing column type differs slightly
        }
    }

    if (!dbHasColumn($pdo, 'study_sessions', 'stage_number')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `stage_number` INT NOT NULL DEFAULT 1 AFTER `session_number`");
        $pdo->exec(
            "UPDATE `study_sessions`
             SET `stage_number` = CASE
                WHEN LOWER(`stage_name`) LIKE '%mastery verification%' OR LOWER(`stage_name`) LIKE '%feynman%' OR LOWER(`stage_name`) LIKE '%stage 5%' THEN 5
                WHEN LOWER(`stage_name`) LIKE '%application%' OR LOWER(`stage_name`) LIKE '%stage 4%' THEN 4
                WHEN LOWER(`stage_name`) LIKE '%elaborative%' OR LOWER(`stage_name`) LIKE '%stage 3%' THEN 3
                WHEN LOWER(`stage_name`) LIKE '%free recall%' OR LOWER(`stage_name`) LIKE '%stage 2%' THEN 2
                WHEN LOWER(`stage_name`) LIKE '%schema mapping%' OR LOWER(`stage_name`) LIKE '%stage 1%' THEN 1
                ELSE LEAST(5, GREATEST(1, `session_number`))
             END"
        );
    }

    if (!dbHasColumn($pdo, 'recall_attempts', 'cognitive_stage_check')) {
        $pdo->exec("ALTER TABLE `recall_attempts` ADD COLUMN `cognitive_stage_check` TEXT NULL AFTER `corrective_feedback`");
    }

    // Rename legacy Stage 1 label globally in DB
    $pdo->exec(
        "UPDATE `study_sessions`
         SET `stage_name` = 'Stage 1: Schema Mapping'
         WHERE `stage_name` LIKE '%Initial Encoding & Schema Mapping%'"
    );

    // Incremental upgrades for two-step digestion & completion-anchored recalibration
    if (!dbHasColumn($pdo, 'study_plans', 'study_mode')) {
        $pdo->exec("ALTER TABLE `study_plans` ADD COLUMN `study_mode` ENUM('deepening', 'spiral_chunking') NOT NULL DEFAULT 'deepening' AFTER `topic_title`");
    }
    if (!dbHasColumn($pdo, 'study_plans', 'target_chunk_count')) {
        $pdo->exec("ALTER TABLE `study_plans` ADD COLUMN `target_chunk_count` TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER `study_mode`");
    }
    if (!dbHasColumn($pdo, 'study_plans', 'study_window_minutes')) {
        $pdo->exec("ALTER TABLE `study_plans` ADD COLUMN `study_window_minutes` INT UNSIGNED NOT NULL DEFAULT 30 AFTER `target_chunk_count`");
    }
    if (!dbHasColumn($pdo, 'study_plans', 'blueprint_json')) {
        $pdo->exec("ALTER TABLE `study_plans` ADD COLUMN `blueprint_json` JSON NULL AFTER `core_concepts_json`");
    }

    if (!dbHasColumn($pdo, 'study_sessions', 'stage_key')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `stage_key` VARCHAR(64) NOT NULL DEFAULT 'schema_mapping' AFTER `stage_name`");
        $pdo->exec(
            "UPDATE `study_sessions`
             SET `stage_key` = CASE `stage_number`
                WHEN 1 THEN 'schema_mapping'
                WHEN 2 THEN 'closed_book_free_recall'
                WHEN 3 THEN 'elaborative_interrogation'
                WHEN 4 THEN 'application_edge_cases'
                ELSE 'mastery_verification'
             END"
        );
    }
    if (!dbHasColumn($pdo, 'study_sessions', 'original_scheduled_date')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `original_scheduled_date` DATE NULL AFTER `scheduled_date`");
    }
    $pdo->exec(
        "UPDATE `study_sessions`
         SET `original_scheduled_date` = `scheduled_date`
         WHERE `original_scheduled_date` IS NULL"
    );
    if (!dbHasColumn($pdo, 'study_sessions', 'chunk_scope_json')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `chunk_scope_json` JSON NULL AFTER `cognitive_goal`");
    }
    if (!dbHasColumn($pdo, 'study_sessions', 'continuity_hook')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `continuity_hook` TEXT NULL AFTER `chunk_scope_json`");
    }
    $statusColType = dbGetColumnType($pdo, 'study_sessions', 'status');
    if ($statusColType !== '' && !str_contains($statusColType, "'merged'")) {
        $pdo->exec(
            "ALTER TABLE `study_sessions`
             MODIFY COLUMN `status` ENUM('pending', 'completed', 'merged') NOT NULL DEFAULT 'pending'"
        );
    }
    if (!dbHasColumn($pdo, 'study_sessions', 'merged_into_session_id')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `merged_into_session_id` INT UNSIGNED NULL AFTER `status`");
    }
    if (!dbHasColumn($pdo, 'study_sessions', 'recalibration_count')) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `recalibration_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `merged_into_session_id`");
    }

    $tablesEnsured = true;
}

function getDbConnection(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $hosts = DB_HOST === 'localhost' ? ['localhost', '127.0.0.1'] : [DB_HOST];
    $lastException = null;

    foreach ($hosts as $host) {
        $dsn = sprintf(
            'mysql:host=%s;dbname=%s;charset=%s',
            $host,
            DB_NAME,
            DB_CHARSET
        );

        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
            break;
        } catch (PDOException $e) {
            $pdo = null;
            $lastException = $e;
            $isAccessDenied = (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1045)
                || str_contains($e->getMessage(), '[1045]');
            if ($isAccessDenied) {
                break;
            }
        }
    }

    if (!($pdo instanceof PDO)) {
        respondJson([
            'ok' => false,
            'error' => 'Database connection failed. Verify Hostinger MySQL credentials in api/config.php.',
            'details' => $lastException ? $lastException->getMessage() : 'Unknown PDO error.',
        ], 503);
    }

    try {
        ensureDatabaseTables($pdo);
    } catch (PDOException $e) {
        respondJson([
            'ok' => false,
            'error' => 'Connected to MySQL, but automatic table initialization failed.',
            'details' => $e->getMessage(),
        ], 500);
    }

    return $pdo;
}

// -----------------------------------------------------------------------------
// User Authentication & Guest Mode Resolution Helpers
// -----------------------------------------------------------------------------
/**
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function formatUserRow(array $row): array {
    return [
        'id' => (int) $row['id'],
        'email' => $row['email'] !== null ? (string) $row['email'] : null,
        'displayName' => (string) ($row['display_name'] ?: 'Learner'),
        'googleId' => $row['google_id'] !== null ? (string) $row['google_id'] : null,
        'isGuest' => (bool) ((int) ($row['is_guest'] ?? 0)),
        'guestToken' => $row['guest_token'] !== null ? (string) $row['guest_token'] : null,
        'createdAt' => (string) ($row['created_at'] ?? ''),
    ];
}

function getOrCreateGuestUser(PDO $pdo, string $rawToken = ''): array {
    $token = preg_replace('/[^a-zA-Z0-9_-]/', '', trim($rawToken)) ?? '';
    if (strlen($token) < 16) {
        $token = bin2hex(random_bytes(24));
    }
    $token = substr($token, 0, 64);

    $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `guest_token` = :token LIMIT 1');
    $stmt->execute([':token' => $token]);
    $existing = $stmt->fetch();
    if ($existing) {
        return $existing;
    }

    $ins = $pdo->prepare(
        "INSERT INTO `users` (`display_name`, `is_guest`, `guest_token`) VALUES ('Guest Mode', 1, :token)"
    );
    $ins->execute([':token' => $token]);
    $id = (int) $pdo->lastInsertId();

    $fetch = $pdo->prepare('SELECT * FROM `users` WHERE `id` = :id LIMIT 1');
    $fetch->execute([':id' => $id]);
    $row = $fetch->fetch();
    return $row ?: [
        'id' => $id,
        'email' => null,
        'display_name' => 'Guest Mode',
        'google_id' => null,
        'is_guest' => 1,
        'guest_token' => $token,
        'created_at' => date('Y-m-d H:i:s'),
    ];
}

/**
 * @param array<string, mixed> $body
 * @return array{bearerToken: string, guestToken: string}
 */
function extractRequestAuthCredentials(array $body = []): array {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    $bearerToken = '';
    if (preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
        $bearerToken = trim($m[1]);
    } elseif (!empty($_SERVER['HTTP_X_AUTH_TOKEN'])) {
        $bearerToken = trim((string) $_SERVER['HTTP_X_AUTH_TOKEN']);
    } elseif (!empty($body['authToken'])) {
        $bearerToken = trim((string) $body['authToken']);
    }

    $guestToken = '';
    if (!empty($_SERVER['HTTP_X_GUEST_TOKEN'])) {
        $guestToken = trim((string) $_SERVER['HTTP_X_GUEST_TOKEN']);
    } elseif (!empty($_GET['guest_token'])) {
        $guestToken = trim((string) $_GET['guest_token']);
    } elseif (!empty($body['guestToken'])) {
        $guestToken = trim((string) $body['guestToken']);
    }

    return [
        'bearerToken' => $bearerToken,
        'guestToken' => preg_replace('/[^a-zA-Z0-9_-]/', '', $guestToken) ?? '',
    ];
}

/**
 * Resolve the current user from Bearer JWT, PHP session, or Guest Token.
 *
 * @param PDO $pdo
 * @param array<string, mixed> $body
 * @param bool $createGuestIfTokenProvided
 * @return array<string, mixed>|null
 */
function resolveCurrentUser(PDO $pdo, array $body = [], bool $createGuestIfTokenProvided = true): ?array {
    startPbSession();
    $creds = extractRequestAuthCredentials($body);

    // 1. Check signed Bearer/X-Auth-Token JWT
    if ($creds['bearerToken'] !== '') {
        $verified = verifyAuthToken($creds['bearerToken']);
        if ($verified !== null) {
            $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `id` = :id LIMIT 1');
            $stmt->execute([':id' => $verified['uid']]);
            $row = $stmt->fetch();
            if ($row) {
                return $row;
            }
        }
    }

    // 2. Check PHP session user ID
    if (!empty($_SESSION['pb_user_id'])) {
        $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `id` = :id LIMIT 1');
        $stmt->execute([':id' => (int) $_SESSION['pb_user_id']]);
        $row = $stmt->fetch();
        if ($row) {
            return $row;
        }
    }

    // 3. Check guest_token
    if ($creds['guestToken'] !== '') {
        $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `guest_token` = :gt LIMIT 1');
        $stmt->execute([':gt' => $creds['guestToken']]);
        $row = $stmt->fetch();
        if ($row) {
            return $row;
        }
        if ($createGuestIfTokenProvided) {
            return getOrCreateGuestUser($pdo, $creds['guestToken']);
        }
    }

    return null;
}

/**
 * Resolve user ID for study plan queries, falling back to default user when unauthenticated.
 */
function resolveEffectiveUserRow(PDO $pdo, array $body = []): array {
    $user = resolveCurrentUser($pdo, $body, true);
    if ($user !== null) {
        return $user;
    }

    $fallbackId = ensureDefaultFallbackUser($pdo);
    $stmt = $pdo->prepare('SELECT * FROM `users` WHERE `id` = :id LIMIT 1');
    $stmt->execute([':id' => $fallbackId]);
    $row = $stmt->fetch();
    return $row ?: [
        'id' => $fallbackId,
        'email' => 'learner@english-3d.com',
        'display_name' => 'Demo Learner',
        'google_id' => null,
        'is_guest' => 0,
        'guest_token' => null,
    ];
}

/**
 * Migrate all study plans and sessions belonging to a guest_token to a permanent user_id.
 */
function migrateGuestDataToUser(PDO $pdo, string $guestToken, int $targetUserId, ?string $targetEmail = null): int {
    $cleanToken = preg_replace('/[^a-zA-Z0-9_-]/', '', trim($guestToken)) ?? '';
    if ($cleanToken === '') {
        return 0;
    }

    $stmt = $pdo->prepare(
        'SELECT `id` FROM `users` WHERE `guest_token` = :token AND `is_guest` = 1 AND `id` != :target LIMIT 1'
    );
    $stmt->execute([
        ':token' => $cleanToken,
        ':target' => $targetUserId,
    ]);
    $guestRow = $stmt->fetch();
    if (!$guestRow) {
        return 0;
    }

    $guestId = (int) $guestRow['id'];

    $countStmt = $pdo->prepare('SELECT COUNT(*) AS cnt FROM `study_plans` WHERE `user_id` = :gid');
    $countStmt->execute([':gid' => $guestId]);
    $migratedPlans = (int) ($countStmt->fetch()['cnt'] ?? 0);

    if ($targetEmail !== null && $targetEmail !== '') {
        $updPlans = $pdo->prepare(
            'UPDATE `study_plans` SET `user_id` = :uid, `user_email` = :email WHERE `user_id` = :gid'
        );
        $updPlans->execute([
            ':uid' => $targetUserId,
            ':email' => mb_substr($targetEmail, 0, 255),
            ':gid' => $guestId,
        ]);
    } else {
        $updPlans = $pdo->prepare('UPDATE `study_plans` SET `user_id` = :uid WHERE `user_id` = :gid');
        $updPlans->execute([
            ':uid' => $targetUserId,
            ':gid' => $guestId,
        ]);
    }

    $updSessions = $pdo->prepare('UPDATE `study_sessions` SET `user_id` = :uid WHERE `user_id` = :gid');
    $updSessions->execute([
        ':uid' => $targetUserId,
        ':gid' => $guestId,
    ]);

    $delGuest = $pdo->prepare('DELETE FROM `users` WHERE `id` = :gid AND `is_guest` = 1');
    $delGuest->execute([':gid' => $guestId]);

    return $migratedPlans;
}

