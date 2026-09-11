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
    if old in text:
        text = text.replace(old, new)
    elif new not in text:
        raise SystemExit(f'Could not locate rounding target: {old}')

# Maintain the private hashed Student ID registry used by the Diagnostic website.
# The registry stores only SHA-256 hashes (not names, class, grade, or raw IDs).
if 'set as databaseSet' not in text:
    old_import = 'import { onValue, ref as databaseRef } from "firebase/database";'
    new_import = 'import { onValue, ref as databaseRef, set as databaseSet } from "firebase/database";'
    if old_import not in text:
        raise SystemExit('Could not locate Firebase Database import')
    text = text.replace(old_import, new_import, 1)

if 'const syncStudentIdRegistry = async' not in text:
    anchor = 'const cleanEmail = (v: string) => v.trim().toLowerCase();\n'
    helper = '''const cleanEmail = (v: string) => v.trim().toLowerCase();
const studentIdRegistryHash = async (studentId: string) => {
  const bytes = new TextEncoder().encode(studentId.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};
const syncStudentIdRegistry = async (rows: Student[]) => {
  await Promise.all(
    rows
      .filter((student) => student.studentId?.trim())
      .map(async (student) => {
        const hash = await studentIdRegistryHash(student.studentId);
        await databaseSet(
          databaseRef(diagnosticDb, `assessmentTracker/studentIdRegistry/${hash}`),
          true,
        );
      }),
  );
};
'''
    if anchor not in text:
        raise SystemExit('Could not locate cleanEmail anchor')
    text = text.replace(anchor, helper, 1)

old_student_loader = '''      onSnapshot(actingAsAdmin ? collection(db, "students") : classSource("students"), (s) =>
        setStudents(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Student)),
      ),'''
new_student_loader = '''      onSnapshot(actingAsAdmin ? collection(db, "students") : classSource("students"), (s) => {
        const rows = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Student);
        setStudents(rows);
        void syncStudentIdRegistry(rows).catch((error) =>
          console.warn("Unable to sync Diagnostic Student ID registry", error),
        );
      }),'''
if old_student_loader in text:
    text = text.replace(old_student_loader, new_student_loader, 1)
elif new_student_loader not in text:
    raise SystemExit('Could not locate student snapshot loader')

# Important: when a teacher signs in, sync IDs from ALL of that teacher's classes,
# not only the currently selected class. This prevents Grades 11/12 (or any class
# that was not manually opened) from being rejected by the Diagnostic join page.
all_classes_marker = '  // Diagnostic ID registry sync: all teacher classes\n'
if all_classes_marker not in text:
    anchor = '\n\n  const selectedStudents = students\n'
    effect = '''

  // Diagnostic ID registry sync: all teacher classes
  useEffect(() => {
    if (!user || actingAsAdmin || classes.length === 0) return;
    const stops = classes.map((classroom) =>
      onSnapshot(
        query(collection(db, "students"), where("classId", "==", classroom.id)),
        (snapshot) => {
          const rows = snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as Student,
          );
          void syncStudentIdRegistry(rows).catch((error) =>
            console.warn(
              `Unable to sync Diagnostic Student ID registry for class ${classroom.id}`,
              error,
            ),
          );
        },
        (error) =>
          console.warn(
            `Unable to read students for Diagnostic ID sync in class ${classroom.id}`,
            error,
          ),
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [user, actingAsAdmin, classes]);
'''
    if anchor not in text:
        raise SystemExit('Could not locate selectedStudents anchor')
    text = text.replace(anchor, effect + anchor, 1)

path.write_text(text, encoding='utf-8')
