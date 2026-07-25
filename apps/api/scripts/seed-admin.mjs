import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";

const args = process.argv.slice(2);
const isRemote = args.includes("--remote");

const option = (name) => {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name} value`);
  }
  return value;
};

const readPassword = async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    let password = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) password += chunk;
    return password.replace(/[\r\n]+$/, "");
  }

  return new Promise((resolve, reject) => {
    let password = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(password);
    };
    const fail = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      reject(new Error("Admin seeding cancelled"));
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          fail();
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
          continue;
        }
        password += character;
      }
    };

    process.stdout.write("Admin password: ");
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
};

const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;

const email = option("--email").trim().toLowerCase();
const name = option("--name").trim();
if (email.length === 0 || name.length === 0) {
  throw new Error("Admin email and name must not be empty");
}

const password = await readPassword();
if (password.length < 8 || password.length > 128) {
  throw new Error("Admin password must contain between 8 and 128 characters");
}

const passwordHash = await hashPassword(password);
const userId = randomUUID();
const accountId = randomUUID();
const now = Math.floor(Date.now() / 1000);
const sql = [
  `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${sqlString(userId)}, ${sqlString(name)}, ${sqlString(email)}, 1, ${now}, ${now})`,
  `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (${sqlString(accountId)}, ${sqlString(userId)}, 'credential', ${sqlString(userId)}, ${sqlString(passwordHash)}, ${now}, ${now})`,
  `INSERT INTO person (id, auth_user_id, name, created_at) VALUES (${sqlString(userId)}, ${sqlString(userId)}, ${sqlString(name)}, ${now})`,
  `INSERT INTO person_role (person_id, role) VALUES (${sqlString(userId)}, 'admin')`,
].join(";");

const wrangler = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);
execFileSync(
  wrangler,
  [
    "d1",
    "execute",
    "h2class",
    isRemote ? "--remote" : "--local",
    "--command",
    sql,
    "--yes",
  ],
  { stdio: "inherit" },
);

console.log(`Seeded admin ${email} (${userId}) in the ${isRemote ? "remote" : "local"} database.`);
