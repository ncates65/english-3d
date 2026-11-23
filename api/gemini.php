<?php
declare(strict_types=1);

/**
 * Practice Buddy ("PB") — Multimodal Gemini Proxy, URL Harvester & Stage-Aware Recall Grader
 * Endpoint: https://english-3d.com/study/api/gemini.php
 *
 * Uses Gemini 3.8 Flash (`gemini-3.8-flash`)
 * via the Interactions API (`/v1beta/interactions`, Api-Revision: 2026-05-20)
 * with Structured Outputs (`response_format` JSON Schema) and Multimodal Inputs.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/spacing_helpers.php';
sendJsonHeaders();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    respondJson(['ok' => false, 'error' => 'Method not allowed. Use POST.'], 405);
}

$body = getJsonBody();
$action = (string) ($_GET['action'] ?? ($body['action'] ?? ''));

function normalizeGeminiStageName(string $stageName): string {
    return pbNormalizeStageLabel($stageName);
}

function resolveStageNumFromContext(int $explicitStage, string $stageName, int $sessionNum, string $stageKey = ''): int {
    if ($explicitStage >= 1 && $explicitStage <= 5) {
        return $explicitStage;
    }
    return pbInferStageNumber($stageName, $sessionNum, $stageKey);
}

function getStageThinkingRequirement(int $stageNumber): string {
    return match ($stageNumber) {
        1 => 'Stage 1 (Schema Mapping): Learner must organize high-level structure, categorize main pillars, and trace how core components connect.',
        2 => 'Stage 2 (Closed-Book Free Recall): Learner must retrieve foundational definitions, key terms, and core facts accurately from memory without notes.',
        3 => 'Stage 3 (Elaborative Interrogation): Learner must explain WHY mechanisms work, HOW one step causes another, and contrast closely related concepts—surface definitions alone are insufficient.',
        4 => 'Stage 4 (Application & Edge Cases): Learner must diagnose concrete scenarios or boundary conditions, predict outcomes when variables change, and justify a solution.',
        default => 'Stage 5 (Mastery Verification): Learner must synthesize the entire topic fluently, rigorously, and with zero conceptual gaps as if teaching an intelligent peer.',
    };
}

/**
 * Normalize raw prompts array (either strings or {prompt_text, chunk_tag?, expected_rubric_points})
 * into consistent `prompts` (string[]) and `promptItems` (structured array).
 *
 * @return array{prompts: array<int, string>, promptItems: array<int, array<string, mixed>>}
 */
function normalizeSessionPromptItems(mixed $rawPrompts): array {
    return unpackPromptsPayload($rawPrompts);
}

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
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; PracticeBuddy/1.0; +https://english-3d.com/study)',
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
 * @return array{ok: bool, data?: array<string, mixed>, error?: string}
 */
function callGeminiStructured(array $inputContentItems, array $jsonSchema, string $systemInstruction): array {
    if (GEMINI_API_KEY === '' || GEMINI_API_KEY === 'REPLACE_WITH_GEMINI_API_KEY') {
        return [
            'ok' => false,
            'error' => 'GEMINI_API_KEY is not configured in api/config.php.',
        ];
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
        CURLOPT_TIMEOUT        => 45,
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
        return [
            'ok' => false,
            'error' => 'Failed to reach Gemini Interactions API: ' . $curlErr,
        ];
    }

    $decoded = json_decode((string) $rawResponse, true);
    if ($httpCode >= 400 || !is_array($decoded)) {
        $apiErrMsg = '';
        if (is_array($decoded) && isset($decoded['error']['message'])) {
            $apiErrMsg = ': ' . (string) $decoded['error']['message'];
        }
        return [
            'ok' => false,
            'error' => 'Gemini API error (HTTP ' . $httpCode . ')' . $apiErrMsg,
        ];
    }

    // Extract text output from steps[] (current Interactions API schema)
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

    $cleanOutput = trim($outputText);
    if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/is', $cleanOutput, $fenceMatch)) {
        $cleanOutput = trim($fenceMatch[1]);
    }

    $parsedJson = json_decode($cleanOutput, true);
    if (!is_array($parsedJson)) {
        return [
            'ok' => false,
            'error' => 'Gemini did not return valid structured JSON.',
        ];
    }

    return [
        'ok' => true,
        'data' => $parsedJson,
    ];
}

// =============================================================================
// Helper 4: Stage-Specific Server Fallbacks
// =============================================================================
/**
 * @return array<int, array<string, mixed>>
 */
function buildStageFallbackPrompts(
    int $stageNumber,
    string $cleanTitle,
    string $subAngle = '',
    string $primaryTag = 'Full Topic',
    string $focusLabel = '',
    string $reviewTag = ''
): array {
    $scopeName = $focusLabel !== '' ? "{$cleanTitle} ({$focusLabel})" : $cleanTitle;

    $items = match ($stageNumber) {
        1 => [
            [
                'prompt_text' => "Map the macro architecture of \"{$scopeName}\": list the 3–5 primary categories or pillars and explain how each pillar feeds into or constrains the others.",
                'chunk_tag' => $primaryTag,
                'expected_rubric_points' => [
                    "Identifies 3–5 distinct macro pillars of {$scopeName}",
                    'Explicitly describes structural or sequential relationships between pillars',
                    'Maintains high-level conceptual organization without getting bogged down in isolated trivia',
                ],
            ],
            [
                'prompt_text' => "Trace the end-to-end workflow or hierarchy of \"{$scopeName}\", identifying where key inputs enter and where major outputs or state changes occur.",
                'chunk_tag' => $primaryTag,
                'expected_rubric_points' => [
                    'Identifies primary inputs, transformations, and outputs',
                    'Establishes clear boundaries for each major component',
                    'Explains how components depend on one another',
                ],
            ],
        ],
        2 => [
            [
                'prompt_text' => "Closed-Book Definition & Term Recall: List and define the core terminology, key variables, and foundational rules of \"{$scopeName}\" strictly from memory.",
                'chunk_tag' => $primaryTag,
                'expected_rubric_points' => [
                    "Accurately defines primary terms and rules of {$scopeName}",
                    'Avoids vague placeholders or circular definitions',
                    'Retrieves essential foundational facts without consulting notes',
                ],
            ],
            [
                'prompt_text' => "Fact Retrieval Sweep: Write down every key formula, threshold, sequence step, or governing rule in \"{$cleanTitle}\" that you can recall unassisted.",
                'chunk_tag' => $reviewTag !== '' ? $reviewTag : $primaryTag,
                'expected_rubric_points' => [
                    'Recalls exact steps or components in proper order',
                    'Identifies critical quantitative or structural constraints',
                    'Distinguishes core principles from secondary details',
                ],
            ],
        ],
        3 => [
            [
                'prompt_text' => $subAngle === 'spot_misconception'
                    ? "Spot & Correct the Misconception: Identify a common conceptual trap in \"{$scopeName}\" and prove why the naive intuition fails mechanically."
                    : "Why & How Causal Interrogation: Explain WHY the primary mechanism in \"{$scopeName}\" works the way it does and HOW one step directly drives the next.",
                'chunk_tag' => $primaryTag,
                'expected_rubric_points' => [
                    'Explains causal why/how mechanisms rather than merely restating definitions',
                    'Traces step-by-step cause-and-effect chains',
                    'Links mechanism behavior to underlying principles',
                ],
            ],
            [
                'prompt_text' => "Compare & Contrast: Select two closely related concepts or modes within \"{$cleanTitle}\" and explain why they behave differently and when each applies.",
                'chunk_tag' => $reviewTag !== '' ? $reviewTag : $primaryTag,
                'expected_rubric_points' => [
                    'Contrasts two related concepts on concrete mechanistic criteria',
                    'Explains why the differences matter functionally',
                    'Identifies conditions that favor one over the other',
                ],
            ],
        ],
        4 => [
            [
                'prompt_text' => $subAngle === 'boundary_test'
                    ? "Boundary Stress-Test: Push a core variable or assumption in \"{$scopeName}\" to an extreme limit and predict exactly where and why the standard model breaks down."
                    : "Diagnostic Scenario: Imagine a key input, constraint, or component in \"{$scopeName}\" fails or shifts abruptly. Diagnose what breaks downstream and predict the outcome.",
                'chunk_tag' => $primaryTag,
                'expected_rubric_points' => [
                    'Accurately diagnoses the root cause of the breakdown',
                    'Predicts downstream system or conceptual consequences',
                    'Justifies the prediction using core domain rules',
                ],
            ],
            [
                'prompt_text' => $subAngle === 'feynman_teachback'
                    ? "Applied Teach-Back: Explain how you would apply \"{$cleanTitle}\" to solve a messy real-world case for a colleague who keeps confusing surface rules with underlying causes."
                    : "Applied Problem-Solving: Design or evaluate a concrete real-world solution using the principles of \"{$cleanTitle}\", explaining your reasoning step by step.",
                'chunk_tag' => $reviewTag !== '' ? $reviewTag : $primaryTag,
                'expected_rubric_points' => [
                    'Applies principles correctly to a novel scenario',
                    'Addresses relevant constraints and edge cases',
                    'Defends the chosen solution logically',
                ],
            ],
        ],
        default => [
            [
                'prompt_text' => "Comprehensive Mastery Synthesis: Teach \"{$cleanTitle}\" from first principles to an intelligent peer—connecting the structural map, causal mechanisms, and real-world edge cases into one cohesive explanation.",
                'chunk_tag' => $primaryTag,
                'expected_rubric_points' => [
                    'Synthesizes macro architecture, foundational rules, and causal links smoothly',
                    'Explains complex ideas in clear, jargon-free language',
                    'Integrates edge cases and failure modes with zero major gaps',
                ],
            ],
            [
                'prompt_text' => "Self-Audit & Boundary Synthesis: Identify the single trickiest interaction or common misconception in \"{$cleanTitle}\" and prove why the correct model holds.",
                'chunk_tag' => $reviewTag !== '' ? $reviewTag : $primaryTag,
                'expected_rubric_points' => [
                    'Pinpoints subtle nuances or common misconceptions',
                    'Demonstrates deep, exam-ready conceptual precision',
                    'Connects across multiple subtopics seamlessly',
                ],
            ],
        ],
    };

    return $items;
}

