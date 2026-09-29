"use client";

import type { JobFilters } from "../lib/job-constraints";
import styles from "./job-agent.module.css";

export function JobFilterFields({ value, disabled, onChange }: { value: JobFilters; disabled: boolean; onChange: (next: JobFilters) => void }) {
  return <fieldset disabled={disabled} className={styles.filterFields}>
    <legend>Optional posting filters</legend>
    <div className={styles.fields}>
      <label>Maximum required experience (years; blank = any)
        <input type="number" min={0} max={40} step={0.5} value={value.maxRequiredYears ?? ""} onChange={(event) => onChange({ ...value, maxRequiredYears: event.target.value === "" ? null : Number(event.target.value) })} />
      </label>
      <label>Desired annual salary minimum (CAD; blank = any)
        <input type="number" min={0} max={500000} step={1000} value={value.minAnnualCad ?? ""} onChange={(event) => onChange({ ...value, minAnnualCad: event.target.value === "" ? null : Number(event.target.value) })} />
      </label>
      <fieldset className={styles.filterFields}><legend>Work modes (none selected = any)</legend>
        {(["remote", "hybrid", "onsite"] as const).map((mode) => <label className={styles.checkbox} key={mode}>
          <input type="checkbox" checked={value.workModes.includes(mode)} onChange={(event) => onChange({ ...value, workModes: event.target.checked ? [...value.workModes, mode] : value.workModes.filter((entry) => entry !== mode) })} />{mode}
        </label>)}
      </fieldset>
      <label className={styles.checkbox}><input type="checkbox" checked={value.includeUnknown} onChange={(event) => onChange({ ...value, includeUnknown: event.target.checked })} /> Keep unknown conditions for review</label>
    </div>
    <p className={styles.caption}>These are search preferences, not claims about your experience or eligibility. Only explicit English requirements, CAD annual salary and source work-mode labels are recognized. A salary range overlapping your minimum is not an offer. Unknown includes missing, ambiguous and unsupported wording. Geography and title exclusions still apply.</p>
  </fieldset>;
}
