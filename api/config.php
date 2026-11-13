<?php
declare(strict_types=1);

/**
 * SpacedPractice AI — Configuration & Database Bootstrap
 * Production URL: https://english-3D.com/study/api/config.php
 * Compatible with PHP 8.2+ on Hostinger Business Shared/Cloud Hosting.
 */

// -----------------------------------------------------------------------------
// 1. Application Constants & Environment Overrides
// -----------------------------------------------------------------------------
define('APP_BASE_URL', getenv('APP_BASE_URL') ?: 'https://english-3D.com/study');

// Hostinger MySQL Credentials (set via Hostinger hPanel env or directly below)
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'u237966338_spaced_study');
define('DB_USER', getenv('DB_USER') ?: 'u237966338_study_admin');
define('DB_PASS', getenv('DB_PASS') ?: 'rYK2Jr9_GZpgD@7j*euHevZP');
define('DB_CHARSET', 'utf8mb4');

// Gemini API Configuration
// Note: gemini-2.5-flash is legacy/deprecated; upgraded to gemini-3.8-flash per current Google GenAI spec
define('GEMINI_API_KEY', getenv('GEMINI_API_KEY') ?: 'f646f6a72a1cd51e7bf8b76165d83479bff1b546');
define('GEMINI_MODEL', getenv('GEMINI_MODEL') ?: 'gemini-3.8-flash');
define('GEMINI_INTERACTIONS_ENDPOINT', 'https://generativelanguage.googleapis.com/v1beta/interactions');
define('GEMINI_API_REVISION', '2026-05-20');

// Google OAuth2 Client ID for Calendar FreeBusy & Google Tasks Sync
define('GOOGLE_OAUTH_CLIENT_ID', getenv('GOOGLE_OAUTH_CLIENT_ID') ?: '278513964432-v070bccs95iv7hlc3n1hgc3vc3sisqg6.apps.googleusercontent.com');

// -----------------------------------------------------------------------------
// 2. Standard JSON & CORS Headers Helper
// -----------------------------------------------------------------------------
function sendJsonHeaders(): void {
    header('Content-Type: application/json; charset=utf-8');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
    $allowedOrigins = [
        'https://english-3D.com',
        'https://english-3d.com',
        'https://www.english-3D.com',
        'https://www.english-3d.com',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ];
    if (in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
    } else {
        header('Access-Control-Allow-Origin: *');
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/**
 * Send a structured JSON response and exit cleanly.
 *
 * @param array<string, mixed> $payload
 * @param int $statusCode
 */
function respondJson(array $payload, int $statusCode = 200): never {
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Parse JSON request body safely.
 *
 * @return array<string, mixed>
 */
function getJsonBody(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        respondJson([
            'ok' => false,
            'error' => 'Invalid JSON request payload.',
        ], 400);
    }
    return $decoded;
}

// -----------------------------------------------------------------------------
// 3. PDO MySQL Connection Singleton
// -----------------------------------------------------------------------------
function getDbConnection(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        DB_HOST,
        DB_NAME,
        DB_CHARSET
    );

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        respondJson([
            'ok' => false,
            'error' => 'Database connection failed. Verify Hostinger MySQL credentials in api/config.php.',
            'details' => $e->getMessage(),
        ], 503);
    }
}
