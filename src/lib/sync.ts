import type { SavedSession } from "./storage";
import type { StudyPack } from "./types";

export async function submitStudySession(
  pack: StudyPack,
  session: SavedSession,
): Promise<{ ok: boolean; message: string }> {
  const envEndpoint = import.meta.env.VITE_STUDY_RESPONSE_ENDPOINT as
    | string
    | undefined;
  const endpoint = envEndpoint || pack.responseEndpoint;

  if (!endpoint) {
    return {
      ok: false,
      message:
        "No response endpoint is configured yet. Progress is still saved locally in this browser.",
    };
  }

  const payload = {
    submittedAt: new Date().toISOString(),
    participantId: session.participantId,
    sessionStartedAt: session.sessionStartedAt,
    consentAccepted: session.consentAccepted,
    consentAcceptedAt: session.consentAcceptedAt,
    backgroundAnswers: session.backgroundAnswers,
    trialResponses: session.trialResponses,
    subjectiveAnswers: session.subjectiveAnswers ?? {},
    finalPreferences: session.finalPreferences ?? {},
    finalComment: session.finalComment ?? "",
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      message:
        "Submission failed because the response endpoint could not be reached from the browser. Progress remains stored locally.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `Submission failed with status ${response.status}. Progress remains stored locally.`,
    };
  }

  return { ok: true, message: "Responses submitted successfully." };
}
