import {
  GradeRecallEvaluation,
  ScheduledSessionBlueprint,
  SessionPromptItem,
  StudyPlan,
  StudySession,
  StudyWindowConfig,
  UploadedFilePayload,
  UserAccount,
} from '../types/study';
import {
  addCalendarDays,
  calculateSpacedSchedule,
  CognitiveStageNumber,
  diffCalendarDays,
  formatLocalDate,
  normalizeStageName,
  resolveStageNumber,
} from '../utils/spacingEngine';
import { requestGoogleOAuthToken } from '../utils/calendarSync';

const API_BASE = '/study/api';
const LEGACY_STORAGE_KEY = 'spaced_practice_ai_plans_v1';
const SEED_INITIALIZED_KEY = 'practice_buddy_seed_initialized_v1';
const GUEST_TOKEN_KEY = 'pb_guest_token_v1';
const AUTH_TOKEN_KEY = 'pb_auth_token_v1';
const AUTH_USER_KEY = 'pb_auth_user_v1';
const OFFLINE_USERS_KEY = 'pb_offline_accounts_v1';

// -----------------------------------------------------------------------------
// Guest Token & Auth Storage Helpers
// -----------------------------------------------------------------------------
function generateGuestToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return 'pb_g_' + crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // Fallback below
  }
  return (
    'pb_g_' +
    Math.random().toString(36).slice(2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

export function getOrCreateLocalGuestToken(): string {
  try {
    const existing = localStorage.getItem(GUEST_TOKEN_KEY);
    if (existing && existing.length >= 16) {
      return existing;
    }
    const fresh = generateGuestToken();
    localStorage.setItem(GUEST_TOKEN_KEY, fresh);
    return fresh;
  } catch {
    return generateGuestToken();
  }
}

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): UserAccount | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserAccount;
    if (parsed && typeof parsed.id === 'number') {
      return parsed;
    }
  } catch {
    // Ignore
  }
  return null;
}

function saveStoredAuthSession(user: UserAccount, token?: string | null): void {
  try {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else if (user.isGuest) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
    if (user.isGuest && user.guestToken) {
      localStorage.setItem(GUEST_TOKEN_KEY, user.guestToken);
    }
  } catch {
    // Ignore quota errors
  }
}

function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const guestToken = getOrCreateLocalGuestToken();
  if (guestToken) {
    headers['X-Guest-Token'] = guestToken;
  }
  const authToken = getStoredAuthToken();
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
    headers['X-Auth-Token'] = authToken;
  }
  return headers;
}

function getPlansStorageKey(user?: UserAccount | null): string {
  const active = user || getStoredUser();
  if (active && !active.isGuest) {
    return `pb_plans_user_${active.id}`;
  }
  const gt = active?.guestToken || getOrCreateLocalGuestToken();
  return `pb_plans_guest_${gt}`;
}

