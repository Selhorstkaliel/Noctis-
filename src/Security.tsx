import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Badge, Button, Dialog, Field, Icon, Logo } from "./components";
import { api } from "./api";
import {
  acceptSession,
  getStore,
  initialize,
  navigate,
  signOut,
} from "./store";
import { normalizeLanguage, translate, useI18n } from "./i18n";

export function SecretField(props: ComponentProps<typeof Field>) {
  const [visible, setVisible] = useState(false);
  const { t } = useSecurityLanguage();
  return (
    <div className="secret-field">
      <Field {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="subtle-link"
        aria-label={t(visible ? "Hide {label}" : "Show {label}", {
          label: props.label,
        })}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {t(visible ? "Hide" : "Show")}
      </button>
    </div>
  );
}
function useSecurityLanguage() {
  const current = useI18n();
  let language = current.language;
  if (getStore().auth !== "authenticated") {
    try {
      language = normalizeLanguage(
        localStorage.getItem("noctis-preferred-language") || navigator.language,
      );
    } catch {
      language = normalizeLanguage(navigator.language);
    }
  }
  return {
    language,
    t: (text: string, values?: Record<string, string | number>) =>
      translate(language, text, values),
  };
}
export function securityError(error: unknown, t: (text: string) => string) {
  return t(
    error instanceof TypeError
      ? "Connection failed. Check your internet connection and try again."
      : (error as Error).message,
  );
}
function focusError(form: HTMLFormElement) {
  const target = form.querySelector<HTMLElement>(
    '[aria-invalid="true"], input:not([readonly])',
  );
  target?.focus();
}
export function continueAfterSecurity() {
  const invite = sessionStorage.getItem("noctis-pending-invite");
  const onboarding = sessionStorage.getItem("noctis-pending-onboarding");
  sessionStorage.removeItem("noctis-pending-invite");
  sessionStorage.removeItem("noctis-pending-onboarding");
  navigate(invite ? `invite/${invite}` : onboarding ? "onboarding" : "home");
}
export function SecurityRoute({ mode }: { mode: string }) {
  const { t, language } = useSecurityLanguage();
  const [secret] = useState(
    () =>
      location.hash.match(/^#\/(?:verify|reset)-email\/([\w-]{43})$/)?.[1] ||
      "",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const title =
    mode === "mfa"
      ? "Two-factor authentication"
      : mode === "forgot-password"
        ? "Reset your password"
        : mode === "reset-email"
          ? "Choose a new password"
          : "Verify your email";
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${t(title)} · Noctis`;
    if (secret)
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#/${mode}`,
      );
  }, [secret, mode, language, title]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  return (
    <main className="security-page">
      <Logo />
      <section className="panel security-card">
        <Icon name="ShieldCheck" size={28} />
        <h1>{t(title)}</h1>
        {mode === "verification" && (
          <p>
            {t(
              "Confirm your email before entering Noctis. Check your inbox or request a confirmation link.",
            )}
          </p>
        )}
        {mode === "mfa" && (
          <p>
            {t(
              "Enter a code from your authenticator or an unused recovery code.",
            )}
          </p>
        )}
        {mode === "forgot-password" && (
          <p>
            {t(
              "Enter your account email. If password recovery is available, we will send a link.",
            )}
          </p>
        )}
        {mode === "verify-email" && !done && (
          <p>{t("Confirm this email to finish verifying your account.")}</p>
        )}
        {!done && mode !== "verification" && (
          <form
            noValidate
            aria-busy={busy}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = event.currentTarget;
              setError("");
              setMessage("");
              if (mode === "mfa" && code.length < 6) {
                setError(
                  t(
                    "Enter a code from your authenticator or an unused recovery code.",
                  ),
                );
                focusError(form);
                return;
              }
              if (
                mode === "forgot-password" &&
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
              ) {
                setError(t("Enter a valid email address."));
                focusError(form);
                return;
              }
              if (
                mode === "reset-email" &&
                (password.length < 12 || password !== confirm)
              ) {
                setError(
                  t(
                    password.length < 12
                      ? "Use at least 12 characters for your password."
                      : "The new passwords do not match.",
                  ),
                );
                focusError(form);
                return;
              }
              setBusy(true);
              try {
                if (mode === "mfa") {
                  const result = await api("/auth/mfa/login", "POST", { code });
                  await acceptSession(result);
                  continueAfterSecurity();
                }
                if (mode === "forgot-password") {
                  await api("/auth/password/forgot", "POST", { email });
                  setMessage(
                    t(
                      "If password recovery is available for this email, a link is on its way. Check your inbox and spam folder.",
                    ),
                  );
                  setDone(true);
                }
                if (mode === "verify-email") {
                  await api("/auth/email/verify", "POST", { token: secret });
                  setMessage(t("Email verified. You can now continue."));
                  setDone(true);
                }
                if (mode === "reset-email") {
                  await api("/auth/password/reset", "POST", {
                    token: secret,
                    password,
                    code: code || undefined,
                  });
                  setPassword("");
                  setConfirm("");
                  setCode("");
                  setMessage(
                    t(
                      "Password changed. All sessions were signed out. Sign in with your new password.",
                    ),
                  );
                  setDone(true);
                }
              } catch (e) {
                setError(securityError(e, t));
                focusError(form);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "forgot-password" && (
              <Field
                label={t("Email address")}
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error || undefined}
              />
            )}
            {mode === "reset-email" && (
              <>
                <SecretField
                  label={t("New password")}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  hint={t("At least 12 characters")}
                />
                <SecretField
                  label={t("Confirm new password")}
                  autoComplete="new-password"
                  maxLength={128}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </>
            )}
            {["mfa", "reset-email"].includes(mode) && (
              <SecretField
                label={t("Authenticator or recovery code")}
                autoComplete="one-time-code"
                maxLength={39}
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                hint={
                  mode === "reset-email"
                    ? t(
                        "Required only if two-factor authentication is enabled.",
                      )
                    : undefined
                }
                error={error || undefined}
              />
            )}
            {mode === "verify-email" && error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy ||
                (["verify-email", "reset-email"].includes(mode) && !secret)
              }
              className="full-width"
            >
              {busy
                ? t("One moment…")
                : t(
                    mode === "mfa"
                      ? "Verify and sign in"
                      : mode === "forgot-password"
                        ? "Send recovery link"
                        : mode === "reset-email"
                          ? "Reset password"
                          : "Confirm email",
                  )}
            </Button>
            {["verify-email", "reset-email"].includes(mode) && !secret && (
              <p role="alert" className="field-error">
                {t(
                  "Open the link from your email. If it expired, request a new one.",
                )}
              </p>
            )}
          </form>
        )}
        {mode === "verification" && (
          <div className="security-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await initialize();
                  if (getStore().auth === "authenticated")
                    continueAfterSecurity();
                  else
                    setMessage(
                      t(
                        "Your email has not been confirmed yet. Open the link in your inbox.",
                      ),
                    );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("I confirmed my email")}
            </Button>
            <Button
              disabled={busy || cooldown > 0}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/auth/email/resend", "POST", {});
                  setCooldown(60);
                  setMessage(
                    t(
                      "A new confirmation link is on its way. Previous links no longer work.",
                    ),
                  );
                } catch (e) {
                  setError(securityError(e, t));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {cooldown
                ? t("Resend in {seconds}s", { seconds: cooldown })
                : t("Resend confirmation email")}
            </Button>
          </div>
        )}
        <div className="security-feedback" aria-live="polite">
          {message && <p role="status">{message}</p>}
          {mode === "verification" && error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </div>
        {done && mode === "verify-email" && (
          <Button
            variant="primary"
            onClick={async () => {
              await initialize();
              continueAfterSecurity();
            }}
          >
            {t("Continue")}
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            if (getStore().auth === "verification") await signOut();
            else {
              if (mode === "reset-email" && done) await initialize();
              navigate("login");
            }
          }}
        >
          {t(mode === "verification" ? "Sign out" : "Back to sign in")}
        </Button>
      </section>
    </main>
  );
}

