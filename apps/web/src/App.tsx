import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { MyScheduleItem } from "@h2class/shared";
import {
  getMe,
  getMyBalance,
  getMyFeedback,
  getMySchedule,
  getMyStudents,
  getToken,
  messageForError,
  onUnauthorized,
  signIn,
  signOut,
} from "./lib/api";
import { formatDate, formatDateTime, utcRange } from "./lib/date";

type Session = "checking" | "anonymous" | "authenticated";
type Tab = "overview" | "attendance" | "feedback";

const STATUS_TEXT = {
  present: "出勤",
  absent: "缺勤",
  excused_leave: "请假",
  late_cancel: "临时取消",
} as const;

const Loading = ({ text = "正在加载…" }: { text?: string }) => (
  <div className="state-card" aria-live="polite">
    <span className="spinner" aria-hidden="true" />
    <p>{text}</p>
  </div>
);

const Problem = ({ error }: { error: unknown }) => (
  <div className="state-card state-card--error" role="status">
    <strong>暂时没有加载成功</strong>
    <p>{messageForError(error)}</p>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="empty-card">{children}</div>
);

const Login = ({ onSuccess }: { onSuccess: () => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      const me = await getMe();
      if (!me.roles.includes("guardian")) {
        signOut();
        setError("此账号不是家长账号。");
        return;
      }
      onSuccess();
    } catch (value) {
      signOut();
      setError(messageForError(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand-mark" aria-hidden="true">H2</div>
        <p className="eyebrow">H2CLASS · 家长中心</p>
        <h1>陪你看见每一次成长</h1>
        <p>课程安排、剩余课时、考勤和课后反馈，都在这里。</p>
      </section>
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div>
          <p className="eyebrow">欢迎回来</p>
          <h2>家长登录</h2>
        </div>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error === null ? null : <p className="form-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "正在登录…" : "进入家长中心"}
        </button>
        <p className="login-help">账号由教学中心创建。如需重置密码，请联系老师。</p>
      </form>
    </main>
  );
};

const UpcomingLesson = ({ lesson }: { lesson: MyScheduleItem }) => (
  <article className="lesson-row">
    <div className="date-tile">
      <strong>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", day: "2-digit" }).format(new Date(lesson.startAt))}</strong>
      <span>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "short" }).format(new Date(lesson.startAt))}</span>
    </div>
    <div className="lesson-row__body">
      <div className="lesson-row__top">
        <strong>{lesson.classTypeName}</strong>
        <span className={`pill pill--${lesson.status}`}>{lesson.status === "cancelled" ? "已取消" : lesson.status === "completed" ? "已完成" : "待上课"}</span>
      </div>
      <p>{lesson.studentName} · {lesson.teacherName}老师</p>
      <time>{formatDateTime(lesson.startAt)}—{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(lesson.endAt))}</time>
    </div>
  </article>
);

