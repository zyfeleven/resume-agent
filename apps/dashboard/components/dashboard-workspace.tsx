"use client";

import { useState } from "react";

type View = "overview" | "applications";

const activity = [
  { time: "09:42", title: "Application plan created", detail: "Form fields classified from the latest page snapshot.", tone: "quiet" },
  { time: "09:45", title: "Contact details verified", detail: "3 sourced profile facts are ready for the selected application.", tone: "good" },
  { time: "09:47", title: "Question needs review", detail: "Work authorization is sensitive and remains under your control.", tone: "attention" },
];

const fields = [
  { name: "First name", value: "Maya", source: "Verified identity fact", state: "Filled" },
  { name: "Email", value: "maya.chen@example.com", source: "Verified contact fact", state: "Filled" },
  { name: "Work authorization", value: "Needs your answer", source: "Sensitive field", state: "Take over" },
];

function Sidebar({ view }: { view: View }) {
  const items = [
    { label: "Overview", href: "/", active: view === "overview", note: "" },
    { label: "Applications", href: "/applications", active: view === "applications", note: "1" },
    { label: "Resume Studio", href: "#resume-studio", active: false, note: "" },
    { label: "Profile Vault", href: "#profile-vault", active: false, note: "" },
    { label: "Activity", href: "#activity", active: false, note: "" },
  ];

  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Resume Agent home">
        <span className="brand-mark">R</span>
        <span>
          <strong>Resume Agent</strong>
          <small>Supervised workspace</small>
        </span>
      </a>
      <nav aria-label="Main navigation">
        <p className="nav-kicker">Workspace</p>
        {items.map((item) => (
          <a className={`nav-item ${item.active ? "active" : ""}`} href={item.href} key={item.label}>
            <span>{item.label}</span>
            {item.note ? <b>{item.note}</b> : null}
          </a>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="local-status"><span /> Local runner protected</div>
        <p>Credentials and browser sessions stay on your device.</p>
      </div>
    </aside>
  );
}

function StatusPill({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "good" | "attention" }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function Overview({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return (
    <>
      <section className="hero-card">
        <div>
          <p className="eyebrow">Monday, July 27</p>
          <h1>A calm control plane for every application.</h1>
          <p className="hero-copy">Your agent can prepare reversible form updates. You keep control of sensitive answers, uploads, and every final submission.</p>
        </div>
        <div className="hero-action">
          <div className="readiness-ring" aria-label="Application readiness 72 percent"><strong>72%</strong><span>ready</span></div>
          <a className="button primary" href="/applications">Open application</a>
        </div>
      </section>

      <section className="metric-grid" aria-label="Application metrics">
        <article className="metric-card"><p>Active applications</p><strong>01</strong><span>1 waiting for you</span></article>
        <article className="metric-card"><p>Verified facts</p><strong>24</strong><span>All sources intact</span></article>
        <article className="metric-card"><p>Resume versions</p><strong>03</strong><span>1 ready to review</span></article>
        <article className="metric-card accent"><p>Approvals needed</p><strong>02</strong><span>Nothing is submitted</span></article>
      </section>

      <section className="content-grid">
        <article className="panel application-card">
          <div className="panel-heading">
            <div><p className="eyebrow">Current application</p><h2>Product Designer · Northstar</h2></div>
            <StatusPill tone="attention">Needs review</StatusPill>
          </div>
          <div className="application-meta"><span>Remote · Toronto</span><span>•</span><span>Updated just now</span></div>
          <div className="progress-track" aria-label="Application progress"><span /></div>
          <div className="progress-steps"><span className="complete">Profile</span><span className="complete">Resume</span><span className="current">Form review</span><span>Submit</span></div>
          <div className="application-footer">
            <div className="avatar-stack" aria-label="Sources ready"><span>M</span><span>R</span><span>J</span></div>
            <button className="text-button" onClick={onOpenWorkspace}>Review 2 items <span aria-hidden="true">→</span></button>
          </div>
        </article>

        <article className="panel safety-card">
          <div className="safety-icon" aria-hidden="true">✓</div>
          <p className="eyebrow">Safety status</p>
          <h2>Nothing can submit itself.</h2>
          <p>Final submission is locked until you review the exact form and approve that specific action.</p>
          <a href="/applications" className="text-button">See the approval queue <span aria-hidden="true">→</span></a>
        </article>
      </section>

      <section className="panel timeline-panel" id="activity">
        <div className="panel-heading"><div><p className="eyebrow">Live activity</p><h2>What the agent did, in plain language</h2></div><StatusPill tone="good">All checks passed</StatusPill></div>
        <ol className="timeline">
          {activity.map((item) => <li key={item.time}><time>{item.time}</time><span className={`timeline-dot ${item.tone}`} /><div><strong>{item.title}</strong><p>{item.detail}</p></div></li>)}
        </ol>
      </section>
    </>
  );
}

function Applications({ paused, onTogglePause }: { paused: boolean; onTogglePause: () => void }) {
  return (
    <>
      <section className="workspace-title">
        <div><p className="eyebrow">Application workspace</p><h1>Product Designer · Northstar</h1><p>northstar.example/apply · local browser session</p></div>
        <div className="workspace-actions"><StatusPill tone={paused ? "attention" : "good"}>{paused ? "Paused safely" : "Runner observed"}</StatusPill><button className="button secondary" onClick={onTogglePause}>{paused ? "Resume plan" : "Pause run"}</button></div>
      </section>

      <section className="workspace-grid">
        <article className="panel run-panel">
          <div className="panel-heading"><div><p className="eyebrow">Run timeline</p><h2>Step 3 of 4</h2></div><span className="count-label">Latest snapshot</span></div>
          <ol className="run-steps">
            <li className="done"><span>1</span><div><strong>Prepare profile</strong><p>Verified facts selected</p></div></li>
            <li className="done"><span>2</span><div><strong>Attach resume</strong><p>Approved version ready</p></div></li>
            <li className="active"><span>3</span><div><strong>Review form</strong><p>1 sensitive question waiting</p></div></li>
            <li><span>4</span><div><strong>Final approval</strong><p>Always requires you</p></div></li>
          </ol>
          <button className="takeover-button">Take over browser</button>
          <p className="helper-text">Your agent pauses immediately and asks for a fresh page snapshot when you hand control back.</p>
        </article>

        <article className="browser-panel" aria-label="Synthetic browser snapshot">
          <div className="browser-toolbar"><span className="browser-dots"><i /><i /><i /></span><span className="address">northstar.example/apply</span><span className="secure-dot">Local</span></div>
          <div className="browser-content">
            <div className="company-line"><span className="company-mark">N</span><strong>Northstar careers</strong></div>
            <p className="form-step">Application · Personal details</p>
            <h2>Tell us a little about yourself</h2>
            <label>First name <input value="Maya" readOnly aria-label="First name" /></label>
            <label>Email <input value="maya.chen@example.com" readOnly aria-label="Email" /></label>
            <div className="sensitive-field"><span>Work authorization</span><button>Answer in browser</button><small>Human input required</small></div>
            <button className="form-next" disabled>Continue after review</button>
          </div>
        </article>

        <article className="panel decisions-panel">
          <div className="panel-heading"><div><p className="eyebrow">Review queue</p><h2>Field decisions</h2></div><StatusPill tone="attention">1 action</StatusPill></div>
          <div className="field-list">
            {fields.map((field) => <div className={`field-row ${field.state === "Take over" ? "requires-action" : ""}`} key={field.name}><div><strong>{field.name}</strong><p>{field.value}</p><small>{field.source}</small></div><StatusPill tone={field.state === "Filled" ? "good" : "attention"}>{field.state}</StatusPill></div>)}
          </div>
          <div className="approval-callout"><span>!</span><div><strong>Final submit is locked</strong><p>It becomes available only after every review item is resolved and you approve this exact page.</p></div></div>
        </article>
      </section>
    </>
  );
}

export function DashboardWorkspace({ view }: { view: View }) {
  const [paused, setPaused] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(view === "applications");
  const currentView = workspaceOpen ? "applications" : view;

  return (
    <div className="app-shell">
      <Sidebar view={currentView} />
      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{currentView === "overview" ? "Overview" : "Applications"}</strong></div><div className="topbar-right"><button className="notification-button" aria-label="Two pending notifications">2</button><span className="user-avatar">MC</span></div></header>
        <div className="page-content">
          {currentView === "overview" ? <Overview onOpenWorkspace={() => setWorkspaceOpen(true)} /> : <Applications paused={paused} onTogglePause={() => setPaused((value) => !value)} />}
        </div>
      </main>
    </div>
  );
}