function buildServerFallbackPlan(
    string $topicPrompt,
    array $inlineFileTextBlocks,
    array $harvestedContextBlocks,
    array $harvestedLinks,
    array $scheduledBlueprints,
    string $startDate,
    string $masterByDate,
    int $studyWindowMinutes = 30,
    int $wordCount = 0,
    ?array $existingBlueprint = null
): array {
    $cleanTitle = '';
    if (is_array($existingBlueprint) && !empty($existingBlueprint['topicTitle'])) {
        $cleanTitle = trim((string) $existingBlueprint['topicTitle']);
    }
    if ($cleanTitle === '' && $topicPrompt !== '') {
        $parts = preg_split('/[.\r\n]/', $topicPrompt);
        $cleanTitle = trim((string) ($parts[0] ?? ''));
    }
    if ($cleanTitle === '' && !empty($harvestedLinks)) {
        $cleanTitle = trim((string) ($harvestedLinks[0]['title'] ?? ''));
    }
    if ($cleanTitle === '') {
        $cleanTitle = 'Custom Spaced Mastery Plan';
    }
    $cleanTitle = mb_substr($cleanTitle, 0, 85);

    $digestSections = [];
    if ($topicPrompt !== '') {
        $digestSections[] = "STUDY FOCUS & OBJECTIVES:\n{$topicPrompt}";
    }
    if (!empty($inlineFileTextBlocks)) {
        $digestSections[] = "EXTRACTED FILE CONTENTS:\n" . implode("\n\n", $inlineFileTextBlocks);
    }
    if (!empty($harvestedContextBlocks)) {
        $digestSections[] = "HARVESTED WEB SOURCES:\n" . implode("\n\n", $harvestedContextBlocks);
    }
    if (empty($digestSections)) {
        $digestSections[] = "Study topic: {$cleanTitle}";
    }

    $coreConcepts = is_array($existingBlueprint['coreConcepts'] ?? null) && !empty($existingBlueprint['coreConcepts'])
        ? $existingBlueprint['coreConcepts']
        : [
            [
                'id' => 'c1',
                'title' => "Foundational Architecture of {$cleanTitle}",
                'summary' => "Defines the primary boundaries, governing principles, and first-principles definitions for {$cleanTitle}.",
                'connections' => 'Serves as the structural anchor for causal mechanisms in Pillar 2 and real-world diagnostics in Pillar 3.',
            ],
            [
                'id' => 'c2',
                'title' => 'Causal Mechanisms & Dynamic Interactions',
                'summary' => 'Traces how state transitions, inputs, and feedback loops operate across the system.',
                'connections' => 'Connects foundational definitions to edge-case behavior under stress or boundary constraints.',
            ],
            [
                'id' => 'c3',
                'title' => 'Diagnostic Application & Boundary Failure Modes',
                'summary' => 'Evaluates how to diagnose breakdowns, distinguish look-alike concepts, and apply rules to novel problems.',
                'connections' => 'Tested directly in Stage 4 Application scenarios and the Stage 5 Mastery Verification synthesis.',
            ],
        ];

    $conceptClusters = is_array($existingBlueprint['conceptClusters'] ?? null) && !empty($existingBlueprint['conceptClusters'])
        ? $existingBlueprint['conceptClusters']
        : array_map(static fn(array $c, int $i) => [
            'cluster_id' => 'cluster-' . ($i + 1),
            'title' => (string) ($c['title'] ?? 'Concept Cluster'),
            'key_concepts' => [trim((string) ($c['title'] ?? ''))],
        ], $coreConcepts, array_keys($coreConcepts));

    $estimatedMinutes = is_array($existingBlueprint) && isset($existingBlueprint['estimatedFirstPassMinutes'])
        ? max(5, (int) $existingBlueprint['estimatedFirstPassMinutes'])
        : max(20, (int) round(max(100, $wordCount) / 80));

    $blueprint = $existingBlueprint ?: [
        'topicTitle' => $cleanTitle,
        'executiveSummary' => "Evidence-based spaced retrieval plan for \"{$cleanTitle}\" spanning {$startDate} to {$masterByDate} (" . count($scheduledBlueprints) . " Cepeda-optimal sessions).",
        'estimatedFirstPassMinutes' => $estimatedMinutes,
        'learningObjectives' => [
            "Map the structural categories and core boundaries of {$cleanTitle}.",
            "Retrieve key terms, definitions, and mechanisms from memory without notes.",
            "Diagnose boundary conditions and synthesize {$cleanTitle} in plain language.",
        ],
        'coreConcepts' => $coreConcepts,
        'conceptClusters' => $conceptClusters,
        'relationships' => [
            'Foundational definitions govern downstream causal mechanisms.',
            'Boundary conditions reveal where simplified rules break down.',
        ],
        'misconceptionsOrTraps' => [
            "Confusing surface terminology of {$cleanTitle} with underlying causal mechanisms.",
        ],
        'extractedSourceDigest' => implode("\n\n", $digestSections),
    ];

    $sessionCount = max(1, count($scheduledBlueprints));
    $modeRouting = selectStudyMode($sessionCount, $studyWindowMinutes, $wordCount, $conceptClusters, $estimatedMinutes);
    $studyMode = $modeRouting['mode'];
    $targetChunkCount = $modeRouting['target_chunk_count'];
    $skeleton = buildStageSkeleton($sessionCount);
    $chunkScopes = assignSpiralChunkScopes($sessionCount, $studyMode, $targetChunkCount);
    $chunkModules = buildChunkModulesFromClusters($conceptClusters, $targetChunkCount);

    $sessions = [];
    foreach ($scheduledBlueprints as $idx => $bp) {
        $num = (int) ($bp['sessionNumber'] ?? ($idx + 1));
        $skel = $skeleton[$idx] ?? $skeleton[count($skeleton) - 1];
        $scope = $chunkScopes[$idx] ?? null;

        $primaryTag = 'Full Topic';
        $reviewTag = '';
        $focusLabel = '';
        if ($studyMode === 'spiral_chunking' && is_array($scope)) {
            if (!empty($scope['new'])) {
                $newLabel = (string) $scope['new'][0];
                $primaryTag = "New: Chunk {$newLabel}";
                $focusLabel = $chunkModules[$newLabel]['title'] ?? "Module {$newLabel}";
            } elseif (!empty($scope['review'])) {
                $revFirst = (string) $scope['review'][0];
                $primaryTag = $revFirst === 'ALL' ? 'Full Topic' : ('Review: Chunk ' . implode(' & ', $scope['review']));
            }
            if (!empty($scope['review'])) {
                $revList = $scope['review'];
                $reviewTag = $revList[0] === 'ALL'
                    ? 'Full Topic'
                    : 'Review: Chunk ' . (string) $revList[0];
            }
        }

        $promptItems = buildStageFallbackPrompts(
            $skel['stage_number'],
            $cleanTitle,
            $skel['sub_angle'],
            $primaryTag,
            $focusLabel,
            $reviewTag
        );

        $checklist = [];
        foreach ($promptItems as $pi) {
            foreach ($pi['expected_rubric_points'] as $rp) {
                $checklist[] = $rp;
            }
        }

        $continuityHook = $idx === 0
            ? ''
            : "Building directly on your Session #{$idx} recall, this session shifts to {$skel['stage_name']}.";

        $sessions[] = [
            'sessionNumber' => $num,
            'stageNumber' => $skel['stage_number'],
            'stageKey' => $skel['stage_key'],
            'stageName' => $skel['stage_name'],
            'cognitiveGoal' => $skel['cognitive_goal'],
            'chunkScope' => $scope,
            'continuityHook' => $continuityHook,
            'prompts' => $promptItems,
            'verificationChecklist' => array_slice(array_values(array_unique($checklist)), 0, 6),
        ];
    }

    return [
        'topicTitle' => $cleanTitle,
        'studyMode' => $studyMode,
        'targetChunkCount' => $targetChunkCount,
        'studyWindowMinutes' => $studyWindowMinutes,
        'executiveSummary' => (string) ($blueprint['executiveSummary'] ?? ''),
        'coreConcepts' => $coreConcepts,
        'blueprint' => $blueprint,
        'extractedSourceDigest' => (string) ($blueprint['extractedSourceDigest'] ?? implode("\n\n", $digestSections)),
        'sessions' => $sessions,
    ];
}

