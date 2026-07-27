"use client";

import type { JDRequirement } from "@resume-agent/contracts";
import { useCallback, useEffect, useState } from "react";

import type { JobsPayload, JobView } from "../lib/job-payload";

type Priority = JDRequirement["priority"];

const PRIORITY_GROUPS: ReadonlyArray<{ id: Priority; label: string; note: string }> = [
  { id: "must_have", label: "Must have", note: "Stated as required by the posting" },
  { id: "preferred", label: "Preferred", note: "Stated as a plus or nice to have" },
  { id: "context", label: "Context", note: "Responsibilities and role framing" },
];

const KIND_LABELS: Record<JDRequirement["kind"], string> = {
  responsibility: "responsibility",
  skill: "skill",
  experience: "experience",
  education: "education",
  credential: "credential",
  behavior: "behavior",
  other: "other",
};

const SKIP_LABELS: Record<string, string> = {
  possible_injection: "addressed the agent",
  possible_secret: "looked like a credential",
  duplicate_requirement: "already listed",
  line_too_long: "too long to parse",
  not_a_requirement: "not a requirement",
  non_requirement_section: "benefits, company, or legal section",
};

const SECTION_LABELS: Record<string, string> = {
  intro: "intro",
  responsibilities: "responsibilities",
  requirements: "requirements",
  preferred: "preferred",
  benefits: "not imported",
  about: "not imported",
  legal: "not imported",
  unrecognized: "unknown heading",
};

function formatTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function JobIntake() {
  const [payload, setPayload] = useState<JobsPayload | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", company: "", location: "", sourceUrl: "", text: "" });
  const [showForm, setShowForm] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [busyRequirementId, setBusyRequirementId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "attention"; text: string } | null>(null);

  const request = useCallback(async (input: string, init?: RequestInit): Promise<JobsPayload | null> => {
    const response = await fetch(input, init);
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : "That request could not be completed.";
      setNotice({ tone: "attention", text: message });
      return null;
    }

    const next = body as JobsPayload;
    setPayload(next);
    return next;
  }, []);

  useEffect(() => {
    void request("/api/jobs");
  }, [request]);

  const jobs = payload?.jobs ?? [];
  const selected: JobView | undefined = jobs.find((entry) => entry.job.id === selectedJobId) ?? jobs[0];

  const onParse = async (event: React.FormEvent) => {
    event.preventDefault();
    setParsing(true);
    setNotice(null);

    const next = await request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        company: form.company,
        ...(form.location.trim() ? { location: form.location } : {}),
        ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl } : {}),
        text: form.text,
      }),
    });

    if (next) {
      setSelectedJobId(next.jobs[0]?.job.id ?? null);
      setForm({ title: "", company: "", location: "", sourceUrl: "", text: "" });
      setShowForm(false);
      setNotice({
        tone: "good",
        text: "Parsed from the posting's own wording. Correct anything the sections got wrong.",
      });
    }
    setParsing(false);
  };

  const onCorrect = async (requirement: JDRequirement, body: Record<string, unknown> | null) => {
    setBusyRequirementId(requirement.id);
    await request(`/api/jobs/${encodeURIComponent(requirement.jobId)}/requirements/${encodeURIComponent(requirement.id)}`, {
      method: body ? "PATCH" : "DELETE",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    setBusyRequirementId(null);
  };

  const onClear = async () => {
    if (!window.confirm("Delete every stored job description and its parsed requirements?")) {
      return;
    }
    const next = await request("/api/jobs", { method: "DELETE" });
    if (next) {
      setSelectedJobId(null);
      setNotice({ tone: "good", text: "Local job data deleted." });
    }
  };

  if (!payload) {
    return (
      <section className="panel">
        <p className="eyebrow">Jobs</p>
        <h2>Loading your local jobs…</h2>
      </section>
    );
  }

  const formOpen = showForm || jobs.length === 0;

  return (
    <>
      <section className="workspace-title">
        <div>
          <p className="eyebrow">Jobs</p>
          <h1>{selected ? selected.job.title : "Add a job description"}</h1>
          <p>
            {selected
              ? `${selected.job.company}${selected.job.location ? ` · ${selected.job.location}` : ""} · ${
                  selected.summary.must_have
                } must have · ${selected.summary.preferred} preferred · ${selected.summary.context} context`
              : "Paste a posting to see the requirements it actually states."}
          </p>
        </div>
        <div className="workspace-actions">
          <button className="button primary" onClick={() => setShowForm((open) => !open)}>
            {formOpen ? "Close" : "Add job"}
          </button>
          {jobs.length > 0 ? (
            <button className="button secondary" onClick={() => void onClear()}>
              Delete local data
            </button>
          ) : null}
        </div>
      </section>

      {jobs.length > 1 ? (
        <div className="job-switcher">
          {jobs.map((entry) => (
            <button
              key={entry.job.id}
              className={entry.job.id === selected?.job.id ? "active" : ""}
              onClick={() => setSelectedJobId(entry.job.id)}
            >
              {entry.job.title} <b>{entry.job.company}</b>
            </button>
          ))}
        </div>
      ) : null}

      {formOpen ? (
        <section className="panel intake-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Paste the job description</h2>
            </div>
            <span className="count-label">Nothing is sent to the hiring site</span>
          </div>
          <form onSubmit={(event) => void onParse(event)}>
            <div className="intake-fields">
              <label>
                Role title
                <input
                  required
                  maxLength={240}
                  value={form.title}
                  placeholder="Senior Product Designer"
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </label>
              <label>
                Company
                <input
                  required
                  maxLength={240}
                  value={form.company}
                  placeholder="Northstar Labs"
                  onChange={(event) => setForm({ ...form, company: event.target.value })}
                />
              </label>
              <label>
                Location <small>optional</small>
                <input
                  maxLength={240}
                  value={form.location}
                  placeholder="Remote · Toronto"
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                />
              </label>
              <label>
                Posting URL <small>optional</small>
                <input
                  type="url"
                  maxLength={2000}
                  value={form.sourceUrl}
                  placeholder="https://…"
                  onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })}
                />
              </label>
            </div>
            <label className="intake-text">
              Job description
              <textarea
                required
                rows={12}
                value={form.text}
                placeholder="Paste the full posting, including its headings."
                onChange={(event) => setForm({ ...form, text: event.target.value })}
              />
            </label>
            <p className="helper-text">
              Title and company are yours to enter: the parser copies what the posting says and never infers facts about
              it. Lines that address the agent are dropped before anything is stored.
            </p>
            <button className="button primary" type="submit" disabled={parsing}>
              {parsing ? "Reading the posting…" : "Parse requirements"}
            </button>
          </form>
          {notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}
        </section>
      ) : null}

      {!formOpen && notice ? <p className={`import-notice ${notice.tone}`}>{notice.text}</p> : null}

      {selected ? (
        <>
          {selected.report ? (
            <section className="panel report-panel jd-report">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Parse report</p>
                  <h2>{selected.report.sourceLineCount} lines read</h2>
                </div>
                <span className="count-label">{formatTime(selected.report.parsedAt)}</span>
              </div>
              <ul className="section-list">
                {selected.report.sections.map((section) => (
                  <li key={`${section.kind}-${section.startLine}`}>
                    <span>{section.heading ?? "Opening lines"}</span>
                    <b className={SECTION_LABELS[section.kind] === "not imported" ? "muted" : ""}>
                      {SECTION_LABELS[section.kind] ?? section.kind}
                    </b>
                  </li>
                ))}
              </ul>
              {selected.report.skipped.length > 0 ? (
                <p className="helper-text">
                  Skipped:{" "}
                  {selected.report.skipped
                    .map((entry) => `line ${entry.line} (${SKIP_LABELS[entry.reason] ?? entry.reason})`)
                    .join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="panel facts-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Step 2</p>
                <h2>Check what the posting asks for</h2>
              </div>
              <span className="count-label">{selected.requirements.length} requirements</span>
            </div>

            {selected.requirements.length === 0 ? (
              <p className="helper-text">This posting produced no requirements. Check the parse report above.</p>
            ) : null}

            {PRIORITY_GROUPS.map((group) => {
              const items = selected.requirements.filter((requirement) => requirement.priority === group.id);
              if (items.length === 0) {
                return null;
              }

              return (
                <div className="fact-group" key={group.id}>
                  <p className="fact-group-title">
                    {group.label} <b>{items.length}</b> <i>{group.note}</i>
                  </p>
                  {items.map((requirement) => (
                    <div className="fact-row requirement-row" key={requirement.id}>
                      <div className="fact-main">
                        <div className="fact-headline">
                          <strong>{requirement.text}</strong>
                        </div>
                        <p className="fact-source">
                          <span>{requirement.source.locator.replace("line:", "line ")}</span>
                          <span className="kind-chip">{KIND_LABELS[requirement.kind]}</span>
                        </p>
                        {requirement.keywords.length > 0 ? (
                          <p className="keyword-row">
                            {requirement.keywords.map((keyword) => (
                              <span key={keyword}>{keyword}</span>
                            ))}
                          </p>
                        ) : null}
                      </div>
                      <div className="fact-actions">
                        <select
                          aria-label={`Priority for ${requirement.text.slice(0, 40)}`}
                          disabled={busyRequirementId === requirement.id}
                          value={requirement.priority}
                          onChange={(event) =>
                            void onCorrect(requirement, { action: "set_priority", priority: event.target.value })
                          }
                        >
                          {PRIORITY_GROUPS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button className="text-button" onClick={() => void onCorrect(requirement, null)}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            <div className="approval-callout">
              <span>!</span>
              <div>
                <strong>Requirements are the posting's words, not verified facts</strong>
                <p>
                  Tailoring will match these against facts you verified in the profile vault. A requirement you have no
                  fact for stays unmatched rather than being written into a resume.
                </p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
