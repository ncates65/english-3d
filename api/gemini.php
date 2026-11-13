<?php
declare(strict_types=1);

/**
 * SpacedPractice AI — Multimodal Gemini Proxy, URL Harvester & AI Recall Grader
 * Endpoint: https://english-3D.com/study/api/gemini.php
 *
 * Uses Gemini 3.8 Flash (`gemini-3.8-flash`, replacing deprecated `gemini-2.5-flash`)
 * via the Interactions API (`/v1beta/interactions`, Api-Revision: 2026-05-20)
 * with Structured Outputs (`response_format` JSON Schema) and Multimodal Inputs.
 */

require_once __DIR__ . '/config.php';
sendJsonHeaders();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    respondJson(['ok' => false, 'error' => 'Method not allowed. Use POST.'], 405);
}

$body = getJsonBody();
$action = $_GET['action'] ?? ($body['action'] ?? '');

// =============================================================================
// Helper 1: Server-Side URL Content Harvester & HTML Cleaner
// =============================================================================
function harvestUrlContent(string $url): array {
    $url = trim($url);
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return ['url' => $url, 'ok' => false, 'title' => $url, 'text' => 'Invalid URL format.'];
    }

    // Transform public Google Docs links to plain-text export URLs automatically
    $fetchUrl = $url;
    if (preg_match('#docs\.google\.com/document/d/([a-zA-Z0-9_-]+)#', $url, $matches)) {
        $fetchUrl = "https://docs.google.com/document/d/{$matches[1]}/export?format=txt";
    }

    $ch = curl_init($fetchUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; SpacedPracticeAI/1.0; +https://english-3D.com/study)',
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $rawHtml = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($rawHtml === false || $httpCode >= 400) {
        return [
            'url' => $url,
            'ok' => false,
            'title' => $url,
            'text' => "Could not fetch URL (HTTP {$httpCode}): {$curlErr}",
        ];
    }

    // Plain text response (e.g., Google Doc export or raw .txt/.md)
    if (stripos($contentType, 'text/plain') !== false || stripos($contentType, 'text/markdown') !== false) {
        $clean = mb_substr(trim((string) $rawHtml), 0, 18000);
        return [
            'url' => $url,
            'ok' => true,
            'title' => basename(parse_url($url, PHP_URL_PATH) ?: $url) ?: $url,
            'text' => $clean,
        ];
    }

    // Extract <title>
    $title = $url;
    if (preg_match('/<title[^>]*>(.*?)<\/title>/is', (string) $rawHtml, $titleMatch)) {
        $title = trim(html_entity_decode(strip_tags($titleMatch[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    // Strip non-content tags
    $cleaned = preg_replace([
        '/<script\b[^>]*>(.*?)<\/script>/is',
        '/<style\b[^>]*>(.*?)<\/style>/is',
        '/<nav\b[^>]*>(.*?)<\/nav>/is',
        '/<footer\b[^>]*>(.*?)<\/footer>/is',
        '/<svg\b[^>]*>(.*?)<\/svg>/is',
        '/<!--(.*?)-->/s',
    ], ' ', (string) $rawHtml);

    $text = strip_tags((string) $cleaned);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\s+/', ' ', $text) ?? '';
    $text = mb_substr(trim($text), 0, 18000);

    return [
        'url' => $url,
        'ok' => true,
        'title' => $title,
        'text' => $text !== '' ? $text : "Fetched page title: {$title}",
    ];
}

// =============================================================================
// Helper 2: Extract Text from Base64 .docx Archive (word/document.xml)
// =============================================================================
function extractDocxTextFromBase64(string $base64Data): string {
    $binary = base64_decode($base64Data, true);
    if ($binary === false || !class_exists('ZipArchive')) {
        return '';
    }
    $tmpFile = tempnam(sys_get_temp_dir(), 'sp_docx_');
    if ($tmpFile === false) {
        return '';
    }
    file_put_contents($tmpFile, $binary);
    $zip = new ZipArchive();
    $extractedText = '';
    if ($zip->open($tmpFile) === true) {
        $xmlIndex = $zip->locateName('word/document.xml');
        if ($xmlIndex !== false) {
            $xmlData = $zip->getFromIndex($xmlIndex);
            if ($xmlData !== false) {
                $xmlData = str_replace(['</w:p>', '</w:tr>'], ["\n", "\n"], $xmlData);
                $extractedText = trim(strip_tags($xmlData));
            }
        }
        $zip->close();
    }
    @unlink($tmpFile);
    return mb_substr($extractedText, 0, 25000);
}

// =============================================================================
// Helper 3: Call Gemini 3.8 Flash Interactions API with Structured Outputs
// =============================================================================
/**
 * @param array<int, array<string, mixed>> $inputContentItems
 * @param array<string, mixed> $jsonSchema
 * @param string $systemInstruction
 * @return array<string, mixed>
 */
function callGeminiStructured(array $inputContentItems, array $jsonSchema, string $systemInstruction): array {
    if (GEMINI_API_KEY === '' || GEMINI_API_KEY === 'REPLACE_WITH_GEMINI_API_KEY') {
        respondJson([
            'ok' => false,
            'error' => 'GEMINI_API_KEY is not configured in api/config.php.',
        ], 503);
    }

    $payload = [
        'model' => GEMINI_MODEL,
        'system_instruction' => $systemInstruction,
        'input' => $inputContentItems,
        'response_format' => [
            'type' => 'text',
            'mime_type' => 'application/json',
            'schema' => $jsonSchema,
        ],
        'generation_config' => [
            'temperature' => 0.25,
        ],
    ];

    $ch = curl_init(GEMINI_INTERACTIONS_ENDPOINT);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 90,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-goog-api-key: ' . GEMINI_API_KEY,
            'Api-Revision: ' . GEMINI_API_REVISION,
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    $rawResponse = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($rawResponse === false) {
        respondJson([
            'ok' => false,
            'error' => 'Failed to reach Gemini Interactions API: ' . $curlErr,
        ], 502);
    }

    $decoded = json_decode((string) $rawResponse, true);
    if ($httpCode >= 400 || !is_array($decoded)) {
        respondJson([
            'ok' => false,
            'error' => 'Gemini API error (HTTP ' . $httpCode . ')',
            'details' => $decoded ?? $rawResponse,
        ], 502);
    }

    // Extract text output from steps[] (new Interactions API schema)
    $outputText = '';
    if (isset($decoded['steps']) && is_array($decoded['steps'])) {
        foreach ($decoded['steps'] as $step) {
            if (($step['type'] ?? '') === 'model_output' && isset($step['content']) && is_array($step['content'])) {
                foreach ($step['content'] as $part) {
                    if (($part['type'] ?? '') === 'text' && isset($part['text'])) {
                        $outputText .= (string) $part['text'];
                    }
                }
            }
        }
    }
    // Fallback if output_text or outputs[] is present
    if ($outputText === '' && isset($decoded['output_text'])) {
        $outputText = (string) $decoded['output_text'];
    }
    if ($outputText === '' && isset($decoded['outputs']) && is_array($decoded['outputs'])) {
        foreach ($decoded['outputs'] as $out) {
            if (($out['type'] ?? '') === 'text' && isset($out['text'])) {
                $outputText .= (string) $out['text'];
            }
        }
    }

    $parsedJson = json_decode(trim($outputText), true);
    if (!is_array($parsedJson)) {
        respondJson([
            'ok' => false,
            'error' => 'Gemini did not return valid structured JSON.',
            'rawOutput' => $outputText,
        ], 502);
    }

    return $parsedJson;
}

// =============================================================================
// Action A: harvest_url — Preview harvested content from a pasted URL
// =============================================================================
if ($action === 'harvest_url') {
    $url = trim((string) ($body['url'] ?? ''));
    if ($url === '') {
        respondJson(['ok' => false, 'error' => 'URL is required.'], 400);
    }
    $harvested = harvestUrlContent($url);
    respondJson($harvested);
}

// =============================================================================
// Action B: generate_plan — Cognitive Scaffolding & Spaced Plan Generation
// =============================================================================
if ($action === 'generate_plan') {
    $topicPrompt = trim((string) ($body['topicPrompt'] ?? ''));
    $urls = is_array($body['urls'] ?? null) ? $body['urls'] : [];
    $files = is_array($body['files'] ?? null) ? $body['files'] : [];
    $scheduledBlueprints = is_array($body['scheduledBlueprints'] ?? null) ? $body['scheduledBlueprints'] : [];
    $startDate = (string) ($body['startDate'] ?? date('Y-m-d'));
    $masterByDate = (string) ($body['masterByDate'] ?? date('Y-m-d', strtotime('+14 days')));
    $userEmail = trim((string) ($body['userEmail'] ?? 'learner@english-3d.com'));
    $saveToDb = (bool) ($body['saveToDb'] ?? false);

    if ($topicPrompt === '' && empty($urls) && empty($files)) {
        respondJson([
            'ok' => false,
            'error' => 'Please provide a study topic, at least one study file, or a source URL.',
        ], 400);
    }

    // 1. Harvest all URLs via server-side cURL
    $harvestedLinks = [];
    $harvestedContextBlocks = [];
    foreach ($urls as $rawUrl) {
        $u = trim((string) $rawUrl);
        if ($u === '') {
            continue;
        }
        $info = harvestUrlContent($u);
        $harvestedLinks[] = [
            'url' => $u,
            'title' => $info['title'],
            'status' => $info['ok'] ? 'harvested' : 'unreachable',
        ];
        if ($info['ok']) {
            $harvestedContextBlocks[] = "=== SOURCE URL: {$u} ({$info['title']}) ===\n{$info['text']}";
        }
    }

    // 2. Build Multimodal Input Array for Gemini 3.8 Flash Interactions API
    $inputItems = [];
    $inlineFileTextBlocks = [];

    foreach ($files as $file) {
        $fileName = (string) ($file['name'] ?? 'uploaded-file');
        $mimeType = strtolower(trim((string) ($file['mimeType'] ?? 'application/octet-stream')));
        $base64Data = (string) ($file['base64Data'] ?? '');

        // Strip data URI prefix if present
        if (str_contains($base64Data, ',')) {
            $parts = explode(',', $base64Data, 2);
            $base64Data = $parts[1];
        }

        if ($base64Data === '') {
            continue;
        }

        if ($mimeType === 'application/pdf') {
            $inputItems[] = [
                'type' => 'document',
                'data' => $base64Data,
                'mime_type' => 'application/pdf',
            ];
        } elseif (str_starts_with($mimeType, 'image/')) {
            $inputItems[] = [
                'type' => 'image',
                'data' => $base64Data,
                'mime_type' => $mimeType,
            ];
        } elseif (
            str_contains($mimeType, 'wordprocessingml') ||
            str_ends_with(strtolower($fileName), '.docx')
        ) {
            $docxText = extractDocxTextFromBase64($base64Data);
            if ($docxText !== '') {
                $inlineFileTextBlocks[] = "=== UPLOADED DOCX ({$fileName}) ===\n{$docxText}";
            }
        } else {
            // Plain text, Markdown, CSV
            $decodedText = base64_decode($base64Data, true);
            if ($decodedText !== false) {
                $inlineFileTextBlocks[] = "=== UPLOADED FILE ({$fileName}) ===\n" . mb_substr($decodedText, 0, 25000);
            }
        }
    }

    // 3. Format the Cepeda et al. (2008) Session Blueprints for the prompt
    $blueprintLines = [];
    foreach ($scheduledBlueprints as $bp) {
        $sNum = (int) ($bp['sessionNumber'] ?? 1);
        $sStage = (string) ($bp['stageName'] ?? 'Active Recall');
        $sDate = (string) ($bp['scheduledDate'] ?? $startDate);
        $sOffset = (int) ($bp['dayOffset'] ?? 0);
        $sGap = (int) ($bp['gapDays'] ?? 0);
        $sGoal = (string) ($bp['cognitiveGoal'] ?? '');
        $blueprintLines[] = "Session {$sNum} | Stage: {$sStage} | Date: {$sDate} (Day {$sOffset}, Gap +{$sGap}d) | Cognitive Goal: {$sGoal}";
    }

    $masterPrompt = "You are a cognitive scientist specializing in Cepeda et al. (2008) optimal spacing intervals, Ebbinghaus decay mitigation, Roediger & Karpicke (2006) testing effect, and the Feynman technique.\n\n"
        . "USER STUDY TOPIC / LEARNING OBJECTIVES:\n"
        . ($topicPrompt !== '' ? $topicPrompt : 'Derive comprehensive learning objectives directly from the attached study files and URLs.') . "\n\n"
        . "TEMPORAL SCHEDULE (Start: {$startDate} -> Master By: {$masterByDate}):\n"
        . implode("\n", $blueprintLines) . "\n\n";

    if (!empty($inlineFileTextBlocks)) {
        $masterPrompt .= "EXTRACTED TEXT FROM UPLOADED FILES:\n" . implode("\n\n", $inlineFileTextBlocks) . "\n\n";
    }
    if (!empty($harvestedContextBlocks)) {
        $masterPrompt .= "HARVESTED WEB SOURCE CONTENT:\n" . implode("\n\n", $harvestedContextBlocks) . "\n\n";
    }

    $masterPrompt .= <<<'INSTRUCTIONS'
CRITICAL PEDAGOGICAL & STRUCTURAL REQUIREMENTS:
1. FORBID PASSIVE RE-READING: Never tell the student to "review notes", "re-read chapter", or "highlight key terms". Every single prompt must require active, effortful, closed-book retrieval or problem-solving.
2. STAGE-SPECIFIC SCAFFOLDING:
   - Session 1 (Day 0 — Initial Encoding & Schema Mapping): Extract 3-5 macro pillars and require the learner to map how they causally or structurally connect.
   - Session 2 (Day 1 — Closed-Book Free Recall): Generate 3 specific brain-dump prompts the learner must answer strictly from memory BEFORE opening any reference material.
   - Session 3 (Elaborative Interrogation): Generate deep "Why does X cause Y?" and "How does mechanism Z operate under constraint W?" questions grounded in the material.
   - Session 4 (Application & Edge Cases): Present 2-3 realistic mini-scenarios, clinical/engineering/domain edge cases, or diagnostic problems to solve unassisted.
   - Session 5+ (Interleaved Synthesis, if scheduled): Cross-connect disparate subtopics and test rapid cue-to-concept discrimination.
   - Final Session (Day T-1 or Day T — Mastery Verification / Feynman Teach-Back): Provide a rigorous Feynman Teach-Back challenge and a verification rubric checklist of core concepts the user must explain from scratch without jargon as if teaching an intelligent novice.
3. EXTRACTED SOURCE DIGEST (`extractedSourceDigest`):
   Write an exhaustive, authoritative, well-structured 1,000 to 2,000 word reference digest synthesizing all definitions, mechanisms, formulas, arguments, and examples from the uploaded files, harvested URLs, and study topic. This digest will be stored in `study_plans.extracted_context_cache` so future AI quiz-grading sessions can evaluate the student's closed-book recall with 100% factual accuracy without re-uploading files.
4. Generate exactly one session entry in `sessions` matching each session number in the provided TEMPORAL SCHEDULE.
INSTRUCTIONS;

    $inputItems[] = [
        'type' => 'text',
        'text' => $masterPrompt,
    ];

    // 4. Define Structured Output JSON Schema
    $planSchema = [
        'type' => 'object',
        'properties' => [
            'topicTitle' => [
                'type' => 'string',
                'description' => 'Concise, specific title for the study plan.',
            ],
            'executiveSummary' => [
                'type' => 'string',
                'description' => '2-4 sentence executive synthesis of the domain and mastery target.',
            ],
            'coreConcepts' => [
                'type' => 'array',
                'description' => '3 to 6 macro conceptual pillars that anchor the domain schema.',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string'],
                        'title' => ['type' => 'string'],
                        'summary' => ['type' => 'string'],
                        'connections' => [
                            'type' => 'string',
                            'description' => 'How this pillar causally or structurally connects to the other pillars.',
                        ],
                    ],
                    'required' => ['id', 'title', 'summary', 'connections'],
                ],
            ],
            'extractedSourceDigest' => [
                'type' => 'string',
                'description' => 'Comprehensive 1,000-2,000 word structured reference digest of the source material for future AI grading.',
            ],
            'sessions' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'sessionNumber' => ['type' => 'integer'],
                        'stageName' => ['type' => 'string'],
                        'cognitiveGoal' => ['type' => 'string'],
                        'prompts' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => '3 to 4 material-grounded closed-book active-recall prompts or scenarios.',
                        ],
                        'verificationChecklist' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => '4 to 6 specific factual/conceptual criteria required for full mastery credit.',
                        ],
                    ],
                    'required' => ['sessionNumber', 'stageName', 'cognitiveGoal', 'prompts', 'verificationChecklist'],
                ],
            ],
        ],
        'required' => ['topicTitle', 'executiveSummary', 'coreConcepts', 'extractedSourceDigest', 'sessions'],
    ];

    $systemInstruction = 'You are Practice Buddy, an expert cognitive science curriculum architect and retrieval-practice designer. Always respond with valid JSON matching the requested schema.';

    $generated = callGeminiStructured($inputItems, $planSchema, $systemInstruction);

    // Merge generated session prompts with the exact Cepeda spacing dates
    $mergedSessions = [];
    $genSessionsByNum = [];
    foreach (($generated['sessions'] ?? []) as $gs) {
        $genSessionsByNum[(int) ($gs['sessionNumber'] ?? 0)] = $gs;
    }

    foreach ($scheduledBlueprints as $idx => $bp) {
        $num = (int) ($bp['sessionNumber'] ?? ($idx + 1));
        $gs = $genSessionsByNum[$num] ?? ($generated['sessions'][$idx] ?? []);
        $mergedSessions[] = [
            'sessionNumber' => $num,
            'stageName' => (string) ($gs['stageName'] ?? $bp['stageName'] ?? "Session {$num}"),
            'scheduledDate' => (string) ($bp['scheduledDate'] ?? $startDate),
            'dayOffset' => (int) ($bp['dayOffset'] ?? 0),
            'gapDays' => (int) ($bp['gapDays'] ?? 0),
            'cognitiveGoal' => (string) ($gs['cognitiveGoal'] ?? $bp['cognitiveGoal'] ?? ''),
            'prompts' => is_array($gs['prompts'] ?? null) ? $gs['prompts'] : [],
            'verificationChecklist' => is_array($gs['verificationChecklist'] ?? null) ? $gs['verificationChecklist'] : [],
            'status' => 'pending',
            'masteryScore' => null,
            'calendarEventId' => null,
            'completedAt' => null,
            'attempts' => [],
        ];
    }

    $resultPlan = [
        'userEmail' => $userEmail,
        'topicTitle' => (string) ($generated['topicTitle'] ?? 'Spaced Study Plan'),
        'executiveSummary' => (string) ($generated['executiveSummary'] ?? ''),
        'coreConcepts' => is_array($generated['coreConcepts'] ?? null) ? $generated['coreConcepts'] : [],
        'sourceLinks' => $harvestedLinks,
        'extractedContextCache' => (string) ($generated['extractedSourceDigest'] ?? ''),
        'startDate' => $startDate,
        'masterByDate' => $masterByDate,
        'sessions' => $mergedSessions,
    ];

    // Optionally persist directly to MySQL if requested
    if ($saveToDb) {
        try {
            $pdo = getDbConnection();
            $pdo->beginTransaction();

            $planStmt = $pdo->prepare(
                'INSERT INTO study_plans
                (user_email, topic_title, executive_summary, core_concepts_json, source_links_json, extracted_context_cache, start_date, master_by_date)
                VALUES (:user_email, :topic_title, :executive_summary, :core_concepts_json, :source_links_json, :extracted_context_cache, :start_date, :master_by_date)'
            );
            $planStmt->execute([
                ':user_email' => $resultPlan['userEmail'],
                ':topic_title' => $resultPlan['topicTitle'],
                ':executive_summary' => $resultPlan['executiveSummary'],
                ':core_concepts_json' => json_encode($resultPlan['coreConcepts'], JSON_UNESCAPED_UNICODE),
                ':source_links_json' => json_encode($resultPlan['sourceLinks'], JSON_UNESCAPED_UNICODE),
                ':extracted_context_cache' => $resultPlan['extractedContextCache'],
                ':start_date' => $resultPlan['startDate'],
                ':master_by_date' => $resultPlan['masterByDate'],
            ]);

            $planId = (int) $pdo->lastInsertId();
            $resultPlan['id'] = $planId;
            $resultPlan['createdAt'] = date('Y-m-d H:i:s');

            $sessionStmt = $pdo->prepare(
                'INSERT INTO study_sessions
                (plan_id, session_number, stage_name, scheduled_date, day_offset, gap_days, cognitive_goal, prompts_json, verification_checklist_json, status)
                VALUES (:plan_id, :session_number, :stage_name, :scheduled_date, :day_offset, :gap_days, :cognitive_goal, :prompts_json, :verification_checklist_json, :status)'
            );

            foreach ($resultPlan['sessions'] as $i => $sess) {
                $sessionStmt->execute([
                    ':plan_id' => $planId,
                    ':session_number' => $sess['sessionNumber'],
                    ':stage_name' => $sess['stageName'],
                    ':scheduled_date' => $sess['scheduledDate'],
                    ':day_offset' => $sess['dayOffset'],
                    ':gap_days' => $sess['gapDays'],
                    ':cognitive_goal' => $sess['cognitiveGoal'],
                    ':prompts_json' => json_encode($sess['prompts'], JSON_UNESCAPED_UNICODE),
                    ':verification_checklist_json' => json_encode($sess['verificationChecklist'], JSON_UNESCAPED_UNICODE),
                    ':status' => 'pending',
                ]);
                $resultPlan['sessions'][$i]['id'] = (int) $pdo->lastInsertId();
                $resultPlan['sessions'][$i]['planId'] = $planId;
            }

            $pdo->commit();
        } catch (Throwable $dbErr) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $resultPlan['dbWarning'] = 'Generated plan successfully, but MySQL persistence failed: ' . $dbErr->getMessage();
        }
    }

    respondJson([
        'ok' => true,
        'modelUsed' => GEMINI_MODEL,
        'plan' => $resultPlan,
    ]);
}