/**
 * @param string $topicTitle
 * @param int $stageNumber
 * @param string $stageName
 * @param array<int, string> $rubricPoints
 * @param string $userResponseText
 * @return array<string, mixed>
 */
function evaluateServerFallbackRecall(
    string $topicTitle,
    int $stageNumber,
    string $stageName,
    array $rubricPoints,
    string $userResponseText
): array {
    $normalized = mb_strtolower($userResponseText);
    $words = preg_split('/\s+/', trim($userResponseText)) ?: [];
    $wordCount = count(array_filter($words, static fn($w) => $w !== ''));

    $stopwords = ['that', 'this', 'with', 'from', 'into', 'correctly', 'explains', 'describes', 'identifies', 'states', 'between', 'without'];
    $whatYouNailed = [];
    $missingToReview = [];

    foreach ($rubricPoints as $criterion) {
        $cleanCrit = preg_replace('/[^a-z0-9\s-]/', ' ', mb_strtolower((string) $criterion)) ?? '';
        $critWords = preg_split('/\s+/', $cleanCrit) ?: [];
        $keywords = array_values(array_filter($critWords, static function ($w) use ($stopwords) {
            return strlen($w) >= 4 && !in_array($w, $stopwords, true);
        }));

        $matched = 0;
        foreach ($keywords as $kw) {
            if (str_contains($normalized, $kw)) {
                $matched++;
            }
        }
        $ratio = count($keywords) > 0 ? ($matched / count($keywords)) : 0.0;

        if ($ratio >= 0.30 && $wordCount >= 15) {
            $whatYouNailed[] = $criterion;
        } else {
            $missingToReview[] = $criterion;
        }
    }

    // Stage-specific cognitive check heuristic
    $hasCausalMarkers = (bool) preg_match('/\b(because|therefore|causes?|leads? to|results? in|mechanism|whereas|unlike|if|when)\b/i', $userResponseText);
    $hasStructuralMarkers = (bool) preg_match('/\b(category|pillars?|components?|stages?|connects?|links?|pipeline|hierarchy|first|second)\b/i', $userResponseText);
    $hasScenarioMarkers = (bool) preg_match('/\b(diagnos|predict|scenario|edge case|fail|disrupt|solution|outcome)\b/i', $userResponseText);

    $cognitiveStageCheck = match ($stageNumber) {
        1 => $hasStructuralMarkers
            ? 'Stage 1 Check Passed: You organized the high-level categories and structural links between components.'
            : 'Stage 1 Check: Your response lists details, but try zooming out to explicitly group the main categories and map how each component connects.',
        2 => $wordCount >= 25
            ? 'Stage 2 Check Passed: You engaged in unassisted free recall from memory without relying on surface cues.'
            : 'Stage 2 Check: Push for deeper unassisted retrieval—write out complete definitions and key terms directly from memory before unlocking notes.',
        3 => $hasCausalMarkers
            ? 'Stage 3 Check Passed: You explained causal "why" and "how" relationships rather than stopping at surface definitions.'
            : 'Stage 3 Check: Watch out for stopping at "what" definitions. In Elaborative Interrogation, explicitly explain WHY each mechanism works and HOW one step drives the next.',
        4 => $hasScenarioMarkers || $hasCausalMarkers
            ? 'Stage 4 Check Passed: You applied core principles to diagnose behavior and reason through conditions.'
            : 'Stage 4 Check: Make sure to trace the concrete scenario step-by-step—diagnose what fails, predict variable changes, and justify your solution.',
        default => $wordCount >= 40 && $hasCausalMarkers
            ? 'Stage 5 Check Passed: You delivered an integrated, peer-ready synthesis linking core principles and nuances.'
            : 'Stage 5 Check: Aim for a fuller, self-contained synthesis that weaves together structure, causal mechanisms, and edge cases cleanly.',
    };

    $checklistRatio = count($rubricPoints) > 0
        ? (count($whatYouNailed) / count($rubricPoints))
        : 0.5;
    $depthBonus = min(25, (int) floor($wordCount / 6));
    $rawScore = (int) round($checklistRatio * 75 + $depthBonus);
    $score = max(15, min(98, $rawScore));

    if (empty($whatYouNailed) && $wordCount >= 10) {
        $whatYouNailed[] = "Initiated closed-book {$stageName} retrieval ({$wordCount} words) addressing {$topicTitle}.";
    }

    if ($score >= 80) {
        $coachFeedback = "Strong {$stageName} performance ({$score}% mastery)! You addressed the core concepts clearly. Review any remaining nuance below before your next spaced interval.";
    } elseif ($score >= 70) {
        $coachFeedback = "Solid foundational recall ({$score}%), though " . count($missingToReview) . " rubric point(s) need sharper specificity for {$stageName}.";
    } else {
        $coachFeedback = "Your {$stageName} attempt ({$score}%) highlights fragile recall on key rubric points (" . count($missingToReview) . " missed). Schedule an Adaptive Booster (+2 Days) to strengthen these traces.";
    }

    $firstMissed = $missingToReview[0] ?? ($rubricPoints[0] ?? $topicTitle);
    $socraticQuestion = "Focusing specifically on \"{$firstMissed}\", what is the underlying causal mechanism that links this point to the rest of {$topicTitle}, and what happens if it changes?";

    return [
        'masteryScore' => $score,
        'whatYouNailed' => $whatYouNailed,
        'accuratePoints' => $whatYouNailed,
        'cognitiveStageCheck' => $cognitiveStageCheck,
        'missingToReview' => $missingToReview,
        'missedOrInaccurateConcepts' => $missingToReview,
        'coachFeedback' => $coachFeedback,
        'socraticFollowUpQuestion' => $socraticQuestion,
        'recommendAdaptiveExtraSession' => $score < 70,
    ];
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
// Action B: generate_plan / generate_session_prompts (Two-Step Gemini Pipeline)
// =============================================================================
if ($action === 'generate_plan' || $action === 'generate_session_prompts') {
    $topicPrompt = trim((string) ($body['topicPrompt'] ?? ''));
    $urls = is_array($body['urls'] ?? null) ? $body['urls'] : [];
    $files = is_array($body['files'] ?? null) ? $body['files'] : [];
    $scheduledBlueprints = is_array($body['scheduledBlueprints'] ?? null) ? $body['scheduledBlueprints'] : [];
    $startDate = (string) ($body['startDate'] ?? date('Y-m-d'));
    $masterByDate = (string) ($body['masterByDate'] ?? date('Y-m-d', strtotime('+14 days')));
    $studyWindowMinutes = max(
        10,
        min(
            240,
            (int) ($body['studyWindowMinutes'] ?? ($body['studyWindow']['durationMinutes'] ?? 30))
        )
    );
    $userEmail = trim((string) ($body['userEmail'] ?? 'learner@english-3d.com'));
    $saveToDb = (bool) ($body['saveToDb'] ?? false);

    if ($topicPrompt === '' && empty($urls) && empty($files)) {
        respondJson([
            'ok' => false,
            'error' => 'Please provide a study topic, at least one study file, or a source URL.',
        ], 400);
    }

    if (empty($scheduledBlueprints)) {
        $scheduledBlueprints = [[
            'sessionNumber' => 1,
            'scheduledDate' => $startDate,
            'dayOffset' => 0,
            'gapDays' => 0,
        ]];
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

    // 2. Build Multimodal Input Array for Call 1
    $inputItems = [];
    $inlineFileTextBlocks = [];

    foreach ($files as $file) {
        $fileName = (string) ($file['name'] ?? 'uploaded-file');
        $mimeType = strtolower(trim((string) ($file['mimeType'] ?? 'application/octet-stream')));
        $base64Data = (string) ($file['base64Data'] ?? '');

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
            $decodedText = base64_decode($base64Data, true);
            if ($decodedText !== false) {
                $inlineFileTextBlocks[] = "=== UPLOADED FILE ({$fileName}) ===\n" . mb_substr($decodedText, 0, 25000);
            }
        }
    }

    // Compute approximate word count across topic prompt, text files, and harvested URLs
    $combinedTextForCount = trim(
        $topicPrompt . "\n" . implode("\n", $inlineFileTextBlocks) . "\n" . implode("\n", $harvestedContextBlocks)
    );
    $wordParts = preg_split('/\s+/u', $combinedTextForCount) ?: [];
    $wordCount = count(array_filter($wordParts, static fn($w) => $w !== ''));

    // -------------------------------------------------------------------------
    // CALL 1: Canonical Knowledge Blueprint & Semantic Density Estimation
    // -------------------------------------------------------------------------
    $call1Prompt = "Analyze the learner's topic, study objectives, attached multimodal files, and harvested URLs to extract a structured Canonical Knowledge Blueprint.\n\n"
        . "USER STUDY TOPIC / LEARNING OBJECTIVES:\n"
        . ($topicPrompt !== '' ? $topicPrompt : 'Derive comprehensive learning objectives directly from the attached files and URLs.') . "\n\n";

    if (!empty($inlineFileTextBlocks)) {
        $call1Prompt .= "EXTRACTED TEXT FROM UPLOADED FILES:\n" . implode("\n\n", $inlineFileTextBlocks) . "\n\n";
    }
    if (!empty($harvestedContextBlocks)) {
        $call1Prompt .= "HARVESTED WEB SOURCE CONTENT:\n" . implode("\n\n", $harvestedContextBlocks) . "\n\n";
    }

    $call1Prompt .= <<<'CALL1_INSTRUCTIONS'
REQUIREMENTS FOR CANONICAL BLUEPRINT (CALL 1):
1. `estimatedFirstPassMinutes`: Estimate realistically how many minutes a focused learner needs to absorb and map the FULL source material on a first pass (integer).
2. `learningObjectives`: Return 3 to 7 concrete, measurable mastery objectives.
3. `coreConcepts`: Return 3 to 6 macro conceptual pillars (`id`, `title`, `summary`, `connections`) showing how the system fits together.
4. `conceptClusters`: Group the domain into coherent teachable topic clusters (`cluster_id`, `title`, `key_concepts[]`), suitable for spiral chunking when broad.
5. `relationships`: List specific causal, hierarchical, contrast, or dependency links across concepts.
6. `misconceptionsOrTraps`: List common conceptual traps, look-alike confusions, or boundary failure cases learners stumble over.
7. `extractedSourceDigest`: Write an exhaustive, authoritative 400 to 600 word structured reference digest capturing all key definitions, formulas, mechanisms, contrasts, and examples for closed-book AI grading later.
CALL1_INSTRUCTIONS;

    $call1InputItems = $inputItems;
    $call1InputItems[] = [
        'type' => 'text',
        'text' => $call1Prompt,
    ];

    $blueprintSchema = [
        'type' => 'object',
        'properties' => [
            'topicTitle' => ['type' => 'string'],
            'executiveSummary' => ['type' => 'string'],
            'estimatedFirstPassMinutes' => ['type' => 'integer'],
            'learningObjectives' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
            ],
            'coreConcepts' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'string'],
                        'title' => ['type' => 'string'],
                        'summary' => ['type' => 'string'],
                        'connections' => ['type' => 'string'],
                    ],
                    'required' => ['id', 'title', 'summary', 'connections'],
                ],
            ],
            'conceptClusters' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'cluster_id' => ['type' => 'string'],
                        'title' => ['type' => 'string'],
                        'key_concepts' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                        ],
                    ],
                    'required' => ['cluster_id', 'title', 'key_concepts'],
                ],
            ],
            'relationships' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
            ],
            'misconceptionsOrTraps' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
            ],
            'extractedSourceDigest' => ['type' => 'string'],
        ],
        'required' => [
            'topicTitle',
            'executiveSummary',
            'estimatedFirstPassMinutes',
            'learningObjectives',
            'coreConcepts',
            'conceptClusters',
            'relationships',
            'misconceptionsOrTraps',
            'extractedSourceDigest',
        ],
    ];

    $blueprintSystem = 'You are Practice Buddy, an expert cognitive scientist and curriculum architect. Extract a precise, factual Canonical Knowledge Blueprint strictly matching the lowercase JSON schema.';
    $call1Result = callGeminiStructured($call1InputItems, $blueprintSchema, $blueprintSystem);

    $aiWarning = null;
    $sessionCount = count($scheduledBlueprints);
    $stageSkeleton = buildStageSkeleton($sessionCount);

    $studyMode = 'deepening';
    $targetChunkCount = 1;
    $chunkScopes = assignSpiralChunkScopes($sessionCount, 'deepening', 1);
    $blueprintData = null;
    $generated = null;

    if (!$call1Result['ok'] || !is_array($call1Result['data'])) {
        $generated = buildServerFallbackPlan(
            $topicPrompt,
            $inlineFileTextBlocks,
            $harvestedContextBlocks,
            $harvestedLinks,
            $scheduledBlueprints,
            $startDate,
            $masterByDate,
            $studyWindowMinutes,
            $wordCount,
            null
        );
        $studyMode = (string) ($generated['studyMode'] ?? 'deepening');
        $targetChunkCount = (int) ($generated['targetChunkCount'] ?? 1);
        $chunkScopes = assignSpiralChunkScopes($sessionCount, $studyMode, $targetChunkCount);
        $blueprintData = $generated['blueprint'] ?? null;
        $aiWarning = $call1Result['error'] ?? 'Gemini Call 1 unavailable; generated plan via server fallback.';
    } else {
        $blueprintData = $call1Result['data'];
        $estimatedMinutes = max(5, (int) ($blueprintData['estimatedFirstPassMinutes'] ?? 45));
        $conceptClusters = is_array($blueprintData['conceptClusters'] ?? null) ? $blueprintData['conceptClusters'] : [];

        // Deterministic routing & spiral chunking between Call 1 & Call 2
        $routing = selectStudyMode(
            $sessionCount,
            $studyWindowMinutes,
            $wordCount,
            $conceptClusters,
            $estimatedMinutes
        );
        $studyMode = $routing['mode'];
        $targetChunkCount = $routing['target_chunk_count'];
        $chunkScopes = assignSpiralChunkScopes($sessionCount, $studyMode, $targetChunkCount);
        $chunkModules = buildChunkModulesFromClusters($conceptClusters, $targetChunkCount);

        // Prepare compact blueprint JSON for lightweight text-only Call 2
        $call2Blueprint = [
            'topicTitle' => $blueprintData['topicTitle'] ?? $topicPrompt,
            'executiveSummary' => $blueprintData['executiveSummary'] ?? '',
            'learningObjectives' => $blueprintData['learningObjectives'] ?? [],
            'coreConcepts' => $blueprintData['coreConcepts'] ?? [],
            'conceptClusters' => $conceptClusters,
            'relationships' => $blueprintData['relationships'] ?? [],
            'misconceptionsOrTraps' => $blueprintData['misconceptionsOrTraps'] ?? [],
            'digestExcerpt' => mb_substr((string) ($blueprintData['extractedSourceDigest'] ?? ''), 0, 3000),
        ];

        $skeletonPayload = [];
        foreach ($scheduledBlueprints as $idx => $bp) {
            $num = (int) ($bp['sessionNumber'] ?? ($idx + 1));
            $skel = $stageSkeleton[$idx] ?? $stageSkeleton[count($stageSkeleton) - 1];
            $skeletonPayload[] = [
                'sessionNumber' => $num,
                'scheduledDate' => (string) ($bp['scheduledDate'] ?? $startDate),
                'dayOffset' => (int) ($bp['dayOffset'] ?? 0),
                'gapDays' => (int) ($bp['gapDays'] ?? 0),
                'stageNumber' => $skel['stage_number'],
                'stageKey' => $skel['stage_key'],
                'stageName' => $skel['stage_name'],
                'subAngle' => $skel['sub_angle'],
                'defaultCognitiveGoal' => $skel['cognitive_goal'],
                'chunkScope' => $chunkScopes[$idx] ?? null,
            ];
        }

        // ---------------------------------------------------------------------
        // CALL 2: Progressive Spaced Sessions Generator (Lightweight Text-Only)
        // ---------------------------------------------------------------------
        $call2Prompt = "CANONICAL KNOWLEDGE BLUEPRINT:\n"
            . json_encode($call2Blueprint, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n"
            . "ROUTED STUDY MODE: {$studyMode} (targetChunkCount={$targetChunkCount}, studyWindowMinutes={$studyWindowMinutes})\n"
            . (!empty($chunkModules)
                ? "SPIRAL CHUNK MODULES:\n" . json_encode($chunkModules, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n"
                : '')
            . "ASSIGNED SESSION SKELETON & CEPEDA SCHEDULE:\n"
            . json_encode($skeletonPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n"
            . <<<'CALL2_INSTRUCTIONS'
CRITICAL PROGRESSIVE SESSION GENERATION RULES:
1. STRICT SKELETON ALIGNMENT: Emit one object in `sessions[]` for EVERY item in the ASSIGNED SESSION SKELETON matching its exact `sessionNumber`, `stageNumber`, `stageKey`, and `stageName`.
2. BLUEPRINT BINDING: Bind every prompt directly to specific concepts, clusters, `relationships`, or `misconceptionsOrTraps` from the Canonical Knowledge Blueprint above—never write generic filler questions.
3. FORBID PASSIVE RE-READING: Never ask the learner to "re-read", "review notes", or "highlight". Require effortful closed-book recall, causal interrogation, scenario transfer, or Feynman teach-back tailored to each session's `stageNumber` and `subAngle`:
   - `uncued_brain_dump`: Uncued retrieval + mechanism explanation without hints.
   - `compare_contrast`: Explicit mechanistic contrast between two easily confused concepts/pathways.
   - `spot_misconception`: Present or probe a trap from `misconceptionsOrTraps` and require proof of why it fails.
   - `real_world_scenario`: Concrete realistic diagnostic or design case.
   - `feynman_teachback`: Clear peer-level explanation from first principles without jargon hiding.
   - `boundary_test`: Extreme variable/constraint stress test or failure mode.
4. SPIRAL CHUNKING vs DEEPENING `chunk_tag`:
   - In `deepening` mode or Session N full synthesis, tag every prompt with `"Full Topic"`.
   - In `spiral_chunking` mode, align prompts to the session's `chunkScope`: tag new-module prompts `"New: Chunk X"` (e.g. `"New: Chunk B"`) and spaced-review prompts `"Review: Chunk Y"` (e.g. `"Review: Chunk A"`).
5. `continuityHook`:
   - For `sessionNumber === 1`: set `continuityHook` to empty string `""`.
   - For Sessions `2..N`: write exactly ONE crisp connecting sentence referencing the previous session's concepts or retrieval milestone (e.g., "Building on the Chunk A schema you mapped in Session #1, you now add Chunk B while stress-testing Chunk A from memory.").
6. RUBRIC POINTS & CHECKLIST: Provide 2 focused prompts per session, each with 2 to 3 concrete `expected_rubric_points`, and 4 to 6 `verificationChecklist` criteria per session.
CALL2_INSTRUCTIONS;

        $sessionsSchema = [
            'type' => 'object',
            'properties' => [
                'sessions' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'sessionNumber' => ['type' => 'integer'],
                            'stageNumber' => ['type' => 'integer'],
                            'stageName' => ['type' => 'string'],
                            'stageKey' => ['type' => 'string'],
                            'cognitiveGoal' => ['type' => 'string'],
                            'continuityHook' => ['type' => 'string'],
                            'prompts' => [
                                'type' => 'array',
                                'items' => [
                                    'type' => 'object',
                                    'properties' => [
                                        'prompt_text' => ['type' => 'string'],
                                        'chunk_tag' => ['type' => 'string'],
                                        'expected_rubric_points' => [
                                            'type' => 'array',
                                            'items' => ['type' => 'string'],
                                        ],
                                    ],
                                    'required' => ['prompt_text', 'chunk_tag', 'expected_rubric_points'],
                                ],
                            ],
                            'verificationChecklist' => [
                                'type' => 'array',
                                'items' => ['type' => 'string'],
                            ],
                        ],
                        'required' => [
                            'sessionNumber',
                            'stageNumber',
                            'stageName',
                            'stageKey',
                            'cognitiveGoal',
                            'continuityHook',
                            'prompts',
                            'verificationChecklist',
                        ],
                    ],
                ],
            ],
            'required' => ['sessions'],
        ];

        $sessionSystem = 'You are Practice Buddy, an expert cognitive-science retrieval coach. Produce progressive, blueprint-grounded spaced sessions strictly matching the lowercase JSON schema.';
        $call2Result = callGeminiStructured(
            [['type' => 'text', 'text' => $call2Prompt]],
            $sessionsSchema,
            $sessionSystem
        );

        if ($call2Result['ok'] && is_array($call2Result['data']) && !empty($call2Result['data']['sessions'])) {
            $generated = [
                'topicTitle' => (string) ($blueprintData['topicTitle'] ?? 'Spaced Study Plan'),
                'studyMode' => $studyMode,
                'targetChunkCount' => $targetChunkCount,
                'studyWindowMinutes' => $studyWindowMinutes,
                'executiveSummary' => (string) ($blueprintData['executiveSummary'] ?? ''),
                'coreConcepts' => is_array($blueprintData['coreConcepts'] ?? null) ? $blueprintData['coreConcepts'] : [],
                'blueprint' => $blueprintData,
                'extractedSourceDigest' => (string) ($blueprintData['extractedSourceDigest'] ?? ''),
                'sessions' => $call2Result['data']['sessions'],
            ];
        } else {
            $generated = buildServerFallbackPlan(
                $topicPrompt,
                $inlineFileTextBlocks,
                $harvestedContextBlocks,
                $harvestedLinks,
                $scheduledBlueprints,
                $startDate,
                $masterByDate,
                $studyWindowMinutes,
                $wordCount,
                $blueprintData
            );
            $aiWarning = $call2Result['error'] ?? 'Gemini Call 2 unavailable; generated sessions via server fallback.';
        }
    }

    // Merge generated session prompts with deterministic skeleton & exact Cepeda dates
    $mergedSessions = [];
    $genSessionsByNum = [];
    foreach (($generated['sessions'] ?? []) as $gs) {
        $genSessionsByNum[(int) ($gs['sessionNumber'] ?? 0)] = $gs;
    }

    foreach ($scheduledBlueprints as $idx => $bp) {
        $num = (int) ($bp['sessionNumber'] ?? ($idx + 1));
        $gs = $genSessionsByNum[$num] ?? ($generated['sessions'][$idx] ?? []);
        $skel = $stageSkeleton[$idx] ?? $stageSkeleton[count($stageSkeleton) - 1];
        $scope = $chunkScopes[$idx] ?? null;

        $stageNumber = (int) $skel['stage_number'];
        $stageKey = (string) ($skel['stage_key'] ?: ($gs['stageKey'] ?? 'schema_mapping'));
        $rawStageName = normalizeGeminiStageName((string) ($skel['stage_name'] ?: ($gs['stageName'] ?? "Session {$num}")));

        $unpacked = normalizeSessionPromptItems($gs['prompts'] ?? []);
        // Ensure every prompt has chunk_tag fallback
        $defaultTag = 'Full Topic';
        if ($studyMode === 'spiral_chunking' && is_array($scope)) {
            if (!empty($scope['new'])) {
                $defaultTag = 'New: Chunk ' . (string) $scope['new'][0];
            } elseif (!empty($scope['review']) && $scope['review'][0] !== 'ALL') {
                $defaultTag = 'Review: Chunk ' . (string) $scope['review'][0];
            }
        }
        foreach ($unpacked['promptItems'] as $pIdx => $pItem) {
            if (empty($pItem['chunk_tag'])) {
                $unpacked['promptItems'][$pIdx]['chunk_tag'] = $defaultTag;
            }
        }

        $checklist = is_array($gs['verificationChecklist'] ?? null)
            ? array_values(array_map('strval', $gs['verificationChecklist']))
            : [];

        if (empty($checklist) && !empty($unpacked['promptItems'])) {
            foreach ($unpacked['promptItems'] as $pi) {
                foreach ($pi['expected_rubric_points'] as $rp) {
                    $checklist[] = $rp;
                }
            }
            $checklist = array_slice(array_values(array_unique($checklist)), 0, 6);
        }

        $schedDate = (string) ($bp['scheduledDate'] ?? $startDate);
        $continuityHook = $idx === 0
            ? ''
            : trim((string) ($gs['continuityHook'] ?? "Building on your Session #{$idx} recall, advance into {$rawStageName}."));

        $mergedSessions[] = [
            'sessionNumber' => $num,
            'stageNumber' => $stageNumber,
            'stageName' => mb_substr($rawStageName, 0, 160),
            'stageKey' => mb_substr($stageKey, 0, 64),
            'scheduledDate' => $schedDate,
            'originalScheduledDate' => $schedDate,
            'dayOffset' => (int) ($bp['dayOffset'] ?? 0),
            'gapDays' => (int) ($bp['gapDays'] ?? 0),
            'cognitiveGoal' => trim((string) ($gs['cognitiveGoal'] ?? $skel['cognitive_goal'] ?? ($bp['cognitiveGoal'] ?? ''))),
            'chunkScope' => $scope,
            'continuityHook' => $continuityHook,
            'prompts' => $unpacked['prompts'],
            'promptItems' => $unpacked['promptItems'],
            'verificationChecklist' => $checklist,
            'status' => 'pending',
            'mergedIntoSessionId' => null,
            'recalibrationCount' => 0,
            'masteryScore' => null,
            'calendarEventId' => null,
            'completedAt' => null,
            'attempts' => [],
        ];
    }

    $resultPlan = [
        'userEmail' => $userEmail,
        'topicTitle' => mb_substr((string) ($generated['topicTitle'] ?? 'Spaced Study Plan'), 0, 255),
        'studyMode' => $studyMode === 'spiral_chunking' ? 'spiral_chunking' : 'deepening',
        'targetChunkCount' => $targetChunkCount,
        'studyWindowMinutes' => $studyWindowMinutes,
        'executiveSummary' => (string) ($generated['executiveSummary'] ?? ''),
        'coreConcepts' => is_array($generated['coreConcepts'] ?? null) ? $generated['coreConcepts'] : [],
        'blueprint' => is_array($blueprintData) ? $blueprintData : null,
        'sourceLinks' => $harvestedLinks,
        'extractedContextCache' => (string) ($generated['extractedSourceDigest'] ?? ''),
        'startDate' => $startDate,
        'masterByDate' => $masterByDate,
        'sessions' => $mergedSessions,
    ];

    $persistedInMySql = false;

    if ($saveToDb) {
        try {
            $pdo = getDbConnection();
            $currentUser = resolveEffectiveUserRow($pdo, $body);
            $currentUserId = (int) $currentUser['id'];
            $effectiveEmail = trim((string) ($currentUser['email'] ?: $resultPlan['userEmail']));

            $pdo->beginTransaction();

            $planStmt = $pdo->prepare(
                'INSERT INTO study_plans
                (user_id, user_email, topic_title, study_mode, target_chunk_count, study_window_minutes, executive_summary, core_concepts_json, blueprint_json, source_links_json, extracted_context_cache, start_date, master_by_date)
                VALUES (:user_id, :user_email, :topic_title, :study_mode, :target_chunk_count, :study_window_minutes, :executive_summary, :core_concepts_json, :blueprint_json, :source_links_json, :extracted_context_cache, :start_date, :master_by_date)'
            );
            $planStmt->execute([
                ':user_id' => $currentUserId,
                ':user_email' => mb_substr($effectiveEmail, 0, 255),
                ':topic_title' => $resultPlan['topicTitle'],
                ':study_mode' => $resultPlan['studyMode'],
                ':target_chunk_count' => $resultPlan['targetChunkCount'],
                ':study_window_minutes' => $resultPlan['studyWindowMinutes'],
                ':executive_summary' => $resultPlan['executiveSummary'],
                ':core_concepts_json' => json_encode($resultPlan['coreConcepts'], JSON_UNESCAPED_UNICODE),
                ':blueprint_json' => $resultPlan['blueprint'] !== null ? json_encode($resultPlan['blueprint'], JSON_UNESCAPED_UNICODE) : null,
                ':source_links_json' => json_encode($resultPlan['sourceLinks'], JSON_UNESCAPED_UNICODE),
                ':extracted_context_cache' => $resultPlan['extractedContextCache'],
                ':start_date' => $resultPlan['startDate'],
                ':master_by_date' => $resultPlan['masterByDate'],
            ]);

            $planId = (int) $pdo->lastInsertId();
            $resultPlan['id'] = $planId;
            $resultPlan['userId'] = $currentUserId;
            $resultPlan['userEmail'] = $effectiveEmail;
            $resultPlan['createdAt'] = date('Y-m-d H:i:s');

            $sessionStmt = $pdo->prepare(
                'INSERT INTO study_sessions
                (plan_id, user_id, session_number, stage_number, stage_name, stage_key, scheduled_date, original_scheduled_date, day_offset, gap_days, cognitive_goal, chunk_scope_json, continuity_hook, prompts_json, verification_checklist_json, status, recalibration_count)
                VALUES (:plan_id, :user_id, :session_number, :stage_number, :stage_name, :stage_key, :scheduled_date, :original_scheduled_date, :day_offset, :gap_days, :cognitive_goal, :chunk_scope_json, :continuity_hook, :prompts_json, :verification_checklist_json, :status, :recalibration_count)'
            );

            foreach ($resultPlan['sessions'] as $i => $sess) {
                $promptsToStore = !empty($sess['promptItems']) ? $sess['promptItems'] : $sess['prompts'];
                $sessionStmt->execute([
                    ':plan_id' => $planId,
                    ':user_id' => $currentUserId,
                    ':session_number' => $sess['sessionNumber'],
                    ':stage_number' => $sess['stageNumber'],
                    ':stage_name' => $sess['stageName'],
                    ':stage_key' => $sess['stageKey'],
                    ':scheduled_date' => $sess['scheduledDate'],
                    ':original_scheduled_date' => $sess['originalScheduledDate'],
                    ':day_offset' => $sess['dayOffset'],
                    ':gap_days' => $sess['gapDays'],
                    ':cognitive_goal' => $sess['cognitiveGoal'],
                    ':chunk_scope_json' => $sess['chunkScope'] !== null ? json_encode($sess['chunkScope'], JSON_UNESCAPED_UNICODE) : null,
                    ':continuity_hook' => $sess['continuityHook'],
                    ':prompts_json' => json_encode($promptsToStore, JSON_UNESCAPED_UNICODE),
                    ':verification_checklist_json' => json_encode($sess['verificationChecklist'], JSON_UNESCAPED_UNICODE),
                    ':status' => 'pending',
                    ':recalibration_count' => 0,
                ]);
                $resultPlan['sessions'][$i]['id'] = (int) $pdo->lastInsertId();
                $resultPlan['sessions'][$i]['planId'] = $planId;
                $resultPlan['sessions'][$i]['userId'] = $currentUserId;
            }

            $pdo->commit();
            $persistedInMySql = true;
        } catch (Throwable $dbErr) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $resultPlan['dbWarning'] = 'Generated plan successfully, but MySQL persistence failed: ' . $dbErr->getMessage();
        }
    }

    respondJson([
        'ok' => true,
        'modelUsed' => $aiWarning === null ? GEMINI_MODEL : 'server-fallback',
        'persistedInMySql' => $persistedInMySql,
        'aiWarning' => $aiWarning,
        'plan' => $resultPlan,
    ]);
}

