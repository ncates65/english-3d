<?php
declare(strict_types=1);

/**
 * Practice Buddy ("PB") — Shared Stage Compression, Mode Routing,
 * Session Formatting & Three-Tier Completion-Anchored Recalibration Helpers
 */

function pbNormalizeStageLabel(string $stageName): string {
    if (stripos($stageName, 'Initial Encoding & Schema Mapping') !== false) {
        return 'Stage 1: Schema Mapping';
    }
    return $stageName;
}

function pbInferStageNumber(string $stageName, int $sessionNumber = 1, string $stageKey = ''): int {
    $keyLower = mb_strtolower(trim($stageKey));
    if ($keyLower !== '') {
        if (str_contains($keyLower, 'sprint') || str_contains($keyLower, 'mastery') || str_contains($keyLower, 'feynman')) {
            return 5;
        }
        if (str_contains($keyLower, 'application') || str_contains($keyLower, 'edge_cases') || str_contains($keyLower, 'booster')) {
            return 4;
        }
        if (str_contains($keyLower, 'elaborative')) {
            return 3;
        }
        if (str_contains($keyLower, 'recall_elaboration') || str_contains($keyLower, 'free_recall') || str_contains($keyLower, 'closed_book')) {
            return 2;
        }
        if (str_contains($keyLower, 'schema')) {
            return 1;
        }
    }

    $lower = mb_strtolower($stageName);
    if (str_contains($lower, 'stage 5') || str_contains($lower, 'mastery verification') || str_contains($lower, 'feynman') || str_contains($lower, 'sprint')) {
        return 5;
    }
    if (str_contains($lower, 'stage 4') || str_contains($lower, 'application') || str_contains($lower, 'edge case') || str_contains($lower, 'booster')) {
        return 4;
    }
    if (str_contains($lower, 'stage 3') || str_contains($lower, 'elaborative')) {
        return 3;
    }
    if (str_contains($lower, 'stage 2') || str_contains($lower, 'free recall') || str_contains($lower, 'closed-book')) {
        return 2;
    }
    if (str_contains($lower, 'stage 1') || str_contains($lower, 'schema mapping')) {
        return 1;
    }
    return max(1, min(5, $sessionNumber));
}

function pbDiffCalendarDays(string $fromYmd, string $toYmd): int {
    try {
        $utc = new DateTimeZone('UTC');
        $d1 = DateTimeImmutable::createFromFormat('!Y-m-d', substr(trim($fromYmd), 0, 10), $utc);
        $d2 = DateTimeImmutable::createFromFormat('!Y-m-d', substr(trim($toYmd), 0, 10), $utc);
        if ($d1 && $d2) {
            return (int) $d1->diff($d2)->format('%r%a');
        }
    } catch (Throwable) {
        // Fallback below
    }
    return (int) round((strtotime($toYmd) - strtotime($fromYmd)) / 86400);
}

function pbAddCalendarDays(string $ymd, int $days): string {
    try {
        $utc = new DateTimeZone('UTC');
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', substr(trim($ymd), 0, 10), $utc);
        if ($d) {
            $op = $days >= 0 ? "+{$days} days" : "{$days} days";
            return $d->modify($op)->format('Y-m-d');
        }
    } catch (Throwable) {
        // Fallback below
    }
    return date('Y-m-d', strtotime($ymd . ($days >= 0 ? " +{$days} days" : " {$days} days")));
}

/**
 * Deterministic Stage Compression Mapping (`N` sessions -> cognitive stage slots).
 *
 * @return array<int, array{stage_number: int, stage_key: string, stage_name: string, sub_angle: string, cognitive_goal: string}>
 */
