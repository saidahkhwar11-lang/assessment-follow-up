from pathlib import Path

path = Path('app/page.tsx')
text = path.read_text(encoding='utf-8')
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
path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')
