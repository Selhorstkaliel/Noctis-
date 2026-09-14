import { useEffect, useState } from "react";
import { Badge, Button, Field, Icon, Logo } from "./components";
import { command, navigate, signIn, useStore } from "./store";
import { normalizeLanguage, translate, useI18n } from "./i18n";
import { ApiError } from "./api";
import { securityError } from "./Security";
export function Login() {
  const store = useStore();
  const [language, setLanguage] = useState(() => {
    try {
      return normalizeLanguage(
        localStorage.getItem("noctis-preferred-language") || navigator.language,
      );
    } catch {
      return normalizeLanguage(navigator.language);
    }
  });
  const [languageTouched, setLanguageTouched] = useState(false);
  const t = (text: string, values?: Record<string, string | number>) =>
    translate(language, text, values);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="login-page">
      <img className="login-background" src="/images/mountains.jpg" alt="" />
      <div className="login-shade" />
      <header>
        <Logo />
        <div className="login-header-actions">
          <span className="subtle-link">
            {t("YOUR WORLD. BEAUTIFULLY CONNECTED.")}
          </span>
          <div
            className="login-language"
            aria-label={t("Language & region")}
            role="group"
          >
            {(["en-US", "pt-BR"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={language === value ? "active" : ""}
                aria-label={
                  value === "en-US" ? "English" : "Português (Brasil)"
                }
                aria-pressed={language === value}
                onClick={() => {
                  setLanguage(value);
                  setLanguageTouched(true);
                  try {
                    localStorage.setItem("noctis-preferred-language", value);
                  } catch {}
                }}
              >
                {value === "en-US" ? "EN" : "PT"}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="login-story">
        <Badge tone="glass" icon="Orbit">
          {t("A LITTLE CLOSER, EVEN FROM HERE.")}
        </Badge>
        <h1>
          {t("A space")}
          <br />
          {t("for your")} <em>{t("people.")}</em>
        </h1>
        <p>
          {t("The conversations that run late.")}
          <br />
          {t("The ideas that go somewhere.")}
          <br />
          {t("The people who make it all worthwhile.")}
        </p>
        <div className="login-story-footer">
          <span className="coordinate-line" />
          <span>{t("GOOD COMPANY. NO DISTANCE.")}</span>
        </div>
      </div>
      <div className="login-form">
        <span className="login-emblem">
          <Icon name="Orbit" size={37} />
        </span>
        <span className="eyebrow">{t("WELCOME TO NOCTIS")}</span>
        <h2>{t(register ? "Find your people." : "Good to have you back.")}</h2>
        <p>
          {register
            ? t("Create your account. Make a little room for what matters.")
            : t("Your conversations, communities, and next great idea await.")}
        </p>
        <form
          noValidate
          aria-busy={busy}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setError("");
            if (password.length < 12) {
              setError(t("Use at least 12 characters for your password."));
              return;
            }
            setBusy(true);
            try {
              const result = await signIn(
                {
                  email,
                  password,
                  ...(register ? { name, handle, language } : {}),
                },
                register,
              );
              if (register)
                sessionStorage.setItem("noctis-pending-onboarding", "true");
              if (languageTouched && result !== "authenticated")
                sessionStorage.setItem(
                  "noctis-pending-login-language",
                  language,
                );
              if (result === "mfa") {
                setPassword("");
                navigate("mfa");
                return;
              }
              if (result === "verification") {
                setPassword("");
                return;
              }
              if (register || languageTouched)
                await command("/settings", "PATCH", { language });
              setPassword("");
              const invite = sessionStorage.getItem("noctis-pending-invite");
              if (invite) {
                sessionStorage.removeItem("noctis-pending-invite");
                navigate(`invite/${invite}`);
              } else navigate(register ? "onboarding" : "home");
            } catch (e) {
              setError(
                register && e instanceof ApiError && e.status === 409
                  ? t(
                      "We couldn't create this account. Try a different email or username. If you already registered, sign in or reset your password.",
                    )
                  : securityError(e, t),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <>
              <Field
                label={t("Display name")}
                autoComplete="name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
              <Field
                label={t("Username")}
                autoComplete="username"
                value={handle}
                maxLength={32}
                placeholder="your.name"
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
              />
            </>
          )}
          <Field
            label={t("Email address")}
            type="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label={t("Password")}
            type={visible ? "text" : "password"}
            autoComplete={register ? "new-password" : "current-password"}
            value={password}
            minLength={12}
            maxLength={128}
            placeholder={t(
              register ? "At least 12 characters" : "Your password",
            )}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="subtle-link"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {t(visible ? "Hide password" : "Show password")}
          </button>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="light"
            type="submit"
            className="full-width"
            disabled={busy}
          >
            {t(busy ? "One moment…" : register ? "Create account" : "Sign in")}
            <Icon name="ArrowRight" size={16} />
          </Button>
        </form>
        {(!register || error) && (
          <button
            type="button"
            className="subtle-link"
            disabled={busy}
            onClick={() => navigate("forgot-password")}
          >
            {t("Forgot password?")}
          </button>
        )}
        {store.providers.some((p) => p.enabled && p.login) && (
          <>
            <div className="login-form-divider">
              <span />
              {language === "pt-BR" ? "OU" : "OR"}
              <span />
            </div>
            {store.providers
              .filter((p) => p.enabled && p.login)
              .map((p) => (
                <a
                  key={p.id}
                  className="button full-width"
                  href={`/api/oauth/${p.id}/start?purpose=login`}
                >
                  {t("Continue with {provider}", {
                    provider: p.id === "github" ? "GitHub" : "Google",
                  })}
                </a>
              ))}
          </>
        )}
        <button
          className="login-back subtle-link"
          type="button"
          disabled={busy}
          onClick={() => {
            setRegister(!register);
            setError("");
            setPassword("");
          }}
        >
          {t(
            register
              ? "Already have an account? Sign in"
              : "New here? Create an account",
          )}
        </button>
        <p className="login-note">
          <Icon name="ShieldCheck" size={13} />
          {t("Your account, securely connected.")}
        </p>
      </div>
    </div>
  );
}
export function Onboarding() {
  const store = useStore();
  const { t } = useI18n();
  const [interests, setInterests] = useState<string[]>([]);
  return (
    <div className="page-content standard-page">
      <span className="eyebrow">{t("MAKE YOURSELF AT HOME")}</span>
      <h1>
        {t("What brings you here, {name}?", {
          name: store.profile.name.split(" ")[0],
        })}
      </h1>
      <p className="muted">
        {t("Pick a few interests. There's a space for every side of you.")}
      </p>
      <div className="interest-grid">
        {[
          "Design & creativity",
          "Gaming",
          "Music",
          "Technology",
          "Lifestyle",
        ].map((i) => (
          <button
            key={i}
            aria-pressed={interests.includes(i)}
            className={interests.includes(i) ? "selected" : ""}
            onClick={() =>
              setInterests((s) =>
                s.includes(i) ? s.filter((x) => x !== i) : [...s, i],
              )
            }
          >
            {t(i)}
            {interests.includes(i) && <Icon name="Check" size={14} />}
          </button>
        ))}
      </div>
      <Button
        variant="primary"
        onClick={async () => {
          await command("/settings", "PATCH", {
            interests: interests.join(","),
          });
          navigate("discover");
        }}
      >
        {t("Discover your communities")}
        <Icon name="ArrowRight" size={16} />
      </Button>
    </div>
  );
}
