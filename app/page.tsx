"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, coordinatorEmail, db, diagnosticDb } from "./firebase";
import { onValue, ref as databaseRef } from "firebase/database";

type TestType =
  | "Diagnostic"
  | "Reading"
  | "Writing"
  | "Spelling"
  | "Speaking"
  | "Extra Credit Exam"
  | "Bonus";
type ClassRoom = {
  id: string;
  grade: number;
  gradeLevel?: string;
  section: string;
  teacherName: string;
  teacherEmail: string;
};
type Student = { id: string; classId: string; name: string; studentId: string };
type Test = {
  id: string;
  classId: string;
  type: TestType;
  title: string;
  date: string;
  max: number;
  targetStudentIds?: string[];
};
type Score = {
  id: string;
  classId: string;
  assessmentId: string;
  studentId: string;
  value: string;
};
type DiagnosticResult = { studentId: string; score: number; level: string; skills?: { Grammar?: number; Vocabulary?: number; Context?: number; Reading?: number }; completedAt?: number };
type Comment = {
  id: string;
  classId: string;
  authorEmail: string;
  authorRole: "admin" | "teacher";
  text: string;
  parentId: string;
  createdAt: number;
};

const planTypes: TestType[] = [
  "Diagnostic",
  "Reading",
  "Writing",
  "Spelling",
  "Speaking",
];
const testTypes: TestType[] = [
  ...planTypes,
  "Extra Credit Exam",
  "Bonus",
];
const plan: Record<TestType, number> = {
  Diagnostic: 1,
  Reading: 2,
  Writing: 2,
  Spelling: 4,
  Speaking: 1,
  "Extra Credit Exam": 0,
  Bonus: 0,
};
const gradeLevels = [
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9 ADV",
  "Grade 9 G",
  "Grade 10 ADV",
  "Grade 10 G",
  "Grade 11 ADV",
  "Grade 11 G",
  "Grade 12 ADV",
  "Grade 12 G",
] as const;
const cleanEmail = (v: string) => v.trim().toLowerCase();
const classGradeLevel = (classroom: ClassRoom) => {
  if (classroom.gradeLevel) return classroom.gradeLevel;
  if (classroom.grade <= 8) return `Grade ${classroom.grade}`;
  return `Grade ${classroom.grade} ${/adv/i.test(classroom.section) ? "ADV" : "G"}`;
};

