import {
  GradeRecallEvaluation,
  ScheduledSessionBlueprint,
  StudyPlan,
  StudySession,
  StudyWindowConfig,
  UploadedFilePayload,
} from '../types/study';
import {
  addCalendarDays,
  calculateSpacedSchedule,
  formatLocalDate,
} from '../utils/spacingEngine';

const API_BASE = '/study/api';
const LOCAL_STORAGE_KEY = 'spaced_practice_ai_plans_v1';

/**
 * Seed a realistic, evidence-based demo StudyPlan in localStorage so first-time visitors
 * or local Vite previews immediately see a rich schedule and can test the AI Recall Grader.
 */
function createDefaultSeedPlans(): StudyPlan[] {
  const today = formatLocalDate(new Date());
  const masterDate = addCalendarDays(today, 14);
  const schedule = calculateSpacedSchedule(today, masterDate);

  const stagePrompts: Record<number, { prompts: string[]; checklist: string[] }> = {
    1: {
      prompts: [
        'Without looking at notes, draw or describe the 4-stage pipeline of Cellular Respiration (Glycolysis → Pyruvate Oxidation → Citric Acid Cycle → Oxidative Phosphorylation) and state the exact cellular compartment for each.',
        'How does the proton-motive force across the inner mitochondrial membrane couple the Electron Transport Chain (Complexes I–IV) to ATP Synthase rotary catalysis?',
        'Contrast substrate-level phosphorylation with oxidative phosphorylation in terms of mechanism, oxygen dependency, and net ATP yield.',
      ],
      checklist: [
        'Correctly locates Glycolysis in cytosol, Pyruvate oxidation & Citric Acid Cycle in mitochondrial matrix, and ETC in cristae/inner mitochondrial membrane.',
        'Explains NADH and FADH2 as high-energy electron donors driving proton pumping into the intermembrane space.',
        'Describes chemiosmosis via F0/F1 ATP Synthase and O2 as the terminal electron acceptor forming H2O.',
        'Distinguishes direct enzymatic phosphate transfer (substrate-level) from electrochemical gradient coupling.',
      ],
    },
    2: {
      prompts: [
        'Closed-Book Brain Dump: Write down every regulatory enzyme of Glycolysis and the Citric Acid Cycle you can recall, along with which molecules allosterically inhibit or activate them.',
        'Retrieve from memory the exact net inputs and outputs of a single turn of the Citric Acid Cycle vs. two turns per glucose molecule.',
        'What happens to the NADH/NAD+ ratio if Complex IV (Cytochrome c oxidase) is blocked by cyanide, and why does the Citric Acid Cycle halt even though it uses no O2 directly?',
      ],
      checklist: [
        'Identifies Phosphofructokinase-1 (PFK-1) as the committed pacemaker step inhibited by ATP/citrate and activated by AMP/Fructose-2,6-bisphosphate.',
        'States 2 Acetyl-CoA per glucose yield 6 NADH, 2 FADH2, 2 GTP/ATP, and 4 CO2.',
        'Explains that Complex IV blockade traps electron carriers in reduced state (NADH/FADH2), depleting oxidized NAD+ required by Isocitrate Dehydrogenase and alpha-Ketoglutarate Dehydrogenase.',
      ],
    },
    3: {
      prompts: [
        'Elaborative Interrogation (WHY): Why does the cell invest 2 ATP during the preparatory phase of glycolysis before harvesting any energy, and how does hexokinase phosphorylation trap glucose inside the cell?',
        'Elaborative Interrogation (HOW): How do brown adipose tissue uncoupling proteins (UCP1 / thermogenin) alter the relationship between oxygen consumption rate and ATP synthesis?',
        'Why does FADH2 entering at Complex II yield ~1.5 ATP whereas NADH entering at Complex I yields ~2.5 ATP?',
      ],
      checklist: [
        'Explains electrostatic trapping of negatively charged Glucose-6-Phosphate across the plasma membrane and destabilization of the hexose ring.',
        'Explains that UCP1 dissipates the proton gradient as heat, causing maximal ETC electron flow and O2 consumption while ATP synthesis drops.',
        'Notes that Complex II (Succinate Dehydrogenase) does not pump protons across the inner membrane, contributing fewer H+ per electron pair.',
      ],
    },
    4: {
      prompts: [
        'Clinical Diagnostic Scenario: A patient presents with severe hyperthermia, profuse sweating, rapid breathing, and lactic acidosis after exposure to 2,4-Dinitrophenol (DNP). Diagnose the exact biochemical mechanism and predict their mitochondrial O2 consumption and ATP/ADP ratio.',
        'Edge-Case Problem: Under anaerobic burst exercise in fast-twitch skeletal muscle, explain how lactate dehydrogenase (LDH) sustains glycolytic ATP production and how the Cori Cycle restores hepatic glucose.',
      ],
      checklist: [
        'Identifies DNP as a lipid-soluble protonophore that shuttles H+ across the inner mitochondrial membrane, collapsing the electrochemical gradient.',
        'Predicts plummeting ATP/ADP ratio, loss of respiratory control, runaway fuel oxidation, and compensatory anaerobic glycolysis causing lactic acidosis.',
        'Explains that LDH oxidizes NADH back to NAD+ so Glyceraldehyde-3-phosphate dehydrogenase (GAPDH) can continue operating.',
      ],
    },
    5: {
      prompts: [
        'Feynman Teach-Back Mastery Verification: Imagine teaching an inquisitive 14-year-old how a single glucose molecule powers their heartbeat. Explain the entire journey from cytosolic splitting to the molecular waterwheel (ATP Synthase) without hiding behind unexplained jargon.',
        'Self-Audit: Explicitly explain the feedback loops that slow down cellular respiration when the cell is resting with abundant ATP.',
      ],
      checklist: [
        'Uses clear, mechanistic analogies while preserving biochemical accuracy (cytosol vs. matrix vs. intermembrane space).',
        'Clearly explains electron harvesting (NADH/FADH2), proton gradient buildup, and chemiosmotic ATP synthesis.',
        'Covers allosteric feedback inhibition of PFK-1, Pyruvate Dehydrogenase, and Isocitrate Dehydrogenase by high ATP/NADH.',
      ],
    },
  };

  const sessions: StudySession[] = schedule.sessions.map((bp, idx) => {
    const template = stagePrompts[idx + 1] || stagePrompts[5];
    const isFirstCompleted = idx === 0;
    return {
      id: 100 + idx + 1,
      planId: 1,
      sessionNumber: bp.sessionNumber,
      stageName: bp.stageName,
      scheduledDate: bp.scheduledDate,
      dayOffset: bp.dayOffset,
      gapDays: bp.gapDays,
      cognitiveGoal: bp.cognitiveGoal,
      prompts: template.prompts,
      verificationChecklist: template.checklist,
      status: isFirstCompleted ? 'completed' : 'pending',
      masteryScore: isFirstCompleted ? 91 : null,
      calendarEventId: null,
      completedAt: isFirstCompleted ? `${today} 10:15:00` : null,
      attempts: isFirstCompleted
        ? [
            {
              id: 501,
              sessionId: 101,
              userResponseText:
                'Cellular respiration proceeds through four coupled stages: (1) Glycolysis in the cytosol converts 1 glucose into 2 pyruvate, 2 net ATP (via substrate-level phosphorylation), and 2 NADH. (2) Pyruvate oxidation in the mitochondrial matrix uses the Pyruvate Dehydrogenase Complex to decarboxylate pyruvate into Acetyl-CoA, releasing CO2 and reducing NAD+ to NADH. (3) The Citric Acid Cycle in the matrix oxidizes Acetyl-CoA to 2 CO2 per turn while generating 3 NADH, 1 FADH2, and 1 GTP. (4) Oxidative phosphorylation across the inner mitochondrial membrane uses Complexes I, III, and IV to pump protons into the intermembrane space as electrons flow to terminal acceptor O2, and F0F1 ATP Synthase uses the resulting proton-motive force to synthesize ~26-28 ATP.',
              aiScore: 91,
              strengths: [
                'Accurate compartmentalization across cytosol, mitochondrial matrix, and inner mitochondrial membrane.',
                'Clear distinction between substrate-level phosphorylation and chemiosmotic oxidative phosphorylation.',
                'Precise accounting of electron carriers (NADH, FADH2) and terminal electron acceptor O2.',
              ],
              missingConcepts: [
                'Could explicitly note that Complex II (Succinate Dehydrogenase) transfers electrons from FADH2 via ubiquinone without pumping protons.',
              ],
              correctiveFeedback:
                'Outstanding initial schema map! Your structural trace from cytosolic glycolysis to rotary catalysis at F0F1 ATP Synthase is rock-solid. To reach 100%, explicitly incorporate why FADH2 yields fewer ATP than NADH (Complex II bypasses Complex I proton translocation).',
              followUpQuestion:
                'How does cytosolic NADH produced during glycolysis transfer its reducing equivalents into the mitochondrial matrix in heart/liver cells versus skeletal muscle cells?',
              createdAt: `${today} 10:15:00`,
            },
          ]
        : [],
    };
  });

  return [
    {
      id: 1,
      userEmail: 'learner@english-3d.com',
      topicTitle: 'Bioenergetics: Cellular Respiration & Chemiosmotic ATP Synthesis',
      executiveSummary:
        'Master the four coupled stages of aerobic cellular respiration, allosteric metabolic regulation (PFK-1, PDH, Citric Acid Cycle), chemiosmotic proton-motive coupling, and clinical uncoupling scenarios across a 14-day Cepeda medium-horizon schedule.',
      coreConcepts: [
        {
          id: 'pillar-1',
          title: 'Glycolytic Payoff & Allosteric Pacemakers',
          summary:
            'Cytosolic 10-step oxidation of glucose to 2 pyruvate yielding 2 net ATP and 2 NADH, gated by Phosphofructokinase-1 (PFK-1) energy sensing.',
          connections:
            'Supplies pyruvate to the mitochondrial matrix and relies on aerobic shuttle systems or anaerobic LDH to regenerate NAD+.',
        },
        {
          id: 'pillar-2',
          title: 'Pyruvate Oxidation & Citric Acid Cycle Hub',
          summary:
            'Matrix oxidation of carbon skeletons to CO2, harvesting high-energy electrons in 6 NADH and 2 FADH2 per glucose.',
          connections:
            'Depends strictly on oxidized NAD+ and FAD regenerated by the Electron Transport Chain.',
        },
        {
          id: 'pillar-3',
          title: 'Electron Transport & Proton-Motive Force',
          summary:
            'Redox-driven proton translocation across Complexes I, III, and IV builds Δp (electrical ΔΨ + chemical ΔpH) across the inner membrane.',
          connections:
            'Directly powers rotary catalysis in F0/F1 ATP Synthase; sensitive to uncouplers (DNP, UCP1) and complex inhibitors (cyanide, rotenone).',
        },
        {
          id: 'pillar-4',
          title: 'Respiratory Control & Feedback Homeostasis',
          summary:
            'High [ATP]/[ADP] and [NADH]/[NAD+] ratios allosterically throttle PFK-1, Pyruvate Dehydrogenase, and Isocitrate Dehydrogenase.',
          connections:
            'Prevents futile substrate oxidation when cellular energy charge is saturated.',
        },
      ],
      sourceLinks: [
        {
          url: 'https://www.ncbi.nlm.nih.gov/books/NBK21208/',
          title: 'Molecular Cell Biology — Oxidative Phosphorylation & Chemiosmosis',
          status: 'harvested',
        },
      ],
      extractedContextCache:
        'AUTHORITATIVE SOURCE DIGEST — BIOENERGETICS & CELLULAR RESPIRATION:\n' +
        '1. Overview & Compartmentalization: Aerobic oxidation of glucose (C6H12O6 + 6 O2 -> 6 CO2 + 6 H2O, ΔG°\' = -2870 kJ/mol) captures energy in ~30-32 ATP molecules per glucose.\n' +
        '2. Stage 1 — Glycolysis (Cytosol): Investment of 2 ATP at Hexokinase and Phosphofructokinase-1 (PFK-1); Cleavage by Aldolase into DHAP and G3P; Payoff phase via GAPDH (producing 2 NADH) and substrate-level phosphorylation at Phosphoglycerate Kinase (2 ATP) and Pyruvate Kinase (2 ATP). Net yield: 2 Pyruvate, 2 ATP, 2 NADH. PFK-1 is the committed step: inhibited by high ATP and Citrate; activated by AMP, ADP, and Fructose-2,6-bisphosphate.\n' +
        '3. Stage 2 — Pyruvate Oxidation (Mitochondrial Matrix): Pyruvate enters via Mitochondrial Pyruvate Carrier (MPC). Pyruvate Dehydrogenase Complex (PDC, requiring TPP, lipoamide, CoA, FAD, NAD+) catalyzes oxidative decarboxylation of 2 Pyruvate -> 2 Acetyl-CoA + 2 CO2 + 2 NADH.\n' +
        '4. Stage 3 — Citric Acid Cycle / Krebs Cycle (Mitochondrial Matrix): Citrate Synthase condenses Acetyl-CoA (2C) + Oxaloacetate (4C) -> Citrate (6C). Isocitrate Dehydrogenase and alpha-Ketoglutarate Dehydrogenase catalyze oxidative decarboxylations producing NADH and CO2. Succinyl-CoA Synthetase produces GTP (substrate-level phosphorylation). Succinate Dehydrogenase (Complex II, embedded in inner membrane) oxidizes succinate to fumarate producing FADH2. Malate Dehydrogenase regenerates Oxaloacetate and produces NADH. Per glucose (2 turns): 6 NADH, 2 FADH2, 2 GTP/ATP, 4 CO2.\n' +
        '5. Stage 4 — Oxidative Phosphorylation (Inner Mitochondrial Membrane): NADH donates 2e- to Complex I (NADH:ubiquinone oxidoreductase, pumps 4 H+). FADH2 donates 2e- via Complex II to Ubiquinone (CoQ) with 0 H+ pumped. Complex III (Cytochrome bc1, Q-cycle) transfers e- to Cytochrome c and pumps 4 H+. Complex IV (Cytochrome c oxidase) reduces 1/2 O2 + 2H+ -> H2O and pumps 2 H+. Total H+ pumped: 10 H+ per NADH (~2.5 ATP), 6 H+ per FADH2 (~1.5 ATP). F0F1 ATP Synthase uses proton flux down electrochemical gradient (chemiosmosis) to phosphorylate ADP + Pi -> ATP.\n' +
        '6. Uncouplers & Inhibitors: Protonophores (2,4-DNP) and UCP1 (thermogenin in brown fat) permeabilize the inner membrane to H+, collapsing Δp, halting ATP synthesis while accelerating electron transport, O2 consumption, and heat dissipation. Cyanide/CO inhibit Complex IV, halting electron flow, collapsing proton pumping, and trapping NADH so the Citric Acid Cycle arrests from NAD+ depletion.',
      startDate: today,
      masterByDate: masterDate,
      createdAt: `${today} 09:00:00`,
      sessions,
      studyWindow: {
        startHour: '09:00',
        endHour: '17:00',
        durationMinutes: 30,
        syncMode: 'google_calendar',
      },
    },
  ];
}