// =============================================================================
// Action C: grade_recall / evaluate_recall — Stage-Tailored AI Coaching & Grading
// =============================================================================
if ($action === 'grade_recall' || $action === 'evaluate_recall') {
    $sessionId = (int) ($body['sessionId'] ?? 0);
    $userResponseText = trim((string) ($body['userResponseText'] ?? ''));

    if ($userResponseText === '') {
        respondJson(['ok' => false, 'error' => 'userResponseText cannot be empty.'], 400);
    }

    $stageName = normalizeGeminiStageName((string) ($body['stageName'] ?? $body['stage_name'] ?? 'Active Recall Session'));
    $stageNumber = (int) ($body['stageNumber'] ?? $body['stage_number'] ?? 0);
    $cognitiveGoal = (string) ($body['cognitiveGoal'] ?? '');
    $rawPromptItems = $body['promptItems'] ?? $body['prompts'] ?? [];
    $verificationChecklist = is_array($body['verificationChecklist'] ?? null) ? $body['verificationChecklist'] : [];
    $extractedContextCache = (string) ($body['extractedContextCache'] ?? '');
    $topicTitle = (string) ($body['topicTitle'] ?? '');

    $pdo = null;
    $sessionPlanId = 0;
    $sessionScheduledDate = '';
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
                $sessionPlanId = (int) $row['plan_id'];
                $sessionScheduledDate = (string) ($row['scheduled_date'] ?? '');
                $stageName = normalizeGeminiStageName((string) $row['stage_name']);
                $stageNumber = isset($row['stage_number']) ? (int) $row['stage_number'] : $stageNumber;
                $cognitiveGoal = (string) $row['cognitive_goal'];
                $decodedDbPrompts = json_decode((string) $row['prompts_json'], true);
                if (is_array($decodedDbPrompts) && !empty($decodedDbPrompts)) {
                    $rawPromptItems = $decodedDbPrompts;
                }
                $verificationChecklist = json_decode((string) $row['verification_checklist_json'], true) ?: $verificationChecklist;
                $extractedContextCache = (string) $row['extracted_context_cache'];
                $topicTitle = (string) $row['topic_title'];
            }
        } catch (Throwable) {
            // Continue with payload context if DB is offline
        }
    }

    $stageNumber = resolveStageNumFromContext($stageNumber, $stageName, 1);
    $unpacked = normalizeSessionPromptItems($rawPromptItems);
    $promptItems = $unpacked['promptItems'];

    // Collect combined rubric points from promptItems + verificationChecklist
    $combinedRubric = [];
    $promptSectionLines = [];
    foreach ($promptItems as $idx => $pi) {
        $pNum = $idx + 1;
        $line = "Prompt {$pNum}: {$pi['prompt_text']}";
        if (!empty($pi['expected_rubric_points'])) {
            $line .= "\n   Expected Rubric Points: " . implode('; ', $pi['expected_rubric_points']);
            foreach ($pi['expected_rubric_points'] as $rp) {
                $combinedRubric[] = $rp;
            }
        }
        $promptSectionLines[] = $line;
    }
    foreach ($verificationChecklist as $vc) {
        $combinedRubric[] = (string) $vc;
    }
    $combinedRubric = array_values(array_unique(array_filter($combinedRubric, static fn($x) => trim((string) $x) !== '')));

    $stageRequirement = getStageThinkingRequirement($stageNumber);

    $gradingPrompt = "STUDY TOPIC: {$topicTitle}\n"
        . "COGNITIVE STAGE: Stage {$stageNumber} — {$stageName}\n"
        . "STAGE THINKING REQUIREMENT: {$stageRequirement}\n"
        . "COGNITIVE GOAL: {$cognitiveGoal}\n\n"
        . "ASSIGNED STAGE-SPECIFIC PROMPTS & HIDDEN EXPECTED RUBRIC POINTS:\n"
        . implode("\n\n", $promptSectionLines) . "\n\n"
        . "SESSION VERIFICATION CHECKLIST:\n"
        . implode("\n- ", array_merge([''], $verificationChecklist)) . "\n\n"
        . "AUTHORITATIVE SOURCE MATERIAL DIGEST (`extracted_context_cache`):\n"
        . ($extractedContextCache !== '' ? $extractedContextCache : 'Evaluate against domain consensus for the topic.') . "\n\n"
        . "LEARNER'S CLOSED-BOOK RESPONSE:\n"
        . $userResponseText . "\n\n"
        . "EVALUATION INSTRUCTIONS:\n"
        . "1. Score the response from 0 to 100 (`masteryScore`) based on factual accuracy, rubric point coverage, AND fulfillment of Stage {$stageNumber}'s required cognitive depth.\n"
        . "2. `whatYouNailed`: List specific concepts, structural links, mechanisms, or diagnostic steps the learner produced accurately.\n"
        . "3. `cognitiveStageCheck`: Explicitly assess whether the learner achieved the TYPE of thinking required by Stage {$stageNumber}. For example, if in Stage 3 (Elaborative Interrogation) they only gave a surface definition instead of explaining WHY/HOW causal mechanisms work, coach them directly on elevating their reasoning.\n"
        . "4. `missingToReview`: List specific omitted rubric points, gaps, or misconceptions to review before the next spaced session.\n"
        . "5. `coachFeedback`: Provide concise, encouraging corrective synthesis.\n"
        . "6. `socraticFollowUpQuestion`: Ask one targeted follow-up question addressing the largest gap.\n"
        . "7. Set `recommendAdaptiveExtraSession` to true if `masteryScore` < 70 or foundational mechanisms remain unstable.";

    $gradingSchema = [
        'type' => 'object',
        'properties' => [
            'masteryScore' => [
                'type' => 'integer',
                'description' => 'Score from 0 to 100 reflecting conceptual accuracy, rubric coverage, and stage-appropriate cognitive depth.',
            ],
            'whatYouNailed' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
                'description' => 'Specific concepts, structural links, or mechanisms accurately produced.',
            ],
            'cognitiveStageCheck' => [
                'type' => 'string',
                'description' => 'Direct evaluation of whether the learner met the cognitive thinking requirement of this specific stage (Stages 1-5).',
            ],
            'missingToReview' => [
                'type' => 'array',
                'items' => ['type' => 'string'],
                'description' => 'Specific gaps, missing rubric points, or nuances to review before the next session.',
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
            'whatYouNailed',
            'cognitiveStageCheck',
            'missingToReview',
            'coachFeedback',
            'socraticFollowUpQuestion',
            'recommendAdaptiveExtraSession',
        ],
    ];

    $systemInstruction = 'You are Practice Buddy, an expert cognitive-science coach. Grade closed-book recall attempts against stage-specific expected rubric points and cognitive stage requirements with high factual fidelity.';

    $geminiResult = callGeminiStructured(
        [['type' => 'text', 'text' => $gradingPrompt]],
        $gradingSchema,
        $systemInstruction
    );

    $aiWarning = null;
    if ($geminiResult['ok'] && is_array($geminiResult['data'])) {
        $evaluation = $geminiResult['data'];
    } else {
        $evaluation = evaluateServerFallbackRecall(
            $topicTitle,
            $stageNumber,
            $stageName,
            $combinedRubric,
            $userResponseText
        );
        $aiWarning = $geminiResult['error'] ?? 'Gemini AI grader unavailable; scored via server rubric analyzer.';
    }

    $score = max(0, min(100, (int) ($evaluation['masteryScore'] ?? 0)));
    $whatYouNailed = is_array($evaluation['whatYouNailed'] ?? null)
        ? $evaluation['whatYouNailed']
        : (is_array($evaluation['accuratePoints'] ?? null) ? $evaluation['accuratePoints'] : []);
    $cognitiveStageCheck = trim((string) ($evaluation['cognitiveStageCheck'] ?? ''));
    $missingToReview = is_array($evaluation['missingToReview'] ?? null)
        ? $evaluation['missingToReview']
        : (is_array($evaluation['missedOrInaccurateConcepts'] ?? null) ? $evaluation['missedOrInaccurateConcepts'] : []);
    $coachFeedback = (string) ($evaluation['coachFeedback'] ?? '');
    $socraticQuestion = (string) ($evaluation['socraticFollowUpQuestion'] ?? '');
    $recommendExtra = (bool) ($evaluation['recommendAdaptiveExtraSession'] ?? ($score < 70));
    if ($score < 70) {
        $recommendExtra = true;
    }

    $attemptId = null;
    $completedAt = date('Y-m-d H:i:s');
    $persistedInMySql = false;
    $dbWarning = null;
    $recalibrated = false;
    $refreshedPlan = null;

    if ($sessionId > 0) {
        try {
            if (!($pdo instanceof PDO)) {
                $pdo = getDbConnection();
            }
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
                ':strengths_json' => json_encode($whatYouNailed, JSON_UNESCAPED_UNICODE),
                ':missing_concepts_json' => json_encode($missingToReview, JSON_UNESCAPED_UNICODE),
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
            $persistedInMySql = true;

            // Completion-Anchored Hook: auto-run Tier 1 recalibration if completing an overdue session
            if ($sessionPlanId > 0) {
                $today = date('Y-m-d');
                if ($sessionScheduledDate !== '' && $sessionScheduledDate < $today) {
                    $recal = recalibratePlanSchedule($pdo, $sessionPlanId, $today, 'tier1_only');
                    if (!empty($recal['recalibrated']) && !empty($recal['plan'])) {
                        $recalibrated = true;
                        $refreshedPlan = $recal['plan'];
                    }
                }
                if ($refreshedPlan === null) {
                    $loadedPlans = loadStudyPlans($pdo, $sessionPlanId);
                    $refreshedPlan = $loadedPlans[0] ?? null;
                }
            }
        } catch (Throwable $dbErr) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $dbWarning = 'Evaluated recall attempt, but MySQL save failed: ' . $dbErr->getMessage();
        }
    }

    respondJson([
        'ok' => true,
        'modelUsed' => $aiWarning === null ? GEMINI_MODEL : 'server-fallback',
        'persistedInMySql' => $persistedInMySql,
        'aiWarning' => $aiWarning,
        'dbWarning' => $dbWarning,
        'attemptId' => $attemptId,
        'completedAt' => $completedAt,
        'recalibrated' => $recalibrated,
        'plan' => $refreshedPlan,
        'evaluation' => [
            'masteryScore' => $score,
            'whatYouNailed' => $whatYouNailed,
            'accuratePoints' => $whatYouNailed,
            'cognitiveStageCheck' => $cognitiveStageCheck,
            'missingToReview' => $missingToReview,
            'missedOrInaccurateConcepts' => $missingToReview,
            'coachFeedback' => $coachFeedback,
            'socraticFollowUpQuestion' => $socraticQuestion,
            'recommendAdaptiveExtraSession' => $recommendExtra,
        ],
    ]);
}

respondJson(['ok' => false, 'error' => "Unsupported action: {$action}"], 400);