function isSeedInitialized(scopeKey: string): boolean {
  try {
    return (
      localStorage.getItem(`${SEED_INITIALIZED_KEY}_${scopeKey}`) === '1' ||
      localStorage.getItem(SEED_INITIALIZED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function markSeedInitialized(scopeKey: string): void {
  try {
    localStorage.setItem(`${SEED_INITIALIZED_KEY}_${scopeKey}`, '1');
    localStorage.setItem(SEED_INITIALIZED_KEY, '1');
  } catch {
    // Ignore storage quota errors
  }
}

function normalizePlanData(plan: StudyPlan): StudyPlan {
  return {
    ...plan,
    sessions: (plan.sessions || []).map((s, idx) => {
      const stageName = normalizeStageName(s.stageName || '');
      const stageNumber = resolveStageNumber({
        stageNumber: s.stageNumber,
        stageName,
        sessionNumber: s.sessionNumber || idx + 1,
      });
      const promptItems: SessionPromptItem[] =
        Array.isArray(s.promptItems) && s.promptItems.length > 0
          ? s.promptItems
          : (s.prompts || []).map((p) => ({
            prompt_text: p,
            expected_rubric_points: [],
          }));
      return {
        ...s,
        stageNumber,
        stageName,
        promptItems,
        prompts: promptItems.map((pi) => pi.prompt_text),
      };
    }),
  };
}

// -----------------------------------------------------------------------------
// Seed Demo Plan & Stage-Specific Prompt Templates
// -----------------------------------------------------------------------------
function createDefaultSeedPlans(): StudyPlan[] {
  const today = formatLocalDate(new Date());
  const masterDate = addCalendarDays(today, 14);
  const schedule = calculateSpacedSchedule(today, masterDate);

  const stageTemplates: Record<
    number,
    { promptItems: SessionPromptItem[]; checklist: string[] }
  > = {
    1: {
      promptItems: [
        {
          prompt_text:
            'Map the 4-stage macro architecture of Cellular Respiration (Glycolysis -> Pyruvate Oxidation -> Citric Acid Cycle -> Oxidative Phosphorylation), grouping each stage by cellular compartment, primary inputs, and main outputs.',
          expected_rubric_points: [
            'Places Glycolysis in cytosol, Pyruvate oxidation & Citric Acid Cycle in mitochondrial matrix, and ETC in inner mitochondrial membrane',
            'Connects pyruvate output from glycolysis to Acetyl-CoA entry in the matrix',
            'Links NADH/FADH2 electron harvesting to oxidative phosphorylation',
          ],
        },
        {
          prompt_text:
            'Trace how the Electron Transport Chain (Complexes I–IV) connects to ATP Synthase and distinguish substrate-level phosphorylation from oxidative phosphorylation at a high level.',
          expected_rubric_points: [
            'Explains proton pumping into intermembrane space creating proton-motive force',
            'Identifies F0/F1 ATP Synthase chemiosmotic coupling and O2 as terminal acceptor',
            'Contrasts direct enzymatic phosphate transfer with gradient-driven ATP synthesis',
          ],
        },
      ],
      checklist: [
        'Correctly locates Glycolysis in cytosol, Pyruvate oxidation & Citric Acid Cycle in mitochondrial matrix, and ETC in inner mitochondrial membrane.',
        'Explains NADH and FADH2 as electron donors driving proton pumping into the intermembrane space.',
        'Describes chemiosmosis via F0/F1 ATP Synthase and O2 as the terminal electron acceptor forming H2O.',
        'Distinguishes direct enzymatic phosphate transfer (substrate-level) from electrochemical gradient coupling.',
      ],
    },
    2: {
      promptItems: [
        {
          prompt_text:
            'Closed-Book Free Recall: List every key regulatory enzyme of Glycolysis and the Citric Acid Cycle from memory, along with its allosteric activators and inhibitors.',
          expected_rubric_points: [
            'Identifies PFK-1 as committed pacemaker step inhibited by ATP/citrate and activated by AMP/Fructose-2,6-bisphosphate',
            'Recalls Pyruvate Dehydrogenase and Isocitrate Dehydrogenase regulation',
            'States exact net yield per glucose for Glycolysis and 2 turns of Citric Acid Cycle',
          ],
        },
        {
          prompt_text:
            'Retrieve from memory the exact net inputs and outputs of two turns of the Citric Acid Cycle per glucose molecule, and state what happens to NAD+ if Complex IV is blocked.',
          expected_rubric_points: [
            'States 2 Acetyl-CoA yield 6 NADH, 2 FADH2, 2 GTP/ATP, and 4 CO2',
            'Explains Complex IV blockade traps NADH/FADH2 in reduced state',
            'Identifies NAD+ depletion halting Isocitrate and alpha-Ketoglutarate Dehydrogenases',
          ],
        },
      ],
      checklist: [
        'Identifies Phosphofructokinase-1 (PFK-1) as the committed pacemaker step inhibited by ATP/citrate and activated by AMP/Fructose-2,6-bisphosphate.',
        'States 2 Acetyl-CoA per glucose yield 6 NADH, 2 FADH2, 2 GTP/ATP, and 4 CO2.',
        'Explains that Complex IV blockade traps electron carriers in reduced state, depleting NAD+.',
      ],
    },
    3: {
      promptItems: [
        {
          prompt_text:
            'Why does the cell invest 2 ATP during the preparatory phase of glycolysis before harvesting energy, and how does hexokinase phosphorylation trap glucose inside the cell?',
          expected_rubric_points: [
            'Explains negative charge on Glucose-6-Phosphate prevents diffusion across lipid bilayer',
            'Explains conformational/energetic priming destabilizes hexose ring for Aldolase cleavage',
            'Contrasts hexokinase trapping with irreversible PFK-1 commitment',
          ],
        },
        {
          prompt_text:
            'Why does FADH2 entering at Complex II yield ~1.5 ATP whereas NADH entering at Complex I yields ~2.5 ATP, and how does UCP1 alter oxygen consumption vs. ATP yield?',
          expected_rubric_points: [
            'Notes Complex II (Succinate Dehydrogenase) pumps 0 protons across inner membrane',
            'Quantifies 10 H+ per NADH vs. 6 H+ per FADH2',
            'Explains UCP1 dissipates proton gradient as heat, accelerating O2 consumption while dropping ATP output',
          ],
        },
      ],
      checklist: [
        'Explains electrostatic trapping of negatively charged Glucose-6-Phosphate and ring destabilization.',
        'Explains that UCP1 dissipates the proton gradient as heat, maximizing O2 consumption while ATP drops.',
        'Notes Complex II does not pump protons across the inner mitochondrial membrane.',
      ],
    },
    4: {
      promptItems: [
        {
          prompt_text:
            'Clinical Diagnostic Scenario: A patient presents with severe hyperthermia, profuse sweating, rapid breathing, and lactic acidosis after exposure to 2,4-Dinitrophenol (DNP). Diagnose the exact biochemical mechanism and predict mitochondrial O2 consumption and ATP/ADP ratio.',
          expected_rubric_points: [
            'Identifies DNP as a lipid-soluble protonophore collapsing the H+ electrochemical gradient',
            'Predicts falling ATP/ADP ratio and loss of respiratory control',
            'Explains runaway O2 consumption/heat generation plus compensatory anaerobic glycolysis causing lactic acidosis',
          ],
        },
        {
          prompt_text:
            'Edge-Case Problem: Under anaerobic burst exercise in fast-twitch skeletal muscle, explain how lactate dehydrogenase (LDH) sustains glycolytic ATP production and how the Cori Cycle restores hepatic glucose.',
          expected_rubric_points: [
            'Explains LDH reduces pyruvate to lactate while oxidizing NADH back to NAD+',
            'Identifies NAD+ regeneration as essential for GAPDH to keep glycolysis running',
            'Describes Cori Cycle hepatic gluconeogenesis consuming ATP to recycle lactate',
          ],
        },
      ],
      checklist: [
        'Identifies DNP as a protonophore collapsing the electrochemical gradient.',
        'Predicts plummeting ATP/ADP ratio, runaway O2 consumption, and lactic acidosis.',
        'Explains LDH oxidizes NADH back to NAD+ so GAPDH continues operating.',
      ],
    },
    5: {
      promptItems: [
        {
          prompt_text:
            'Mastery Synthesis Challenge: Teach the complete story of how one glucose molecule powers a heartbeat—integrating compartmentalized stages, electron shuttles, proton-motive catalysis, and allosteric feedback homeostasis—in clear, rigorous language.',
          expected_rubric_points: [
            'Integrates all 4 stages across cytosol, matrix, and inner membrane seamlessly',
            'Explains electron carrier harvesting, proton-motive force, and ATP Synthase rotary mechanism',
            'Covers allosteric feedback inhibition of PFK-1, PDH, and Isocitrate Dehydrogenase at high ATP/NADH',
          ],
        },
      ],
      checklist: [
        'Uses clear, mechanistic synthesis while preserving biochemical accuracy across compartments.',
        'Explains electron harvesting (NADH/FADH2), proton gradient buildup, and chemiosmotic ATP synthesis.',
        'Covers allosteric feedback inhibition of PFK-1, Pyruvate Dehydrogenase, and Isocitrate Dehydrogenase.',
      ],
    },
  };

  const sessions: StudySession[] = schedule.sessions.map((bp, idx) => {
    const template = stageTemplates[bp.stageNumber] || stageTemplates[5];
    const isFirstCompleted = idx === 0;
    return {
      id: 100 + idx + 1,
      planId: 1,
      sessionNumber: bp.sessionNumber,
      stageNumber: bp.stageNumber,
      stageName: bp.stageName,
      scheduledDate: bp.scheduledDate,
      dayOffset: bp.dayOffset,
      gapDays: bp.gapDays,
      cognitiveGoal: bp.cognitiveGoal,
      prompts: template.promptItems.map((p) => p.prompt_text),
      promptItems: template.promptItems,
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
              'Cellular respiration proceeds through four coupled stages: (1) Glycolysis in the cytosol converts 1 glucose into 2 pyruvate, 2 net ATP (via substrate-level phosphorylation), and 2 NADH. (2) Pyruvate oxidation in the mitochondrial matrix uses the Pyruvate Dehydrogenase Complex to convert pyruvate into Acetyl-CoA, releasing CO2 and NADH. (3) The Citric Acid Cycle in the matrix oxidizes Acetyl-CoA to CO2 while generating NADH, FADH2, and GTP. (4) Oxidative phosphorylation across the inner mitochondrial membrane uses Complexes I, III, and IV to pump protons into the intermembrane space as electrons flow to terminal acceptor O2, and F0F1 ATP Synthase uses the resulting proton-motive force to synthesize ~26-28 ATP.',
            aiScore: 91,
            strengths: [
              'Accurate compartmentalization across cytosol, mitochondrial matrix, and inner mitochondrial membrane.',
              'Clear distinction between substrate-level phosphorylation and chemiosmotic oxidative phosphorylation.',
              'Precise accounting of electron carriers (NADH, FADH2) and terminal electron acceptor O2.',
            ],
            whatYouNailed: [
              'Accurate compartmentalization across cytosol, mitochondrial matrix, and inner mitochondrial membrane.',
              'Clear distinction between substrate-level phosphorylation and chemiosmotic oxidative phosphorylation.',
            ],
            cognitiveStageCheck:
              'Stage 1 Check Passed: You mapped the 4-stage architecture, cellular compartments, and primary structural connections cleanly.',
            missingConcepts: [
              'Explicitly note that Complex II (Succinate Dehydrogenase) transfers electrons from FADH2 via ubiquinone without pumping protons.',
            ],
            missingToReview: [
              'Explicitly note that Complex II (Succinate Dehydrogenase) transfers electrons from FADH2 via ubiquinone without pumping protons.',
            ],
            correctiveFeedback:
              'Outstanding initial schema map! Your structural trace from cytosolic glycolysis to rotary catalysis at F0F1 ATP Synthase is rock-solid.',
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
        '1. Overview & Compartmentalization: Aerobic oxidation of glucose captures energy in ~30-32 ATP molecules per glucose across cytosol, matrix, and inner mitochondrial membrane.\n' +
        '2. Glycolysis (Cytosol): Investment of 2 ATP at Hexokinase and PFK-1; Payoff phase via GAPDH (2 NADH) and substrate-level phosphorylation (4 ATP gross, 2 net). PFK-1 is inhibited by ATP/citrate and activated by AMP/Fructose-2,6-bisphosphate.\n' +
        '3. Pyruvate Oxidation & Citric Acid Cycle (Matrix): PDC oxidizes 2 Pyruvate -> 2 Acetyl-CoA + 2 CO2 + 2 NADH. Two turns of the Citric Acid Cycle yield 6 NADH, 2 FADH2, 2 GTP/ATP, and 4 CO2.\n' +
        '4. Oxidative Phosphorylation (Inner Membrane): Complex I pumps 4 H+, Complex II (FADH2) pumps 0 H+, Complex III pumps 4 H+, Complex IV reduces O2 to H2O and pumps 2 H+. Proton flux powers F0F1 ATP Synthase.\n' +
        '5. Uncouplers & Inhibitors: 2,4-DNP and UCP1 collapse the proton gradient, halting ATP synthesis while increasing O2 consumption and heat; cyanide blocks Complex IV.',
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

function loadLocalPlans(user?: UserAccount | null): StudyPlan[] {
  const activeUser = user || getStoredUser();
  const key = getPlansStorageKey(activeUser);

  try {
    let raw = localStorage.getItem(key);
    // Migrate legacy single-user storage on guest load if present
    if (raw === null && (!activeUser || activeUser.isGuest)) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) {
        raw = legacy;
        localStorage.setItem(key, legacy);
      }
    }

    if (raw === null) {
      if (!isSeedInitialized(key) && (!activeUser || activeUser.isGuest)) {
        const seeded = createDefaultSeedPlans();
        saveLocalPlans(seeded, activeUser);
        markSeedInitialized(key);
        return seeded;
      }
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as StudyPlan[]).map(normalizePlanData)
      : [];
  } catch {
    return isSeedInitialized(key) ? [] : createDefaultSeedPlans();
  }
}

function saveLocalPlans(plans: StudyPlan[], user?: UserAccount | null): void {
  const key = getPlansStorageKey(user);
  try {
    localStorage.setItem(key, JSON.stringify(plans.map(normalizePlanData)));
  } catch {
    // Ignore storage quota errors
  }
}

function migrateLocalGuestPlans(
  guestToken: string,
  targetUser: UserAccount
): number {
  const guestKey = `pb_plans_guest_${guestToken}`;
  const targetKey = getPlansStorageKey(targetUser);
  if (guestKey === targetKey) return 0;

  try {
    const rawGuest = localStorage.getItem(guestKey);
    if (!rawGuest) return 0;
    const guestPlans = JSON.parse(rawGuest) as StudyPlan[];
    if (!Array.isArray(guestPlans) || guestPlans.length === 0) return 0;

    const rawTarget = localStorage.getItem(targetKey);
    const existingTarget = rawTarget
      ? (JSON.parse(rawTarget) as StudyPlan[])
      : [];
    const seen = new Set(existingTarget.map((p) => `${p.topicTitle}::${p.startDate}`));

    const migrated = guestPlans
      .filter((gp) => !seen.has(`${gp.topicTitle}::${gp.startDate}`))
      .map((gp) => ({
        ...gp,
        userId: targetUser.id,
        userEmail: targetUser.email || gp.userEmail,
      }));

    const combined = [...migrated, ...existingTarget];
    localStorage.setItem(targetKey, JSON.stringify(combined.map(normalizePlanData)));
    localStorage.removeItem(guestKey);
    return migrated.length;
  } catch {
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Offline Auth Fallback (when running Vite preview without PHP/MySQL)
// -----------------------------------------------------------------------------
interface OfflineAccountRecord {
  id: number;
  email: string;
  password: string;
  displayName: string;
}

function loadOfflineAccounts(): OfflineAccountRecord[] {
  try {
    const raw = localStorage.getItem(OFFLINE_USERS_KEY);
    return raw ? (JSON.parse(raw) as OfflineAccountRecord[]) : [];
  } catch {
    return [];
  }
}

function saveOfflineAccounts(accounts: OfflineAccountRecord[]): void {
  try {
    localStorage.setItem(OFFLINE_USERS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore
  }
}

// -----------------------------------------------------------------------------
// Auth API Operations (`/study/api/auth.php`)
// -----------------------------------------------------------------------------
export async function ensureAuthSession(): Promise<UserAccount> {
  const guestToken = getOrCreateLocalGuestToken();
  const storedUser = getStoredUser();

  try {
    const res = await fetch(
      `${API_BASE}/auth.php?guest_token=${encodeURIComponent(guestToken)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...buildAuthHeaders(),
        },
      }
    );
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.user) {
        const user = data.user as UserAccount;
        saveStoredAuthSession(user, data.token || null);
        return user;
      }
    }
  } catch {
    // Offline local preview fallback
  }

  if (storedUser) {
    return storedUser;
  }

  const guestUser: UserAccount = {
    id: 0,
    email: null,
    displayName: 'Guest Mode',
    isGuest: true,
    guestToken,
  };
  saveStoredAuthSession(guestUser, null);
  return guestUser;
}

export async function continueAsGuest(): Promise<UserAccount> {
  const guestToken = getOrCreateLocalGuestToken();
  try {
    const res = await fetch(`${API_BASE}/auth.php?action=guest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({ action: 'guest', guestToken }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.user) {
        const user = data.user as UserAccount;
        saveStoredAuthSession(user, data.token || null);
        return user;
      }
    }
  } catch {
    // Offline fallback
  }

  const guestUser: UserAccount = {
    id: 0,
    email: null,
    displayName: 'Guest Mode',
    isGuest: true,
    guestToken,
  };
  saveStoredAuthSession(guestUser, null);
  return guestUser;
}

export async function registerWithEmail(params: {
  displayName: string;
  email: string;
  password: string;
}): Promise<{ user: UserAccount; migratedPlansCount: number }> {
  const guestToken = getOrCreateLocalGuestToken();
  const currentUser = getStoredUser();
  const localGuestPlans =
    currentUser?.isGuest !== false ? loadLocalPlans(currentUser) : [];

  try {
    const res = await fetch(`${API_BASE}/auth.php?action=register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        action: 'register',
        displayName: params.displayName,
        email: params.email,
        password: params.password,
        guestToken,
        localPlans: localGuestPlans,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Could not create account.');
      }
      const user = data.user as UserAccount;
      saveStoredAuthSession(user, data.token);
      const localMig = migrateLocalGuestPlans(guestToken, user);
      return {
        user,
        migratedPlansCount: Number(data.migratedPlansCount || localMig || 0),
      };
    }
  } catch (err) {
    if (err instanceof Error && !/fetch|network|json/i.test(err.message)) {
      throw err;
    }
  }

  // Offline dev preview fallback
  const accounts = loadOfflineAccounts();
  const normalizedEmail = params.email.trim().toLowerCase();
  if (accounts.some((a) => a.email === normalizedEmail)) {
    throw new Error('An account with this email already exists. Please sign in instead.');
  }
  const created: OfflineAccountRecord = {
    id: Date.now(),
    email: normalizedEmail,
    password: params.password,
    displayName: params.displayName.trim() || normalizedEmail.split('@')[0],
  };
  saveOfflineAccounts([...accounts, created]);
  const user: UserAccount = {
    id: created.id,
    email: created.email,
    displayName: created.displayName,
    isGuest: false,
  };
  saveStoredAuthSession(user, `offline_${created.id}`);
  const migratedPlansCount = migrateLocalGuestPlans(guestToken, user);
  return { user, migratedPlansCount };
}

export async function loginWithEmail(params: {
  email: string;
  password: string;
}): Promise<{ user: UserAccount; migratedPlansCount: number }> {
  const guestToken = getOrCreateLocalGuestToken();
  const currentUser = getStoredUser();
  const localGuestPlans =
    currentUser?.isGuest !== false ? loadLocalPlans(currentUser) : [];

  try {
    const res = await fetch(`${API_BASE}/auth.php?action=login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        action: 'login',
        email: params.email,
        password: params.password,
        guestToken,
        localPlans: localGuestPlans,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Invalid email or password.');
      }
      const user = data.user as UserAccount;
      saveStoredAuthSession(user, data.token);
      const localMig = migrateLocalGuestPlans(guestToken, user);
      return {
        user,
        migratedPlansCount: Number(data.migratedPlansCount || localMig || 0),
      };
    }
  } catch (err) {
    if (err instanceof Error && !/fetch|network|json/i.test(err.message)) {
      throw err;
    }
  }

  // Offline dev preview fallback
  const accounts = loadOfflineAccounts();
  const normalizedEmail = params.email.trim().toLowerCase();
  const match = accounts.find(
    (a) => a.email === normalizedEmail && a.password === params.password
  );
  if (!match) {
    throw new Error('Invalid email or password.');
  }
  const user: UserAccount = {
    id: match.id,
    email: match.email,
    displayName: match.displayName,
    isGuest: false,
  };
  saveStoredAuthSession(user, `offline_${match.id}`);
  const migratedPlansCount = migrateLocalGuestPlans(guestToken, user);
  return { user, migratedPlansCount };
}

export async function authenticateWithGoogle(
  googleClientId: string
): Promise<{ user: UserAccount; migratedPlansCount: number }> {
  const accessToken = await requestGoogleOAuthToken(googleClientId, [
    'openid',
    'email',
    'profile',
  ]);

  const guestToken = getOrCreateLocalGuestToken();
  const currentUser = getStoredUser();
  const localGuestPlans =
    currentUser?.isGuest !== false ? loadLocalPlans(currentUser) : [];

  const res = await fetch(`${API_BASE}/auth.php?action=google`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({
      action: 'google',
      accessToken,
      guestToken,
      localPlans: localGuestPlans,
    }),
  });

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Google Sign-In verification failed.');
    }
    const user = data.user as UserAccount;
    saveStoredAuthSession(user, data.token);
    const localMig = migrateLocalGuestPlans(guestToken, user);
    return {
      user,
      migratedPlansCount: Number(data.migratedPlansCount || localMig || 0),
    };
  }

  throw new Error('Could not reach Practice Buddy authentication endpoint.');
}

export async function logoutUser(): Promise<UserAccount> {
  try {
    await fetch(`${API_BASE}/auth.php?action=logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({ action: 'logout' }),
    });
  } catch {
    // Ignore offline logout
  }

  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    // Assign a fresh guest token on explicit sign-out so signed-in data stays isolated
    const nextGuestToken = generateGuestToken();
    localStorage.setItem(GUEST_TOKEN_KEY, nextGuestToken);
  } catch {
    // Ignore
  }

  return continueAsGuest();
}

// -----------------------------------------------------------------------------
// Study Plans CRUD & Rescheduling
// -----------------------------------------------------------------------------
async function persistPlanDirectToMySql(
  plan: Omit<StudyPlan, 'id'> | StudyPlan,
  user?: UserAccount | null
): Promise<StudyPlan | null> {
  try {
    const res = await fetch(`${API_BASE}/plans.php?action=create_plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        userEmail: user?.email || plan.userEmail || 'learner@english-3d.com',
        guestToken: getOrCreateLocalGuestToken(),
        topicTitle: plan.topicTitle,
        executiveSummary: plan.executiveSummary,
        coreConcepts: plan.coreConcepts,
        sourceLinks: plan.sourceLinks,
        extractedContextCache: plan.extractedContextCache,
        startDate: plan.startDate,
        masterByDate: plan.masterByDate,
        sessions: plan.sessions,
      }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.plan) {
        return normalizePlanData({
          ...(data.plan as StudyPlan),
          studyWindow: plan.studyWindow,
        });
      }
    }
  } catch {
    // MySQL endpoint unreachable
  }
  return null;
}

export interface ApiInitData {
  plans: StudyPlan[];
  backendLive: boolean;
  backendError?: string;
  googleOAuthClientId: string;
  geminiModel: string;
  user: UserAccount;
}

export async function fetchAllPlans(
  activeUser?: UserAccount | null
): Promise<ApiInitData> {
  let backendError: string | undefined;
  const resolvedUser = activeUser || (await ensureAuthSession());
  const scopeKey = getPlansStorageKey(resolvedUser);

  try {
    const guestToken = getOrCreateLocalGuestToken();
    const res = await fetch(
      `${API_BASE}/plans.php?guest_token=${encodeURIComponent(guestToken)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...buildAuthHeaders(),
        },
      }
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.plans)) {
        const serverUser: UserAccount = data.user || resolvedUser;
        if (data.user) {
          saveStoredAuthSession(serverUser, getStoredAuthToken());
        }

        let plans = (data.plans as StudyPlan[]).map(normalizePlanData);

        if (plans.length > 0) {
          markSeedInitialized(scopeKey);
        } else {
          let hasLocalKey = false;
          try {
            hasLocalKey = localStorage.getItem(scopeKey) !== null;
          } catch {
            hasLocalKey = false;
          }
          if (!isSeedInitialized(scopeKey) && !hasLocalKey && serverUser.isGuest) {
            const [seedPlan] = createDefaultSeedPlans();
            const persistedSeed = await persistPlanDirectToMySql(seedPlan, serverUser);
            plans = persistedSeed ? [persistedSeed] : [seedPlan];
          }
          markSeedInitialized(scopeKey);
        }

        saveLocalPlans(plans, serverUser);
        return {
          plans,
          backendLive: true,
          googleOAuthClientId:
            data.config?.googleOAuthClientId ||
            localStorage.getItem('sp_google_client_id') ||
            '',
          geminiModel: data.config?.geminiModel || 'gemini-3.8-flash',
          user: serverUser,
        };
      }
      backendError = data.details || data.error || 'Invalid response from MySQL API.';
    } else if (contentType.includes('application/json')) {
      const errData = await res.json().catch(() => null);
      backendError =
        errData?.details ||
        errData?.error ||
        `MySQL backend error (HTTP ${res.status}).`;
    } else if (
      res.status >= 500 ||
      (!res.ok &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1')
    ) {
      backendError = `MySQL backend returned HTTP ${res.status} at ${API_BASE}/plans.php.`;
    }
  } catch (err) {
    if (
      err instanceof Error &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      backendError = `Could not reach ${API_BASE}/plans.php: ${err.message}`;
    }
  }

  return {
    plans: loadLocalPlans(resolvedUser),
    backendLive: false,
    backendError,
    googleOAuthClientId: localStorage.getItem('sp_google_client_id') || '',
    geminiModel: 'gemini-3.8-flash',
    user: resolvedUser,
  };
}

export async function generateAndSaveStudyPlan(params: {
  topicPrompt: string;
  urls: string[];
  files: UploadedFilePayload[];
  startDate: string;
  masterByDate: string;
  scheduledBlueprints: ScheduledSessionBlueprint[];
  studyWindow: StudyWindowConfig;
  userEmail?: string;
  user?: UserAccount | null;
}): Promise<{ plan: StudyPlan; persistedInMySql: boolean; warning?: string }> {
  let candidatePlan: StudyPlan | null = null;
  let persistedInMySql = false;
  let warning: string | undefined;
  const activeUser = params.user || getStoredUser();

  try {
    const res = await fetch(`${API_BASE}/gemini.php?action=generate_plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        action: 'generate_plan',
        topicPrompt: params.topicPrompt,
        urls: params.urls,
        files: params.files,
        startDate: params.startDate,
        masterByDate: params.masterByDate,
        scheduledBlueprints: params.scheduledBlueprints,
        userEmail: activeUser?.email || params.userEmail || 'learner@english-3d.com',
        guestToken: getOrCreateLocalGuestToken(),
        saveToDb: true,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.plan) {
        persistedInMySql = Boolean(
          data.persistedInMySql && data.plan.id && !data.plan.dbWarning
        );
        if (data.aiWarning) {
          warning = String(data.aiWarning);
        } else if (data.plan.dbWarning) {
          warning = String(data.plan.dbWarning);
        }
        candidatePlan = normalizePlanData({
          ...data.plan,
          id: data.plan.id || Date.now(),
          createdAt: data.plan.createdAt || new Date().toISOString(),
          studyWindow: params.studyWindow,
        });
      }
    }
  } catch {
    // Fallback to client-side synthesized plan when PHP proxy is unreachable
  }

  if (!candidatePlan) {
    candidatePlan = buildSynthesizedPlanFallback({
      ...params,
      userEmail: activeUser?.email || params.userEmail,
    });
  }

  if (!persistedInMySql) {
    const persisted = await persistPlanDirectToMySql(candidatePlan, activeUser);
    if (persisted) {
      candidatePlan = persisted;
      persistedInMySql = true;
    } else {
      warning =
        warning ||
        'Saved in browser cache only because Hostinger MySQL could not be reached.';
    }
  }

  const scopeKey = getPlansStorageKey(activeUser);
  markSeedInitialized(scopeKey);
  const current = loadLocalPlans(activeUser).filter((p) => p.id !== candidatePlan!.id);
  saveLocalPlans([candidatePlan, ...current], activeUser);
  return { plan: candidatePlan, persistedInMySql, warning };
}

export async function rescheduleOverdueSession(params: {
  plan: StudyPlan;
  session: StudySession;
  cascadeRemaining?: boolean;
  user?: UserAccount | null;
}): Promise<{ updatedPlan: StudyPlan; shiftedCount: number }> {
  const today = formatLocalDate(new Date());
  const cascade = params.cascadeRemaining !== false;
  const activeUser = params.user || getStoredUser();

  try {
    const res = await fetch(`${API_BASE}/plans.php?action=reschedule_session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        action: 'reschedule_session',
        sessionId: params.session.id,
        newScheduledDate: today,
        cascadeRemaining: cascade,
      }),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data.ok && data.plan) {
        const updatedPlan = normalizePlanData({
          ...(data.plan as StudyPlan),
          studyWindow: params.plan.studyWindow,
        });
        const plans = loadLocalPlans(activeUser).map((p) =>
          p.id === updatedPlan.id ? updatedPlan : p
        );
        saveLocalPlans(plans, activeUser);
        return {
          updatedPlan,
          shiftedCount: Number(data.shiftedCount || 1),
        };
      }
    }
  } catch {
    // Fallback to local schedule shifting
  }

  const deltaDays = Math.max(
    0,
    diffCalendarDays(params.session.scheduledDate, today)
  );
  let prevDate = today;
  let shiftedCount = 0;
  let latestDate = params.plan.masterByDate;

  const updatedSessions = params.plan.sessions.map((s) => {
    if (s.id === params.session.id) {
      shiftedCount++;
      if (today > latestDate) latestDate = today;
      return {
        ...s,
        scheduledDate: today,
        dayOffset: Math.max(0, diffCalendarDays(params.plan.startDate, today)),
      };
    }

    if (
      cascade &&
      deltaDays > 0 &&
      s.status !== 'completed' &&
      s.sessionNumber > params.session.sessionNumber
    ) {
      let nextDate = addCalendarDays(s.scheduledDate, deltaDays);
      if (nextDate <= prevDate) {
        nextDate = addCalendarDays(prevDate, Math.max(1, s.gapDays || 1));
      }
      prevDate = nextDate;
      shiftedCount++;
      if (nextDate > latestDate) latestDate = nextDate;
      return {
        ...s,
        scheduledDate: nextDate,
        dayOffset: Math.max(0, diffCalendarDays(params.plan.startDate, nextDate)),
      };
    }

    return s;
  });

  const updatedPlan: StudyPlan = {
    ...params.plan,
    masterByDate: latestDate,
    sessions: updatedSessions,
  };
  const plans = loadLocalPlans(activeUser).map((p) =>
    p.id === updatedPlan.id ? updatedPlan : p
  );
  saveLocalPlans(plans, activeUser);
  return { updatedPlan, shiftedCount };
}

export async function submitRecallForGrading(params: {
  plan: StudyPlan;
  session: StudySession;
  userResponseText: string;
  user?: UserAccount | null;
}): Promise<{
  evaluation: GradeRecallEvaluation;
  updatedPlan: StudyPlan;
  persistedInMySql: boolean;
}> {
  let evaluation: GradeRecallEvaluation | null = null;
  let persistedInMySql = false;
  let serverAttemptId: number | null = null;
  let serverCompletedAt: string | null = null;
  const activeUser = params.user || getStoredUser();

  const stageNumber = resolveStageNumber(params.session);

  try {
    const res = await fetch(`${API_BASE}/gemini.php?action=grade_recall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify({
        action: 'grade_recall',
        sessionId: params.session.id,
        topicTitle: params.plan.topicTitle,
        stageNumber,
        stageName: params.session.stageName,
        cognitiveGoal: params.session.cognitiveGoal,
        prompts: params.session.prompts,
        promptItems: params.session.promptItems || [],
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
        persistedInMySql = Boolean(data.persistedInMySql);
        serverAttemptId =
          typeof data.attemptId === 'number' ? data.attemptId : null;
        serverCompletedAt =
          typeof data.completedAt === 'string' ? data.completedAt : null;
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

  const nowIso =
    serverCompletedAt ||
    new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (!persistedInMySql) {
    try {
      const saveRes = await fetch(
        `${API_BASE}/plans.php?action=save_recall_attempt`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthHeaders(),
          },
          body: JSON.stringify({
            sessionId: params.session.id,
            userResponseText: params.userResponseText,
            masteryScore: evaluation.masteryScore,
            whatYouNailed: evaluation.whatYouNailed || evaluation.accuratePoints,
            accuratePoints: evaluation.accuratePoints,
            cognitiveStageCheck: evaluation.cognitiveStageCheck,
            missingToReview:
              evaluation.missingToReview || evaluation.missedOrInaccurateConcepts,
            missedOrInaccurateConcepts: evaluation.missedOrInaccurateConcepts,
            coachFeedback: evaluation.coachFeedback,
            socraticFollowUpQuestion: evaluation.socraticFollowUpQuestion,
            completedAt: nowIso,
          }),
        }
      );
      const saveContentType = saveRes.headers.get('content-type') || '';
      if (saveRes.ok && saveContentType.includes('application/json')) {
        const saveData = await saveRes.json();
        if (saveData.ok && saveData.plan) {
          const syncedPlan = normalizePlanData({
            ...(saveData.plan as StudyPlan),
            studyWindow: params.plan.studyWindow,
          });
          const plans = loadLocalPlans(activeUser);
          const updatedPlans = plans.map((p) =>
            p.id === syncedPlan.id ? syncedPlan : p
          );
          saveLocalPlans(updatedPlans, activeUser);
          return {
            evaluation,
            updatedPlan: syncedPlan,
            persistedInMySql: true,
          };
        }
      }
    } catch {
      // Fall back to local cache update if MySQL backend is offline
    }
  }

  const nailed = evaluation.whatYouNailed || evaluation.accuratePoints;
  const missing = evaluation.missingToReview || evaluation.missedOrInaccurateConcepts;

  const newAttempt = {
    id: serverAttemptId || Date.now(),
    sessionId: params.session.id,
    userResponseText: params.userResponseText,
    aiScore: evaluation.masteryScore,
    strengths: nailed,
    whatYouNailed: nailed,
    missingConcepts: missing,
    missingToReview: missing,
    correctiveFeedback: evaluation.coachFeedback,
    cognitiveStageCheck: evaluation.cognitiveStageCheck,
    followUpQuestion: evaluation.socraticFollowUpQuestion,
    createdAt: nowIso,
  };

  const plans = loadLocalPlans(activeUser);
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

  saveLocalPlans(updatedPlans, activeUser);
  const updatedPlan =
    updatedPlans.find((p) => p.id === params.plan.id) || params.plan;

  return { evaluation, updatedPlan, persistedInMySql };
}

export async function scheduleAdaptiveBoosterSession(params: {
  plan: StudyPlan;
  session: StudySession;
  missingConcepts: string[];
  followUpQuestion: string;
  user?: UserAccount | null;
}): Promise<{ updatedPlan: StudyPlan; newSession: StudySession }> {
  const activeUser = params.user || getStoredUser();

  try {
    const res = await fetch(
      `${API_BASE}/plans.php?action=add_booster_session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
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
        const updatedPlan = normalizePlanData(data.plan as StudyPlan);
        const plans = loadLocalPlans(activeUser).map((p) =>
          p.id === updatedPlan.id ? updatedPlan : p
        );
        saveLocalPlans(plans, activeUser);
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

  const remedialItems: SessionPromptItem[] = [];
  if (params.followUpQuestion) {
    remedialItems.push({
      prompt_text: `Socratic Remediation: ${params.followUpQuestion}`,
      expected_rubric_points: params.missingConcepts.slice(0, 3),
    });
  }
  for (const concept of params.missingConcepts.slice(0, 3)) {
    remedialItems.push({
      prompt_text: `Targeted Retrieval Repair: Explain the exact mechanism and role of "${concept}" from memory without consulting source notes.`,
      expected_rubric_points: [
        `Accurately explains ${concept}`,
        'Connects mechanism back to core topic',
      ],
    });
  }
  if (remedialItems.length === 0) {
    for (const p of params.session.prompts.slice(0, 2)) {
      remedialItems.push({ prompt_text: p, expected_rubric_points: [] });
    }
  }

  const newSession: StudySession = {
    id: Date.now(),
    planId: params.plan.id,
    sessionNumber: params.plan.sessions.length + 1,
    stageNumber: resolveStageNumber(params.session),
    stageName: 'Adaptive Booster — Targeted Error Remediation (+2d)',
    scheduledDate: boosterDate,
    dayOffset: params.session.dayOffset + 2,
    gapDays: 2,
    cognitiveGoal: `Eliminate retrieval gaps identified in Session #${params.session.sessionNumber} and stabilize long-term memory consolidation.`,
    prompts: remedialItems.map((p) => p.prompt_text),
    promptItems: remedialItems,
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

  const plans = loadLocalPlans(activeUser);
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

  saveLocalPlans(updatedPlans, activeUser);
  const updatedPlan =
    updatedPlans.find((p) => p.id === params.plan.id) || params.plan;

  return { updatedPlan, newSession };
}

export async function deleteStudyPlan(
  planId: number,
  user?: UserAccount | null
): Promise<StudyPlan[]> {
  const activeUser = user || getStoredUser();
  markSeedInitialized(getPlansStorageKey(activeUser));
  let deletedRemotely = false;

  try {
    const res = await fetch(
      `${API_BASE}/plans.php?plan_id=${encodeURIComponent(planId)}`,
      {
        method: 'DELETE',
        headers: {
          ...buildAuthHeaders(),
        },
      }
    );
    deletedRemotely = res.ok;
  } catch {
    deletedRemotely = false;
  }

  if (!deletedRemotely) {
    try {
      await fetch(`${API_BASE}/plans.php?action=delete_plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({ planId }),
      });
    } catch {
      // Continue with local deletion if offline
    }
  }

  const remaining = loadLocalPlans(activeUser).filter((p) => p.id !== planId);
  saveLocalPlans(remaining, activeUser);
  return remaining;
}

// -----------------------------------------------------------------------------
// Stage-Aware Rubric Fallback Evaluator & Plan Synthesizer
// -----------------------------------------------------------------------------
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

  const rubricPool = new Set<string>(session.verificationChecklist || []);
  for (const pi of session.promptItems || []) {
    for (const rp of pi.expected_rubric_points || []) {
      if (rp.trim()) rubricPool.add(rp.trim());
    }
  }
  const combinedRubric = Array.from(rubricPool);

  const accuratePoints: string[] = [];
  const missedOrInaccurateConcepts: string[] = [];

  for (const criterion of combinedRubric) {
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
            'correctly',
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

    if (ratio >= 0.30 && wordCount >= 15) {
      accuratePoints.push(criterion);
    } else {
      missedOrInaccurateConcepts.push(criterion);
    }
  }

  const stageNum = resolveStageNumber(session);
  const hasCausal = /\b(because|therefore|causes?|leads? to|results? in|mechanism|whereas|unlike)\b/i.test(
    responseText
  );
  const hasStructural = /\b(category|pillars?|components?|stages?|connects?|links?|hierarchy|workflow)\b/i.test(
    responseText
  );
  const hasScenario = /\b(diagnos|predict|scenario|edge case|fail|disrupt|solution|outcome)\b/i.test(
    responseText
  );

  const cognitiveStageCheck =
    stageNum === 1
      ? hasStructural
        ? 'Stage 1 Check Passed: You organized high-level categories and traced how core components connect.'
        : 'Stage 1 Check: Zoom out slightly to explicitly group the main categories and describe how each component connects in the overall structure.'
      : stageNum === 2
        ? wordCount >= 25
          ? 'Stage 2 Check Passed: Solid unassisted retrieval of core terms and definitions from memory.'
          : 'Stage 2 Check: Try expanding your unassisted brain-dump with more foundational definitions and key terms before unlocking the digest.'
        : stageNum === 3
          ? hasCausal
            ? 'Stage 3 Check Passed: You explained causal "why" and "how" mechanisms rather than stopping at surface definitions.'
            : 'Stage 3 Check: You stated what happens, but Stage 3 requires causal reasoning—explicitly explain WHY the mechanism works and HOW one step drives the next.'
          : stageNum === 4
            ? hasScenario || hasCausal
              ? 'Stage 4 Check Passed: You applied principles to diagnose behavior and justify your solution.'
              : 'Stage 4 Check: Trace the scenario step-by-step—diagnose what fails, predict what shifts if a variable changes, and justify your recommendation.'
            : wordCount >= 40 && hasCausal
              ? 'Stage 5 Check Passed: Cohesive, rigorous synthesis suitable for teaching a peer.'
              : 'Stage 5 Check: Tie all major subtopics together into one complete, exam-ready explanation with zero conceptual gaps.';

  const checklistRatio =
    combinedRubric.length > 0
      ? accuratePoints.length / combinedRubric.length
      : 0.5;
  const depthBonus = Math.min(25, Math.floor(wordCount / 6));
  const rawScore = Math.round(checklistRatio * 75 + depthBonus);
  const masteryScore = Math.max(15, Math.min(98, rawScore));

  if (accuratePoints.length === 0 && wordCount >= 10) {
    accuratePoints.push(
      `Initiated closed-book Stage ${stageNum} retrieval (${wordCount} words) addressing ${plan.topicTitle}.`
    );
  }

  const recommendAdaptiveExtraSession = masteryScore < 70;

  const coachFeedback =
    masteryScore >= 80
      ? `Strong ${session.stageName} retrieval (${masteryScore}% mastery)! You demonstrated clear command of the target concepts. Review any remaining nuance below to lock in 100% precision.`
      : masteryScore >= 70
        ? `Solid foundational recall (${masteryScore}%), though ${missedOrInaccurateConcepts.length} rubric point(s) need tighter stage-specific precision.`
        : `Your retrieval attempt (${masteryScore}%) highlights fragile encoding (${missedOrInaccurateConcepts.length} rubric point(s) missed). Schedule an Adaptive Booster (+2 Days) below to reinforce these memory traces.`;

  const firstMissed =
    missedOrInaccurateConcepts[0] ||
    combinedRubric[0] ||
    plan.coreConcepts[0]?.title ||
    plan.topicTitle;

  const socraticFollowUpQuestion = `Focusing specifically on "${firstMissed}", what is the underlying causal mechanism connecting this to ${plan.topicTitle}, and what fails if it is disrupted?`;

  return {
    masteryScore,
    whatYouNailed: accuratePoints,
    accuratePoints,
    cognitiveStageCheck,
    missingToReview: missedOrInaccurateConcepts,
    missedOrInaccurateConcepts,
    coachFeedback,
    socraticFollowUpQuestion,
    recommendAdaptiveExtraSession,
  };
}

function buildStagePromptItemsFallback(
  stageNum: CognitiveStageNumber,
  cleanTitle: string
): SessionPromptItem[] {
  if (stageNum === 1) {
    return [
      {
        prompt_text: `Map the macro architecture of "${cleanTitle}": list its 3–5 main categories or pillars and explain how each component connects.`,
        expected_rubric_points: [
          `Identifies 3–5 core categories of ${cleanTitle}`,
          'Describes high-level structural or sequential links between categories',
          'Avoids getting lost in minor trivia before building the blueprint',
        ],
      },
      {
        prompt_text: `Trace the overall workflow or conceptual hierarchy of "${cleanTitle}" from primary inputs to final outcomes.`,
        expected_rubric_points: [
          'Identifies major inputs, transformations, and outputs',
          'Clarifies boundary roles for each major component',
          'Shows how upstream elements constrain downstream elements',
        ],
      },
    ];
  }
  if (stageNum === 2) {
    return [
      {
        prompt_text: `Closed-Book Definition & Key Term Recall: Without checking notes, list and define the core terminology, rules, and foundational facts of "${cleanTitle}".`,
        expected_rubric_points: [
          `Accurately defines primary terms in ${cleanTitle}`,
          'Retrieves foundational rules or equations from memory',
          'Uses precise domain terminology rather than vague summaries',
        ],
      },
      {
        prompt_text: `Core Fact Sweep: Write out every essential sequence step, threshold, or primary property of "${cleanTitle}" you can recall unassisted.`,
        expected_rubric_points: [
          'Recalls exact steps or properties in correct order',
          'Captures critical constraints or quantitative thresholds',
          'Demonstrates unassisted recall before consulting materials',
        ],
      },
    ];
  }
  if (stageNum === 3) {
    return [
      {
        prompt_text: `Why & How Mechanism Analysis: Explain WHY the primary mechanism in "${cleanTitle}" operates the way it does and HOW one step triggers the next.`,
        expected_rubric_points: [
          'Explains causal why/how relationships instead of surface definitions',
          'Traces step-by-step cause-and-effect links',
          'Identifies underlying driving principles',
        ],
      },
      {
        prompt_text: `Compare & Contrast: Contrast two closely related concepts or pathways within "${cleanTitle}" and explain why they produce different outcomes.`,
        expected_rubric_points: [
          'Contrasts two related concepts along concrete mechanistic axes',
          'Explains why each difference matters functionally',
          'Identifies conditions favoring one over the other',
        ],
      },
    ];
  }
  if (stageNum === 4) {
    return [
      {
        prompt_text: `Diagnostic Edge-Case Scenario: Suppose a primary variable or constraint in "${cleanTitle}" fails or shifts sharply. Diagnose what breaks, predict the downstream outcome, and justify your reasoning.`,
        expected_rubric_points: [
          'Identifies root cause of the breakdown in the scenario',
          'Predicts downstream consequences accurately',
          'Justifies prediction using first-principles rules',
        ],
      },
      {
        prompt_text: `Applied Problem-Solving: Design or evaluate a practical solution for a realistic challenge in "${cleanTitle}" and explain how you handle boundary conditions.`,
        expected_rubric_points: [
          'Applies domain principles to a concrete problem',
          'Accounts for edge cases or trade-offs',
          'Defends chosen approach logically',
        ],
      },
    ];
  }
  return [
    {
      prompt_text: `Mastery Synthesis Challenge: Explain "${cleanTitle}" completely from first principles as if teaching an intelligent peer—connecting the high-level blueprint, causal mechanisms, and key edge cases with zero conceptual gaps.`,
      expected_rubric_points: [
        'Synthesizes macro architecture, foundational definitions, and causal mechanisms',
        'Uses clear, jargon-free explanations without hand-waving',
        'Integrates diagnostic edge cases and boundary conditions fluently',
      ],
    },
  ];
}

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
        'Tested directly in Stage 4 Application scenarios and Stage 5 Mastery Verification synthesis.',
    },
  ];

  const sessions: StudySession[] = params.scheduledBlueprints.map((bp, idx) => {
    const stageNumber = resolveStageNumber({
      stageNumber: bp.stageNumber,
      stageName: bp.stageName,
      sessionNumber: bp.sessionNumber,
    });
    const promptItems = buildStagePromptItemsFallback(stageNumber, cleanTitle);
    const checklist = promptItems
      .flatMap((pi) => pi.expected_rubric_points)
      .slice(0, 6);

    return {
      id: planId + idx + 1,
      planId,
      sessionNumber: bp.sessionNumber,
      stageNumber,
      stageName: normalizeStageName(bp.stageName),
      scheduledDate: bp.scheduledDate,
      dayOffset: bp.dayOffset,
      gapDays: bp.gapDays,
      cognitiveGoal: bp.cognitiveGoal,
      prompts: promptItems.map((pi) => pi.prompt_text),
      promptItems,
      verificationChecklist: checklist,
      status: 'pending',
      masteryScore: null,
      calendarEventId: null,
      completedAt: null,
      attempts: [],
    };
  });

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
