export const LLM_JUDGE_SCHEMA = '2.1';

export const LLM_JUDGE_GATE = {
  minimumPresentation: 16,
  minimumJdFit: 7,
  maximumDeductions: 3,
};

const finite = value => Number.isFinite(Number(value));
const median = values => {
  const sorted = values.map(Number).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export const validateLlmJudge = value => {
  if (!value || typeof value !== 'object') throw new Error('LLM judge verdict must be a JSON object');
  if (value.schemaVersion !== LLM_JUDGE_SCHEMA) {
    throw new Error(`LLM judge schema ${LLM_JUDGE_SCHEMA} is required; re-run the context-isolated judge`);
  }
  const verdicts = Array.isArray(value.verdicts) ? value.verdicts : [];
  if (!verdicts.length) throw new Error('LLM judge verdicts[] must contain at least one run');
  if (Number(value.runs) !== verdicts.length) {
    throw new Error('LLM judge runs must equal verdicts.length');
  }
  const verdictMetrics = verdicts.map((verdict, index) => {
    const total = Number(verdict?.total);
    const presentation = Number(verdict?.presentation?.score);
    const jdFit = Number(verdict?.jd_fit?.score);
    const employerDeductions = Number(verdict?.deductions?.total);
    const actionableDeductions = Number(verdict?.actionable_deductions?.total);
    if (![total, presentation, jdFit, employerDeductions, actionableDeductions].every(Number.isFinite)) {
      throw new Error(`LLM judge verdict ${index + 1} is missing numeric scoring fields`);
    }
    if (actionableDeductions > employerDeductions) {
      throw new Error(`LLM judge verdict ${index + 1} actionable deductions exceed employer deductions`);
    }
    return { total, presentation, jdFit, actionableDeductions };
  });
  const gate = value.gate;
  if (!gate || !finite(gate.presentation) || !finite(gate.jdFit) || !finite(gate.actionableDeductions)) {
    throw new Error('LLM judge gate must record numeric presentation, jdFit, and actionableDeductions');
  }
  if (!Array.isArray(gate.criticalFixes)) {
    throw new Error('LLM judge gate.criticalFixes must be an array');
  }
  const normalizedGateCriticalFixes = gate.criticalFixes.map(item =>
    typeof item === 'string' ? item : item?.fix
  ).filter(value => typeof value === 'string');
  if (normalizedGateCriticalFixes.length !== gate.criticalFixes.length) {
    throw new Error('LLM judge gate.criticalFixes entries must be strings or {fix} objects');
  }
  const expectedGate = {
    presentation: median(verdictMetrics.map(item => item.presentation)),
    jdFit: median(verdictMetrics.map(item => item.jdFit)),
    actionableDeductions: median(verdictMetrics.map(item => item.actionableDeductions)),
  };
  for (const key of Object.keys(expectedGate)) {
    if (Number(gate[key]) !== expectedGate[key]) {
      throw new Error(`LLM judge gate.${key} must equal the median verdict value (${expectedGate[key]})`);
    }
  }
  const fixes = Array.isArray(value.fixes) ? value.fixes : [];
  if (fixes.some(item => !item || typeof item !== 'object' || typeof item.fix !== 'string')) {
    throw new Error('LLM judge fixes[] must contain {fix,severity} objects');
  }
  const criticalFixes = fixes
    .filter(item => item.severity === 'critical')
    .map(item => item.fix);
  if (JSON.stringify(normalizedGateCriticalFixes) !== JSON.stringify(criticalFixes)) {
    throw new Error('LLM judge gate.criticalFixes must equal the critical entries in fixes[]');
  }
  const expectedPass = Number(gate.presentation) >= LLM_JUDGE_GATE.minimumPresentation
    && Number(gate.jdFit) >= LLM_JUDGE_GATE.minimumJdFit
    && Number(gate.actionableDeductions) <= LLM_JUDGE_GATE.maximumDeductions
    && normalizedGateCriticalFixes.length === 0;
  if (value.pass !== expectedPass) {
    throw new Error(`LLM judge pass must equal the configured gate result (${expectedPass})`);
  }
  const totals = verdictMetrics.map(item => item.total);
  if (!finite(value.medianTotal)) {
    throw new Error('LLM judge verdicts and medianTotal must include numeric total scores');
  }
  if (Number(value.medianTotal) !== median(totals)) {
    throw new Error(`LLM judge medianTotal must equal the median verdict total (${median(totals)})`);
  }
  return {
    ...value,
    runs: verdicts.length,
    medianTotal: Number(value.medianTotal),
    gate: {
      presentation: Number(gate.presentation),
      jdFit: Number(gate.jdFit),
      actionableDeductions: Number(gate.actionableDeductions),
      criticalFixes: normalizedGateCriticalFixes,
    },
    fixes,
  };
};

export const aggregateLlmJudgeRuns = values => {
  const records = values.map(value => {
    validateLlmJudge(value);
    return value;
  });
  const verdicts = records.flatMap(record => record.verdicts);
  if (!verdicts.length || verdicts.length % 2 === 0) {
    throw new Error('LLM judge aggregation requires an odd, non-zero number of verdicts');
  }
  const total = median(verdicts.map(verdict => verdict.total));
  const representative = verdicts.find(verdict => Number(verdict.total) === total);
  const fixes = Array.isArray(representative?.fixes)
    ? representative.fixes.filter(item => item && typeof item.fix === 'string')
    : [];
  const gate = {
    presentation: median(verdicts.map(verdict => verdict.presentation.score)),
    jdFit: median(verdicts.map(verdict => verdict.jd_fit.score)),
    actionableDeductions: median(verdicts.map(verdict => verdict.actionable_deductions.total)),
    criticalFixes: fixes.filter(item => item.severity === 'critical').map(item => item.fix),
  };
  const pass = gate.presentation >= LLM_JUDGE_GATE.minimumPresentation
    && gate.jdFit >= LLM_JUDGE_GATE.minimumJdFit
    && gate.actionableDeductions <= LLM_JUDGE_GATE.maximumDeductions
    && gate.criticalFixes.length === 0;
  return validateLlmJudge({
    schemaVersion: LLM_JUDGE_SCHEMA,
    judgedAt: new Date().toISOString(),
    runs: verdicts.length,
    medianTotal: total,
    gate,
    pass,
    fixes,
    verdicts,
  });
};

export const llmJudgePasses = value => {
  try {
    return validateLlmJudge(value).pass === true;
  } catch {
    return false;
  }
};
