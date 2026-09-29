import { handleIntelligentFormRoute } from "../../../../../lib/ai-runner-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask Gemini for a grounded form plan without writing to the page. */
export async function POST() {
  return handleIntelligentFormRoute("plan");
}
