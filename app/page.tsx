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
type TierName = "Tier 1" | "Tier 2" | "Tier 3";
type TierStudent = { student: Student; total: number; diagnostic?: DiagnosticResult };
type TierSnapshot = Record<TierName, TierStudent[]>;
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
    [diagnosticDetail, setDiagnosticDetail] = useState<{ student: Student; result?: DiagnosticResult } | null>(null),
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
    [classViewTab, setClassViewTab] = useState<"tracker" | "support">("tracker"),
    [tierSnapshot, setTierSnapshot] = useState<TierSnapshot | null>(null),
    [supportPlanReady, setSupportPlanReady] = useState(false),
    [newTeacherName, setNewTeacherName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = cleanEmail(user?.email ?? "") === coordinatorEmail;
  const canEdit = portal === "teacher" || (!portal && !isAdmin);
  const actingAsAdmin = isAdmin && portal !== "teacher";
  const selected = classes.find((c) => c.id === selectedId);
  useEffect(() => {
    if (!selected?.grade) {
      setDiagnosticResults({});
      return;
    }
    const grade = selected.grade;
    const gradeRef = databaseRef(
      diagnosticDb,
      `teacherControlCenter/diagnosticByGrade/grade${grade}/results`,
    );
    const unsubscribe = onValue(gradeRef, (snapshot) => {
      const raw = snapshot.val() || {};
      const next: Record<string, DiagnosticResult> = {};
      Object.values(raw).forEach((classResults) =>
        Object.values((classResults || {}) as Record<string, DiagnosticResult>).forEach((result) => {
          if (result?.studentId) {
            next[`${grade}:${String(result.studentId).trim()}`] = {
              studentId: result.studentId,
              score: result.score,
              level: result.level,
              skills: result.skills,
            };
          }
        }),
      );
      setDiagnosticResults(next);
    });
    return unsubscribe;
  }, [selected?.grade]);

  const diagnosticFor=(student:Student)=>{const classroom=classes.find((item)=>item.id===student.classId);const grade=classroom?.grade;return grade?diagnosticResults[`${grade}:${student.studentId.trim()}`]:undefined};

  useEffect(() => {
    if (!diagnosticDetail) return;
    const classroom = classes.find((item) => item.id === diagnosticDetail.student.classId);
    const grade = classroom?.grade;
    if (!grade) return;

    const resultsRef = databaseRef(
      diagnosticDb,
      `teacherControlCenter/diagnosticByGrade/grade${grade}/results`,
    );
    const unsubscribe = onValue(resultsRef, (snapshot) => {
      const raw = snapshot.val() || {};
      let found: DiagnosticResult | undefined;
      Object.values(raw).some((classResults) =>
        Object.values((classResults || {}) as Record<string, DiagnosticResult>).some((result) => {
          if (String(result?.studentId ?? "").trim() === diagnosticDetail.student.studentId.trim()) {
            found = result;
            return true;
          }
          return false;
        }),
      );
      setDiagnosticDetail((current) =>
        current && current.student.id === diagnosticDetail.student.id
          ? { ...current, result: found }
          : current,
      );
    });
    return unsubscribe;
  }, [diagnosticDetail?.student.id, classes]);


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
    setClassViewTab("tracker");
    setTierSnapshot(null);
    setSupportPlanReady(false);
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
  const hasContinuousAssessmentData = (studentId: string) =>
    selectedTests.some(
      (test) =>
        test.type !== "Diagnostic" &&
        isTargeted(test, studentId) &&
        scoreFor(test.id, studentId) !== "",
    );

  function extractStudentLevels() {
    if (!selected) return;
    const next: TierSnapshot = { "Tier 1": [], "Tier 2": [], "Tier 3": [] };
    selectedStudents.forEach((student) => {
      if (!hasContinuousAssessmentData(student.id)) return;
      const total = continuousTotal(student.id);
      const item: TierStudent = { student, total, diagnostic: diagnosticFor(student) };
      if (total >= 90) next["Tier 1"].push(item);
      else if (total >= 61) next["Tier 2"].push(item);
      else next["Tier 3"].push(item);
    });
    (Object.keys(next) as TierName[]).forEach((tier) =>
      next[tier].sort((a, b) => b.total - a.total || a.student.name.localeCompare(b.student.name)),
    );
    setTierSnapshot(next);
    setSupportPlanReady(false);
  }

  const tierMeta: Record<TierName, { range: string; description: string }> = {
    "Tier 1": { range: "90% and above", description: "Able to access the curriculum and ready to be challenged." },
    "Tier 2": { range: "61% to 89%", description: "Needs some support to access the curriculum." },
    "Tier 3": { range: "60% and below", description: "Needs prerequisite skills and targeted remedial support." },
  };

  type SupportPlanContent = {
    aim: string;
    focusLabel: string;
    targets: string[];
    strategies: string[];
    howWhereWhen: string[];
    success: string[];
  };

  const tierPlanBase: Record<TierName, SupportPlanContent> = {
    "Tier 1": {
      aim: "Extend independent application of English skills through higher-order reading, writing, speaking and creative tasks.",
      focusLabel: "Enrichment across English skills",
      targets: [
        "Complete one higher-order English challenge or extension task every two weeks with at least 80% of the task criteria met.",
        "Use evidence, precise vocabulary and increasingly complex sentence structures in one extended response or presentation each month.",
        "Maintain achievement at 90% or above while demonstrating independent revision and self-correction.",
      ],
      strategies: [
        "Use extension questions, project-based tasks, authentic texts and open-ended writing or speaking challenges.",
        "Provide choice of enrichment tasks and opportunities for peer explanation, mentoring or presentation where appropriate.",
        "Give feedback focused on depth, precision, evidence, vocabulary range and independence rather than extra repetitive work.",
      ],
      howWhereWhen: [
        "How: extension, inquiry, independent application, conferencing and targeted feedback.",
        "Where: regular English lessons, independent work and suitable department enrichment activities.",
        "When: one planned challenge at least every two weeks, reviewed during the normal assessment cycle.",
      ],
      success: [
        "At least 80% of agreed challenge-task criteria are met in two consecutive enrichment tasks.",
        "Student continues to achieve 90%+ while showing stronger independence, reasoning and language precision.",
      ],
    },
    "Tier 2": {
      aim: "Strengthen identified English skill gaps so students can access grade-level reading, language and writing tasks with increasing independence.",
      focusLabel: "Targeted grade-level support",
      targets: [
        "Reach at least 80% accuracy in the identified focus skill in two consecutive short checks or classroom tasks.",
        "Complete one guided reading, language or writing practice task each week and use teacher feedback to correct errors.",
        "Demonstrate the targeted skill independently in the next relevant class assessment or common task.",
      ],
      strategies: [
        "Model the target skill, use worked examples and gradually remove scaffolds as accuracy improves.",
        "Use short small-group practice, guided questioning, retrieval practice and immediate feedback within normal lessons.",
        "Allow students to correct work after feedback and briefly explain what they changed and why.",
      ],
      howWhereWhen: [
        "How: explicit modelling, guided practice, checking for understanding, correction and gradual release.",
        "Where: regular English lessons and short teacher-led small-group support when needed.",
        "When: at least once each week for the identified focus skill and after relevant assessments.",
      ],
      success: [
        "At least 80% accuracy is achieved in the focus skill across two consecutive checks/tasks.",
        "Student completes the next related grade-level task with reduced prompting and fewer repeated errors.",
      ],
    },
    "Tier 3": {
      aim: "Build prerequisite English skills through explicit, scaffolded and repeated practice so students can participate more successfully in grade-level learning.",
      focusLabel: "Prerequisite and remedial support",
      targets: [
        "Reach at least 70% accuracy in the identified prerequisite skill in two consecutive supported checks or practice tasks.",
        "Complete one short, achievable reading/language/writing practice task each week using the agreed scaffold.",
        "Use the target skill with reduced teacher prompting by the next review cycle.",
      ],
      strategies: [
        "Teach one small skill step at a time using clear modelling, examples, visuals and frequent checks for understanding.",
        "Use short repeated practice, retrieval, sentence frames, word banks, chunked texts and guided correction as appropriate.",
        "Provide targeted small-group or brief 1:1 support when feasible, then return the student to the same curriculum goal with suitable scaffolding.",
      ],
      howWhereWhen: [
        "How: explicit instruction, chunking, scaffolded practice, repetition, immediate feedback and gradual reduction of support.",
        "Where: regular English lessons, intervention time or short small-group support where available.",
        "When: at least weekly, with brief reinforcement during normal lessons and review after the next assessment cycle.",
      ],
      success: [
        "At least 70% accuracy is achieved in the focus prerequisite skill across two consecutive supported checks/tasks.",
        "Student completes a related class task with fewer prompts and shows improved participation and accuracy.",
      ],
    },
  };

  function diagnosticSkillAverages(items: TierStudent[]) {
    const maxima = { Grammar: 25, Vocabulary: 25, Context: 20, Reading: 30 };
    const totals: Record<keyof typeof maxima, { sum: number; count: number }> = {
      Grammar: { sum: 0, count: 0 },
      Vocabulary: { sum: 0, count: 0 },
      Context: { sum: 0, count: 0 },
      Reading: { sum: 0, count: 0 },
    };
    items.forEach(({ diagnostic }) => {
      if (!diagnostic?.skills) return;
      (Object.keys(maxima) as (keyof typeof maxima)[]).forEach((skill) => {
        const value = diagnostic.skills?.[skill];
        if (typeof value === "number") {
          totals[skill].sum += (value / maxima[skill]) * 100;
          totals[skill].count += 1;
        }
      });
    });
    return (Object.keys(maxima) as (keyof typeof maxima)[])
      .filter((skill) => totals[skill].count)
      .map((skill) => ({ skill, average: Math.round(totals[skill].sum / totals[skill].count) }))
      .sort((a, b) => a.average - b.average);
  }

  function weakestDiagnosticAreas(items: TierStudent[]) {
    return diagnosticSkillAverages(items).slice(0, 2);
  }

  const skillSupportLibrary: Record<"Grammar" | "Vocabulary" | "Context" | "Reading", {
    name: string;
    tier2Target: string;
    tier3Target: string;
    tier1Target: string;
    tier2Strategies: string[];
    tier3Strategies: string[];
    tier1Strategies: string[];
  }> = {
    Grammar: {
      name: "Grammar",
      tier1Target: "Apply the target grammar accurately in an extended paragraph, response or presentation, with at least 90% accuracy across two tasks.",
      tier2Target: "Use the target grammar with at least 80% accuracy in two consecutive sentence/paragraph checks, then apply it in the next related class task.",
      tier3Target: "Identify and use the target grammar pattern with at least 70% accuracy in two consecutive scaffolded checks using examples or sentence frames.",
      tier1Strategies: ["Use editing challenges, sentence combining and purposeful grammar choices in extended writing.", "Ask students to explain why a structure is effective and edit authentic examples."],
      tier2Strategies: ["Model the grammar pattern, use worked examples and short error-correction practice.", "Move from sentence frames to independent sentences and a short paragraph."],
      tier3Strategies: ["Teach one grammar pattern at a time with colour-coded examples, sentence frames and oral rehearsal.", "Use short repeated practice and immediate correction before moving to independent use."],
    },
    Vocabulary: {
      name: "Vocabulary",
      tier1Target: "Use at least 8 new or precise curriculum words accurately in an extended speaking/writing task and explain meaning from context when challenged.",
      tier2Target: "Recall and use at least 8 of 10 target words accurately in two consecutive retrieval/application activities.",
      tier3Target: "Recognise, match and use at least 7 of 10 high-frequency/lesson words accurately in two consecutive supported activities.",
      tier1Strategies: ["Use morphology, synonyms, collocations and precise word-choice challenges in authentic tasks.", "Require students to justify vocabulary choices and infer unfamiliar words from context."],
      tier2Strategies: ["Use retrieval grids, word families, Frayer-style examples and sentence application.", "Revisit a small set of target words across reading, speaking and writing during the week."],
      tier3Strategies: ["Use visuals, word banks, matching, oral rehearsal and repeated retrieval of a small word set.", "Teach meaning, pronunciation and one usable sentence pattern before independent application."],
    },
    Context: {
      name: "Context Clues",
      tier1Target: "Infer unfamiliar word meaning and justify the inference with textual evidence in at least 4 of 5 challenge items across two tasks.",
      tier2Target: "Use surrounding words, examples or contrast clues to infer meaning with at least 80% accuracy across two short tasks.",
      tier3Target: "Identify a clue around an unfamiliar word and choose the best supported meaning with at least 70% accuracy across two scaffolded tasks.",
      tier1Strategies: ["Use unfamiliar vocabulary in authentic texts and require evidence-based justification of inferred meanings.", "Compare multiple possible meanings and discuss which context evidence rules them in or out."],
      tier2Strategies: ["Teach a simple clue routine: read around the word, identify the clue, predict, then check.", "Use short annotated examples before independent practice in grade-level texts."],
      tier3Strategies: ["Highlight the target word and one nearby clue; model thinking aloud using short accessible sentences.", "Use multiple-choice meaning checks first, then move to short texts with gradually reduced highlighting."],
    },
    Reading: {
      name: "Reading",
      tier1Target: "Answer higher-order comprehension questions and support responses with accurate textual evidence at 90%+ across two extended reading tasks.",
      tier2Target: "Identify main idea, key details and one inference with at least 80% accuracy across two grade-appropriate reading checks.",
      tier3Target: "Read a short accessible passage and identify the main idea plus two supporting details with at least 70% accuracy across two supported checks.",
      tier1Strategies: ["Use complex texts, inference/evaluation questions and evidence-based discussion or written responses.", "Ask students to compare viewpoints, author choices or evidence across texts."],
      tier2Strategies: ["Pre-teach only essential vocabulary, model annotation and use main-idea/detail/inference organisers.", "Use guided questioning, think-alouds and gradual release from paired to independent reading."],
      tier3Strategies: ["Chunk short texts, use headings/visuals, oral reading where appropriate and one question type at a time.", "Model locating evidence, then use a simple main idea + two details organiser with fading prompts."],
    },
  };

  function gradeBandForSelected() {
    const label = selected ? classGradeLevel(selected) : "";
    const match = label.match(/(5|6|7|8|9|10|11|12)/);
    const grade = match ? Number(match[1]) : 9;
    if (grade <= 6) return { grade, band: "5-6" as const };
    if (grade <= 8) return { grade, band: "7-8" as const };
    if (grade <= 10) return { grade, band: "9-10" as const };
    return { grade, band: "11-12" as const };
  }

  function realisticSkillTarget(tier: TierName, skill: keyof typeof skillSupportLibrary, baseline: number, grade: number) {
    const gain = baseline < 40 ? 12 : baseline < 60 ? 10 : baseline < 75 ? 8 : baseline < 88 ? 6 : 4;
    const target = Math.min(tier === "Tier 1" ? 95 : tier === "Tier 2" ? 88 : 75, baseline + gain);
    const skillName = skillSupportLibrary[skill].name;
    if (skill === "Reading") {
      if (grade <= 6) return `Improve ${skillName} from about ${baseline}% to ${target}% by identifying the main idea and two supporting details correctly in 4 out of 5 short, age-appropriate texts across two consecutive checks.`;
      if (grade <= 8) return `Improve ${skillName} from about ${baseline}% to ${target}% by identifying main idea, key details and one supported inference with at least ${target}% accuracy across two grade-appropriate texts.`;
      if (grade <= 10) return `Improve ${skillName} from about ${baseline}% to ${target}% by selecting relevant evidence and answering main-idea, detail and inference questions with at least ${target}% accuracy across two grade-level texts.`;
      return `Improve ${skillName} from about ${baseline}% to ${target}% by annotating an age-appropriate academic text, selecting relevant evidence and answering inference/analysis questions with at least ${target}% accuracy across two checks.`;
    }
    return `Improve ${skillName} from about ${baseline}% to ${target}% across two consecutive checks, then apply the skill with reduced prompting in the next related class task.`;
  }

  function ageAppropriateStrategies(skill: keyof typeof skillSupportLibrary, tier: TierName, grade: number) {
    const young = grade <= 6, middle = grade <= 8, senior = grade >= 11;
    if (skill === "Reading") {
      if (young) return tier === "Tier 3"
        ? ["Use short supported texts with headings/visuals; pre-teach only essential words, highlight key information and sequence ideas before answering.", "Use paired reading, a simple main-idea + two-details organiser and oral rehearsal before a short written response; fade prompts gradually."]
        : ["Use short age-appropriate texts, prediction/scanning, highlighting and a main-idea/details organiser before independent reading.", "Move from paired discussion to a short independent response that points to evidence in the text."];
      if (middle) return ["Use grade-appropriate texts with purposeful annotation for main idea, details, vocabulary-in-context and inference.", "Model think-alouds and evidence selection, then reduce prompts from guided pairs to independent responses."];
      if (senior) return ["Use age-appropriate nonfiction/academic texts; teach annotation, command words, evidence selection, inference and paraphrasing.", "Use short exam-style responses that require students to justify answers with precise textual evidence and increasingly independent editing."];
      return ["Use grade-level texts with annotation, context clues and evidence-selection routines.", "Practise main idea, detail, inference and short evidence-based responses with gradual release to independence."];
    }
    if (skill === "Vocabulary") {
      if (young) return ["Teach a small set of useful words with pictures/context, pronunciation, matching and oral sentence practice.", "Recycle the same words through reading, speaking and short sentence frames before independent use."];
      if (senior) return ["Teach academic vocabulary through context, morphology/word families, collocations and command words rather than isolated lists.", "Require students to use new vocabulary in age-appropriate discussion, paraphrasing and short academic responses."];
      return ["Use vocabulary in context, word families, retrieval practice and sentence application across the week.", "Move from guided examples to accurate use in reading responses and short writing."];
    }
    if (skill === "Context") {
      if (young) return ["Highlight the unfamiliar word and a nearby picture/example/contrast clue; model: read around it, find the clue, choose the meaning.", "Use short sentences first, then short passages with less highlighting as confidence improves."];
      if (senior) return ["Use authentic grade-appropriate texts to infer meaning from definition, example, contrast, morphology and surrounding argument.", "Require students to justify the inferred meaning and paraphrase the sentence using an appropriate synonym."];
      return ["Teach a repeatable context-clue routine and annotate the evidence around unfamiliar words.", "Compare possible meanings and require a short justification before checking the answer."];
    }
    if (young) return ["Model one grammar pattern at a time with clear examples, oral rehearsal, sentence frames and short correction tasks.", "Move from matching/choosing to completing and then writing an independent sentence using the same pattern."];
    if (senior) return ["Teach grammar through authentic age-appropriate sentences and short academic writing; use focused editing rather than isolated drills only.", "Use sentence combining, error analysis and redrafting so students transfer the target structure into extended responses."];
    return ["Use worked examples, sentence combining and focused error correction linked to current grade-level writing.", "Move from guided practice to a short paragraph and self-editing checklist with reduced teacher prompting."];
  }

  function buildSupportPlan(tier: TierName, items: TierStudent[]): SupportPlanContent {
    const base = tierPlanBase[tier];
    const focus = weakestDiagnosticAreas(items);
    if (!focus.length) return base;

    const { grade } = gradeBandForSelected();
    const threshold = tier === "Tier 1" ? 85 : tier === "Tier 2" ? 80 : 70;
    const priority = focus.filter((x) => x.average < threshold);
    const selectedFocus = (priority.length ? priority : focus).slice(0, 2);
    const focusNames = selectedFocus.map((x) => skillSupportLibrary[x.skill].name);
    const targets = selectedFocus.map((x) => realisticSkillTarget(tier, x.skill, x.average, grade));
    const strategies = selectedFocus.flatMap((x) => ageAppropriateStrategies(x.skill, tier, grade)).slice(0, 4);

    const aim = tier === "Tier 1"
      ? `Extend independent, higher-order application of ${focusNames.join(" and ")} through age-appropriate Grade ${grade} tasks while maintaining strong curriculum achievement.`
      : tier === "Tier 2"
        ? `Strengthen ${focusNames.join(" and ")} through age-appropriate Grade ${grade} practice so students complete grade-level English tasks with greater accuracy and independence.`
        : `Build the prerequisite ${focusNames.join(" and ")} skills needed for Grade ${grade} learning through explicit, scaffolded and repeated practice without replacing the age-appropriate curriculum.`;

    return {
      aim,
      focusLabel: selectedFocus.map((x) => `${skillSupportLibrary[x.skill].name} (${x.average}% tier average)`).join(" · "),
      targets: [...targets, ...(tier === "Tier 1" ? ["Maintain 90%+ in continuous assessment while completing the agreed age-appropriate extension tasks independently."] : ["Use teacher feedback to correct the focus skill and demonstrate reduced prompting by the next review cycle."])],
      strategies: [...strategies, "Collect one short skill check/work sample and the next relevant assessment as evidence; adjust scaffolding or challenge from the evidence rather than repeating the same plan."],
      howWhereWhen: tier === "Tier 1"
        ? ["How: extension, authentic texts/tasks, evidence-based discussion/writing, conferencing and independent application.", "Where: regular English lessons and suitable enrichment opportunities.", "When: one purposeful extension at least every two weeks; review using the next relevant assessment/work sample."]
        : tier === "Tier 2"
          ? ["How: explicit modelling, guided practice, checking for understanding, correction and gradual release.", "Where: regular English lessons and short teacher-led small-group support when useful.", "When: at least weekly for the priority skill, followed by a short check and transfer into normal classwork."]
          : ["How: explicit instruction, chunking, visuals/organisers/frames as appropriate, repeated practice, immediate feedback and gradual reduction of support.", "Where: regular English lessons plus targeted small-group/intervention time where available.", "When: at least weekly with brief reinforcement in normal lessons; review after the next assessment cycle."],
      success: tier === "Tier 1"
        ? ["Student meets the stated skill target across two consecutive age-appropriate tasks/checks.", "Student maintains 90%+ and demonstrates stronger independent reasoning, precision and transfer of the focus skill."]
        : tier === "Tier 2"
          ? ["Student reaches the realistic target stated from the current baseline across two consecutive checks/tasks.", "Student applies the skill in the next related grade-level task with fewer repeated errors and less prompting."]
          : ["Student reaches the realistic target stated from the current baseline across two consecutive supported checks/tasks.", "Student completes a related age-appropriate class task with fewer prompts and improved participation/accuracy."],
    };
  }

  function printSupportPlan() {
    if (!selected || !tierSnapshot || !supportPlanReady) return;
    const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] || ch));
    const sections = (["Tier 1", "Tier 2", "Tier 3"] as TierName[]).map((tier) => {
      const items = tierSnapshot[tier];
      const focus = weakestDiagnosticAreas(items);
      const base = buildSupportPlan(tier, items);
      const names = items.length ? items.map((x) => `${esc(x.student.name)} (${x.total}%)`).join(" • ") : "No students in this tier";
      const focusText = focus.length ? base.focusLabel : "Use ongoing class assessment evidence; Diagnostic skill data is not yet available for this tier.";
      const lis = (arr: string[]) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      return `<section><h2>${tier} - ${tierMeta[tier].range}</h2><p class=desc>${esc(tierMeta[tier].description)}</p><table><tr><th>Grade / Class</th><td>${esc(classGradeLevel(selected))} · ${esc(selected.section)}</td><th>Teacher</th><td>${esc(selected.teacherName)}</td></tr><tr><th>Students</th><td colspan=3>${names}</td></tr><tr><th>Area of Need / Long-Term Aim</th><td colspan=3>${esc(base.aim)}<br><b>Diagnostic focus:</b> ${esc(focusText)}</td></tr><tr><th>SMART Targets</th><td>${lis(base.targets)}</td><th>Support Strategies</th><td>${lis(base.strategies)}</td></tr><tr><th>How / Where / When</th><td>${lis(base.howWhereWhen)}</td><th>Success Criteria</th><td>${lis(base.success)}</td></tr><tr><th>Next Review Date</th><td>________________</td><th>Review</th><td>Review progress using the next assessment cycle and update the tier if the student's Continuous Assessment Total changes.</td></tr></table></section>`;
    }).join("");
    const w = window.open("", "_blank");
    if (!w) { flash("Please allow pop-ups to print the support plan"); return; }
    w.document.write(`<!doctype html><html><head><title>${esc(selected.section)} Support Plan</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#172536;margin:0}h1{text-align:center;margin:0 0 6px}h2{background:#eaf1f7;padding:8px 10px;border-left:5px solid #315f8d;margin-top:22px}.meta{text-align:center;color:#596979;margin-bottom:16px}.desc{font-weight:700}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #7f929f;padding:7px;vertical-align:top}th{background:#f3f6f8;text-align:left;width:16%}ul{margin:0;padding-left:17px}li{margin:0 0 4px}section{break-after:page}section:last-child{break-after:auto}.note{margin-top:12px;font-size:10px;color:#596979}</style></head><body><h1>Al Reyadah School - English Department</h1><div class=meta>Individualized Support Plans · Term 1 · Academic Year 2026-2027</div>${sections}<p class=note>Tier placement is based on the current Continuous Assessment Total /100. Diagnostic skill data is used only to personalise recommended targets and strategies; it is not included in the continuous total. Recommendations are classroom supports and should be adjusted by the teacher using current work samples, attendance and professional judgement. Review Date and final Review are intentionally left for the teacher to complete using real evidence.</p><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

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

    const now = new Date();
    const dayName = now.toLocaleDateString("en-GB", { weekday: "long" });
    const dateText = now.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const term = "Term 1";
    const academicYear = "2026–2027";
    const className = `${classGradeLevel(selected)} · ${selected.section}`;

    const headers = [
      "Student ID",
      "Student Name",
      "Diagnostic (/100)",
      ...selectedTests
        .filter((t) => t.type !== "Diagnostic")
        .map((t) => `${t.type} - ${t.title} (/${t.max})`),
      "Total (/100)",
    ];

    const regularTests = selectedTests.filter((t) => t.type !== "Diagnostic");

    const data = selectedStudents.map((s) => {
      const diagnostic = diagnosticFor(s);
      return [
        s.studentId,
        s.name,
        diagnostic?.score ?? "",
        ...regularTests.map((t) => {
          if (!isTargeted(t, s.id)) return "N/A";
          const v = scoreFor(t.id, s.id);
          return v === "" ? "" : Number(v);
        }),
        continuousTotal(s.id),
      ];
    });

    const title = "Alreyada School - English Department Assessment Tracker";
    const metadataRows = [
      [title],
      [],
      ["Teacher Name", selected.teacherName, "Class", className],
      ["Term", term, "Academic Year", academicYear],
      ["Day", dayName, "Date", dateText],
      [],
      headers,
      ...data,
    ];

    const sheet = XLSX.utils.aoa_to_sheet(metadataRows);
    const lastCol = XLSX.utils.encode_col(headers.length - 1);
    const headerRow = 7;
    const lastRow = Math.max(headerRow, headerRow + data.length);

    sheet["!merges"] = [
      {
        s: { r: 0, c: 0 },
        e: { r: 0, c: Math.max(0, headers.length - 1) },
      },
    ];

    sheet["!cols"] = [
      { wch: 18 },
      { wch: 32 },
      { wch: 18 },
      ...regularTests.map((t) => ({
        wch: Math.max(18, Math.min(30, `${t.type} - ${t.title}`.length + 5)),
      })),
      { wch: 16 },
    ];

    sheet["!rows"] = [
      { hpt: 28 },
      { hpt: 8 },
      { hpt: 22 },
      { hpt: 22 },
      { hpt: 22 },
      { hpt: 8 },
      { hpt: 26 },
    ];

    sheet["!autofilter"] = {
      ref: `A${headerRow}:${lastCol}${lastRow}`,
    };

    // Basic formatting metadata. SheetJS preserves number/text layout,
    // merged title, widths, row heights, and filter in the downloaded workbook.
    const titleCell = sheet["A1"];
    if (titleCell) {
      titleCell.s = {
        font: { bold: true, sz: 16 },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }

    ["A3", "C3", "A4", "C4", "A5", "C5"].forEach((addr) => {
      if (sheet[addr]) {
        sheet[addr].s = { font: { bold: true } };
      }
    });

    for (let c = 0; c < headers.length; c += 1) {
      const addr = `${XLSX.utils.encode_col(c)}${headerRow}`;
      if (sheet[addr]) {
        sheet[addr].s = {
          font: { bold: true },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
        };
      }
    }

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Class Marks");

    const safeClass = `${classGradeLevel(selected)}-${selected.section}`
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");

    XLSX.writeFile(
      book,
      `${safeClass}-${term.replace(/\s+/g, "-")}-English-Assessment.xlsx`,
      { cellStyles: true },
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
              <div className="class-view-tabs" role="tablist" aria-label="Class tools">
                <button type="button" className={classViewTab === "tracker" ? "active" : ""} onClick={() => setClassViewTab("tracker")}>Assessment Tracker</button>
                <button type="button" className={classViewTab === "support" ? "active" : ""} onClick={() => setClassViewTab("support")}>Student Levels &amp; Support Plan</button>
              </div>
              {classViewTab === "tracker" ? (
              <>
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
                        <th className="diagnostic-head">Diagnostic result<small>/100 · automatic</small></th>
                        <th className="diagnostic-head">Details<small>skill breakdown</small></th>
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
                            colSpan={5 + selectedTests.length}
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
                            <td className="diagnostic-cell">
                              {diagnosticFor(s) ? (
                                <><b>{diagnosticFor(s)?.score}</b><small>/100</small></>
                              ) : (
                                <span className="not-targeted">—</span>
                              )}
                            </td>
                            <td className="diagnostic-cell">
                              <button
                                type="button"
                                className="diagnostic-details-btn"
                                onClick={() => setDiagnosticDetail({ student: s })}
                              >
                                Details
                              </button>
                            </td>
                            {selectedTests.map((t) => (
                              <td key={t.id}>
                                {isTargeted(t, s.id) ? (
                                  <input aria-label={`${s.name} ${t.title}`} type="number" min="0" max={t.max} value={scoreFor(t.id, s.id)} placeholder="—" disabled={!canEdit} onChange={(e) => void updateScore(t, s, e.target.value)} />
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
              ) : (
                <section className="panel support-plan-panel">
                  <div className="panel-head">
                    <div>
                      <p className="eyebrow">ON-DEMAND · NO EXTRA LIVE LISTENERS</p>
                      <h2>Student Levels &amp; Support Plan</h2>
                      <p>Extract the selected class into the school's three support tiers using the current Continuous Assessment Total /100.</p>
                    </div>
                    <button type="button" className="primary" onClick={extractStudentLevels}>Extract Levels</button>
                  </div>
                  <div className="tier-rule-grid">
                    {(["Tier 1", "Tier 2", "Tier 3"] as TierName[]).map((tier) => (
                      <article key={tier} className={`tier-rule ${tier.replace(" ", "-").toLowerCase()}`}>
                        <span>{tier}</span><strong>{tierMeta[tier].range}</strong><small>{tierMeta[tier].description}</small>
                      </article>
                    ))}
                  </div>
                  {!tierSnapshot ? (
                    <div className="support-empty"><b>Nothing is calculated until you click Extract Levels.</b><span>This keeps the feature light and prevents background processing across classes.</span></div>
                  ) : (
                    <>
                      <div className="tier-summary-grid">
                        {(["Tier 1", "Tier 2", "Tier 3"] as TierName[]).map((tier) => {
                          const items = tierSnapshot[tier];
                          const focus = weakestDiagnosticAreas(items);
                          return (
                            <article className="tier-card" key={tier}>
                              <header><div><span>{tier}</span><strong>{tierMeta[tier].range}</strong></div><b>{items.length} students</b></header>
                              <div className="tier-students">
                                {!items.length ? <p>No students in this tier.</p> : items.map(({ student, total }) => (
                                  <div key={student.id}><span><b>{student.name}</b><small>{student.studentId}</small></span><strong>{total}%</strong></div>
                                ))}
                              </div>
                              <footer><b>Diagnostic focus</b><span>{focus.length ? focus.map((x) => `${x.skill} ${x.average}%`).join(" · ") : "No diagnostic skill data yet"}</span></footer>
                            </article>
                          );
                        })}
                      </div>
                      {selectedStudents.some((student) => !hasContinuousAssessmentData(student.id)) && (
                        <div className="support-warning">Students with no entered continuous-assessment marks are not placed in a tier yet.</div>
                      )}
                      <div className="support-actions">
                        <button type="button" className="secondary" onClick={() => setSupportPlanReady(true)}>Generate Class Support Plan</button>
                        <button type="button" className="primary" disabled={!supportPlanReady} onClick={printSupportPlan}>Print / Save Support Plan as PDF</button>
                      </div>
                      {supportPlanReady && (
                        <div className="generated-plans">
                          {(["Tier 1", "Tier 2", "Tier 3"] as TierName[]).map((tier) => {
                            const focus = weakestDiagnosticAreas(tierSnapshot[tier]);
                            const base = buildSupportPlan(tier, tierSnapshot[tier]);
                            return (
                              <article key={tier}>
                                <div className="generated-plan-head"><div><span>{tier}</span><h3>{tierMeta[tier].range}</h3></div><b>{tierSnapshot[tier].length} students</b></div>
                                <p><b>Area of Need / Long-Term Aim:</b> {base.aim}</p>
                                <p><b>Diagnostic skill focus:</b> {focus.length ? base.focusLabel : "Use ongoing assessment evidence until Diagnostic skill data is available."}</p>
                                <div className="plan-columns"><div><b>SMART Targets</b><ul>{base.targets.map((x) => <li key={x}>{x}</li>)}</ul></div><div><b>Support Strategies</b><ul>{base.strategies.map((x) => <li key={x}>{x}</li>)}</ul></div><div><b>How / Where / When</b><ul>{base.howWhereWhen.map((x) => <li key={x}>{x}</li>)}</ul></div><div><b>Success Criteria</b><ul>{base.success.map((x) => <li key={x}>{x}</li>)}</ul></div></div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
      {diagnosticDetail && <div className="diagnostic-modal" onClick={()=>setDiagnosticDetail(null)}><div className="diagnostic-modal-card" onClick={(e)=>e.stopPropagation()}>
        <div className="diagnostic-modal-head"><div><p className="eyebrow">Student details</p><h2>{diagnosticDetail.student.name}</h2><small>Student ID {diagnosticDetail.student.studentId}</small></div><button type="button" onClick={()=>setDiagnosticDetail(null)}>Close</button></div>
        {diagnosticDetail.result ? <>
          <div className="diagnostic-summary"><div><span>Score</span><b>{diagnosticDetail.result.score}/100</b></div><div><span>Level</span><b>Level {diagnosticDetail.result.level}</b></div></div>
          <div className="diagnostic-skills">{([['Grammar',diagnosticDetail.result.skills?.Grammar??0,25],['Vocabulary',diagnosticDetail.result.skills?.Vocabulary??0,25],['Context Clues',diagnosticDetail.result.skills?.Context??0,20],['Reading',diagnosticDetail.result.skills?.Reading??0,30]] as [string,number,number][]).map(([name,score,total])=>{const pct=Math.round(score/total*100);return <div className="diagnostic-skill" key={name}><div><b>{name}</b><span>{score}/{total}</span></div><div className="diagnostic-bar"><i style={{width:`${pct}%`}} /></div><small>{pct>=80?'Strong':pct>=60?'Developing':'Needs support'}</small></div>})}</div>
          <div className="diagnostic-support"><b>Support areas</b><p>{(()=>{const a=[['Grammar',diagnosticDetail.result.skills?.Grammar??0,25],['Vocabulary',diagnosticDetail.result.skills?.Vocabulary??0,25],['Context Clues',diagnosticDetail.result.skills?.Context??0,20],['Reading',diagnosticDetail.result.skills?.Reading??0,30]] as [string,number,number][];const n=a.filter(([,v,m])=>v/m<.6).map(([x])=>x);return n.length?`Focus on ${n.join(' and ')}.`:'No priority support area. Continue regular practice across all skills.'})()}</p></div>
        </> : <div className="diagnostic-support"><b>Diagnostic</b><p>No diagnostic result is available for this student yet.</p></div>}
        {canEdit && <div className="diagnostic-support">
          <b>Student actions</b>
          <div className="row-actions" style={{marginTop:"10px"}}>
            <button onClick={() => { setDiagnosticDetail(null); void editStudent(diagnosticDetail.student); }}>Edit student</button>
            <button className="danger-link" onClick={() => { const student = diagnosticDetail.student; setDiagnosticDetail(null); void deleteStudent(student); }}>Delete student</button>
          </div>
        </div>}
      </div></div>}
      <footer className="credit">
        Created for Al Reyadah School English Department · Ms. Saidah Khwar
      </footer>
    </main>
  );
}