function loadLocalPlans(): StudyPlan[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const seeded = createDefaultSeedPlans();
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : createDefaultSeedPlans();
  } catch {
    return createDefaultSeedPlans();
  }
}

function saveLocalPlans(plans: StudyPlan[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // Ignore storage quota errors
  }
}

export interface ApiInitData {
  plans: StudyPlan[];
  backendLive: boolean;
  googleOAuthClientId: string;
  geminiModel: string;
}

/**
 * Fetch all study plans from Hostinger MySQL (`/study/api/plans.php`),
 * falling back cleanly to local storage when running without a PHP/MySQL backend.
 */
export async function fetchAllPlans(): Promise<ApiInitData> {
  try {
    const res = await fetch(`${API_BASE}/plans.php`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.plans)) {
        const localPlans = loadLocalPlans();
        const merged =
          data.plans.length > 0 ? (data.plans as StudyPlan[]) : localPlans;
        saveLocalPlans(merged);
        return {
          plans: merged,
          backendLive: true,
          googleOAuthClientId:
            data.config?.googleOAuthClientId ||
            localStorage.getItem('sp_google_client_id') ||
            '',
          geminiModel: data.config?.geminiModel || 'gemini-3.8-flash',
        };
      }
    }
  } catch {
    // Backend PHP/MySQL is offline in local Vite preview
  }

  return {
    plans: loadLocalPlans(),
    backendLive: false,
    googleOAuthClientId: localStorage.getItem('sp_google_client_id') || '',
    geminiModel: 'gemini-3.8-flash',
  };
}

