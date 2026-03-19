const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

    const sessionSheet = getOrCreateSheet_(
      spreadsheet,
      'sessions',
      [
        'submittedAt',
        'participantId',
        'sessionStartedAt',
        'consentAccepted',
        'consentAcceptedAt',
        'backgroundAnswersJson',
        'subjectiveAnswersJson',
        'finalPreferencesJson',
        'finalComment',
      ],
    );

    const trialSheet = getOrCreateSheet_(
      spreadsheet,
      'trial_responses',
      [
        'submittedAt',
        'participantId',
        'trialId',
        'blockId',
        'partId',
        'kind',
        'chartType',
        'promptType',
        'taskType',
        'foodName',
        'subgroupLabel',
        'correctAnswer',
        'answer',
        'isCorrect',
        'responseTimeMs',
        'difficulty',
        'trialOrderIndex',
        'answeredAt',
        'timeSinceSessionStartMs',
      ],
    );

    sessionSheet.appendRow([
      payload.submittedAt || new Date().toISOString(),
      payload.participantId || '',
      payload.sessionStartedAt || '',
      payload.consentAccepted === true,
      payload.consentAcceptedAt || '',
      JSON.stringify(payload.backgroundAnswers || {}),
      JSON.stringify(payload.subjectiveAnswers || {}),
      JSON.stringify(payload.finalPreferences || {}),
      payload.finalComment || '',
    ]);

    const trialResponses = Array.isArray(payload.trialResponses)
      ? payload.trialResponses
      : [];

    trialResponses.forEach((trial) => {
      trialSheet.appendRow([
        payload.submittedAt || new Date().toISOString(),
        payload.participantId || '',
        trial.trialId || '',
        trial.blockId || '',
        trial.partId || '',
        trial.kind || '',
        trial.chartType || '',
        trial.promptType || '',
        trial.taskType || '',
        trial.foodName || '',
        trial.subgroupLabel || '',
        trial.correctAnswer || '',
        trial.answer || '',
        trial.isCorrect === true,
        trial.responseTimeMs || '',
        trial.difficulty || '',
        trial.trialOrderIndex || '',
        trial.answeredAt || '',
        trial.timeSinceSessionStartMs || '',
      ]);
    });

    return jsonResponse_({ ok: true });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
}

function doGet() {
  return jsonResponse_({ ok: true, message: 'Study response endpoint is running.' });
}

function getOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