function buildStageSkeleton(int $sessionCount): array {
    $n = max(1, $sessionCount);

    if ($n === 1) {
        return [[
            'stage_number' => 5,
            'stage_key' => 'schema_recall_transfer_sprint',
            'stage_name' => 'Stage 5: Schema, Recall & Transfer Sprint',
            'sub_angle' => 'comprehensive_sprint',
            'cognitive_goal' => 'Map macro pillars, execute rapid closed-book recall, and apply concepts to a synthesis challenge in one intensive sprint.',
        ]];
    }

    if ($n === 2) {
        return [
            [
                'stage_number' => 1,
                'stage_key' => 'schema_recall_hybrid',
                'stage_name' => 'Stage 1: Schema Mapping & Recall Hybrid',
                'sub_angle' => 'schema_plus_core_facts',
                'cognitive_goal' => 'Organize high-level architecture and retrieve foundational terms and core definitions from memory.',
            ],
            [
                'stage_number' => 5,
                'stage_key' => 'elaboration_mastery_hybrid',
                'stage_name' => 'Stage 5: Elaboration & Mastery Verification',
                'sub_angle' => 'causal_teachback_synthesis',
                'cognitive_goal' => 'Explain why/how causal mechanisms operate and synthesize the full topic cleanly as if teaching an intelligent peer.',
            ],
        ];
    }

    if ($n === 3) {
        return [
            [
                'stage_number' => 1,
                'stage_key' => 'schema_mapping',
                'stage_name' => 'Stage 1: Schema Mapping',
                'sub_angle' => 'macro_architecture',
                'cognitive_goal' => 'Organize high-level structure, core categories, and causal or hierarchical relationships across the topic.',
            ],
            [
                'stage_number' => 3,
                'stage_key' => 'elaborative_interrogation',
                'stage_name' => 'Stage 3: Elaborative Interrogation',
                'sub_angle' => 'why_how_causality',
                'cognitive_goal' => 'Retrieve key terms while explaining why and how mechanisms operate and contrasting closely related concepts.',
            ],
            [
                'stage_number' => 5,
                'stage_key' => 'application_mastery_hybrid',
                'stage_name' => 'Stage 5: Application & Mastery Verification',
                'sub_angle' => 'scenario_plus_synthesis',
                'cognitive_goal' => 'Solve applied diagnostic cases and deliver a complete, gap-free mastery synthesis.',
            ],
        ];
    }

    if ($n === 4) {
        return [
            [
                'stage_number' => 1,
                'stage_key' => 'schema_mapping',
                'stage_name' => 'Stage 1: Schema Mapping',
                'sub_angle' => 'macro_architecture',
                'cognitive_goal' => 'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
            ],
            [
                'stage_number' => 2,
                'stage_key' => 'recall_elaboration_hybrid',
                'stage_name' => 'Stage 2: Closed-Book Recall & Elaboration',
                'sub_angle' => 'facts_plus_why_how',
                'cognitive_goal' => 'Retrieve core definitions unassisted and explain why underlying mechanisms work as they do.',
            ],
            [
                'stage_number' => 4,
                'stage_key' => 'application_edge_cases',
                'stage_name' => 'Stage 4: Application & Edge Cases',
                'sub_angle' => 'real_world_scenario',
                'cognitive_goal' => 'Apply core principles to realistic scenarios, diagnostics, and boundary conditions without notes.',
            ],
            [
                'stage_number' => 5,
                'stage_key' => 'mastery_verification',
                'stage_name' => 'Stage 5: Mastery Verification',
                'sub_angle' => 'feynman_synthesis',
                'cognitive_goal' => 'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
            ],
        ];
    }

    if ($n === 5) {
        return [
            [
                'stage_number' => 1,
                'stage_key' => 'schema_mapping',
                'stage_name' => 'Stage 1: Schema Mapping',
                'sub_angle' => 'macro_architecture',
                'cognitive_goal' => 'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
            ],
            [
                'stage_number' => 2,
                'stage_key' => 'closed_book_free_recall',
                'stage_name' => 'Stage 2: Closed-Book Free Recall',
                'sub_angle' => 'uncued_core_retrieval',
                'cognitive_goal' => 'Retrieve foundational concepts, definitions, and core facts directly from memory without consulting notes.',
            ],
            [
                'stage_number' => 3,
                'stage_key' => 'elaborative_interrogation',
                'stage_name' => 'Stage 3: Elaborative Interrogation',
                'sub_angle' => 'why_how_causality',
                'cognitive_goal' => 'Explain why and how mechanisms operate and contrast closely related concepts to deepen retrieval cues.',
            ],
            [
                'stage_number' => 4,
                'stage_key' => 'application_edge_cases',
                'stage_name' => 'Stage 4: Application & Edge Cases',
                'sub_angle' => 'real_world_scenario',
                'cognitive_goal' => 'Apply core principles to realistic scenarios, diagnostics, and boundary conditions without reference notes.',
            ],
            [
                'stage_number' => 5,
                'stage_key' => 'mastery_verification',
                'stage_name' => 'Stage 5: Mastery Verification',
                'sub_angle' => 'feynman_synthesis',
                'cognitive_goal' => 'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
            ],
        ];
    }

    if ($n === 6) {
        return [
            [
                'stage_number' => 1,
                'stage_key' => 'schema_mapping',
                'stage_name' => 'Stage 1: Schema Mapping',
                'sub_angle' => 'macro_architecture',
                'cognitive_goal' => 'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
            ],
            [
                'stage_number' => 2,
                'stage_key' => 'closed_book_free_recall',
                'stage_name' => 'Stage 2: Closed-Book Free Recall',
                'sub_angle' => 'uncued_core_retrieval',
                'cognitive_goal' => 'Retrieve foundational concepts, definitions, and core facts directly from memory without consulting notes.',
            ],
            [
                'stage_number' => 3,
                'stage_key' => 'elaborative_interrogation',
                'stage_name' => 'Stage 3: Elaborative Interrogation',
                'sub_angle' => 'compare_contrast',
                'cognitive_goal' => 'Explain why and how mechanisms operate and contrast closely related concepts to deepen retrieval cues.',
            ],
            [
                'stage_number' => 4,
                'stage_key' => 'application_core',
                'stage_name' => 'Stage 4: Core Application Practice',
                'sub_angle' => 'real_world_scenario',
                'cognitive_goal' => 'Apply core mechanisms to realistic real-world scenarios and justify decisions without consulting notes.',
            ],
            [
                'stage_number' => 4,
                'stage_key' => 'edge_cases_transfer',
                'stage_name' => 'Stage 4: Edge Cases & Transfer',
                'sub_angle' => 'boundary_test',
                'cognitive_goal' => 'Stress-test understanding against boundary conditions, failure modes, and cross-topic transfer cases.',
            ],
            [
                'stage_number' => 5,
                'stage_key' => 'mastery_verification',
                'stage_name' => 'Stage 5: Mastery Verification',
                'sub_angle' => 'feynman_synthesis',
                'cognitive_goal' => 'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
            ],
        ];
    }

    // N >= 7: Pin Stage 1 first and Stage 5 last; allocate middle m = N - 2
    $m = $n - 2;
    $s2Count = max(1, (int) round($m * 0.2));
    $s3Count = max(1, (int) round($m * 0.4));
    $s4Count = $m - $s2Count - $s3Count;
    if ($s4Count < 1) {
        $deficit = 1 - $s4Count;
        $trim3 = min($deficit, max(0, $s3Count - 1));
        $s3Count -= $trim3;
        $deficit -= $trim3;
        if ($deficit > 0) {
            $s2Count = max(1, $s2Count - $deficit);
        }
        $s4Count = max(1, $m - $s2Count - $s3Count);
    }

    $skeleton = [[
        'stage_number' => 1,
        'stage_key' => 'schema_mapping',
        'stage_name' => 'Stage 1: Schema Mapping',
        'sub_angle' => 'macro_architecture',
        'cognitive_goal' => 'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
    ]];

    $s2Angles = ['uncued_core_retrieval', 'terminology_constraints'];
    for ($i = 0; $i < $s2Count; $i++) {
        $angle = $s2Angles[$i % count($s2Angles)];
        $skeleton[] = [
            'stage_number' => 2,
            'stage_key' => 'closed_book_free_recall',
            'stage_name' => 'Stage 2: Closed-Book Free Recall',
            'sub_angle' => $angle,
            'cognitive_goal' => 'Retrieve foundational concepts, definitions, and core facts directly from memory without consulting notes.',
        ];
    }

    $s3Angles = ['uncued_brain_dump', 'compare_contrast', 'spot_misconception'];
    for ($i = 0; $i < $s3Count; $i++) {
        $angle = $s3Angles[$i % count($s3Angles)];
        $angleLabel = match ($angle) {
            'compare_contrast' => 'Stage 3: Elaborative Interrogation (Compare & Contrast)',
            'spot_misconception' => 'Stage 3: Elaborative Interrogation (Misconception Check)',
            default => 'Stage 3: Elaborative Interrogation',
        };
        $skeleton[] = [
            'stage_number' => 3,
            'stage_key' => 'elaborative_interrogation',
            'stage_name' => $angleLabel,
            'sub_angle' => $angle,
            'cognitive_goal' => 'Explain why and how mechanisms operate and contrast closely related concepts to deepen retrieval cues.',
        ];
    }

    $s4Angles = ['real_world_scenario', 'feynman_teachback', 'boundary_test'];
    for ($i = 0; $i < $s4Count; $i++) {
        $angle = $s4Angles[$i % count($s4Angles)];
        $angleLabel = match ($angle) {
            'feynman_teachback' => 'Stage 4: Applied Feynman Teach-Back',
            'boundary_test' => 'Stage 4: Application & Boundary Tests',
            default => 'Stage 4: Application & Edge Cases',
        };
        $skeleton[] = [
            'stage_number' => 4,
            'stage_key' => 'application_edge_cases',
            'stage_name' => $angleLabel,
            'sub_angle' => $angle,
            'cognitive_goal' => 'Apply core principles to realistic scenarios, diagnostics, and boundary conditions without reference notes.',
        ];
    }

    $skeleton[] = [
        'stage_number' => 5,
        'stage_key' => 'mastery_verification',
        'stage_name' => 'Stage 5: Mastery Verification',
        'sub_angle' => 'feynman_synthesis',
        'cognitive_goal' => 'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
    ];

    return $skeleton;
}