/**
 * Generate a cognitive-scaffolded Spaced Study Plan via `/study/api/gemini.php?action=generate_plan`
 * and store it in MySQL (`study_plans` + `study_sessions`).
 */
export async function generateAndSaveStudyPlan(params: {
  topicPrompt: string;
  urls: string[];
  files: UploadedFilePayload[];
  startDate: string;
  masterByDate: string;
  scheduledBlueprints: ScheduledSessionBlueprint[];
  studyWindow: StudyWindowConfig;
  userEmail?: string;
}): Promise<{ plan: StudyPlan; persistedInMySql: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/gemini.php?action=generate_plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generate_plan',
        topicPrompt: params.topicPrompt,
        urls: params.urls,
        files: params.files,
        startDate: params.startDate,
        masterByDate: params.masterByDate,
        scheduledBlueprints: params.scheduledBlueprints,
        userEmail: params.userEmail || 'learner@english-3d.com',
        saveToDb: true,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.plan) {
        const createdPlan: StudyPlan = {
          ...data.plan,
          id: data.plan.id || Date.now(),
          createdAt: data.plan.createdAt || new Date().toISOString(),
          studyWindow: params.studyWindow,
        };
        const current = loadLocalPlans();
        saveLocalPlans([createdPlan, ...current]);
        return { plan: createdPlan, persistedInMySql: !data.plan.dbWarning };
      }
    }
  } catch {
    // Fallback to client-side synthesized plan when PHP proxy is unreachable
  }

  // Synthesize an evidence-based plan locally so user workflow always succeeds
  const synthesized = buildSynthesizedPlanFallback(params);
  const current = loadLocalPlans();
  saveLocalPlans([synthesized, ...current]);
  return { plan: synthesized, persistedInMySql: false };
}