export default function Home({
  portal,
}: {
  portal?: "admin" | "teacher";
}) {
  const [user, setUser] = useState<User | null>(null),
    [authLoading, setAuthLoading] = useState(true),
    [authMode, setAuthMode] = useState<"signin" | "signup">("signin"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState<ClassRoom[]>([]),
    [students, setStudents] = useState<Student[]>([]),
    [tests, setTests] = useState<Test[]>([]),
    [scores, setScores] = useState<Score[]>([]),
    [comments, setComments] = useState<Comment[]>([]),
    [diagnosticResults, setDiagnosticResults] = useState<Record<string, DiagnosticResult>>({}),
    [diagnosticDetail, setDiagnosticDetail] = useState<{ student: Student; result: DiagnosticResult } | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [role, setRole] = useState<"admin" | "teacher">(
      portal === "teacher" ? "teacher" : "admin",
    ),
    [gradeFilter, setGradeFilter] = useState<string>("all"),
    [newType, setNewType] = useState<TestType>("Reading"),
    [newAssessmentTitle, setNewAssessmentTitle] = useState(""),
    [newAssessmentMax, setNewAssessmentMax] = useState("20"),
    [targetMode, setTargetMode] = useState<"all" | "selected">("all"),
    [targetStudentIds, setTargetStudentIds] = useState<string[]>([]),
    [dataLoading, setDataLoading] = useState(false),
    [commentText, setCommentText] = useState(""),
    [replyTo, setReplyTo] = useState(""),
    [showClassForm, setShowClassForm] = useState(false),
    [editingClassId, setEditingClassId] = useState(""),
    [newGradeLevel, setNewGradeLevel] = useState<(typeof gradeLevels)[number]>("Grade 5"),
    [newSection, setNewSection] = useState(""),
    [newTeacherName, setNewTeacherName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = cleanEmail(user?.email ?? "") === coordinatorEmail;
  const canEdit = portal === "teacher" || (!portal && !isAdmin);
  const actingAsAdmin = isAdmin && portal !== "teacher";
  const selected = classes.find((c) => c.id === selectedId);
  useEffect(() => {
    const unsubs=Array.from({length:8},(_,i)=>i+5).map((grade)=>onValue(databaseRef(diagnosticDb,`teacherControlCenter/diagnosticByGrade/grade${grade}/results`),(snapshot)=>{
      const raw=snapshot.val()||{};
      setDiagnosticResults((current)=>{const next={...current};Object.keys(next).forEach((key)=>{if(key.startsWith(`${grade}:`))delete next[key]});Object.values(raw).forEach((classResults)=>Object.values((classResults||{}) as Record<string,DiagnosticResult>).forEach((result)=>{if(result?.studentId)next[`${grade}:${String(result.studentId).trim()}`]=result}));return next});
    }));
    return ()=>unsubs.forEach((fn)=>fn());
  },[]);
  const diagnosticFor=(student:Student)=>{const classroom=classes.find((item)=>item.id===student.classId);const grade=classroom?.grade;return grade?diagnosticResults[`${grade}:${student.studentId.trim()}`]:undefined};

  const selectedStudents = students.filter((s) => s.classId === selectedId);
  const selectedTests = tests.filter((t) => t.classId === selectedId);
  const flash = (m: string) => {
    setMessage(m);
    window.setTimeout(() => setMessage(""), 3000);
  };
  const defaultMaximum = (type: TestType) =>
    type === "Diagnostic" ? "100" : type === "Bonus" ? "5" : "20";

  useEffect(() => {
    setTargetMode("all");
    setTargetStudentIds([]);
  }, [selectedId]);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthLoading(false);
        if (u && !portal)
          setRole(
            cleanEmail(u.email ?? "") === coordinatorEmail
              ? "admin"
              : "teacher",
          );
      }),
    [portal],
  );

  useEffect(() => {
    if (!user) {
      setClasses([]);
      return;
    }
    setDataLoading(true);
    const admin = cleanEmail(user.email ?? "") === coordinatorEmail && portal !== "teacher";
    const classQuery = admin
        ? collection(db, "classes")
        : query(
            collection(db, "classes"),
            where("teacherEmail", "==", cleanEmail(user.email ?? "")),
          );
    return onSnapshot(classQuery, (snapshot) => {
      const classRows = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as ClassRoom,
        );
      setClasses(
        classRows.sort(
          (a, b) =>
            gradeLevels.indexOf(classGradeLevel(a) as (typeof gradeLevels)[number]) -
              gradeLevels.indexOf(classGradeLevel(b) as (typeof gradeLevels)[number]) ||
            a.section.localeCompare(b.section),
        ),
      );
      setSelectedId((v) =>
        classRows.some((c) => c.id === v) ? v : (classRows[0]?.id ?? ""),
      );
      setDataLoading(false);
    }, () => {
      flash(
        "Firebase is connected, but the security rules still need to be published.",
      );
      setDataLoading(false);
    });
  }, [user, portal]);

  useEffect(() => {
    if (!user || (!actingAsAdmin && !selectedId)) {
      setStudents([]);
      setTests([]);
      setScores([]);
      setComments([]);
      return;
    }
    const classSource = (name: string) =>
        query(collection(db, name), where("classId", "==", selectedId)),
      stops: Array<() => void> = [];

    stops.push(
      onSnapshot(actingAsAdmin ? collection(db, "students") : classSource("students"), (s) =>
        setStudents(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Student)),
      ),
      onSnapshot(actingAsAdmin ? collection(db, "assessments") : classSource("assessments"), (s) =>
        setTests(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Test)),
      ),
    );

    if (!actingAsAdmin || (role === "teacher" && selectedId)) {
      stops.push(
        onSnapshot(classSource("scores"), (s) =>
          setScores(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Score)),
        ),
        onSnapshot(classSource("comments"), (s) =>
          setComments(
            s.docs
              .map((d) => ({ id: d.id, ...d.data() }) as Comment)
              .sort((a, b) => a.createdAt - b.createdAt),
          ),
        ),
      );
    } else {
      setScores([]);
      setComments([]);
    }
    return () => stops.forEach((stop) => stop());
  }, [user, actingAsAdmin, selectedId, role]);

  async function submitAuth(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (authMode === "signup")
        await createUserWithEmailAndPassword(auth, cleanEmail(email), password);
      else await signInWithEmailAndPassword(auth, cleanEmail(email), password);
      setPassword("");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      flash(
        code.includes("email-already")
          ? "This email already has an account. Choose Sign in."
          : code.includes("invalid-credential")
            ? "The email or password is incorrect."
            : code.includes("weak-password")
              ? "Use a password with at least 6 characters."
              : "Account access could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword() {
    if (!email) {
      flash("Enter your email first");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, cleanEmail(email));
      flash("Password reset email sent");
    } catch {
      flash("Could not send the reset email");
    }
  }

  async function addClass(e: FormEvent) {
    e.preventDefault();
    if (!user || !canEdit) return;
    const grade = Number(newGradeLevel.match(/\d+/)?.[0]),
      section = newSection.trim(),
      teacherName = newTeacherName.trim(),
      teacherEmail = cleanEmail(user.email ?? "");
    if (!section || !teacherName || !teacherEmail) {
      flash("Complete the grade, class/section, and teacher name.");
      return;
    }
    const ref = editingClassId
      ? doc(db, "classes", editingClassId)
      : doc(collection(db, "classes"));
    const value: ClassRoom = {
      id: ref.id,
      grade,
      gradeLevel: newGradeLevel,
      section,
      teacherName,
      teacherEmail,
    };
    try {
      await setDoc(ref, value);
      setSelectedId(ref.id);
      setRole("teacher");
      setNewSection("");
      setNewTeacherName("");
      setEditingClassId("");
      setShowClassForm(false);
      flash(
        editingClassId
          ? "Class details updated"
          : `${newGradeLevel} · ${section} is now linked to the Admin Tracker.`,
      );
    } catch {
      flash("The class could not be saved. Please publish the Firebase rules.");
    }
  }
  function startEditClass() {
    if (!selected || !canEdit) return;
    setEditingClassId(selected.id);
    setNewGradeLevel(classGradeLevel(selected) as (typeof gradeLevels)[number]);
    setNewSection(selected.section);
    setNewTeacherName(selected.teacherName);
    setShowClassForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function deleteClass() {
    if (!selected || !canEdit) return;
    if (!confirm(`Delete ${classGradeLevel(selected)} · ${selected.section} and all its students, tests, marks, and comments?`)) return;
    try {
      const related = [
        ...students.filter((x) => x.classId === selected.id).map((x) => ["students", x.id] as const),
        ...tests.filter((x) => x.classId === selected.id).map((x) => ["assessments", x.id] as const),
        ...scores.filter((x) => x.classId === selected.id).map((x) => ["scores", x.id] as const),
        ...comments.filter((x) => x.classId === selected.id).map((x) => ["comments", x.id] as const),
      ];
      await Promise.all(related.map(([name, id]) => deleteDoc(doc(db, name, id))));
      await deleteDoc(doc(db, "classes", selected.id));
      flash("Class and linked tracker data deleted");
    } catch {
      flash("The class could not be deleted. Publish the latest Firebase rules.");
    }
  }
  async function addStudent() {
    if (!selected) return;
    const studentId = prompt("Student ID:")?.trim(),
      name = prompt("Student name:")?.trim();
    if (!studentId || !name) return;
    const id = `${selected.id}_${studentId}`,
      value: Student = { id, classId: selected.id, studentId, name };
    await setDoc(doc(db, "students", id), value);
    setStudents((v) => [...v.filter((s) => s.id !== id), value]);
    flash("Student added");
  }
  async function editStudent(student: Student) {
    if (!canEdit) return;
    const studentId = prompt("Student ID:", student.studentId)?.trim(),
      name = prompt("Student name:", student.name)?.trim();
    if (!studentId || !name) return;
    const newId = `${student.classId}_${studentId}`,
      record: Student = { id: newId, classId: student.classId, studentId, name };
    try {
      await setDoc(doc(db, "students", newId), record);
      if (newId !== student.id) {
        const studentScores = scores.filter((score) => score.studentId === student.id);
        await Promise.all(studentScores.map(async (score) => {
          const next = { ...score, id: `${score.assessmentId}_${newId}`, studentId: newId };
          await setDoc(doc(db, "scores", next.id), next);
          await deleteDoc(doc(db, "scores", score.id));
        }));
        await deleteDoc(doc(db, "students", student.id));
      }
      flash("Student details updated");
    } catch {
      flash("Student details could not be updated");
    }
  }
  async function deleteStudent(student: Student) {
    if (!canEdit || !confirm(`Delete ${student.name} and all linked marks?`)) return;
    try {
      const batch = writeBatch(db),
        linkedMarks = scores.filter(
          (score) =>
            score.classId === student.classId && score.studentId === student.id,
        );
      linkedMarks.forEach((score) => batch.delete(doc(db, "scores", score.id)));
      batch.delete(doc(db, "students", student.id));
      await batch.commit();
      flash(`Student and ${linkedMarks.length} linked mark records deleted`);
    } catch {
      flash("Student could not be deleted");
    }
  }
  async function addTest() {
    if (!selected) return;
    const count = selectedTests.filter((t) => t.type === newType).length + 1,
      title = newAssessmentTitle.trim() || `${newType} ${count}`,
      max = Number(newAssessmentMax);
    if (!max || max < 1) {
      flash("Enter a valid maximum mark");
      return;
    }
    if (targetMode === "selected" && !targetStudentIds.length) {
      flash("Choose at least one target student");
      return;
    }
    const ref = doc(collection(db, "assessments"));
    const value: Test = {
      id: ref.id,
      classId: selected.id,
      type: newType,
      title,
      date: new Date().toISOString().slice(0, 10),
      max,
      targetStudentIds: targetMode === "selected" ? targetStudentIds : [],
    };
    await setDoc(ref, value);
    setNewAssessmentTitle("");
    setNewAssessmentMax(defaultMaximum(newType));
    setTargetMode("all");
    setTargetStudentIds([]);
    flash("Assessment column added");
  }
  async function editTest(test: Test) {
    if (!canEdit) return;
    const title = prompt("Assessment name:", test.title)?.trim();
    if (!title) return;
    const max = Number(prompt("Maximum mark:", String(test.max)));
    if (!max || max < 1) return;
    await setDoc(doc(db, "assessments", test.id), { ...test, title, max });
    flash("Assessment updated");
  }
  async function deleteTest(test: Test) {
    if (!canEdit || !confirm(`Delete ${test.title} and all its marks?`)) return;
    await Promise.all(
      scores
        .filter((score) => score.assessmentId === test.id)
        .map((score) => deleteDoc(doc(db, "scores", score.id))),
    );
    await deleteDoc(doc(db, "assessments", test.id));
    flash("Assessment column deleted");
  }
  async function updateScore(test: Test, student: Student, value: string) {
    if (!isTargeted(test, student.id)) return;
    const numeric =
      value === ""
        ? ""
        : String(Math.max(0, Math.min(test.max, Number(value))));
    const id = `${test.id}_${student.id}`,
      record: Score = {
        id,
        classId: test.classId,
        assessmentId: test.id,
        studentId: student.id,
        value: numeric,
      };
    setScores((v) => [...v.filter((s) => s.id !== id), record]);
    if (numeric === "") {
      await deleteDoc(doc(db, "scores", id)).catch(() => {});
    } else await setDoc(doc(db, "scores", id), record);
  }
  const scoreFor = (testId: string, studentId: string) =>
    scores.find((s) => s.assessmentId === testId && s.studentId === studentId)
      ?.value ?? "";
  function isTargeted(test: Test, studentId: string) {
    return !test.targetStudentIds?.length || test.targetStudentIds.includes(studentId);
  }
  const continuousTotal = (studentId: string) => {
    const continuousTests = selectedTests.filter(
        (test) => test.type !== "Diagnostic" && isTargeted(test, studentId),
      ),
      maximum = continuousTests.reduce((sum, test) => sum + test.max, 0),
      earned = continuousTests.reduce((sum, test) => sum + Number(scoreFor(test.id, studentId) || 0), 0);
    return maximum ? Math.round((earned / maximum) * 100) : 0;
  };
  async function uploadStudents(file?: File) {
    if (!file || !selected) return;
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" }),
        sheet = book.Sheets[book.SheetNames[0]],
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        });
      const find = (row: Record<string, unknown>, keys: string[]) => {
        const k = Object.keys(row).find((x) =>
          keys.includes(x.trim().toLowerCase()),
        );
        return k ? String(row[k]).trim() : "";
      };
      const incoming = rows
        .map((r) => ({
          studentId: find(r, [
            "student id",
            "studentid",
            "student_id",
            "id",
            "student number",
          ]),
          name: find(r, [
            "student name",
            "studentname",
            "student_name",
            "name",
            "full name",
          ]),
        }))
        .filter((x) => x.studentId && x.name);
      if (!incoming.length) {
        flash("No Student ID and Student Name columns were found");
        return;
      }
      const values = await Promise.all(
        incoming.map(async (x) => {
          const id = `${selected.id}_${x.studentId}`,
            record: Student = { id, classId: selected.id, ...x };
          await setDoc(doc(db, "students", id), record);
          return record;
        }),
      );
      setStudents((v) => [
        ...v.filter(
          (s) =>
            s.classId !== selected.id || !values.some((n) => n.id === s.id),
        ),
        ...values,
      ]);
      flash(`${values.length} students uploaded`);
    } catch {
      flash("The student file could not be read");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function downloadExcel() {
    if (!selected) return;
    const headers = [
        "Student ID",
        "Student Name",
        ...selectedTests.map((t) => `${t.type} - ${t.title} (/${t.max})`),
        "Continuous Assessment Total (/100) - Diagnostic excluded",
      ],
      data = selectedStudents.map((s) => [
        s.studentId,
        s.name,
        ...selectedTests.map((t) => {
          if (!isTargeted(t, s.id)) return "N/A";
          const v = scoreFor(t.id, s.id);
          return v === "" ? "" : Number(v);
        }),
        continuousTotal(s.id),
      ]),
      sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    sheet["!cols"] = [
      { wch: 18 },
      { wch: 30 },
      ...selectedTests.map(() => ({ wch: 24 })),
      { wch: 34 },
    ];
    sheet["!autofilter"] = {
      ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, data.length + 1)}`,
    };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Class Marks");
    XLSX.writeFile(
      book,
      `${selected.section.replace(/[^a-z0-9]+/gi, "-")}-English-Assessment.xlsx`,
    );
  }
  function downloadStudentTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Student ID", "Student Name"],
      ["10001", "Example Student"],
    ]);
    sheet["!cols"] = [{ wch: 18 }, { wch: 32 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Student Upload Template");
    XLSX.writeFile(book, "Student-Upload-Template.xlsx");
  }

  async function postComment(e: FormEvent) {
    e.preventDefault();
    if (!user || !selected || !commentText.trim()) return;
    const ref = doc(collection(db, "comments"));
    const record: Comment = {
      id: ref.id,
      classId: selected.id,
      authorEmail: cleanEmail(user.email ?? ""),
      authorRole: actingAsAdmin ? "admin" : "teacher",
      text: commentText.trim(),
      parentId: replyTo,
      createdAt: Date.now(),
    };
    try {
      await setDoc(ref, record);
      setCommentText("");
      setReplyTo("");
      flash(actingAsAdmin ? "Comment sent to the teacher" : "Reply sent");
    } catch {
      flash("Publish the new Firebase rules to enable discussion.");
    }
  }

  const totalRequired = Object.values(plan).reduce((a, b) => a + b, 0);
  const summary = useMemo(() => {
    const completed = classes.reduce(
        (n, c) =>
          n +
          planTypes.reduce(
            (x, t) =>
              x +
              Math.min(
                plan[t],
                tests.filter((v) => v.classId === c.id && v.type === t).length,
              ),
            0,
          ),
        0,
      ),
      required = classes.length * totalRequired;
    return {
      completed,
      required,
      rate: required ? Math.round((completed / required) * 100) : 0,
    };
  }, [classes, tests]);

  if (authLoading)
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="brand-mark">A</div>
          <h1>Loading assessment planner…</h1>
        </div>
      </main>
    );
  if (!user)
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">A</div>
          <p className="eyebrow">AL REYADAH SCHOOL</p>
          <h1>
            {portal === "admin" ? "Admin Live Tracker" : "Teacher Tracker"}
          </h1>
          <p>
            {portal === "admin"
              ? "Coordinator sign-in for live, read-only department follow-up."
              : "Teacher sign-in to manage classes, students, tests, and marks."}
          </p>
          <form onSubmit={submitAuth}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : authMode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          <div className="login-links">
            <button
              onClick={() =>
                setAuthMode((v) => (v === "signin" ? "signup" : "signin"))
              }
            >
              {authMode === "signin"
                ? "Create a teacher account"
                : "Already registered? Sign in"}
            </button>
            <button onClick={resetPassword}>Forgot password?</button>
          </div>
          <small>
            {portal === "admin"
              ? `Authorized admin: ${coordinatorEmail}`
              : "Teacher accounts can be created from this page."}
          </small>
        </section>
        {message && <div className="toast">{message}</div>}
      </main>
    );

  if (portal === "admin" && !isAdmin)
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">A</div>
          <p className="eyebrow">ADMIN PORTAL</p>
          <h1>Admin access only</h1>
          <p>This account is not authorized to open the department tracker.</p>
          <button className="primary" onClick={() => signOut(auth)}>
            Sign out and use the admin account
          </button>
        </section>
      </main>
    );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>Al Reyadah School</strong>
            <small>English Department · Assessment Follow-up</small>
          </div>
        </div>
        {isAdmin && !portal && (
          <div className="role-switch">
            <button
              className={role === "admin" ? "active" : ""}
              onClick={() => setRole("admin")}
            >
              Coordinator
            </button>
            <button
              className={role === "teacher" ? "active" : ""}
              onClick={() => setRole("teacher")}
            >
              Class view
            </button>
          </div>
        )}
        <button className="account" onClick={() => signOut(auth)}>
          <span>{user.email?.slice(0, 1).toUpperCase()}</span>
          <small>
            {user.email}
            <b>Sign out</b>
          </small>
        </button>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">TERM 1 · 2026–2027</p>
          <h1>
            {role === "admin" && actingAsAdmin
              ? "Department assessment follow-up"
              : actingAsAdmin
                ? "Class assessment tracker"
                : "My class assessment records"}
          </h1>
          <p>
            {role === "admin" && actingAsAdmin
              ? "Read-only monitoring for every English class from Grade 5 to Grade 12."
              : actingAsAdmin
                ? "Review the selected teacher’s students, assessments, and marks."
                : "Create your classes, upload students, and record each assessment."}
          </p>
        </div>
        {isAdmin && role === "teacher" && portal === "admin" && (
          <button className="secondary" onClick={() => setRole("admin")}>
            ← Back to live overview
          </button>
        )}
        {canEdit && (
          <button className="primary" onClick={() => setShowClassForm((v) => !v)}>
            ＋ Add my class
          </button>
        )}
      </section>
      {canEdit && showClassForm && (
        <section className="panel class-form-panel">
          <div className="panel-head">
            <div>
              <h2>{editingClassId ? "Edit class details" : "Create and link a class"}</h2>
              <p>The selected grade track and your email connect this class directly to the Admin Tracker.</p>
            </div>
          </div>
          <form className="class-form" onSubmit={addClass}>
            <label>
              Grade track
              <select value={newGradeLevel} onChange={(e) => setNewGradeLevel(e.target.value as (typeof gradeLevels)[number])}>
                {gradeLevels.map((grade) => <option key={grade}>{grade}</option>)}
              </select>
            </label>
            <label>
              Class / section
              <input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="Example: 9/1" required />
            </label>
            <label>
              Teacher name
              <input value={newTeacherName} onChange={(e) => setNewTeacherName(e.target.value)} placeholder="Enter your name" required />
            </label>
            <label>
              Linked teacher email
              <input value={user.email ?? ""} readOnly />
            </label>
            <div className="class-form-actions">
              <button className="primary">{editingClassId ? "Save class changes" : "Create & link class"}</button>
              <button type="button" className="secondary" onClick={() => { setShowClassForm(false); setEditingClassId(""); }}>Cancel</button>
            </div>
          </form>
        </section>
      )}
      {message && <div className="toast">{message}</div>}
      {dataLoading ? (
        <section className="panel loading">Loading secured records…</section>
      ) : role === "admin" && isAdmin ? (
        <>
          <section className="stats">
            <article>
              <span>Overall completion</span>
              <strong>{summary.rate}%</strong>
              <div className="bar">
                <i style={{ width: `${summary.rate}%` }} />
              </div>
              <small>
                {summary.completed} of {summary.required} required assessments
              </small>
            </article>
            <article>
              <span>Active classes</span>
              <strong>{classes.length}</strong>
              <small>Across Grades 5–12</small>
            </article>
            <article>
              <span>Students recorded</span>
              <strong>{students.length}</strong>
              <small>Stored securely in Firebase</small>
            </article>
            <article className="attention">
              <span>Classes needing action</span>
              <strong>
                {
                  classes.filter((c) =>
                    planTypes.some(
                      (t) =>
                        tests.filter((x) => x.classId === c.id && x.type === t)
                          .length < plan[t],
                    ),
                  ).length
                }
              </strong>
              <small>Below the department plan</small>
            </article>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Department assessment plan</h2>
                <p>Minimum number expected from every English class.</p>
              </div>
            </div>
            <div className="plan-grid">
              {planTypes.map((t, i) => (
                <div className={`plan-card c${i}`} key={t}>
                  <span>{["D", "R", "W", "S", "SP"][i]}</span>
                  <div>
                    <strong>{t}</strong>
                    <small>{plan[t]} required per term</small>
                  </div>
                  <b>{plan[t]}</b>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Grade & class follow-up</h2>
                <p>
                  Green means complete; amber means tests are still missing.
                </p>
              </div>
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
              >
                <option value="all">All grade tracks</option>
                {gradeLevels.map((grade) => <option key={grade}>{grade}</option>)}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Grade / Class</th>
                    <th>Teacher</th>
                    {planTypes.map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                    <th>Progress</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {!classes.length && (
                    <tr>
                      <td colSpan={9} className="empty">
                          No trackers yet. They will appear when teachers create
                          their classes.
                      </td>
                    </tr>
                  )}
                  {classes
                    .filter(
                      (c) => gradeFilter === "all" || classGradeLevel(c) === gradeFilter,
                    )
                    .map((c) => {
                      const done = planTypes.reduce(
                        (n, t) =>
                          n +
                          Math.min(
                            plan[t],
                            tests.filter(
                              (x) => x.classId === c.id && x.type === t,
                            ).length,
                          ),
                        0,
                      );
                      return (
                        <tr key={c.id}>
                          <td>
                            <b>{classGradeLevel(c)}</b>
                            <small>{c.section}</small>
                          </td>
                          <td>
                            {c.teacherName}
                            <small>{c.teacherEmail}</small>
                          </td>
                          {planTypes.map((t) => {
                            const n = tests.filter(
                              (x) => x.classId === c.id && x.type === t,
                            ).length;
                            return (
                              <td key={t}>
                                <span
                                  className={
                                    n >= plan[t] ? "pill done" : "pill missing"
                                  }
                                >
                                  {n}/{plan[t]}
                                </span>
                              </td>
                            );
                          })}
                          <td>
                            <b>{Math.round((done / totalRequired) * 100)}%</b>
                          </td>
                          <td>
                            <button
                              className="open"
                              onClick={() => {
                                setSelectedId(c.id);
                                setRole("teacher");
                              }}
                            >
                              Open →
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          {!selected ? (
          <section className="panel empty-state">
            <h2>No class created yet</h2>
            <p>
              Select <b>“Add my class”</b> above to create your first tracker.
            </p>
          </section>
          ) : (
            <>
              <section className="class-picker">
                <label>
                  Open class
                  <select
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {classGradeLevel(c)} · {c.section} · {c.teacherName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mini-meta">
                  <span>{classGradeLevel(selected)}</span>
                  <span>{selectedStudents.length} students</span>
                  <span>{selectedTests.length} assessments</span>
                </div>
                {canEdit && (
                  <div className="class-manage">
                    <button onClick={startEditClass}>Edit class</button>
                    <button className="danger-link" onClick={() => void deleteClass()}>Delete class</button>
                  </div>
                )}
              </section>
              <section className="panel tracker">
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">{selected.section}</p>
                    <h2>Student marks table</h2>
                    <p>
                      {actingAsAdmin
                        ? "Coordinator review — this tracker is read-only."
                        : "Add an assessment column whenever the class completes a test."}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="actions">
                      <button className="secondary" onClick={addStudent}>
                        ＋ Add student
                      </button>
                      <button
                        className="secondary"
                        onClick={() => fileInput.current?.click()}
                      >
                        ⇧ Upload students
                      </button>
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div className="add-test">
                    <label>
                      Assessment type
                      <select
                        value={newType}
                        onChange={(e) => {
                          const type = e.target.value as TestType;
                          setNewType(type);
                          setNewAssessmentMax(defaultMaximum(type));
                        }}
                      >
                        {testTypes.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Assessment name
                      <input
                        value={newAssessmentTitle}
                        onChange={(e) => setNewAssessmentTitle(e.target.value)}
                        placeholder={`e.g. ${newType} 1`}
                      />
                    </label>
                    <label>
                      Maximum mark
                      <input
                        type="number"
                        min="1"
                        value={newAssessmentMax}
                        onChange={(e) => setNewAssessmentMax(e.target.value)}
                      />
                    </label>
                    <label>
                      Target students
                      <select
                        value={targetMode}
                        onChange={(e) => {
                          const mode = e.target.value as "all" | "selected";
                          setTargetMode(mode);
                          if (mode === "all") setTargetStudentIds([]);
                        }}
                      >
                        <option value="all">All class</option>
                        <option value="selected">Chosen students</option>
                      </select>
                    </label>
                    {targetMode === "selected" && (
                      <div className="target-students">
                        <b>Choose students</b>
                        <div className="target-list">
                          {selectedStudents.map((student) => (
                            <label key={student.id}>
                              <input
                                type="checkbox"
                                checked={targetStudentIds.includes(student.id)}
                                onChange={(e) =>
                                  setTargetStudentIds((current) =>
                                    e.target.checked
                                      ? [...current, student.id]
                                      : current.filter((id) => id !== student.id),
                                  )
                                }
                              />
                              <span>{student.name}</span>
                              <small>{student.studentId}</small>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    <button className="primary" onClick={addTest}>
                      ＋ Add assessment column
                    </button>
                    <span>Unlimited columns · any assessment type may be repeated.</span>
                  </div>
                )}
                <div className="table-wrap marks">
                  <table>
                    <thead>
                      <tr>
                        <th>Student ID</th>
                        <th>Student name</th>
                        {canEdit && <th>Student actions</th>}
                        {selectedTests.map((t) => (
                          <th key={t.id}>
                            <span className="test-label">{t.type}</span>
                            <b>{t.title}</b>
                            <small>
                              {t.date} · /{t.max}
                            </small>
                            {!!t.targetStudentIds?.length && (
                              <small>{t.targetStudentIds.length} selected students</small>
                            )}
                            {canEdit && (
                              <span className="test-actions">
                                <button onClick={() => void editTest(t)}>Edit</button>
                                <button className="danger-link" onClick={() => void deleteTest(t)}>Delete</button>
                              </span>
                            )}
                          </th>
                        ))}
                        <th className="total-head">Continuous total<small>/100 · Diagnostic and non-targeted tests excluded</small></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!selectedStudents.length ? (
                        <tr>
                          <td
                            colSpan={3 + selectedTests.length + (canEdit ? 1 : 0)}
                            className="empty"
                          >
                            No students have been added to this class yet.
                          </td>
                        </tr>
                      ) : (
                        selectedStudents.map((s) => (
                          <tr key={s.id}>
                            <td className="mono">{s.studentId}</td>
                            <td>
                              <b>{s.name}</b>
                            </td>
                            {canEdit && (
                              <td className="row-actions">
                                <button onClick={() => void editStudent(s)}>Edit</button>
                                <button className="danger-link" onClick={() => void deleteStudent(s)}>Delete</button>
                              </td>
                            )}
                            {selectedTests.map((t) => (
                              <td key={t.id}>
                                {isTargeted(t, s.id) ? (
                                  <div className="score-with-details">
                                    <input aria-label={`${s.name} ${t.title}`} type="number" min="0" max={t.max} value={scoreFor(t.id, s.id)} placeholder="—" disabled={!canEdit} onChange={(e) => void updateScore(t, s, e.target.value)} />
                                    {t.type === "Diagnostic" && diagnosticFor(s) && <button type="button" className="diagnostic-details-btn" onClick={() => setDiagnosticDetail({student:s,result:diagnosticFor(s)!})}>Details</button>}
                                  </div>
                                ) : (
                                  <span className="not-targeted">N/A</span>
                                )}
                              </td>
                            ))}
                            <td className="total-cell"><b>{continuousTotal(s.id)}</b><small>/100</small></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <footer className="table-footer">
                  <span>
                    {actingAsAdmin
                      ? "Read-only coordinator view."
                      : "Marks save directly to Firebase."}
                  </span>
                  <b>{actingAsAdmin ? "View only" : "✓ Auto-saved"}</b>
                </footer>
              </section>
              <section className="excel-tools">
                <div>
                  <strong>
                    {actingAsAdmin ? "Class tracker export" : "Excel student list"}
                  </strong>
                  <span>
                    {actingAsAdmin
                      ? "Download this tracker for offline review."
                      : "Upload Student ID and Student Name, or download the complete class table."}
                  </span>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  aria-label="Upload student Excel file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void uploadStudents(e.target.files?.[0])}
                />
                {canEdit && (
                  <button className="secondary" onClick={downloadStudentTemplate}>
                    ⇩ Download upload template
                  </button>
                )}
                {canEdit && (
                  <button
                    className="secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    ⇧ Upload students
                  </button>
                )}
                <button className="primary" onClick={downloadExcel}>
                  ⇩ Download Excel table
                </button>
              </section>
              <section className="panel discussion">
                <div className="panel-head">
                  <div>
                    <h2>Tracker discussion</h2>
                    <p>Live comments between the coordinator and class teacher.</p>
                  </div>
                  <span className="live-badge">● Live</span>
                </div>
                <div className="comment-list">
                  {!comments.filter((c) => c.classId === selected.id).length && (
                    <p className="empty-comments">No comments yet.</p>
                  )}
                  {comments
                    .filter((c) => c.classId === selected.id && !c.parentId)
                    .map((comment) => (
                      <article className={`comment ${comment.authorRole}`} key={comment.id}>
                        <header>
                          <b>{comment.authorRole === "admin" ? "Coordinator" : selected.teacherName}</b>
                          <small>{new Date(comment.createdAt).toLocaleString()}</small>
                        </header>
                        <p>{comment.text}</p>
                        <button onClick={() => setReplyTo(comment.id)}>Reply</button>
                        {comments
                          .filter((reply) => reply.parentId === comment.id)
                          .map((reply) => (
                            <article className={`comment reply ${reply.authorRole}`} key={reply.id}>
                              <header>
                                <b>{reply.authorRole === "admin" ? "Coordinator" : selected.teacherName}</b>
                                <small>{new Date(reply.createdAt).toLocaleString()}</small>
                              </header>
                              <p>{reply.text}</p>
                            </article>
                          ))}
                      </article>
                    ))}
                </div>
                <form className="comment-form" onSubmit={postComment}>
                  {replyTo && (
                    <div className="replying">
                      Replying to a comment
                      <button type="button" onClick={() => setReplyTo("")}>Cancel</button>
                    </div>
                  )}
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder={actingAsAdmin ? "Leave a follow-up comment for this teacher…" : "Write a reply to the coordinator…"}
                    aria-label="Discussion comment"
                    required
                  />
                  <button className="primary">Send {actingAsAdmin ? "comment" : "reply"}</button>
                </form>
              </section>
            </>
          )}
        </>
      )}
      {diagnosticDetail && <div className="diagnostic-modal" onClick={()=>setDiagnosticDetail(null)}><div className="diagnostic-modal-card" onClick={(e)=>e.stopPropagation()}>
        <div className="diagnostic-modal-head"><div><p className="eyebrow">Diagnostic details</p><h2>{diagnosticDetail.student.name}</h2><small>Student ID {diagnosticDetail.student.studentId}</small></div><button type="button" onClick={()=>setDiagnosticDetail(null)}>Close</button></div>
        <div className="diagnostic-summary"><div><span>Score</span><b>{diagnosticDetail.result.score}/100</b></div><div><span>Level</span><b>Level {diagnosticDetail.result.level}</b></div></div>
        <div className="diagnostic-skills">{([['Grammar',diagnosticDetail.result.skills?.Grammar??0,25],['Vocabulary',diagnosticDetail.result.skills?.Vocabulary??0,25],['Context Clues',diagnosticDetail.result.skills?.Context??0,20],['Reading',diagnosticDetail.result.skills?.Reading??0,30]] as [string,number,number][]).map(([name,score,total])=>{const pct=Math.round(score/total*100);return <div className="diagnostic-skill" key={name}><div><b>{name}</b><span>{score}/{total}</span></div><div className="diagnostic-bar"><i style={{width:`${pct}%`}} /></div><small>{pct>=80?'Strong':pct>=60?'Developing':'Needs support'}</small></div>})}</div>
        <div className="diagnostic-support"><b>Support areas</b><p>{(()=>{const a=[['Grammar',diagnosticDetail.result.skills?.Grammar??0,25],['Vocabulary',diagnosticDetail.result.skills?.Vocabulary??0,25],['Context Clues',diagnosticDetail.result.skills?.Context??0,20],['Reading',diagnosticDetail.result.skills?.Reading??0,30]] as [string,number,number][];const n=a.filter(([,v,m])=>v/m<.6).map(([x])=>x);return n.length?`Focus on ${n.join(' and ')}.`:'No priority support area. Continue regular practice across all skills.'})()}</p></div>
      </div></div>}
      <footer className="credit">
        Created for Al Reyadah School English Department · Ms. Saidah Khwar
      </footer>
    </main>
  );
}