/**
 * Deterministic Study Mode Router (Deepening vs Spiral Chunking).
 *
 * @param int $sessionCount
 * @param int $studyWindowMinutes
 * @param int $wordCount
 * @param array<int, mixed> $conceptClusters
 * @param int $estimatedFirstPassMinutes
 * @return array{mode: string, target_chunk_count: int}
 */
function selectStudyMode(
    int $sessionCount,
    int $studyWindowMinutes,
    int $wordCount,
    array $conceptClusters,
    int $estimatedFirstPassMinutes
): array {
    // Gate 1: Short schedules (< 5 sessions) always use cohesive deepening
    if ($sessionCount < 5) {
        return ['mode' => 'deepening', 'target_chunk_count' => 1];
    }

    // Gate 2: Route broad or time-heavy material into Spiral Chunking when feasible
    $clusterCount = count($conceptClusters);
    $safeWindow = max(10, $studyWindowMinutes);
    $exceedsWindow = $estimatedFirstPassMinutes > ($safeWindow * 1.5);
    $isBroad = $clusterCount >= 3 || ($clusterCount >= 2 && $wordCount >= 2500);

    if ($clusterCount >= 2 && ($exceedsWindow || $isBroad)) {
        $maxChunks = min(4, $sessionCount - 3);
        if ($maxChunks >= 2) {
            return [
                'mode' => 'spiral_chunking',
                'target_chunk_count' => min($clusterCount, $maxChunks),
            ];
        }
    }

    return ['mode' => 'deepening', 'target_chunk_count' => 1];
}

/**
 * Assign progressive new/review chunk scopes across sessions when in spiral_chunking mode.
 * Returns null entries for deepening mode so sessions don't carry false chunk locks.
 *
 * @return array<int, array{new: array<int, string>, review: array<int, string>}|null>
 */
function assignSpiralChunkScopes(int $sessionCount, string $studyMode, int $targetChunkCount): array {
    $scopes = [];
    if ($studyMode !== 'spiral_chunking' || $targetChunkCount < 2 || $sessionCount < 5) {
        for ($i = 0; $i < $sessionCount; $i++) {
            $scopes[] = null;
        }
        return $scopes;
    }

    $chunkLabels = array_slice(['A', 'B', 'C', 'D'], 0, $targetChunkCount);

    for ($idx = 0; $idx < $sessionCount; $idx++) {
        if ($idx === 0) {
            $scopes[] = [
                'new' => [$chunkLabels[0]],
                'review' => [],
            ];
        } elseif ($idx < $targetChunkCount) {
            $scopes[] = [
                'new' => [$chunkLabels[$idx]],
                'review' => array_slice($chunkLabels, 0, $idx),
            ];
        } elseif ($idx === $sessionCount - 1) {
            $scopes[] = [
                'new' => [],
                'review' => ['ALL'],
            ];
        } else {
            $scopes[] = [
                'new' => [],
                'review' => $chunkLabels,
            ];
        }
    }

    return $scopes;
}

