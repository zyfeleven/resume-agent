import { notFound } from "next/navigation";
import { applicationReadiness } from "../../../../lib/application-readiness";
import { applicationTaskHref, resolveApplicationTaskId } from "../../../../lib/application-links";
import { readDiscoveryStore } from "../../../../lib/discovery-store";
import { readJobStore } from "../../../../lib/job-store";
import { readProfileStore } from "../../../../lib/profile-store";
import { readResumeStore } from "../../../../lib/resume-store";
import styles from "../../../../components/job-agent.module.css";
import { AtsFormPreview } from "../../../../components/ats-form-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ApplicationPreparationPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId: segment } = await params;
  const [discovery, profile, jobs, resumes] = await Promise.all([readDiscoveryStore(), readProfileStore(), readJobStore(), readResumeStore()]);
  const taskId = resolveApplicationTaskId(discovery.tasks, segment);
  if (!taskId) notFound();
  const view = await applicationReadiness(taskId, { discovery, profile, jobs, resumes });
  if (!view) notFound();
  const task = discovery.tasks.find((entry) => entry.id === taskId)!;
  const candidate = discovery.jobs.find((entry) => entry.id === task.candidateId);
  return <main className={`${styles.agent} ${styles.preparation}`}>
    <nav className={styles.actions} aria-label="Preparation navigation">
      <a className="button secondary" href="/agent">← Job Agent</a>
      <a className="button secondary" href={applicationTaskHref(taskId)}>Refresh checks</a>
    </nav>
    <header><p className="eyebrow">Application preparation</p><h1>{view.title}</h1><p>{view.company} · {view.location}</p></header>
    <p className={styles.notice}>{view.documentVerified ? "Resume artifact verified locally. Real-site application is not connected." : "Preparation is incomplete. Follow the checklist below."} Nothing has been submitted.</p>
    <p className={styles.caption}>Checked {view.checkedAt}. Posting last collected: {view.lastSeenAt ?? "unknown"}. Refresh checks reads local records only; it does not search the web or use an API key.</p>
    <ol className={styles.checklist}>{view.steps.map((step) => <li className={`panel ${styles.card}`} key={step.id}>
      <p className="eyebrow">{step.status.replaceAll("_", " ")}</p><h2>{step.label}</h2><p>{step.detail}</p>
    </li>)}</ol>
    <AtsFormPreview key={`${taskId}:${candidate?.fingerprint}`} taskId={taskId} fingerprint={candidate?.fingerprint ?? ""} supported={candidate?.provider === "greenhouse"} approved={view.steps[0]?.status === "passed"} />
    <section className={`panel ${styles.card}`}><h2>Continue preparation</h2><p>Last generation status: {view.taskMessage}</p>
      <div className={styles.actions}>
        {view.resumeUrl ? <a className="button primary" href={view.resumeUrl}>Review this exact resume</a> : null}
        {view.downloadUrl ? <a className="button primary" href={view.downloadUrl}>Download verified DOCX</a> : null}
        <a className="button secondary" href="/profile">Review profile facts</a>
        {view.postingUrl ? <a className="button secondary" href={view.postingUrl} target="_blank" rel="noreferrer">View original posting</a> : null}
      </div>
      <p className={styles.caption}>No ATS form session, upload or final-submit permission is created by opening this page.</p>
    </section>
  </main>;
}