/**
 * Grade an Active-Recall or Feynman Teach-Back attempt via `POST /study/api/gemini.php?action=grade_recall`.
 */
export async function submitRecallForGrading(params: {
  plan: StudyPlan;
  session: StudySession;
  userResponseText: string;
}): Promise<{
  evaluation: GradeRecallEvaluation;
  updatedPlan: StudyPlan;
}> {
  let evaluation: GradeRecallEvaluation | null = null;

  try {
    const res = await fetch(`${API_BASE}/gemini.php?action=grade_recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'grade_recall',
        sessionId: params.session.id,
        topicTitle: params.plan.topicTitle,
        stageName: params.session.stageName,
        cognitiveGoal: params.session.cognitiveGoal,
        prompts: params.session.prompts,
        verificationChecklist: params.session.verificationChecklist,
        extractedContextCache: params.plan.extractedContextCache,
        userResponseText: params.userResponseText,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.evaluation) {
        evaluation = data.evaluation as GradeRecallEvaluation;
      }
    }
  } catch {
    // Use deterministic rubric analyzer if PHP proxy is offline
  }

  if (!evaluation) {
    evaluation = evaluateRecallAgainstRubricFallback(
      params.plan,
      params.session,
      params.userResponseText
    );
  }

  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const newAttempt = {
    id: Date.now(),
    sessionId: params.session.id,
    userResponseText: params.userResponseText,
    aiScore: evaluation.masteryScore,
    strengths: evaluation.accuratePoints,
    missingConcepts: evaluation.missedOrInaccurateConcepts,
    correctiveFeedback: evaluation.coachFeedback,
    followUpQuestion: evaluation.socraticFollowUpQuestion,
    createdAt: nowIso,
  };

  const plans = loadLocalPlans();
  const updatedPlans = plans.map((p) => {
    if (p.id !== params.plan.id) return p;
    return {
      ...p,
      sessions: p.sessions.map((s) => {
        if (s.id !== params.session.id) return s;
        return {
          ...s,
          status: 'completed' as const,
          masteryScore: evaluation!.masteryScore,
          completedAt: nowIso,
          attempts: [newAttempt, ...(s.attempts || [])],
        };
      }),
    };
  });

  saveLocalPlans(updatedPlans);
  const updatedPlan =
    updatedPlans.find((p) => p.id === params.plan.id) || params.plan;

  return { evaluation, updatedPlan };
}

/**
 * Schedule an Adaptive Booster Session (+2 Days) when masteryScore < 70.
 */
export async function scheduleAdaptiveBoosterSession(params: {
  plan: StudyPlan;
  session: StudySession;
  missingConcepts: string[];
  followUpQuestion: string;
}): Promise<{ updatedPlan: StudyPlan; newSession: StudySession }> {
  try {
    const res = await fetch(
      `${API_BASE}/plans.php?action=add_booster_session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_booster_session',
          sessionId: params.session.id,
          missingConcepts: params.missingConcepts,
          followUpQuestion: params.followUpQuestion,
        }),
      }
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.plan) {
        const updatedPlan = data.plan as StudyPlan;
        const plans = loadLocalPlans().map((p) =>
          p.id === updatedPlan.id ? updatedPlan : p
        );
        saveLocalPlans(plans);
        const booster =
          updatedPlan.sessions.find((s) => s.id === data.boosterSessionId) ||
          updatedPlan.sessions[updatedPlan.sessions.length - 1];
        return { updatedPlan, newSession: booster };
      }
    }
  } catch {
    // Fallback to local adaptive booster insertion
  }

  const today = formatLocalDate(new Date());
  const baseDate =
    params.session.scheduledDate > today ? params.session.scheduledDate : today;
  const boosterDate = addCalendarDays(baseDate, 2);

  const remedialPrompts: string[] = [];
  if (params.followUpQuestion) {
    remedialPrompts.push(`Socratic Remediation: ${params.followUpQuestion}`);
  }
  for (const concept of params.missingConcepts.slice(0, 3)) {
    remedialPrompts.push(
      `Targeted Retrieval Repair: Explain the exact mechanism and role of "${concept}" from memory without consulting source notes.`
    );
  }
  if (remedialPrompts.length === 0) {
    remedialPrompts.push(...params.session.prompts.slice(0, 2));
  }

  const newSession: StudySession = {
    id: Date.now(),
    planId: params.plan.id,
    sessionNumber: params.plan.sessions.length + 1,
    stageName: 'Adaptive Booster — Targeted Error Remediation (+2d)',
    scheduledDate: boosterDate,
    dayOffset: params.session.dayOffset + 2,
    gapDays: 2,
    cognitiveGoal: `Eliminate retrieval gaps identified in Session #${params.session.sessionNumber} and stabilize long-term memory consolidation.`,
    prompts: remedialPrompts,
    verificationChecklist:
      params.missingConcepts.length > 0
        ? params.missingConcepts.map(
            (c) => `Resolved & accurately retrieved: ${c}`
          )
        : params.session.verificationChecklist,
    status: 'pending',
    masteryScore: null,
    calendarEventId: null,
    completedAt: null,
    attempts: [],
  };

  const plans = loadLocalPlans();
  const updatedPlans = plans.map((p) => {
    if (p.id !== params.plan.id) return p;
    const allSessions = [...p.sessions, newSession].sort((a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate)
    );
    return {
      ...p,
      sessions: allSessions.map((s, idx) => ({
        ...s,
        sessionNumber: idx + 1,
      })),
    };
  });

  saveLocalPlans(updatedPlans);
  const updatedPlan =
    updatedPlans.find((p) => p.id === params.plan.id) || params.plan;

  return { updatedPlan, newSession };
}

