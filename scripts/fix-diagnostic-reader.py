from pathlib import Path

path = Path('app/page.tsx')
text = path.read_text(encoding='utf-8')

# Keep the Diagnostic compatibility reader in place.
start_marker = '  useEffect(() => {\n    if (!selected?.grade) {'
end_marker = '\n\n  const diagnosticFor='
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate Diagnostic reader block')
replacement = '''  useEffect(() => {
    if (!selected?.grade) {
      setDiagnosticResults({});
      return;
    }
    const grade = selected.grade;
    const legacyRef = databaseRef(
      diagnosticDb,
      `teacherControlCenter/diagnosticByGrade/grade${grade}/results`,
    );
    const currentRef = databaseRef(
      diagnosticDb,
      `teacherControlCenter/diagnosticByGrade/grade${grade}/resultsByStudent`,
    );
    let legacyRaw: Record<string, Record<string, DiagnosticResult>> = {};
    let currentRaw: Record<string, Record<string, DiagnosticResult>> = {};
    const rebuild = () => {
      const next: Record<string, DiagnosticResult> = {};
      const latestRank: Record<string, { time: number; key: string }> = {};
      const consider = (resultKey: string, result?: DiagnosticResult) => {
        if (!result?.studentId) return;
        const lookupKey = `${grade}:${String(result.studentId).trim()}`;
        const rank = { time: diagnosticResultTime(result), key: resultKey };
        const current = latestRank[lookupKey];
        if (!current || rank.time > current.time || (rank.time === current.time && rank.key > current.key)) {
          next[lookupKey] = result;
          latestRank[lookupKey] = rank;
        }
      };
      Object.entries(legacyRaw).forEach(([classKey, classResults]) =>
        Object.entries(classResults || {}).forEach(([resultKey, result]) =>
          consider(`legacy:${classKey}:${resultKey}`, result),
        ),
      );
      Object.entries(currentRaw).forEach(([studentKey, levelResults]) =>
        Object.entries(levelResults || {}).forEach(([levelKey, result]) =>
          consider(`current:${studentKey}:${levelKey}`, result),
        ),
      );
      setDiagnosticResults(next);
    };
    const unsubscribeLegacy = onValue(legacyRef, (snapshot) => {
      legacyRaw = (snapshot.val() || {}) as Record<string, Record<string, DiagnosticResult>>;
      rebuild();
    });
    const unsubscribeCurrent = onValue(currentRef, (snapshot) => {
      currentRaw = (snapshot.val() || {}) as Record<string, Record<string, DiagnosticResult>>;
      rebuild();
    });
    return () => {
      unsubscribeLegacy();
      unsubscribeCurrent();
    };
  }, [selected?.grade]);'''
text = text[:start] + replacement + text[end:]

# Round Diagnostic marks only when they are shown/used in the tracker.
# Raw Firebase Diagnostic values remain untouched.
replacements = {
    'diagnostic?.score ?? "",': 'diagnostic ? Math.round(Number(diagnostic.score)) : "",',
    '<><b>{diagnosticFor(s)?.score}</b><small>/100</small></>': '<><b>{Math.round(Number(diagnosticFor(s)?.score ?? 0))}</b><small>/100</small></>',
    'const total = supportPlanSource === "diagnostic" ? Number(diagnostic?.score || 0) : continuousTotal(student.id);': 'const total = supportPlanSource === "diagnostic" ? Math.round(Number(diagnostic?.score || 0)) : continuousTotal(student.id);',
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'Could not locate rounding target: {old}')
    text = text.replace(old, new)

path.write_text(text, encoding='utf-8')
