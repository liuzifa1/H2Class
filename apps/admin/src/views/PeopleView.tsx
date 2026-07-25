import {
  guardianAccountSchema,
  peopleListOutputSchema,
  personSchema,
  type GuardianAccountsCreateInput,
  type PeopleCreateInput,
  type PeopleUpdateInput,
  type Person,
  type PersonRole,
} from "@h2class/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useDeferredValue,
  useState,
  type FormEvent,
} from "react";
import { PageState } from "../components/PageState";
import {
  fetchJson,
  getRequestErrorMessage,
} from "../lib/api";
import { formatShanghaiFullDateTime } from "../lib/date";

const roleLabels: Readonly<Record<PersonRole, string>> = {
  admin: "管理员",
  staff: "员工",
  teacher: "老师",
  guardian: "监护人",
};

const filterRoles = ["admin", "staff", "teacher", "guardian"] as const;
const assignableRoles = ["teacher", "guardian"] as const;

type SaveCommand =
  | { kind: "create"; payload: PeopleCreateInput }
  | { kind: "update"; payload: PeopleUpdateInput };

type PersonFormProps = {
  person: Person | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (command: SaveCommand) => void;
};

const optional = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const nullable = (value: string) => optional(value) ?? null;

const PersonForm = ({ person, pending, error, onCancel, onSave }: PersonFormProps) => {
  const [name, setName] = useState(person?.name ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [school, setSchool] = useState(person?.school ?? "");
  const [grade, setGrade] = useState(person?.grade ?? "");
  const [notes, setNotes] = useState(person?.notes ?? "");
  const [selectedRoles, setSelectedRoles] = useState<PersonRole[]>(person?.roles ?? []);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setFormError("请填写姓名。");
      return;
    }
    if (
      person === null &&
      selectedRoles.includes("guardian") &&
      optional(phone) === undefined
    ) {
      setFormError("创建监护人时必须填写手机号。");
      return;
    }
    setFormError(null);

    if (person === null) {
      const payload: PeopleCreateInput = {
        name: trimmedName,
        ...(optional(phone) === undefined ? {} : { phone: optional(phone) }),
        ...(optional(school) === undefined ? {} : { school: optional(school) }),
        ...(optional(grade) === undefined ? {} : { grade: optional(grade) }),
        ...(optional(notes) === undefined ? {} : { notes: optional(notes) }),
        roles: selectedRoles,
      };
      onSave({ kind: "create", payload });
      return;
    }

    const payload: PeopleUpdateInput = {
      id: person.id,
      name: trimmedName,
      phone: nullable(phone),
      school: nullable(school),
      grade: nullable(grade),
      notes: nullable(notes),
    };
    onSave({ kind: "update", payload });
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onCancel}>
      <section
        className="person-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-form-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <span className="section-kicker">人员档案</span>
            <h2 id="person-form-title">{person === null ? "新增人员" : "编辑人员"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </header>

        <form className="person-form" onSubmit={submit}>
          <label className="field">
            <span>姓名 *</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>手机号</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              placeholder="监护人必填"
            />
          </label>

          <div className="form-grid">
            <label className="field">
              <span>学校</span>
              <input value={school} onChange={(event) => setSchool(event.target.value)} />
            </label>
            <label className="field">
              <span>年级</span>
              <input value={grade} onChange={(event) => setGrade(event.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>备注</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="记录需要团队知晓的信息"
            />
          </label>

          {person === null ? (
            <fieldset className="role-picker">
              <legend>身份</legend>
              <div>
                {assignableRoles.map((role) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role)}
                      onChange={(event) =>
                        setSelectedRoles((current) =>
                          event.target.checked
                            ? [...current, role]
                            : current.filter((item) => item !== role),
                        )
                      }
                    />
                    <span>{roleLabels[role]}</span>
                  </label>
                ))}
              </div>
              <small>不选择身份时按学生档案使用；管理员和员工身份需由管理员单独授权。</small>
            </fieldset>
          ) : (
            <div className="fixed-roles">
              <span>当前身份</span>
              <div>
                {person.roles.length === 0 ? (
                  <span className="role-tag role-tag--student">学生</span>
                ) : (
                  person.roles.map((role) => (
                    <span className={`role-tag role-tag--${role}`} key={role}>
                      {roleLabels[role]}
                    </span>
                  ))
                )}
              </div>
              <small>身份权限需通过管理员确认流程变更。</small>
            </div>
          )}

          {formError === null && error === null ? null : (
            <div className="inline-alert inline-alert--error" role="alert">
              {formError ?? error}
            </div>
          )}

          <footer className="drawer-actions">
            <button className="button button--quiet" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="button button--primary" type="submit" disabled={pending}>
              {pending ? "正在保存…" : person === null ? "创建档案" : "保存修改"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

type GuardianAccountFormProps = {
  person: Person;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (input: GuardianAccountsCreateInput) => void;
};

const GuardianAccountForm = ({
  person,
  pending,
  error,
  onCancel,
  onSave,
}: GuardianAccountFormProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onCancel}>
      <section
        className="person-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guardian-account-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <span className="section-kicker">家长中心</span>
            <h2 id="guardian-account-title">为 {person.name} 开通登录</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="关闭">×</button>
        </header>
        <form
          className="person-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ personId: person.id, email: email.trim(), password });
          }}
        >
          <div className="inline-alert">
            密码会在核心服务中立即进行 scrypt 哈希，不会进入活动日志或 AI 待确认队列。
          </div>
          <label className="field">
            <span>登录邮箱 *</span>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>初始密码 *</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <small>至少 8 个字符。请通过安全方式交给家长。</small>
          </label>
          {error === null ? null : <div className="inline-alert inline-alert--error" role="alert">{error}</div>}
          <footer className="drawer-actions">
            <button className="button button--quiet" type="button" onClick={onCancel}>取消</button>
            <button className="button button--primary" type="submit" disabled={pending}>
              {pending ? "正在开通…" : "开通家长账号"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

export const PeopleView = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [role, setRole] = useState<PersonRole | "">("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [accountPerson, setAccountPerson] = useState<Person | null>(null);
  const [provisionedName, setProvisionedName] = useState<string | null>(null);

  const people = useQuery({
    queryKey: ["people", deferredSearch, role],
    queryFn: () => {
      const query = new URLSearchParams();
      if (deferredSearch.length > 0) query.set("search", deferredSearch);
      if (role.length > 0) query.set("role", role);
      const suffix = query.size === 0 ? "" : `?${query.toString()}`;
      return fetchJson(`/people${suffix}`, {}, peopleListOutputSchema);
    },
  });

  const savePerson = useMutation({
    mutationFn: (command: SaveCommand) =>
      command.kind === "create"
        ? fetchJson(
            "/people",
            { method: "POST", body: JSON.stringify(command.payload) },
            personSchema,
          )
        : fetchJson(
            `/people/${command.payload.id}`,
            { method: "PATCH", body: JSON.stringify(command.payload) },
            personSchema,
          ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      setFormOpen(false);
      setEditing(null);
    },
  });

  const provisionAccount = useMutation({
    mutationFn: (input: GuardianAccountsCreateInput) =>
      fetchJson(
        "/guardian-accounts",
        { method: "POST", body: JSON.stringify(input) },
        guardianAccountSchema,
      ),
    onSuccess: () => {
      setProvisionedName(accountPerson?.name ?? "监护人");
      setAccountPerson(null);
    },
  });

  const rows = people.data?.people ?? [];

  return (
    <section className="page-stack">
      <header className="page-heading">
        <div>
          <span className="section-kicker">人员目录</span>
          <h2>人员档案</h2>
          <p>管理学生、监护人、老师和员工的基本资料。</p>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            savePerson.reset();
            setEditing(null);
            setFormOpen(true);
          }}
        >
          ＋ 新增人员
        </button>
      </header>

      <div className="filter-bar">
        <label className="search-field">
          <span aria-hidden="true">查</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="按姓名搜索"
            aria-label="按姓名搜索"
          />
        </label>
        <label className="select-field">
          <span>身份</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as PersonRole | "")}
          >
            <option value="">全部人员</option>
            {filterRoles.map((item) => (
              <option key={item} value={item}>
                {roleLabels[item]}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count">{people.isPending ? "正在读取…" : `共 ${rows.length} 人`}</span>
      </div>

      {provisionedName === null ? null : (
        <div className="inline-alert" role="status">
          已为 {provisionedName} 开通家长中心登录。密码未被保存到页面。
        </div>
      )}

      <div className="table-card">
        {people.isPending ? (
          <PageState title="正在读取人员档案…" compact />
        ) : people.isError ? (
          <PageState
            title="人员档案加载失败"
            detail={getRequestErrorMessage(people.error)}
            action={
              <button className="button button--quiet" onClick={() => void people.refetch()}>
                重新加载
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <PageState
            title="没有找到人员"
            detail={search.length > 0 || role.length > 0 ? "换个搜索条件试试。" : "从新增第一位学生开始。"}
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table people-table">
              <thead>
                <tr>
                  <th>姓名 / 身份</th>
                  <th>联系方式</th>
                  <th>学校 / 年级</th>
                  <th>备注</th>
                  <th>创建时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <strong className="person-name">{person.name}</strong>
                      <div className="role-tags">
                        {person.roles.length === 0 ? (
                          <span className="role-tag role-tag--student">学生</span>
                        ) : (
                          person.roles.map((personRole) => (
                            <span
                              className={`role-tag role-tag--${personRole}`}
                              key={personRole}
                            >
                              {roleLabels[personRole]}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>{person.phone ?? <span className="muted">未填写</span>}</td>
                    <td>
                      {person.school === null && person.grade === null ? (
                        <span className="muted">未填写</span>
                      ) : (
                        <>
                          <span>{person.school ?? "—"}</span>
                          <small className="cell-subline">{person.grade ?? "年级未填"}</small>
                        </>
                      )}
                    </td>
                    <td className="notes-cell">{person.notes ?? <span className="muted">—</span>}</td>
                    <td className="date-cell">{formatShanghaiFullDateTime(person.createdAt)}</td>
                    <td>
                      {person.roles.includes("guardian") ? (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            provisionAccount.reset();
                            setProvisionedName(null);
                            setAccountPerson(person);
                          }}
                        >
                          开通登录
                        </button>
                      ) : null}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          savePerson.reset();
                          setEditing(person);
                          setFormOpen(true);
                        }}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen ? (
        <PersonForm
          key={editing?.id ?? "new"}
          person={editing}
          pending={savePerson.isPending}
          error={savePerson.isError ? getRequestErrorMessage(savePerson.error) : null}
          onCancel={() => {
            if (!savePerson.isPending) {
              savePerson.reset();
              setFormOpen(false);
            }
          }}
          onSave={(command) => savePerson.mutate(command)}
        />
      ) : null}

      {accountPerson === null ? null : (
        <GuardianAccountForm
          key={accountPerson.id}
          person={accountPerson}
          pending={provisionAccount.isPending}
          error={provisionAccount.isError ? getRequestErrorMessage(provisionAccount.error) : null}
          onCancel={() => {
            if (!provisionAccount.isPending) {
              provisionAccount.reset();
              setAccountPerson(null);
            }
          }}
          onSave={(input) => provisionAccount.mutate(input)}
        />
      )}
    </section>
  );
};
