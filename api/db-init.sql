-- ============================================================================
-- SpacedPractice AI — Hostinger MySQL Database Schema (PHP 8.2+ / MySQL 8.0+)
-- Production Target: https://english-3D.com/study/
-- Run this script in Hostinger phpMyAdmin to initialize the database tables.
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 1. Table: study_plans
-- Stores the master spaced-practice study plan, core concept schema map,
-- source URLs, and the LONGTEXT extracted_context_cache for closed-book AI grading.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `study_plans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_email` VARCHAR(255) NOT NULL DEFAULT 'learner@english-3d.com',
  `topic_title` VARCHAR(255) NOT NULL,
  `executive_summary` TEXT NOT NULL,
  `core_concepts_json` JSON NOT NULL,
  `source_links_json` JSON NOT NULL,
  `extracted_context_cache` LONGTEXT NOT NULL COMMENT '1,000-2,000 word structured digest + extracted text from uploaded files/URLs for subsequent AI recall grading',
  `start_date` DATE NOT NULL,
  `master_by_date` DATE NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_study_plans_user_email` (`user_email`),
  INDEX `idx_study_plans_dates` (`start_date`, `master_by_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Table: study_sessions
-- Stores each Cepeda et al. (2008) spaced retrieval session, cognitive goal,
-- stage-specific active-recall prompts, and verification rubric checklist.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `study_sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id` INT UNSIGNED NOT NULL,
  `session_number` INT NOT NULL,
  `stage_name` VARCHAR(160) NOT NULL,
  `scheduled_date` DATE NOT NULL,
  `day_offset` INT NOT NULL DEFAULT 0,
  `gap_days` INT NOT NULL DEFAULT 0,
  `cognitive_goal` TEXT NOT NULL,
  `prompts_json` JSON NOT NULL,
  `verification_checklist_json` JSON NOT NULL,
  `status` ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
  `mastery_score` INT DEFAULT NULL,
  `calendar_event_id` VARCHAR(255) DEFAULT NULL,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_study_sessions_plan_id` (`plan_id`),
  INDEX `idx_study_sessions_scheduled_date` (`scheduled_date`),
  INDEX `idx_study_sessions_status` (`status`),
  CONSTRAINT `fk_study_sessions_plan`
    FOREIGN KEY (`plan_id`) REFERENCES `study_plans` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Table: recall_attempts
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
  `follow_up_question` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_recall_attempts_session_id` (`session_id`),
  CONSTRAINT `fk_recall_attempts_session`
    FOREIGN KEY (`session_id`) REFERENCES `study_sessions` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