/**
 * Group extracted conceptClusters into labeled Chunk Modules ('A'..'D').
 *
 * @param array<int, mixed> $conceptClusters
 * @return array<string, array{label: string, title: string, key_concepts: array<int, string>}>
 */
function buildChunkModulesFromClusters(array $conceptClusters, int $targetChunkCount): array {
    if ($targetChunkCount < 2 || empty($conceptClusters)) {
        return [];
    }
    $labels = array_slice(['A', 'B', 'C', 'D'], 0, $targetChunkCount);
    $buckets = array_fill(0, $targetChunkCount, []);

    foreach (array_values($conceptClusters) as $i => $cluster) {
        if (!is_array($cluster)) {
            continue;
        }
        $buckets[$i % $targetChunkCount][] = $cluster;
    }

    $modules = [];
    foreach ($labels as $bIdx => $label) {
        $group = $buckets[$bIdx] ?? [];
        $titles = [];
        $concepts = [];
        foreach ($group as $c) {
            $t = trim((string) ($c['title'] ?? ''));
            if ($t !== '') {
                $titles[] = $t;
            }
            if (is_array($c['key_concepts'] ?? null)) {
                foreach ($c['key_concepts'] as $kc) {
                    $kcStr = trim((string) $kc);
                    if ($kcStr !== '') {
                        $concepts[] = $kcStr;
                    }
                }
            }
        }
        $modules[$label] = [
            'label' => $label,
            'title' => !empty($titles) ? implode(' & ', $titles) : "Module {$label}",
            'key_concepts' => array_values(array_unique($concepts)),
        ];
    }

    return $modules;
}

/**
 * Compute ascending expanding offsets in [0 .. $maxSpanDays] starting at offset 0.
 *
 * @return array<int, int>
 */
function computeExpandingOffsets(int $count, int $maxSpanDays): array {
    if ($count <= 0) {
        return [];
    }
    if ($count === 1) {
        return [0];
    }

    $span = max(0, $maxSpanDays);
    $offsets = [0];
    for ($i = 1; $i < $count; $i++) {
        $ratio = $i / ($count - 1);
        $offsets[] = (int) round($span * ($ratio ** 1.45));
    }

    // Forward strict-increase guard (>= 1 day between sessions)
    for ($i = 1; $i < $count; $i++) {
        if ($offsets[$i] <= $offsets[$i - 1]) {
            $offsets[$i] = $offsets[$i - 1] + 1;
        }
    }

    // If span has room for all sessions with >= 1 day gaps, pull back inside $span
    if ($span >= ($count - 1)) {
        if ($offsets[$count - 1] > $span) {
            $offsets[$count - 1] = $span;
        }
        for ($i = $count - 2; $i >= 1; $i--) {
            if ($offsets[$i] >= $offsets[$i + 1]) {
                $offsets[$i] = max($i, $offsets[$i + 1] - 1);
            }
        }
    }

    return $offsets;
}

/**
 * Parse `prompts_json` supporting legacy string[] and structured
 * [{prompt_text, chunk_tag?, expected_rubric_points}] items.
 *
 * @return array{prompts: array<int, string>, promptItems: array<int, array<string, mixed>>}
 */
function unpackPromptsPayload(mixed $decoded): array {
    $prompts = [];
    $promptItems = [];
    if (!is_array($decoded)) {
        return ['prompts' => [], 'promptItems' => []];
    }

    foreach ($decoded as $item) {
        if (is_string($item)) {
            $text = trim($item);
            if ($text !== '') {
                $prompts[] = $text;
                $promptItems[] = [
                    'prompt_text' => $text,
                    'expected_rubric_points' => [],
                ];
            }
        } elseif (is_array($item)) {
            $text = trim((string) ($item['prompt_text'] ?? $item['promptText'] ?? $item['text'] ?? ''));
            $chunkTag = trim((string) ($item['chunk_tag'] ?? $item['chunkTag'] ?? ''));
            $rubric = is_array($item['expected_rubric_points'] ?? null)
                ? array_values(array_filter(array_map(static fn($r) => trim((string) $r), $item['expected_rubric_points']), static fn($r) => $r !== ''))
                : [];
            if ($text !== '') {
                $prompts[] = $text;
                $entry = [
                    'prompt_text' => $text,
                    'expected_rubric_points' => $rubric,
                ];
                if ($chunkTag !== '') {
                    $entry['chunk_tag'] = $chunkTag;
                }
                $promptItems[] = $entry;
            }
        }
    }

    return [
        'prompts' => $prompts,
        'promptItems' => $promptItems,
    ];
}