/**
 * Delete a Study Plan.
 */
export async function deleteStudyPlan(planId: number): Promise<StudyPlan[]> {
  try {
    await fetch(`${API_BASE}/plans.php?plan_id=${encodeURIComponent(planId)}`, {
      method: 'DELETE',
    });
  } catch {
    // Continue with local deletion
  }
  const remaining = loadLocalPlans().filter((p) => p.id !== planId);
  saveLocalPlans(remaining);
  return remaining;
}

/**
 * Deterministic rubric-based fallback evaluator when running in local preview without PHP backend.
 */
function evaluateRecallAgainstRubricFallback(
  plan: StudyPlan,
  session: StudySession,
  responseText: string
): GradeRecallEvaluation {
  const normalized = responseText.toLowerCase();
  const wordCount = responseText
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const accuratePoints: string[] = [];
  const missedOrInaccurateConcepts: string[] = [];

  for (const criterion of session.verificationChecklist) {
    // Extract meaningful keywords (>= 4 chars) from each rubric checklist item
    const keywords = criterion
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 4 &&
          ![
            'that',
            'this',
            'with',
            'from',
            'into',
            'Correctly',
            'explains',
            'describes',
            'identifies',
            'states',
            'between',
            'without',
          ].includes(w)
      );

    const matchedCount = keywords.filter((kw) => normalized.includes(kw)).length;
    const ratio = keywords.length > 0 ? matchedCount / keywords.length : 0;

    if (ratio >= 0.32 && wordCount >= 18) {
      accuratePoints.push(criterion);
    } else {
      missedOrInaccurateConcepts.push(criterion);
    }
  }

  const checklistRatio =
    session.verificationChecklist.length > 0
      ? accuratePoints.length / session.verificationChecklist.length
      : 0.5;
  const depthBonus = Math.min(25, Math.floor(wordCount / 6));
  const rawScore = Math.round(checklistRatio * 75 + depthBonus);
  const masteryScore = Math.max(15, Math.min(98, rawScore));

  if (accuratePoints.length === 0 && wordCount >= 10) {
    accuratePoints.push(
      `Initiated closed-book active recall (${wordCount} words) addressing ${plan.topicTitle}.`
    );
  }

  const recommendAdaptiveExtraSession = masteryScore < 70;

  const coachFeedback =
    masteryScore >= 80
      ? `Strong closed-book retrieval (${masteryScore}% mastery)! You articulated the core mechanisms clearly. Review any remaining nuance in the verification rubric below to lock in 100% precision before your next expanding-interval session.`
      : masteryScore >= 70
      ? `Solid foundational recall (${masteryScore}%), though ${missedOrInaccurateConcepts.length} rubric criterion(s) need tighter mechanistic specificity. Compare your response with the unlocked Source Digest and answer the Socratic follow-up below.`
      : `Your retrieval attempt (${masteryScore}%) reveals fragile encoding on key mechanisms (${missedOrInaccurateConcepts.length} checklist criteria missed). Because effortful retrieval errors are the strongest signal for memory reconsolidation, schedule an Adaptive Booster Session (+2 Days) below to reinforce these traces before they decay.`;

  const firstMissed =
    missedOrInaccurateConcepts[0] ||
    session.verificationChecklist[0] ||
    plan.coreConcepts[0]?.title ||
    plan.topicTitle;

  const socraticFollowUpQuestion = `Focusing specifically on "${firstMissed}", what is the underlying causal mechanism that links this concept to the rest of ${plan.topicTitle}, and what would fail if that mechanism were disrupted?`;

  return {
    masteryScore,
    accuratePoints,
    missedOrInaccurateConcepts,
    coachFeedback,
    socraticFollowUpQuestion,
    recommendAdaptiveExtraSession,
  };
}

