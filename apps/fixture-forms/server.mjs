import { createServer } from "node:http";

/**
 * The controlled application-form lab from docs/FIXTURE_FORM_SPEC.md.
 *
 * It is a test target, not a job board. It makes no external network request, holds only
 * synthetic data, and never sends an application anywhere. Fixtures F01, F09, and F10 are
 * implemented; the remaining IDs in the spec are not built yet and are reported as absent
 * rather than faked.
 */
const PORT = Number(process.env.FIXTURE_PORT ?? 3100);
const HOST = "127.0.0.1";

const BASELINE = {
  revision: 1,
  signal: "",
};

const state = { ...BASELINE };

const FIELDS = [
  { name: "first_name", label: "First name", type: "text", required: true, autocomplete: "given-name" },
  { name: "last_name", label: "Last name", type: "text", required: true, autocomplete: "family-name" },
  { name: "email", label: "Email address", type: "email", required: true, autocomplete: "email" },
  { name: "phone", label: "Phone number", type: "tel", required: false, autocomplete: "tel" },
  { name: "location", label: "Current location", type: "text", required: false, autocomplete: "address-level2" },
  { name: "start_date", label: "Earliest start date", type: "date", required: false, autocomplete: "" },
];

const SENSITIVE_FIELDS = [
  { name: "work_authorization", label: "Are you authorized to work in this country?", type: "text" },
  { name: "compensation", label: "Expected compensation", type: "text" },
  { name: "signature", label: "Type your full name as an electronic signature", type: "text" },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function field({ name, label, type, required, autocomplete }) {
  return `      <p class="field">
        <label for="${name}">${escapeHtml(label)}${required ? ' <span aria-hidden="true">*</span>' : ""}</label>
        <input id="${name}" name="${name}" type="${type}" data-testid="field:${name}"${
          autocomplete ? ` autocomplete="${autocomplete}"` : ""
        }${required ? " required" : ""} />
        <span class="validation" data-testid="validation:${name}"></span>
      </p>`;
}

function sensitiveField({ name, label, type }) {
  return `      <p class="field sensitive" data-sensitive="true">
        <label for="${name}">${escapeHtml(label)}</label>
        <input id="${name}" name="${name}" type="${type}" data-testid="field:${name}" />
      </p>`;
}

function page() {
  const signalAttribute = state.signal ? ` data-fixture-signal="${state.signal}"` : "";
  const signalNotice = state.signal
    ? `    <p class="signal" data-testid="signal:notice">Synthetic condition active: ${escapeHtml(state.signal)}. This fixture only simulates the detection condition; it contains no bypass path and collects no credentials.</p>`
    : "";

  return `<!doctype html>
<html lang="en" data-fixture-id="F01" data-fixture-revision="${state.revision}"${signalAttribute}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fixture careers — Application</title>
  <style>
    body { margin: 0; padding: 40px 24px; background: #f4f6f5; color: #1d2b26; font-family: system-ui, sans-serif; }
    main { max-width: 640px; margin: 0 auto; padding: 32px 36px; background: #fff; border: 1px solid #dde4e1; border-radius: 12px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    p.lead { margin: 0 0 26px; color: #56655f; font-size: 13px; }
    h2 { margin: 28px 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #2f4a41; }
    .field { margin: 0 0 14px; }
    label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 600; }
    input { width: 100%; padding: 8px 10px; border: 1px solid #c7d2cd; border-radius: 6px; font-size: 13px; }
    .sensitive input { border-color: #e0b357; background: #fffdf6; }
    .validation { display: block; margin-top: 4px; color: #a4442f; font-size: 11px; }
    .signal { padding: 10px 12px; border: 1px solid #e0b357; border-radius: 6px; background: #fffdf6; font-size: 12px; }
    button { margin-top: 18px; padding: 9px 16px; border: 0; border-radius: 6px; background: #1f5c47; color: #fff; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>Fixture careers</h1>
    <p class="lead">Synthetic application form. Nothing here is submitted anywhere.</p>
${signalNotice}
    <form data-testid="form:application" method="post" action="/__fixture/submit">
      <h2>Personal details</h2>
${FIELDS.map(field).join("\n")}
      <h2>Additional questions</h2>
${SENSITIVE_FIELDS.map(sensitiveField).join("\n")}
      <button type="submit" data-testid="submit:application" data-submit-candidate="true">Submit application</button>
    </form>
  </main>
</body>
</html>
`;
}

/**
 * F14 — a posting shaped like a real applicant tracking system.
 *
 * Deliberately hostile to every fixture convention: no `data-testid`, no
 * `data-sensitive`, no submit marker, nested attribute names, and EEO questions that
 * announce nothing about themselves. A runner that only works on the marked fixture will
 * fail here, which is the point: this is what a real careers page actually looks like.
 */
function plainPage() {
  const text = ({ id, name, label, type = "text", autocomplete, placeholder, required }) =>
    `      <div class="field">
        <label for="${id}">${escapeHtml(label)}</label>
        <input id="${id}" name="${name}" type="${type}"${autocomplete ? ` autocomplete="${autocomplete}"` : ""}${
          placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : ""
        }${required ? " required" : ""} />
      </div>`;

  return `<!doctype html>
<html lang="en" data-fixture-id="F14" data-fixture-revision="${state.revision}">
<head>
  <meta charset="utf-8" />
  <title>Northwind Robotics — Careers</title>
  <style>
    body { margin: 0; padding: 40px 24px; background: #f7f8fa; color: #1a1f24; font-family: system-ui, sans-serif; }
    main { max-width: 660px; margin: 0 auto; padding: 32px 36px; background: #fff; border: 1px solid #e2e6ea; border-radius: 10px; }
    h1 { margin: 0 0 20px; font-size: 21px; }
    h2 { margin: 26px 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #4a5560; }
    .field { margin: 0 0 14px; }
    label { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 600; }
    input, select { width: 100%; padding: 8px 10px; border: 1px solid #cfd6dd; border-radius: 5px; font-size: 13px; }
    button { margin-top: 18px; padding: 9px 18px; border: 0; border-radius: 5px; background: #14508c; color: #fff; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>Senior Product Designer</h1>
    <form method="post" action="/__fixture/submit">
      <h2>About you</h2>
${text({ id: "c_fn", name: "candidate[first_name]", label: "First name", autocomplete: "given-name", required: true })}
${text({ id: "c_ln", name: "candidate[last_name]", label: "Last name", autocomplete: "family-name", required: true })}
${text({ id: "c_em", name: "candidate[email]", label: "Email address", type: "email", autocomplete: "email", required: true })}
${text({ id: "c_ph", name: "candidate[phone]", label: "Phone number", type: "tel", autocomplete: "tel" })}
${text({ id: "c_loc", name: "candidate[city]", label: "Where are you based?", autocomplete: "address-level2", placeholder: "City" })}
${text({ id: "c_li", name: "candidate[urls][linkedin]", label: "LinkedIn profile", type: "url" })}
      <h2>Role details</h2>
${text({ id: "c_start", name: "candidate[start_date]", label: "Earliest start date", type: "date" })}
${text({ id: "c_src", name: "candidate[source]", label: "How did you hear about this role?" })}
      <h2>Additional information</h2>
${text({ id: "q_auth", name: "eeoc[work_auth]", label: "Are you legally authorized to work in this country?" })}
${text({ id: "q_spon", name: "eeoc[sponsor]", label: "Will you now or in the future require sponsorship?" })}
${text({ id: "q_comp", name: "candidate[expected_salary]", label: "Expected compensation" })}
${text({ id: "q_gender", name: "eeoc[gender]", label: "Gender identity (optional)" })}
${text({ id: "q_eth", name: "eeoc[ethnicity]", label: "Race or ethnicity (optional)" })}
${text({ id: "q_vet", name: "eeoc[veteran]", label: "Protected veteran status (optional)" })}
${text({ id: "q_dis", name: "eeoc[disability]", label: "Disability status (optional)" })}
${text({ id: "q_sig", name: "candidate[signature]", label: "Type your full name as an electronic signature" })}
      <button type="submit">Submit application</button>
    </form>
  </main>
</body>
</html>
`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  if (request.method === "POST" && url.pathname.startsWith("/__fixture/reset/")) {
    Object.assign(state, BASELINE);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ fixtureId: "F01", revision: state.revision, seed: "fixture-seed-1" }));
    return;
  }

  // Turn a synthetic safety marker on, so policy routing can be exercised end to end.
  if (request.method === "POST" && url.pathname === "/__fixture/signal") {
    state.signal = url.searchParams.get("value") ?? "";
    state.revision += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ signal: state.signal, revision: state.revision }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/__fixture/submit") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html lang="en" data-fixture-id="F13" data-fixture-revision="${state.revision}"><body><main><h1>Fixture receipt</h1><p data-testid="receipt:id">FIXTURE-RECEIPT-0001</p><p>Synthetic receipt. No application was sent.</p></main></body></html>`,
    );
    return;
  }

  if (url.pathname === "/apply/plain") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(plainPage());
    return;
  }

  if (url.pathname === "/" || url.pathname === "/apply") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page());
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not a fixture route.");
});

server.listen(PORT, HOST, () => {
  console.log(`Fixture form lab on http://${HOST}:${PORT} (fixture F01, revision ${state.revision})`);
});