/**
 * Format a raw database recall_attempts row.
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function formatAttemptRow(array $row): array {
    $strengths = json_decode((string) $row['strengths_json'], true) ?: [];
    $missing = json_decode((string) $row['missing_concepts_json'], true) ?: [];
    return [
        'id' => (int) $row['id'],
        'sessionId' => (int) $row['session_id'],
        'userResponseText' => (string) $row['user_response_text'],
        'aiScore' => (int) $row['ai_score'],
        'strengths' => $strengths,
        'whatYouNailed' => $strengths,
        'missingConcepts' => $missing,
        'missingToReview' => $missing,
        'correctiveFeedback' => (string) $row['corrective_feedback'],
        'cognitiveStageCheck' => (string) ($row['cognitive_stage_check'] ?? ''),
        'followUpQuestion' => (string) $row['follow_up_question'],
        'createdAt' => (string) $row['created_at'],
    ];
}

/**
 * Format a raw database study_sessions row into a typed frontend structure.
 *
 * @param array<string, mixed> $row
 * @param array<int, array<string, mixed>> $attempts
 * @return array<string, mixed>
 */
function formatSessionRow(array $row, array $attempts = []): array {
    $rawStageName = pbNormalizeStageLabel((string) $row['stage_name']);
    $sessionNumber = (int) $row['session_number'];
    $stageKey = trim((string) ($row['stage_key'] ?? ''));
    $stageNumber = isset($row['stage_number']) && (int) $row['stage_number'] >= 1 && (int) $row['stage_number'] <= 5
        ? (int) $row['stage_number']
        : pbInferStageNumber($rawStageName, $sessionNumber, $stageKey);

    if ($stageKey === '') {
        $stageKey = match ($stageNumber) {
            1 => 'schema_mapping',
            2 => 'closed_book_free_recall',
            3 => 'elaborative_interrogation',
            4 => 'application_edge_cases',
            default => 'mastery_verification',
        };
    }

    $decodedPrompts = json_decode((string) $row['prompts_json'], true);
    $unpacked = unpackPromptsPayload($decodedPrompts);

    $chunkScope = null;
    if (!empty($row['chunk_scope_json'])) {
        $decodedScope = json_decode((string) $row['chunk_scope_json'], true);
        if (is_array($decodedScope)) {
            $chunkScope = $decodedScope;
        }
    }

    return [
        'id' => (int) $row['id'],
        'planId' => (int) $row['plan_id'],
        'userId' => isset($row['user_id']) ? (int) $row['user_id'] : null,
        'sessionNumber' => $sessionNumber,
        'stageNumber' => $stageNumber,
        'stageName' => $rawStageName,
        'stageKey' => $stageKey,
        'scheduledDate' => (string) $row['scheduled_date'],
        'originalScheduledDate' => !empty($row['original_scheduled_date'])
            ? (string) $row['original_scheduled_date']
            : (string) $row['scheduled_date'],
        'dayOffset' => (int) $row['day_offset'],
        'gapDays' => (int) $row['gap_days'],
        'cognitiveGoal' => (string) $row['cognitive_goal'],
        'chunkScope' => $chunkScope,
        'continuityHook' => isset($row['continuity_hook']) ? (string) $row['continuity_hook'] : '',
        'prompts' => $unpacked['prompts'],
        'promptItems' => $unpacked['promptItems'],
        'verificationChecklist' => json_decode((string) $row['verification_checklist_json'], true) ?: [],
        'status' => (string) $row['status'],
        'mergedIntoSessionId' => isset($row['merged_into_session_id']) && $row['merged_into_session_id'] !== null
            ? (int) $row['merged_into_session_id']
            : null,
        'recalibrationCount' => isset($row['recalibration_count']) ? (int) $row['recalibration_count'] : 0,
        'masteryScore' => $row['mastery_score'] !== null ? (int) $row['mastery_score'] : null,
        'calendarEventId' => $row['calendar_event_id'] !== null ? (string) $row['calendar_event_id'] : null,
        'completedAt' => $row['completed_at'] !== null ? (string) $row['completed_at'] : null,
        'attempts' => $attempts,
    ];
}

/**
 * Load full study plan(s) with nested sessions and recall attempts.
 *
 * @return array<int, array<string, mixed>>
 */
