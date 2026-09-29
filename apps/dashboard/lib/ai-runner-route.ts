import { BrowserRunnerError } from "@resume-agent/browser-runner";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { runIntelligentForm } from "./ai-runner";
import { GeminiFormError } from "./gemini-form-provider";
import { runnerPayload } from "./runner-session";

export async function handleIntelligentFormRoute(mode: "plan" | "fill") {
  try {
    return NextResponse.json(await runIntelligentForm(mode));
  } catch (error) {
    if (error instanceof GeminiFormError) {
      return NextResponse.json(
        { error: error.code, message: error.message, ...(await runnerPayload()) },
        { status: error.code === "GEMINI_NOT_CONFIGURED" ? 503 : 502 },
      );
    }
    if (error instanceof BrowserRunnerError) {
      return NextResponse.json(
        { error: error.code, message: error.message, ...(await runnerPayload()) },
        { status: error.code === "SESSION_NOT_FOUND" || error.code === "STALE_SNAPSHOT" ? 409 : 502 },
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "GEMINI_INVALID_RESPONSE",
          message: "Gemini returned a plan that failed local validation. No browser field was changed.",
          ...(await runnerPayload()),
        },
        { status: 502 },
      );
    }
    throw error;
  }
}
