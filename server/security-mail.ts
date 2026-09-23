import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { encrypt, decrypt, hash, token } from "./crypto.js";
import { workerPool, type DB } from "./db.js";

type Mail = { to: string; subject: string; text: string };
export async function queueSecurityMail(db: DB, mail: Mail) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO security_mail(id,payload_encrypted) VALUES($1,$2)",
    [id, encrypt(JSON.stringify(mail), `mail:${id}`)],
  );
}
export async function queueAccountToken(
  db: DB,
  userId: string,
  email: string,
  purpose: "verify" | "reset",
) {
  const secret = token();
  await db.query(
    "INSERT INTO account_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 minute') ON CONFLICT(user_id,purpose) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at",
    [userId, purpose, hash(secret), purpose === "verify" ? 60 : 20],
  );
  // Fragment tokens never reach HTTP access logs or Referer headers. The client clears the fragment on load.
  const link = `${config.APP_ORIGIN}/#/${purpose}-email/${secret}`;
  await queueSecurityMail(db, {
    to: email,
    subject:
      purpose === "verify"
        ? "Noctis â€” Verify your email / Confirme seu e-mail"
        : "Noctis â€” Reset your password / Redefina sua senha",
    text:
      purpose === "verify"
        ? `Confirm your email within 60 minutes. / Confirme seu e-mail em atÃ© 60 minutos:\n\n${link}\n\nIf you did not create this account, ignore this message. / Se vocÃª nÃ£o criou esta conta, ignore esta mensagem.`
        : `Reset your password within 20 minutes. / Redefina sua senha em atÃ© 20 minutos:\n\n${link}\n\nYour authenticator or recovery code is still required if two-factor authentication is enabled. / Se a autenticaÃ§Ã£o em duas etapas estiver ativa, vocÃª ainda precisarÃ¡ do autenticador ou de um cÃ³digo de recuperaÃ§Ã£o.\n\nIf you did not request this, ignore this message. / Se vocÃª nÃ£o fez esta solicitaÃ§Ã£o, ignore esta mensagem.`,
  });
}
const smtp =
  config.MAIL_TRANSPORT === "smtp"
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        requireTLS: config.SMTP_PORT !== 465,
        auth: config.SMTP_USER
          ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
          : undefined,
        tls: { rejectUnauthorized: true },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : undefined;

export async function deliverSecurityMail() {
  const db = await workerPool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query(
      "SELECT * FROM security_mail WHERE available_at<=now() AND attempts<8 AND created_at>now()-interval '1 day' ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!result.rowCount) {
      await db.query("COMMIT");
      return false;
    }
    const row = result.rows[0];
    try {
      const mail = JSON.parse(
        decrypt(row.payload_encrypted, `mail:${row.id}`),
      ) as Mail;
      if (smtp)
        await smtp.sendMail({
          ...mail,
          from: config.MAIL_FROM,
          messageId: `<${row.id}@noctis>`,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      else {
        const path = join(config.STORAGE_PATH, "mail");
        await mkdir(path, { recursive: true, mode: 0o700 });
        await writeFile(join(path, `${row.id}.json`), JSON.stringify(mail), {
          mode: 0o600,
        });
      }
      await db.query("DELETE FROM security_mail WHERE id=$1", [row.id]);
    } catch (error) {
      await db.query(
        "UPDATE security_mail SET attempts=attempts+1,available_at=now()+least(3600,power(2,attempts+1)::int*30)*interval '1 second' WHERE id=$1",
        [row.id],
      );
      const failure = error as {
        code?: string;
        responseCode?: number;
        command?: string;
        response?: string;
      };
      const response = String(failure.response || "")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
        .slice(0, 300);
      process.stderr.write(
        `${JSON.stringify({
          kind: "worker",
          event: "security_mail_failed",
          code: failure.code || null,
          responseCode: failure.responseCode || null,
          command: failure.command || null,
          response,
          retry: true,
        })}\n`,
      );
    }
    await db.query("COMMIT");
    return true;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