function loadStudyPlans(PDO $pdo, ?int $planId = null, ?int $userId = null): array {
    if ($planId !== null) {
        if ($userId !== null) {
            $stmt = $pdo->prepare('SELECT * FROM study_plans WHERE id = :id AND user_id = :uid LIMIT 1');
            $stmt->execute([':id' => $planId, ':uid' => $userId]);
        } else {
            $stmt = $pdo->prepare('SELECT * FROM study_plans WHERE id = :id LIMIT 1');
            $stmt->execute([':id' => $planId]);
        }
    } elseif ($userId !== null) {
        $stmt = $pdo->prepare('SELECT * FROM study_plans WHERE user_id = :uid ORDER BY created_at DESC');
        $stmt->execute([':uid' => $userId]);
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
        $decodedBlueprint = null;
        if (!empty($pRow['blueprint_json'])) {
            $bpTmp = json_decode((string) $pRow['blueprint_json'], true);
            if (is_array($bpTmp)) {
                $decodedBlueprint = $bpTmp;
            }
        }
        $result[] = [
            'id' => $pid,
            'userId' => isset($pRow['user_id']) ? (int) $pRow['user_id'] : null,
            'userEmail' => (string) $pRow['user_email'],
            'topicTitle' => (string) $pRow['topic_title'],
            'studyMode' => (string) ($pRow['study_mode'] ?? 'deepening'),
            'targetChunkCount' => isset($pRow['target_chunk_count']) ? (int) $pRow['target_chunk_count'] : 1,
            'studyWindowMinutes' => isset($pRow['study_window_minutes']) ? (int) $pRow['study_window_minutes'] : 30,
            'executiveSummary' => (string) $pRow['executive_summary'],
            'coreConcepts' => json_decode((string) $pRow['core_concepts_json'], true) ?: [],
            'blueprint' => $decodedBlueprint,
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

/**
 * Merge unique promptItems and verificationChecklist arrays when folding sessions.
 *
 * @param array<int, array<string, mixed>> $targetPrompts
 * @param array<int, array<string, mixed>> $sourcePrompts
 * @return array<int, array<string, mixed>>
 */
function pbMergeUniquePromptItems(array $targetPrompts, array $sourcePrompts): array {
    $merged = [];
    $seen = [];
    foreach (array_merge($targetPrompts, $sourcePrompts) as $item) {
        $text = trim((string) ($item['prompt_text'] ?? ''));
        if ($text === '') {
            continue;
        }
        $norm = mb_strtolower($text);
        if (isset($seen[$norm])) {
            continue;
        }
        $seen[$norm] = true;
        $merged[] = $item;
    }
    return $merged;
}

/**
 * Merge unique checklist entries cleanly.
 *
 * @param array<int, string> $targetList
 * @param array<int, string> $sourceList
 * @return array<int, string>
 */
function pbMergeUniqueChecklist(array $targetList, array $sourceList): array {
    $merged = [];
    $seen = [];
    foreach (array_merge($targetList, $sourceList) as $entry) {
        $t = trim((string) $entry);
        if ($t === '') {
            continue;
        }
        $norm = mb_strtolower($t);
        if (isset($seen[$norm])) {
            continue;
        }
        $seen[$norm] = true;
        $merged[] = $t;
    }
    return $merged;
}

/**
 * Completion-Anchored Three-Tier Session Recalibration.
 * Preserves immutable completed history & recall_attempts; only mutates status = 'pending'.
 *
 * @param PDO $pdo
 * @param int $planId
 * @param string $anchorDate YYYY-MM-DD
 * @param string $mode 'auto' | 'tier1_only' | 'extend_7_days' | 'final_sprint_today'
 * @return array<string, mixed>
 */
function recalibratePlanSchedule(PDO $pdo, int $planId, string $anchorDate, string $mode = 'auto'): array {
    $planStmt = $pdo->prepare('SELECT * FROM study_plans WHERE id = :id LIMIT 1');
    $planStmt->execute([':id' => $planId]);
    $planRow = $planStmt->fetch();
    if (!$planRow) {
        return ['ok' => false, 'error' => 'Study plan not found.'];
    }

    // Strict Immutable History Lock: fetch only pending sessions
    $pendingStmt = $pdo->prepare(
        "SELECT * FROM study_sessions
         WHERE plan_id = :pid AND status = 'pending'
         ORDER BY session_number ASC, id ASC"
    );
    $pendingStmt->execute([':pid' => $planId]);
    $pendingRows = $pendingStmt->fetchAll();

    $pendingCount = count($pendingRows);
    if ($pendingCount === 0) {
        $plans = loadStudyPlans($pdo, $planId);
        return [
            'ok' => true,
            'tier' => 'no_pending_sessions',
            'recalibrated' => false,
            'shiftedCount' => 0,
            'mergedCount' => 0,
            'plan' => $plans[0] ?? null,
        ];
    }

    $planStartDate = (string) $planRow['start_date'];
    $masterByDate = (string) $planRow['master_by_date'];

    // Reference last completed session's date only for computing initial gap_days accurately
    $lastDoneStmt = $pdo->prepare(
        "SELECT scheduled_date FROM study_sessions
         WHERE plan_id = :pid AND status = 'completed'
         ORDER BY session_number DESC, id DESC LIMIT 1"
    );
    $lastDoneStmt->execute([':pid' => $planId]);
    $lastDoneRow = $lastDoneStmt->fetch();
    $lastCompletedDate = $lastDoneRow ? (string) $lastDoneRow['scheduled_date'] : null;

    $remainingDays = pbDiffCalendarDays($anchorDate, $masterByDate);

    // Tier 3 Deadline Squeeze pre-check when anchorDate >= masterByDate
    if ($remainingDays <= 0) {
        if ($mode === 'tier1_only') {
            return [
                'ok' => true,
                'tier' => 'skipped_non_tier1',
                'recalibrated' => false,
                'shiftedCount' => 0,
                'mergedCount' => 0,
                'plan' => null,
            ];
        }

        if ($mode === 'auto') {
            // Do not mutate DB — ask learner to choose resolution strategy
            $plans = loadStudyPlans($pdo, $planId);
            return [
                'ok' => true,
                'tier' => 'deadline_squeeze',
                'recalibrated' => false,
                'shiftedCount' => 0,
                'mergedCount' => 0,
                'options' => ['extend_7_days', 'final_sprint_today'],
                'plan' => $plans[0] ?? null,
            ];
        }

        if ($mode === 'extend_7_days') {
            $baseEnd = $masterByDate > $anchorDate ? $masterByDate : $anchorDate;
            $newMasterByDate = pbAddCalendarDays($baseEnd, 7);
            $pdo->prepare('UPDATE study_plans SET master_by_date = :mbd WHERE id = :pid')
                ->execute([':mbd' => $newMasterByDate, ':pid' => $planId]);
            $masterByDate = $newMasterByDate;
            $remainingDays = pbDiffCalendarDays($anchorDate, $masterByDate);
            // Fall through into Tier 1 or Tier 2 with extended deadline
        } elseif ($mode === 'final_sprint_today') {
            try {
                $pdo->beginTransaction();

                $lastIdx = $pendingCount - 1;
                $targetRow = $pendingRows[$lastIdx];
                $targetId = (int) $targetRow['id'];

                $combinedPrompts = unpackPromptsPayload(json_decode((string) $targetRow['prompts_json'], true))['promptItems'];
                $combinedChecklist = json_decode((string) $targetRow['verification_checklist_json'], true) ?: [];

                $mergedCount = 0;
                $markMergedStmt = $pdo->prepare(
                    "UPDATE study_sessions
                     SET status = 'merged',
                         merged_into_session_id = :tid,
                         recalibration_count = recalibration_count + 1
                     WHERE id = :id AND status = 'pending'"
                );

                for ($i = 0; $i < $lastIdx; $i++) {
                    $srcRow = $pendingRows[$i];
                    $srcPrompts = unpackPromptsPayload(json_decode((string) $srcRow['prompts_json'], true))['promptItems'];
                    $srcChecklist = json_decode((string) $srcRow['verification_checklist_json'], true) ?: [];
                    $combinedPrompts = pbMergeUniquePromptItems($srcPrompts, $combinedPrompts);
                    $combinedChecklist = pbMergeUniqueChecklist($srcChecklist, $combinedChecklist);

                    $markMergedStmt->execute([
                        ':tid' => $targetId,
                        ':id' => (int) $srcRow['id'],
                    ]);
                    $mergedCount++;
                }

                $dayOffset = max(0, pbDiffCalendarDays($planStartDate, $anchorDate));
                $gapDays = $lastCompletedDate !== null
                    ? max(0, pbDiffCalendarDays($lastCompletedDate, $anchorDate))
                    : 0;

                if ($masterByDate < $anchorDate) {
                    $pdo->prepare('UPDATE study_plans SET master_by_date = :mbd WHERE id = :pid')
                        ->execute([':mbd' => $anchorDate, ':pid' => $planId]);
                }

                $updSprintStmt = $pdo->prepare(
                    "UPDATE study_sessions
                     SET stage_number = 5,
                         stage_key = 'mastery_verification',
                         stage_name = 'Stage 5: Mastery Verification (Final Sprint)',
                         scheduled_date = :sd,
                         day_offset = :do,
                         gap_days = :gd,
                         prompts_json = :pj,
                         verification_checklist_json = :vj,
                         recalibration_count = recalibration_count + 1
                     WHERE id = :id AND status = 'pending'"
                );
                $updSprintStmt->execute([
                    ':sd' => $anchorDate,
                    ':do' => $dayOffset,
                    ':gd' => $gapDays,
                    ':pj' => json_encode($combinedPrompts, JSON_UNESCAPED_UNICODE),
                    ':vj' => json_encode($combinedChecklist, JSON_UNESCAPED_UNICODE),
                    ':id' => $targetId,
                ]);

                $pdo->commit();
                $plans = loadStudyPlans($pdo, $planId);
                return [
                    'ok' => true,
                    'tier' => 'tier3_final_sprint',
                    'recalibrated' => true,
                    'shiftedCount' => 1,
                    'mergedCount' => $mergedCount,
                    'plan' => $plans[0] ?? null,
                ];
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                return [
                    'ok' => false,
                    'error' => 'Final sprint consolidation failed: ' . $e->getMessage(),
                ];
            }
        }
    }

    // Tier 1: Runway is sufficient ($remainingDays >= $pendingCount)
    if ($remainingDays >= $pendingCount) {
        try {
            $pdo->beginTransaction();

            $maxSpan = max($pendingCount - 1, $remainingDays - 1);
            $offsets = computeExpandingOffsets($pendingCount, $maxSpan);

            $updStmt = $pdo->prepare(
                "UPDATE study_sessions
                 SET scheduled_date = :sd,
                     day_offset = :do,
                     gap_days = :gd,
                     recalibration_count = recalibration_count + 1
                 WHERE id = :id AND status = 'pending'"
            );

            $prevDate = $lastCompletedDate;
            foreach ($pendingRows as $idx => $row) {
                $newDate = pbAddCalendarDays($anchorDate, $offsets[$idx]);
                $dayOffset = max(0, pbDiffCalendarDays($planStartDate, $newDate));
                $gapDays = ($idx === 0 && $prevDate === null)
                    ? 0
                    : ($prevDate !== null ? max(0, pbDiffCalendarDays($prevDate, $newDate)) : 0);

                $updStmt->execute([
                    ':sd' => $newDate,
                    ':do' => $dayOffset,
                    ':gd' => $gapDays,
                    ':id' => (int) $row['id'],
                ]);
                $prevDate = $newDate;
            }

            $pdo->commit();
            $plans = loadStudyPlans($pdo, $planId);
            return [
                'ok' => true,
                'tier' => $mode === 'extend_7_days' ? 'tier3_extended' : 'tier1_shifted',
                'recalibrated' => true,
                'shiftedCount' => $pendingCount,
                'mergedCount' => 0,
                'plan' => $plans[0] ?? null,
            ];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            return [
                'ok' => false,
                'error' => 'Tier 1 schedule recalibration failed: ' . $e->getMessage(),
            ];
        }
    }

    // Tier 2: Compressed Runway ($remainingDays >= 1 && $remainingDays < $pendingCount)
    if ($mode === 'tier1_only') {
        return [
            'ok' => true,
            'tier' => 'skipped_non_tier1',
            'recalibrated' => false,
            'shiftedCount' => 0,
            'mergedCount' => 0,
            'plan' => null,
        ];
    }

    try {
        $pdo->beginTransaction();

        $targetSlots = max(1, $remainingDays);
        $lastIdx = $pendingCount - 1;

        // Identify Spiral Chunking protection & unpack payloads
        $entries = [];
        foreach ($pendingRows as $idx => $row) {
            $scope = !empty($row['chunk_scope_json'])
                ? json_decode((string) $row['chunk_scope_json'], true)
                : null;
            $hasNewChunk = is_array($scope) && !empty($scope['new']);
            $isFinal = ($idx === $lastIdx);
            $entries[] = [
                'row' => $row,
                'id' => (int) $row['id'],
                'isFinal' => $isFinal,
                'protected' => $hasNewChunk || $isFinal,
                'prompts' => unpackPromptsPayload(json_decode((string) $row['prompts_json'], true))['promptItems'],
                'checklist' => json_decode((string) $row['verification_checklist_json'], true) ?: [],
                'merged' => false,
                'mergedInto' => null,
            ];
        }

        $keptCount = $pendingCount;
        // Prefer folding duplicate/middle review-only sessions from earlier middle slots onward
        if ($keptCount > $targetSlots) {
            for ($i = 0; $i < $pendingCount && $keptCount > $targetSlots; $i++) {
                if ($entries[$i]['protected'] || $entries[$i]['merged']) {
                    continue;
                }
                // Find nearest surviving subsequent session
                $targetIdx = null;
                for ($j = $i + 1; $j < $pendingCount; $j++) {
                    if (!$entries[$j]['merged']) {
                        $targetIdx = $j;
                        break;
                    }
                }
                if ($targetIdx === null) {
                    continue;
                }
                $entries[$i]['merged'] = true;
                $entries[$i]['mergedInto'] = $entries[$targetIdx]['id'];
                $entries[$targetIdx]['prompts'] = pbMergeUniquePromptItems(
                    $entries[$targetIdx]['prompts'],
                    $entries[$i]['prompts']
                );
                $entries[$targetIdx]['checklist'] = pbMergeUniqueChecklist(
                    $entries[$targetIdx]['checklist'],
                    $entries[$i]['checklist']
                );
                $keptCount--;
            }
        }

        $markMergedStmt = $pdo->prepare(
            "UPDATE study_sessions
             SET status = 'merged',
                 merged_into_session_id = :tid,
                 recalibration_count = recalibration_count + 1
             WHERE id = :id AND status = 'pending'"
        );

        $keptIndices = [];
        $mergedCount = 0;
        foreach ($entries as $idx => $entry) {
            if ($entry['merged']) {
                $markMergedStmt->execute([
                    ':tid' => $entry['mergedInto'],
                    ':id' => $entry['id'],
                ]);
                $mergedCount++;
            } else {
                $keptIndices[] = $idx;
            }
        }

        $survivingCount = count($keptIndices);
        // Pin final session cleanly on masterByDate (or 1 day prior when 1 session overflows softly)
        $offsets = computeExpandingOffsets($survivingCount, $remainingDays);

        $updKeptStmt = $pdo->prepare(
            "UPDATE study_sessions
             SET scheduled_date = :sd,
                 day_offset = :do,
                 gap_days = :gd,
                 prompts_json = :pj,
                 verification_checklist_json = :vj,
                 recalibration_count = recalibration_count + 1
             WHERE id = :id AND status = 'pending'"
        );

        $prevDate = $lastCompletedDate;
        $latestDate = $masterByDate;
        foreach ($keptIndices as $kPos => $entryIdx) {
            $entry = $entries[$entryIdx];
            $newDate = pbAddCalendarDays($anchorDate, $offsets[$kPos]);
            if ($kPos === $survivingCount - 1 && $survivingCount >= 2 && $remainingDays >= $survivingCount) {
                // Ensure final session pins right on masterByDate or 1 day prior inside runway
                if ($newDate > $masterByDate) {
                    $newDate = $masterByDate;
                }
            }
            if ($newDate > $latestDate) {
                $latestDate = $newDate;
            }
            $dayOffset = max(0, pbDiffCalendarDays($planStartDate, $newDate));
            $gapDays = ($kPos === 0 && $prevDate === null)
                ? 0
                : ($prevDate !== null ? max(0, pbDiffCalendarDays($prevDate, $newDate)) : 0);

            $updKeptStmt->execute([
                ':sd' => $newDate,
                ':do' => $dayOffset,
                ':gd' => $gapDays,
                ':pj' => json_encode($entry['prompts'], JSON_UNESCAPED_UNICODE),
                ':vj' => json_encode($entry['checklist'], JSON_UNESCAPED_UNICODE),
                ':id' => $entry['id'],
            ]);
            $prevDate = $newDate;
        }

        if ($latestDate > $masterByDate) {
            $pdo->prepare('UPDATE study_plans SET master_by_date = :mbd WHERE id = :pid')
                ->execute([':mbd' => $latestDate, ':pid' => $planId]);
        }

        $pdo->commit();
        $plans = loadStudyPlans($pdo, $planId);
        return [
            'ok' => true,
            'tier' => $mode === 'extend_7_days' ? 'tier3_extended' : 'tier2_compressed',
            'recalibrated' => true,
            'shiftedCount' => $survivingCount,
            'mergedCount' => $mergedCount,
            'plan' => $plans[0] ?? null,
        ];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        return [
            'ok' => false,
            'error' => 'Tier 2 compressed recalibration failed: ' . $e->getMessage(),
        ];
    }
}