const Overview = () => {
  const [range] = useState(() => utcRange(0, 14));
  const students = useQuery({ queryKey: ["my-students"], queryFn: getMyStudents });
  const balances = useQuery({ queryKey: ["my-balance"], queryFn: getMyBalance });
  const schedule = useQuery({
    queryKey: ["my-schedule", range.startAt, range.endAt],
    queryFn: () => getMySchedule(range.startAt, range.endAt),
  });
  if (students.isPending || balances.isPending || schedule.isPending) {
    return <Loading text="正在整理孩子的近况…" />;
  }
  if (students.error || balances.error || schedule.error) {
    return <Problem error={students.error ?? balances.error ?? schedule.error} />;
  }
  return (
    <div className="page-stack">
      <section className="hero-card">
        <p className="eyebrow">孩子概览</p>
        <h2>{students.data.students.length === 0 ? "尚未关联孩子" : `${students.data.students.map((item) => item.name).join("、")}，你好`}</h2>
        <p>未来两周共有 <strong>{schedule.data.lessons.filter((item) => item.status === "scheduled").length}</strong> 节已安排课程。</p>
      </section>

      <section>
        <div className="section-heading">
          <div><p className="eyebrow">课时与有效期</p><h3>当前权益</h3></div>
          <span>核心实时计算</span>
        </div>
        <div className="balance-grid">
          {balances.data.students.map((student) => (
            <article className="balance-card" key={student.studentId}>
              <div className="balance-card__top">
                <div><span>{student.studentName}</span><strong>{student.totalRemainingCredits}</strong><small>剩余课时</small></div>
                <span className="balance-orbit" aria-hidden="true" />
              </div>
              <ul>
                {student.entitlements.length === 0 ? <li>暂无已登记权益</li> : student.entitlements.map((item) => (
                  <li key={item.id}>
                    <span>{item.classTypeName}</span>
                    <b>{item.kind === "package" ? `${item.remainingCredits ?? 0} 课时` : `至 ${item.validTo ?? "—"}`}</b>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <div><p className="eyebrow">未来 14 天</p><h3>课程安排</h3></div>
        </div>
        <div className="list-card">
          {schedule.data.lessons.length === 0 ? <Empty>未来两周暂时没有课程安排。</Empty> : schedule.data.lessons.map((lesson) => <UpcomingLesson key={`${lesson.lessonId}:${lesson.studentId}`} lesson={lesson} />)}
        </div>
      </section>
    </div>
  );
};

const Attendance = () => {
  const [range] = useState(() => utcRange(180, 1));
  const query = useQuery({
    queryKey: ["my-attendance-history", range.startAt, range.endAt],
    queryFn: () => getMySchedule(range.startAt, range.endAt),
  });
  if (query.isPending) return <Loading text="正在加载考勤记录…" />;
  if (query.error) return <Problem error={query.error} />;
  const rows = [...query.data.lessons]
    .filter((item) => item.attendance !== null)
    .sort((left, right) => right.startAt.localeCompare(left.startAt));
  return (
    <div className="page-stack">
      <header className="page-heading"><p className="eyebrow">最近六个月</p><h2>考勤记录</h2><p>出勤与接送时间由教学中心登记。</p></header>
      {rows.length === 0 ? <Empty>暂时没有考勤记录。</Empty> : (
        <div className="timeline">
          {rows.map((item) => {
            const record = item.attendance;
            if (record === null) return null;
            return (
              <article className="timeline-item" key={`${item.lessonId}:${item.studentId}`}>
                <span className={`timeline-dot timeline-dot--${record.status}`} />
                <div className="timeline-card">
                  <div><strong>{item.classTypeName}</strong><span className={`attendance-tag attendance-tag--${record.status}`}>{STATUS_TEXT[record.status]}</span></div>
                  <p>{item.studentName} · {item.teacherName}老师</p>
                  <time>{formatDateTime(item.startAt)}</time>
                  {record.checkedInAt === null ? null : <small>签到 {formatDateTime(record.checkedInAt)}</small>}
                  {record.checkedOutAt === null ? null : <small>签退 {formatDateTime(record.checkedOutAt)} · {record.pickedUpBy}</small>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Feedback = () => {
  const query = useQuery({ queryKey: ["my-feedback"], queryFn: getMyFeedback });
  if (query.isPending) return <Loading text="正在加载课后反馈…" />;
  if (query.error) return <Problem error={query.error} />;
  return (
    <div className="page-stack">
      <header className="page-heading"><p className="eyebrow">老师的记录</p><h2>课后反馈</h2><p>每一条都来自孩子的真实课堂。</p></header>
      {query.data.feedback.length === 0 ? <Empty>暂时没有课后反馈。</Empty> : query.data.feedback.map((item) => (
        <article className="feedback-card" key={`${item.lessonId}:${item.studentId}`}>
          <div className="feedback-card__head">
            <div><span>{item.studentName}</span><h3>{item.classTypeName}</h3></div>
            <time>{formatDate(item.lessonStartAt)}</time>
          </div>
          <dl>
            <div><dt>本节内容</dt><dd>{item.contentCovered}</dd></div>
            <div><dt>课后作业</dt><dd>{item.homework}</dd></div>
            <div><dt>课堂表现</dt><dd>{item.performanceNote}</dd></div>
          </dl>
          <footer>{item.teacherName}老师</footer>
        </article>
      ))}
    </div>
  );
};

export const App = ({ clearCache }: { clearCache: () => void }) => {
  const [session, setSession] = useState<Session>(() => getToken() === null ? "anonymous" : "checking");
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => onUnauthorized(() => {
    clearCache();
    setSession("anonymous");
  }), [clearCache]);

  useEffect(() => {
    if (session !== "checking") return;
    let active = true;
    void getMe().then((me) => {
      if (!active) return;
      if (!me.roles.includes("guardian")) {
        signOut();
        setSession("anonymous");
        return;
      }
      setSession("authenticated");
    }).catch(() => {
      if (active) {
        signOut();
        setSession("anonymous");
      }
    });
    return () => { active = false; };
  }, [session]);

  if (session === "checking") return <main className="boot-screen"><div className="brand-mark">H2</div><Loading text="正在安全进入家长中心…" /></main>;
  if (session === "anonymous") return <Login onSuccess={() => setSession("authenticated")} />;

  return (
    <div className="app-frame">
      <header className="app-header">
        <div><span className="mini-mark">H2</span><div><p>H2CLASS</p><strong>家长中心</strong></div></div>
        <button type="button" onClick={() => { signOut(); clearCache(); setSession("anonymous"); }}>退出</button>
      </header>
      <main className="app-content">
        {tab === "overview" ? <Overview /> : tab === "attendance" ? <Attendance /> : <Feedback />}
      </main>
      <nav className="bottom-nav" aria-label="主要页面">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><span>⌂</span>概览</button>
        <button className={tab === "attendance" ? "active" : ""} onClick={() => setTab("attendance")}><span>✓</span>考勤</button>
        <button className={tab === "feedback" ? "active" : ""} onClick={() => setTab("feedback")}><span>✦</span>反馈</button>
      </nav>
    </div>
  );
};
