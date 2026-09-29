import { z } from "zod";

export const defaultJobFilters = { maxRequiredYears: null, minAnnualCad: null, workModes: [], includeUnknown: true };
export const JobFiltersSchema = z.object({
  maxRequiredYears: z.number().min(0).max(40).nullable(),
  minAnnualCad: z.number().int().min(0).max(500_000).nullable(),
  workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).max(3),
  includeUnknown: z.boolean(),
}).strict();
export type JobFilters = z.infer<typeof JobFiltersSchema>;
type Citation = { source: "description" | "location"; line: number | null; text: string };
type Signal<T> = { value: T | null; evidence: Citation[]; note: string };
type Mode = JobFilters["workModes"][number];
export type ConstraintCheck = { key: "experience" | "salary" | "workMode"; status: "match" | "mismatch" | "unknown" | "not_set"; reason: string; evidence: Citation[] };

const cite = (text: string, line: number): Citation => ({ source: "description", line, text: text.slice(0, 700) });

/** Conservative English hints, not an eligibility inference or replacement for JD review. */
export function extractJobConstraints(job: { description: string; location: string }) {
  const lines = job.description.split(/\r?\n/).map((text, index) => ({ text: text.trim(), line: index + 1 }));
  const years: number[] = [];
  const yearEvidence: Citation[] = [];
  const salaries: { min: number; max: number }[] = [];
  const salaryEvidence: Citation[] = [];
  let requiredSection = false;
  let ambiguousYears = false;
  let ambiguousSalary = false;
  for (const { text, line } of lines) {
    // Oversized/unstructured lines are not treated as reliable local extraction.
    if (!text || text.length > 2500) continue;
    if (/^(?:requirements|qualifications|minimum qualifications|minimum requirements|required qualifications|must[- ]haves?|what you(?:'ll)? bring|what we(?:'re| are) looking for)\s*:?$/i.test(text)) requiredSection = true;
    else if (/^(?:nice[- ]to[- ]haves?|preferred(?: qualifications| requirements)?|bonus|benefits|about(?: us| the company| the role)?|responsibilities|what we offer|what you(?:'ll)? do)\s*:?$/i.test(text)) requiredSection = false;
    const yearMatches = [...text.matchAll(/\b(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:[\w+#.-]+\s+){0,5}experience\b/gi)];
    const requiredExperience = (requiredSection || /\b(?:required|must|minimum|at least)\b/i.test(text)) && /\bexperience\b/i.test(text) && /\b(?:years?|yrs?)\b/i.test(text);
    const preferred = /\b(?:preferred|nice to have|bonus|ideally)\b/i.test(text);
    if (requiredExperience && !preferred && (!yearMatches.length || /\d+[.,]\d+\s*\+?\s*(?:years?|yrs?)\b/i.test(text))) {
      ambiguousYears = true;
      yearEvidence.push(cite(text, line));
      continue;
    }
    if (yearMatches.length && (requiredSection || /\b(?:required|must|minimum|at least)\b/i.test(text))) {
      if (!/\b(?:preferred|nice to have|bonus|ideally)\b/i.test(text)) {
        yearEvidence.push(cite(text, line));
        if (/\b(?:or|equivalent|not required|no minimum|up to|less than|more than)\b/i.test(text)) ambiguousYears = true;
        for (const match of yearMatches) {
          const lower = Number(match[1]);
          const upper = Number(match[2] ?? match[1]);
          if (lower > 40 || upper < lower || upper > 40) ambiguousYears = true;
          else years.push(lower);
        }
      }
    }
    if (!/\b(?:salary|base pay)\b/i.test(text)) continue;
    salaryEvidence.push(cite(text, line));
    const annual = /\b(?:annual|annually|yearly|per year|per annum)\b|\/(?:year|yr)\b/i.test(text);
    const cad = /\bCAD\b|\bCA\$|\bC\$|\bCanadian dollars\b/i.test(text);
    if (!annual || !cad || /\b(?:USD|US dollars|EUR|GBP|hourly|per hour|monthly|per month|bonus|equity|commission|OTE|total compensation)\b|US\$|\/(?:hr|hour|month)\b/i.test(text)) {
      ambiguousSalary = true; continue;
    }
    const amount = "(?:\\d{1,3}(?:,\\d{3})+|\\d{4,7}|\\d{2,3}(?:\\.\\d+)?\\s*k)";
    const amounts = [...text.matchAll(new RegExp(`(?:CAD\\s*|CA\\$\\s*|C\\$\\s*|\\$\\s*)?(${amount})(?:\\s*(?:-|–|to)\\s*(?:CAD\\s*|CA\\$\\s*|C\\$\\s*|\\$\\s*)?(${amount}))?`, "gi"))];
    if (amounts.length !== 1 || (/[\dk]\s*(?:-|–|to)\s*(?:CAD\s*|\$\s*)?\d/i.test(text) && !amounts[0]?.[2]) || /\d\.\d{1,2}(?!\d|k)/i.test(text)) { ambiguousSalary = true; continue; }
    const number = (value: string) => Number(value.replace(/[,\s]/g, "").replace(/k$/i, "")) * (/k$/i.test(value) ? 1000 : 1);
    const min = number(amounts[0]![1]!);
    const max = number(amounts[0]![2] ?? amounts[0]![1]!);
    if (min < 1000 || max < min || max > 2_000_000 || /\b(?:up to|from|starting at|minimum|maximum|more than|less than)\b|\+/i.test(text)) ambiguousSalary = true;
    else salaries.push({ min, max });
  }
  const distinctSalaries = [...new Map(salaries.map((s) => [`${s.min}:${s.max}`, s])).values()];
  const modes: Mode[] = [];
  if (/\bremote\b/i.test(job.location)) modes.push("remote");
  if (/\bhybrid\b/i.test(job.location)) modes.push("hybrid");
  if (/\bon[- ]?site\b/i.test(job.location)) modes.push("onsite");
  const mode = modes.length === 1 && !/\b(?:not|no|non|optional|or)\b/i.test(job.location) ? modes[0]! : null;
  const experience: Signal<number> = { value: years.length && !ambiguousYears ? Math.max(...years) : null, evidence: yearEvidence,
    note: "Only explicit numeric required experience is recognized. Alternatives and unrecognized wording require JD review." };
  const salary: Signal<{ min: number; max: number }> = { value: distinctSalaries.length === 1 && !ambiguousSalary ? distinctSalaries[0]! : null, evidence: salaryEvidence,
    note: "Only an unambiguous stated CAD annual salary is compared. No currency conversion, hourly annualization or total-compensation inference." };
  const workMode: Signal<Mode> = { value: mode, evidence: job.location ? [{ source: "location", line: null, text: job.location }] : [],
    note: "Work mode comes only from the source location label; description wording is not inferred." };
  return { experience, salary, workMode };
}

export function checkJobConstraints(job: { description: string; location: string }, filters: JobFilters) {
  const signals = extractJobConstraints(job);
  const checks: ConstraintCheck[] = [];
  const years = signals.experience.value;
  checks.push({ key: "experience", evidence: signals.experience.evidence,
    status: filters.maxRequiredYears === null ? "not_set" : years === null ? "unknown" : years <= filters.maxRequiredYears ? "match" : "mismatch",
    reason: years === null ? signals.experience.note : `Highest recognized minimum: ${years} year(s). Limit: ${filters.maxRequiredYears ?? "not set"}.` });
  const salary = signals.salary.value;
  checks.push({ key: "salary", evidence: signals.salary.evidence,
    status: filters.minAnnualCad === null ? "not_set" : salary === null ? "unknown" : salary.max >= filters.minAnnualCad ? "match" : "mismatch",
    reason: salary === null ? signals.salary.note : `Stated CAD annual range: ${salary.min}–${salary.max}. Desired minimum: ${filters.minAnnualCad ?? "not set"}. Overlap is not a guaranteed offer.` });
  const mode = signals.workMode.value;
  checks.push({ key: "workMode", evidence: signals.workMode.evidence,
    status: !filters.workModes.length ? "not_set" : mode === null ? "unknown" : filters.workModes.includes(mode) ? "match" : "mismatch",
    reason: mode === null ? signals.workMode.note : `Source work mode: ${mode}.` });
  return { checks, passes: checks.every((check) => check.status !== "mismatch" && (check.status !== "unknown" || filters.includeUnknown)),
    needsReview: checks.some((check) => check.status === "unknown") };
}
