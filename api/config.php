<?php
declare(strict_types=1);

/**
 * Practice Buddy ("PB") — Configuration, Auth Token & HTTP Bootstrap
 * Production URL: https://english-3d.com/study/api/config.php
 * Compatible with PHP 8.2+ on Hostinger Business Shared/Cloud Hosting.
 */

// -----------------------------------------------------------------------------
// 1. Application Constants & Environment Overrides
// -----------------------------------------------------------------------------
if (is_file(__DIR__ . '/config.local.php')) {
    require_once __DIR__ . '/config.local.php';
}

if (!defined('APP_BASE_URL')) {
    define('APP_BASE_URL', getenv('APP_BASE_URL') ?: 'https://english-3D.com/study');
}

// Hostinger MySQL Credentials (set via config.local.php, Hostinger hPanel env, or below)
if (!defined('DB_HOST')) define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
if (!defined('DB_NAME')) define('DB_NAME', getenv('DB_NAME') ?: 'u237966338_spaced_study');
if (!defined('DB_USER')) define('DB_USER', getenv('DB_USER') ?: 'u237966338_study_admin');
if (!defined('DB_PASS')) define('DB_PASS', getenv('DB_PASS') ?: 'rYK2Jr9_GZpgD@7j*euHevZP');
if (!defined('DB_CHARSET')) define('DB_CHARSET', 'utf8mb4');

// Gemini API Configuration
// Note: gemini-2.5-flash is legacy/deprecated; upgraded to gemini-3.8-flash per current Google GenAI spec
if (!defined('GEMINI_API_KEY')) define('GEMINI_API_KEY', getenv('GEMINI_API_KEY') ?: 'AQ.Ab8RN6LsP4GNb4K-THHjawacFQ7UlmusJdIPGNA5sCT9SX_OLQ');
if (!defined('GEMINI_MODEL')) define('GEMINI_MODEL', getenv('GEMINI_MODEL') ?: 'gemini-3.8-flash');
if (!defined('GEMINI_INTERACTIONS_ENDPOINT')) define('GEMINI_INTERACTIONS_ENDPOINT', 'https://generativelanguage.googleapis.com/v1beta/interactions');
if (!defined('GEMINI_API_REVISION')) define('GEMINI_API_REVISION', '2026-05-20');

// Google OAuth2 Client ID for Sign-In, Calendar FreeBusy & Google Tasks Sync
if (!defined('GOOGLE_OAUTH_CLIENT_ID')) {
    define('GOOGLE_OAUTH_CLIENT_ID', getenv('GOOGLE_OAUTH_CLIENT_ID') ?: '278513964432-v070bccs95iv7hlc3n1hgc3vc3sisqg6.apps.googleusercontent.com');
}

// Signing secret for stateless JWT-style HMAC auth tokens
if (!defined('AUTH_TOKEN_SECRET')) {
    define('AUTH_TOKEN_SECRET', getenv('AUTH_TOKEN_SECRET') ?: hash('sha256', DB_NAME . '|' . DB_USER . '|' . __DIR__));
}

// -----------------------------------------------------------------------------
// 2. Standard JSON & CORS Headers Helper
// -----------------------------------------------------------------------------
function sendJsonHeaders(): void {
    header('Content-Type: application/json; charset=utf-8');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowedOrigins = [
        'https://english-3D.com',
        'https://english-3d.com',
        'https://www.english-3D.com',
        'https://www.english-3d.com',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ];
    if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    } else {
        header('Access-Control-Allow-Origin: *');
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Guest-Token, X-Auth-Token');

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
// 3. PHP Session & Compact HMAC JWT Helpers
// -----------------------------------------------------------------------------
function startPbSession(): void {
    if (session_status() === PHP_SESSION_NONE && !headers_sent()) {
        $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['SERVER_PORT'] ?? '') === '443');
        @session_set_cookie_params([
            'lifetime' => 86400 * 30,
            'path' => '/',
            'secure' => $isHttps,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        @session_start();
    }
}

function base64UrlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string {
    $pad = strlen($data) % 4;
    if ($pad > 0) {
        $data .= str_repeat('=', 4 - $pad);
    }
    $decoded = base64_decode(strtr($data, '-_', '+/'), true);
    return $decoded === false ? '' : $decoded;
}

function createAuthToken(int $userId, bool $isGuest = false, int $ttlSeconds = 2592000): string {
    $header = base64UrlEncode((string) json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $now = time();
    $payload = base64UrlEncode((string) json_encode([
        'uid' => $userId,
        'guest' => $isGuest,
        'iat' => $now,
        'exp' => $now + $ttlSeconds,
    ]));
    $sig = base64UrlEncode(hash_hmac('sha256', "{$header}.{$payload}", AUTH_TOKEN_SECRET, true));
    return "{$header}.{$payload}.{$sig}";
}

/**
 * @return array{uid: int, guest: bool, iat: int, exp: int}|null
 */
function verifyAuthToken(string $token): ?array {
    $parts = explode('.', trim($token));
    if (count($parts) !== 3) {
        return null;
    }
    [$header, $payload, $sig] = $parts;
    $expected = base64UrlEncode(hash_hmac('sha256', "{$header}.{$payload}", AUTH_TOKEN_SECRET, true));
    if (!hash_equals($expected, $sig)) {
        return null;
    }
    $decoded = json_decode(base64UrlDecode($payload), true);
    if (!is_array($decoded) || !isset($decoded['uid']) || !isset($decoded['exp'])) {
        return null;
    }
    if ((int) $decoded['exp'] < time()) {
        return null;
    }
    return [
        'uid' => (int) $decoded['uid'],
        'guest' => (bool) ($decoded['guest'] ?? false),
        'iat' => (int) ($decoded['iat'] ?? 0),
        'exp' => (int) $decoded['exp'],
    ];
}

// -----------------------------------------------------------------------------
// 4. Load Database Bootstrap & Migrations
// -----------------------------------------------------------------------------
if (!defined('PB_DB_LOADING') && !function_exists('getDbConnection')) {
    require_once __DIR__ . '/db.php';
}
