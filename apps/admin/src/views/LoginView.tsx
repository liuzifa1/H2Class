import { useState, type FormEvent } from "react";
import {
  getRequestErrorMessage,
  signInWithEmail,
} from "../lib/api";
import { configurationError } from "../lib/config";

type LoginViewProps = {
  onAuthenticated: () => void;
};

export const LoginView = ({ onAuthenticated }: LoginViewProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(configurationError);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || configurationError !== null) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInWithEmail(email.trim(), password);
      onAuthenticated();
    } catch (value) {
      setError(getRequestErrorMessage(value));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="H2Class 介绍">
        <div className="login-story__wash" aria-hidden="true" />
        <div className="login-brand">
          <span>H2</span>
          <strong>H2Class</strong>
        </div>
        <div className="login-story__content">
          <p className="eyebrow">教学中心 · 每日工作台</p>
          <h1>
            把繁琐留给系统，
            <br />
            把时间留给孩子。
          </h1>
          <p>
            用一句话安排课程、查找人员，再从一个队列里完成所有家长与老师通知。
          </p>
        </div>
        <div className="login-story__foot">
          <span>对话优先</span>
          <span>操作留痕</span>
          <span>数据归一</span>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card__heading">
            <span className="kicker">管理账号</span>
            <h2>欢迎回来</h2>
            <p>使用管理员或员工账号进入管理台。</p>
          </div>

          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="name@example.com"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
              required
            />
          </label>

          {error === null ? null : (
            <div className="inline-alert inline-alert--error" role="alert">
              {error}
            </div>
          )}

          <button
            className="button button--primary button--large button--full"
            type="submit"
            disabled={submitting || configurationError !== null}
          >
            {submitting ? "正在登录…" : "进入管理台"}
          </button>
          <p className="login-card__note">仅限已由系统管理员开通的账号。</p>
        </form>
      </section>
    </main>
  );
};
