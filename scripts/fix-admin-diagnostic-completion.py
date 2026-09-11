from pathlib import Path

path = Path('app/page.tsx')
text = path.read_text(encoding='utf-8')

# Add a department-wide Diagnostic result map for the Admin overview only.
state_anchor = '    [diagnosticResults, setDiagnosticResults] = useState<Record<string, DiagnosticResult>>({}),\n'
state_line = '    [adminDiagnosticResults, setAdminDiagnosticResults] = useState<Record<string, DiagnosticResult>>({}),\n'
if state_line not in text:
    if state_anchor not in text:
        raise SystemExit('Could not locate Diagnostic result state anchor')
    text = text.replace(state_anchor, state_anchor + state_line, 1)

# Read the canonical Diagnostic results written by the Diagnostic website for all grades.
admin_reader_marker = '  // Admin overview Diagnostic completion reader\n'
if admin_reader_marker not in text:
    insert_anchor = '\n  const diagnosticFor=(student:Student)=>'
    if insert_anchor not in text:
        raise SystemExit('Could not locate diagnosticFor anchor')
    admin_reader = '''\n\n  // Admin overview Diagnostic completion reader\n  useEffect(() => {\n    if (!actingAsAdmin) {\n      setAdminDiagnosticResults({});\n      return;\n    }\n    const resultsRef = databaseRef(diagnosticDb, `assessmentTracker/diagnosticByStudent`);\n    return onValue(resultsRef, (snapshot) => {\n      const raw = (snapshot.val() || {}) as Record<string, Record<string, Record<string, DiagnosticResult>>>;\n      const next: Record<string, DiagnosticResult> = {};\n      const latestRank: Record<string, { time: number; key: string }> = {};\n      Object.entries(raw).forEach(([studentKey, gradeRows]) =>\n        Object.entries(gradeRows || {}).forEach(([gradeKey, levelRows]) => {\n          const match = String(gradeKey).match(/grade(\\d+)/i);\n          const grade = match ? Number(match[1]) : 0;\n          if (!grade) return;\n          Object.entries(levelRows || {}).forEach(([levelKey, result]) => {\n            if (!result?.studentId) return;\n            const lookupKey = `${grade}:${String(result.studentId).trim()}`;\n            const rank = { time: diagnosticResultTime(result), key: `${studentKey}:${gradeKey}:${levelKey}` };\n            const current = latestRank[lookupKey];\n            if (!current || rank.time > current.time || (rank.time === current.time && rank.key > current.key)) {\n              next[lookupKey] = result;\n              latestRank[lookupKey] = rank;\n            }\n          });\n        }),\n      );\n      setAdminDiagnosticResults(next);\n    });\n  }, [actingAsAdmin]);\n'''
    text = text.replace(insert_anchor, admin_reader + insert_anchor, 1)

# Use actual Diagnostic submissions to count the required Diagnostic assessment in Admin follow-up.
helper_marker = '  const adminDiagnosticComplete = (classroom: ClassRoom) =>\n'
if helper_marker not in text:
    helper_anchor = '  const totalRequired = Object.values(plan).reduce((a, b) => a + b, 0);\n'
    if helper_anchor not in text:
        raise SystemExit('Could not locate admin summary anchor')
    helper = '''  const adminDiagnosticComplete = (classroom: ClassRoom) =>\n    students\n      .filter((student) => student.classId === classroom.id)\n      .some((student) =>\n        Boolean(adminDiagnosticResults[`${classroom.grade}:${student.studentId.trim()}`]),\n      );\n  const adminAssessmentCount = (classroom: ClassRoom, type: TestType) =>\n    type === "Diagnostic"\n      ? (adminDiagnosticComplete(classroom) ? 1 : 0)\n      : tests.filter((test) => test.classId === classroom.id && test.type === type).length;\n\n'''
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

old_summary_count = '''                tests.filter((v) => v.classId === c.id && v.type === t).length,\n'''
new_summary_count = '''                adminAssessmentCount(c, t),\n'''
# Replace only the first occurrence in summary.
summary_pos = text.find('  const summary = useMemo(() => {')
if summary_pos < 0:
    raise SystemExit('Could not locate summary useMemo')
count_pos = text.find(old_summary_count, summary_pos)
if count_pos >= 0:
    text = text[:count_pos] + new_summary_count + text[count_pos + len(old_summary_count):]
elif new_summary_count not in text[summary_pos:summary_pos+1600]:
    raise SystemExit('Could not locate summary assessment count')

old_deps = '  }, [classes, tests]);\n'
new_deps = '  }, [classes, tests, students, adminDiagnosticResults]);\n'
summary_end_pos = text.find(old_deps, summary_pos)
if summary_end_pos >= 0:
    text = text[:summary_end_pos] + new_deps + text[summary_end_pos + len(old_deps):]
elif new_deps not in text[summary_pos:summary_pos+2200]:
    raise SystemExit('Could not update summary dependencies')

# Admin "classes needing action" must use the same Diagnostic-completion rule.
old_action = '''                        tests.filter((x) => x.classId === c.id && x.type === t)\n                          .length < plan[t],\n'''
new_action = '''                        adminAssessmentCount(c, t) < plan[t],\n'''
if old_action in text:
    text = text.replace(old_action, new_action, 1)
elif new_action not in text:
    raise SystemExit('Could not locate classes-needing-action count')

# Per-class progress calculation in the Admin table.
old_done = '''                            tests.filter(\n                              (x) => x.classId === c.id && x.type === t,\n                            ).length,\n'''
new_done = '''                            adminAssessmentCount(c, t),\n'''
if old_done in text:
    text = text.replace(old_done, new_done, 1)
elif new_done not in text:
    raise SystemExit('Could not locate Admin table progress count')

# Per-type pill value in the Admin table.
old_n = '''                            const n = tests.filter(\n                              (x) => x.classId === c.id && x.type === t,\n                            ).length;\n'''
new_n = '''                            const n = adminAssessmentCount(c, t);\n'''
if old_n in text:
    text = text.replace(old_n, new_n, 1)
elif new_n not in text:
    raise SystemExit('Could not locate Admin table pill count')

path.write_text(text, encoding='utf-8')
print('Admin Diagnostic follow-up now counts saved Diagnostic submissions from assessmentTracker/diagnosticByStudent')
