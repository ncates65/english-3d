-- ============================================================================
-- Practice Buddy ("PB") — Hostinger MySQL Database Schema (PHP 8.2+ / MySQL 8.0+)
-- Production Target: https://english-3d.com/study/
-- Run this script in Hostinger phpMyAdmin to initialize the database tables.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 1. Table: users
-- Supports registered email/password accounts, Google OAuth, and Guest Mode.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Table: study_plans
-- Stores the master spaced-practice study plan, core concept schema map,
-- source URLs, and the LONGTEXT extracted_context_cache for closed-book AI grading.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `study_plans` (
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
  `extracted_context_cache` LONGTEXT NOT NULL COMMENT '1,000-2,000 word structured digest + extracted text from uploaded files/URLs for subsequent AI recall grading',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Table: study_sessions
-- Stores each Cepeda et al. (2008) spaced retrieval session, stage number,
-- cognitive goal, stage-specific prompts with expected_rubric_points, and rubric.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `study_sessions` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Table: recall_attempts
-- Stores every active-recall or Feynman teach-back submission graded by Gemini.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `recall_attempts` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