/**
 * Synthesize a structured StudyPlan locally when `/study/api/gemini.php` is unreachable in offline dev preview.
 */
function buildSynthesizedPlanFallback(params: {
  topicPrompt: string;
  urls: string[];
  files: UploadedFilePayload[];
  startDate: string;
  masterByDate: string;
  scheduledBlueprints: ScheduledSessionBlueprint[];
  studyWindow: StudyWindowConfig;
  userEmail?: string;
}): StudyPlan {
  const planId = Date.now();
  const cleanTitle =
    params.topicPrompt.split(/[.\n]/)[0]?.trim().slice(0, 85) ||
    params.files[0]?.name.replace(/\.[^.]+$/, '') ||
    'Custom Spaced Mastery Plan';

  // Extract decoded text from uploaded text/markdown/csv files if present
  const decodedSnippets: string[] = [];
  for (const f of params.files) {
    if (
      f.mimeType.startsWith('text/') ||
      f.name.endsWith('.md') ||
      f.name.endsWith('.txt') ||
      f.name.endsWith('.csv')
    ) {
      try {
        const rawB64 = f.base64Data.includes(',')
          ? f.base64Data.split(',')[1]
          : f.base64Data;
        decodedSnippets.push(
          `--- File: ${f.name} ---\n${atob(rawB64).slice(0, 4000)}`
        );
      } catch {
        // Ignore binary decode error
      }
    }
  }

  const coreConcepts = [
    {
      id: 'c1',
      title: `Foundational Architecture of ${cleanTitle}`,
      summary: `Defines the primary boundaries, governing principles, and first-principles definitions for ${cleanTitle}.`,
      connections:
        'Serves as the structural anchor for causal mechanisms in Pillar 2 and real-world diagnostics in Pillar 3.',
    },
    {
      id: 'c2',
      title: 'Causal Mechanisms & Dynamic Interactions',
      summary:
        'Traces how state transitions, inputs, and feedback loops operate across the system.',
      connections:
        'Connects foundational definitions to edge-case behavior under stress or boundary constraints.',
    },
    {
      id: 'c3',
      title: 'Diagnostic Application & Boundary Failure Modes',
      summary:
        'Evaluates how to diagnose breakdowns, distinguish look-alike concepts, and apply rules to novel problems.',
      connections:
        'Tested directly in Stage 4 Application scenarios and the final Feynman Teach-Back synthesis.',
    },
  ];

  const sessions: StudySession[] = params.scheduledBlueprints.map((bp, idx) => ({
    id: planId + idx + 1,
    planId,
    sessionNumber: bp.sessionNumber,
    stageName: bp.stageName,
    scheduledDate: bp.scheduledDate,
    dayOffset: bp.dayOffset,
    gapDays: bp.gapDays,
    cognitiveGoal: bp.cognitiveGoal,
    prompts: [
      `[${bp.stageName}] Closed-Book Prompt 1: Without consulting source notes, reconstruct the core conceptual architecture and primary mechanisms of "${cleanTitle}".`,
      `[${bp.stageName}] Closed-Book Prompt 2: Explain why the key processes in "${cleanTitle}" operate the way they do, highlighting cause-and-effect relationships.`,
      `[${bp.stageName}] Closed-Book Prompt 3: Create a concrete diagnostic scenario or real-world edge case for "${cleanTitle}" and solve it step-by-step from memory.`,
    ],
    verificationChecklist: [
      `Accurately defines the core principles and terminology of ${cleanTitle} without vague generalizations.`,
      'Articulates the causal "why" and "how" linking the macro conceptual pillars.',
      'Identifies boundary conditions, failure modes, or contrasting edge cases.',
      'Demonstrates clear, jargon-free Feynman synthesis suitable for teaching a novice.',
    ],
    status: 'pending',
    masteryScore: null,
    calendarEventId: null,
    completedAt: null,
    attempts: [],
  }));

  return {
    id: planId,
    userEmail: params.userEmail || 'learner@english-3d.com',
    topicTitle: cleanTitle,
    executiveSummary: `Evidence-based spaced retrieval plan for "${cleanTitle}" spanning ${params.startDate} to ${params.masterByDate} (${sessions.length} Cepeda-optimal sessions).`,
    coreConcepts,
    sourceLinks: params.urls.map((u) => ({
      url: u,
      title: u,
      status: 'harvested',
    })),
    extractedContextCache: [
      `STUDY FOCUS & OBJECTIVES:\n${params.topicPrompt}`,
      decodedSnippets.length > 0
        ? `\nEXTRACTED FILE CONTENTS:\n${decodedSnippets.join('\n\n')}`
        : '',
      params.urls.length > 0
        ? `\nSOURCE URLS:\n${params.urls.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    startDate: params.startDate,
    masterByDate: params.masterByDate,
    createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    sessions,
    studyWindow: params.studyWindow,
  };
}

