import { handleIntelligentFormRoute } from "../../../../../lib/ai-runner-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask Gemini for a grounded plan, then fill only fields the local policy allows. */
export async function POST() {
  return handleIntelligentFormRoute("fill");
}