// =============================================================================
// Action C: grade_recall — AI Rubric Grader for Closed-Book Active Recall
// =============================================================================
if ($action === 'grade_recall') {
    $sessionId = (int) ($body['sessionId'] ?? 0);
    $userResponseText = trim((string) ($body['userResponseText'] ?? ''));

    if ($userResponseText === '') {
        respondJson(['ok' => false, 'error' => 'userResponseText cannot be empty.'], 400);
    }

    // Load session prompts, checklist, and plan's extracted_context_cache from MySQL if available
    $stageName = (string) ($body['stageName'] ?? 'Active Recall Session');
    $cognitiveGoal = (string) ($body['cognitiveGoal'] ?? '');
    $prompts = is_array($body['prompts'] ?? null) ? $body['prompts'] : [];
    $verificationChecklist = is_array($body['verificationChecklist'] ?? null) ? $body['verificationChecklist'] : [];
    $extractedContextCache = (string) ($body['extractedContextCache'] ?? '');
    $topicTitle = (string) ($body['topicTitle'] ?? '');

    $pdo = null;
    if ($sessionId > 0) {
        try {
            $pdo = getDbConnection();
            $stmt = $pdo->prepare(
                'SELECT s.*, p.topic_title, p.extracted_context_cache
                 FROM study_sessions s
                 INNER JOIN study_plans p ON p.id = s.plan_id
                 WHERE s.id = :id LIMIT 1'
            );
            $stmt->execute([':id' => $sessionId]);
            $row = $stmt->fetch();
            if ($row) {
                $stageName = (string) $row['stage_name'];
                $cognitiveGoal = (string) $row['cognitive_goal'];
                $prompts = json_decode((string) $row['prompts_json'], true) ?: $prompts;
                $verificationChecklist = json_decode((string) $row['verification_checklist_json'], true) ?: $verificationChecklist;
                $extractedContextCache = (string) $row['extracted_context_cache'];
                $topicTitle = (string) $row['topic_title'];
            }
        } catch (Throwable) {
            // Continue with request payload context if DB is offline in local dev
        }
    }

    $gradingPrompt = "STUDY TOPIC: {$topicTitle}\n"
        . "SESSION STAGE: {$stageName}\n"
        . "COGNITIVE GOAL: {$cognitiveGoal}\n\n"
        . "ASSIGNED CLOSED-BOOK ACTIVE-RECALL PROMPTS:\n"
        . implode("\n- ", array_merge([''], $prompts)) . "\n\n"
        . "VERIFICATION RUBRIC CHECKLIST:\n"
        . implode("\n- ", array_merge([''], $verificationChecklist)) . "\n\n"
        . "AUTHORITATIVE SOURCE MATERIAL DIGEST (`extracted_context_cache`):\n"
        . ($extractedContextCache !== '' ? $extractedContextCache : 'Evaluate against domain consensus for the topic.') . "\n\n"
        . "LEARNER'S CLOSED-BOOK RESPONSE:\n"
        . $userResponseText . "\n\n"
        . "Evaluate the learner's response strictly against the assigned prompts, the verification checklist, and the source material digest. "
        . "Set `recommendAdaptiveExtraSession` to true if `masteryScore` < 70 or if foundational causal mechanisms were misunderstood.";

    $gradingSchema = [
        'type' => 'object',
        'properties' => [
            'masteryScore' => [
                'type' => 'integer',
                'description' => 'Score from 0 to 100 reflecting conceptual accuracy, depth, and completeness.',
            ],
            'accuratePoints' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
                'description' => 'Specific concepts, mechanisms, or distinctions the learner retrieved accurately.',
            ],
            'missedOrInaccurateConcepts' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
                'description' => 'Specific rubric points or nuances that were omitted, vague, or factually inaccurate.',
            ],
            'coachFeedback' => [
                'type' => 'string',
                'description' => 'Constructive, rigorous corrective synthesis explaining how to bridge the missed concepts.',
            ],
            'socraticFollowUpQuestion' => [
                'type' => 'string',
                'description' => 'One targeted Socratic question that forces the learner to resolve their biggest conceptual gap right now.',
            ],
            'recommendAdaptiveExtraSession' => [
                'type' => 'boolean',
                'description' => 'True if masteryScore < 70 or critical mechanisms are unstable.',
            ],
        ],
        'required' => [
            'masteryScore',
            'accuratePoints',
            'missedOrInaccurateConcepts',
            'coachFeedback',
            'socraticFollowUpQuestion',
            'recommendAdaptiveExtraSession',
        ],
    ];

    $systemInstruction = 'You are an expert cognitive-science tutor and Feynman Teach-Back evaluator. Grade active-recall attempts with rigorous precision, encouraging tone, and high factual fidelity.';

    $evaluation = callGeminiStructured(
        [['type' => 'text', 'text' => $gradingPrompt]],
        $gradingSchema,
        $systemInstruction
    );

    $score = max(0, min(100, (int) ($evaluation['masteryScore'] ?? 0)));
    $accuratePoints = is_array($evaluation['accuratePoints'] ?? null) ? $evaluation['accuratePoints'] : [];
    $missedConcepts = is_array($evaluation['missedOrInaccurateConcepts'] ?? null) ? $evaluation['missedOrInaccurateConcepts'] : [];
    $coachFeedback = (string) ($evaluation['coachFeedback'] ?? '');
    $socraticQuestion = (string) ($evaluation['socraticFollowUpQuestion'] ?? '');
    $recommendExtra = (bool) ($evaluation['recommendAdaptiveExtraSession'] ?? ($score < 70));
    if ($score < 70) {
        $recommendExtra = true;
    }

    $attemptId = null;
    $completedAt = date('Y-m-d H:i:s');

    if ($pdo instanceof PDO && $sessionId > 0) {
        try {
            $pdo->beginTransaction();

            $attStmt = $pdo->prepare(
                'INSERT INTO recall_attempts
                (session_id, user_response_text, ai_score, strengths_json, missing_concepts_json, corrective_feedback, follow_up_question)
                VALUES (:session_id, :user_response_text, :ai_score, :strengths_json, :missing_concepts_json, :corrective_feedback, :follow_up_question)'
            );
            $attStmt->execute([
                ':session_id' => $sessionId,
                ':user_response_text' => $userResponseText,
                ':ai_score' => $score,
                ':strengths_json' => json_encode($accuratePoints, JSON_UNESCAPED_UNICODE),
                ':missing_concepts_json' => json_encode($missedConcepts, JSON_UNESCAPED_UNICODE),
                ':corrective_feedback' => $coachFeedback,
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
        } catch (Throwable) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
        }
    }

    respondJson([
        'ok' => true,
        'modelUsed' => GEMINI_MODEL,
        'attemptId' => $attemptId,
        'completedAt' => $completedAt,
        'evaluation' => [
            'masteryScore' => $score,
            'accuratePoints' => $accuratePoints,
            'missedOrInaccurateConcepts' => $missedConcepts,
            'coachFeedback' => $coachFeedback,
            'socraticFollowUpQuestion' => $socraticQuestion,
            'recommendAdaptiveExtraSession' => $recommendExtra,
        ],
    ]);
}

respondJson(['ok' => false, 'error' => "Unsupported action: {$action}"], 400);