type Account = {
  email: string;
  emailVerifiedAt: string | null;
  hasPassword: boolean;
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
};
export function SecuritySettings() {
  const { t } = useI18n();
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState("");
  const [action, setAction] = useState<"setup" | "disable" | "recovery">();
  const load = () =>
    api<Account>("/auth/account")
      .then(setAccount)
      .catch((e) => setError(securityError(e, t)));
  useEffect(() => {
    const abort = new AbortController();
    api<Account>("/auth/account", "GET", undefined, abort.signal)
      .then(setAccount)
      .catch((e) => {
        if (!abort.signal.aborted) setError(securityError(e, t));
      });
    return () => abort.abort();
  }, []);
  if (!account)
    return (
      <div role="status">
        {error ? (
          <>
            <p className="field-error">{error}</p>
            <Button onClick={() => void load()}>{t("Try again")}</Button>
          </>
        ) : (
          t("Loading account security…")
        )}
      </div>
    );
  return (
    <div className="security-settings">
      <div className="setting-row">
        <div>
          <h2>{t("Email address")}</h2>
          <p>{account.email}</p>
        </div>
        <Badge>
          {t(account.emailVerifiedAt ? "Verified" : "Not verified")}
        </Badge>
      </div>
      <div className="setting-row">
        <div>
          <h2>{t("Two-factor authentication")}</h2>
          <p>
            {t(
              account.mfaEnabled
                ? "Your account requires an authenticator or recovery code when you sign in."
                : "Add a second step to protect your account, including provider sign-ins.",
            )}
          </p>
          {account.mfaEnabled && (
            <p>
              {t("{count} recovery codes remaining", {
                count: account.recoveryCodesRemaining,
              })}
            </p>
          )}
        </div>
        <Badge>{t(account.mfaEnabled ? "Enabled" : "Disabled")}</Badge>
      </div>
      <div className="security-actions">
        {account.mfaEnabled ? (
          <>
            <Button onClick={() => setAction("recovery")}>
              {t("Replace recovery codes")}
            </Button>
            <Button variant="ghost" onClick={() => setAction("disable")}>
              {t("Disable two-factor authentication")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => setAction("setup")}>
            {t("Set up authenticator")}
          </Button>
        )}
      </div>
      {account.hasPassword && (
        <ChangePassword mfaEnabled={account.mfaEnabled} />
      )}
      {action && (
        <MfaDialog
          action={action}
          account={account}
          onClose={() => {
            setAction(undefined);
            void load();
          }}
        />
      )}
    </div>
  );
}
function MfaDialog({
  action,
  account,
  onClose,
}: {
  action: "setup" | "disable" | "recovery";
  account: Account;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrCode: string }>();
  const [codes, setCodes] = useState<string[]>();
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const pending = !!codes && !saved;
  useEffect(() => {
    if (!pending) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);
  const close = () => {
    if (busy) return;
    if (pending || setup) setDiscard(true);
    else onClose();
  };
  const title = codes
    ? "Save your recovery codes"
    : action === "setup"
      ? "Set up authenticator"
      : action === "disable"
        ? "Disable two-factor authentication"
        : "Replace recovery codes";
  return (
    <Dialog title={t(title)} onClose={close} closeLabel={t("Close dialog")}>
      {discard ? (
        <>
          <p>
            {t(
              codes
                ? "These codes will not be shown again. Close without saving them?"
                : "Authenticator setup is not finished. Close setup?",
            )}
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setDiscard(false)}>{t("Keep open")}</Button>
            <Button variant="danger" onClick={onClose}>
              {t("Close")}
            </Button>
          </div>
        </>
      ) : codes ? (
        <>
          <p>
            {t(
              "Each code works once. Keep these codes somewhere safe, separate from your password. They will not be shown again.",
            )}
          </p>
          <Button
            onClick={() => setRevealed(!revealed)}
            aria-pressed={revealed}
          >
            {t(revealed ? "Hide recovery codes" : "Show recovery codes")}
          </Button>
          {revealed && <pre className="recovery-codes">{codes.join("\n")}</pre>}
          <label className="security-check">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            {t("I saved my recovery codes")}
          </label>
          <Button variant="primary" disabled={!saved} onClick={onClose}>
            {t("Done")}
          </Button>
        </>
      ) : (
        <form
          noValidate
          aria-busy={busy}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = e.currentTarget;
            if (setup && !/^\d{6}$/.test(code)) {
              setError(t("Enter the six-digit code from your authenticator."));
              focusError(form);
              return;
            }
            setBusy(true);
            setError("");
            try {
              const result = await api(
                `/auth/mfa/${action === "setup" ? (setup ? "enable" : "setup") : action}`,
                "POST",
                {
                  password: password || undefined,
                  ...(action !== "setup" || setup ? { code } : {}),
                },
              );
              if (result.recoveryCodes) {
                setCodes(result.recoveryCodes);
                setSetup(undefined);
                setPassword("");
                setCode("");
              } else if (action === "setup") setSetup(result);
              else onClose();
            } catch (e) {
              setError(securityError(e, t));
              focusError(form);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            {t(
              action === "disable"
                ? "Your account will stop requiring a second factor. All other sessions will be signed out."
                : action === "recovery"
                  ? "All previous recovery codes will stop working. Other sessions will be signed out."
                  : "Use an authenticator app. Setup expires after 10 minutes. Other sessions will be signed out when you enable it.",
            )}
          </p>
          {account.hasPassword ? (
            <SecretField
              label={t("Current password")}
              autoComplete="current-password"
              value={password}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
              error={error || undefined}
            />
          ) : (
            <p>
              {t(
                "For provider accounts, sign in again if your session is more than 5 minutes old.",
              )}
            </p>
          )}
          {setup && (
            <>
              <p>
                {t(
                  "Scan this QR code with your authenticator, then enter its six-digit code.",
                )}
              </p>
              <img
                className="mfa-qr"
                src={setup.qrCode}
                width={224}
                height={224}
                alt={t("Authenticator setup QR code")}
              />
              <SecretField
                label={t("Manual setup key")}
                readOnly
                value={setup.secret}
                autoComplete="off"
              />
            </>
          )}
          {(setup || action !== "setup") && (
            <SecretField
              label={t(
                setup ? "Six-digit code" : "Authenticator or recovery code",
              )}
              autoComplete="one-time-code"
              value={code}
              maxLength={setup ? 6 : 39}
              onChange={(e) => setCode(e.target.value.trim())}
              error={error || undefined}
            />
          )}
          {!account.hasPassword && !setup && error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" disabled={busy} onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              variant={action === "disable" ? "danger" : "primary"}
              disabled={busy}
            >
              {t(
                busy
                  ? "One moment…"
                  : setup
                    ? "Enable two-factor authentication"
                    : title,
              )}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
export function ChangePassword({
  mfaEnabled = false,
}: {
  mfaEnabled?: boolean;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  return (
    <section className="security-password">
      <h2>{t("Change password")}</h2>
      <form
        ref={ref}
        noValidate
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError("");
          setMessage("");
          if (password.length < 12 || password !== confirm) {
            setError(
              t(
                password.length < 12
                  ? "Use at least 12 characters for your password."
                  : "The new passwords do not match.",
              ),
            );
            focusError(e.currentTarget);
            return;
          }
          setBusy(true);
          try {
            await api("/auth/password", "PATCH", {
              currentPassword: current,
              password,
              code: code || undefined,
            });
            setCurrent("");
            setPassword("");
            setConfirm("");
            setCode("");
            setMessage(
              t("Password updated. Other devices have been signed out."),
            );
          } catch (error) {
            setError(securityError(error, t));
            if (ref.current) focusError(ref.current);
          } finally {
            setBusy(false);
          }
        }}
      >
        <SecretField
          label={t("Current password")}
          autoComplete="current-password"
          value={current}
          maxLength={128}
          onChange={(e) => setCurrent(e.target.value)}
          error={error || undefined}
        />
        <SecretField
          label={t("New password")}
          autoComplete="new-password"
          value={password}
          minLength={12}
          maxLength={128}
          hint={t("At least 12 characters")}
          onChange={(e) => setPassword(e.target.value)}
        />
        <SecretField
          label={t("Confirm new password")}
          autoComplete="new-password"
          value={confirm}
          maxLength={128}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mfaEnabled && (
          <SecretField
            label={t("Authenticator or recovery code")}
            autoComplete="one-time-code"
            value={code}
            maxLength={39}
            onChange={(e) => setCode(e.target.value.trim())}
          />
        )}
        <Button type="submit" disabled={busy}>
          {t(busy ? "One moment…" : "Update password")}
        </Button>
        <div className="security-feedback" role="status">
          {message}
        </div>
      </form>
    </section>
  );
}
