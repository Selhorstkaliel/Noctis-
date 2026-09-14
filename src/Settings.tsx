import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Field,
  Icon,
  Logo,
  PageHeading,
  SearchInput,
  Toggle,
  useUI,
} from "./components";
import { DeviceSessions, PrivacyControls } from "./ServicePanels";
import { securityError, SecuritySettings } from "./Security";
import { api } from "./api";
import { integrations, users } from "./data";
import {
  navigate,
  roleCan,
  updateStore,
  useStore,
  getStore,
  type Store,
} from "./store";
import { AVATAR_MAX_BYTES, AVATAR_MAX_KB } from "../shared/uploads";
import { useI18n } from "./i18n";

function readSettingsDraft() {
  try {
    const raw = sessionStorage.getItem("noctis-settings-draft");
    return raw
      ? (JSON.parse(raw) as Pick<Store, "profile" | "settings">)
      : null;
  } catch {
    return null;
  }
}

const settingsSections = [
  { id: "account", label: "My account", icon: "UserRound" },
  { id: "security", label: "Account security", icon: "ShieldCheck" },
  { id: "privacy", label: "Privacy & safety", icon: "ShieldCheck" },
  { id: "appearance", label: "Appearance", icon: "Palette" },
  { id: "language", label: "Language & region", icon: "Languages" },
  { id: "notifications", label: "Notifications", icon: "Bell" },
  { id: "devices", label: "Voice & devices", icon: "Headphones" },
  { id: "integrations", label: "Connections", icon: "Blocks" },
];
export function Settings({ section }: { section: string }) {
  const store = useStore();
  const { toast, open } = useUI();
  const { t } = useI18n();
  const [profile, setProfile] = useState(() => store.profile);
  const [settings, setSettings] = useState(() => store.settings);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    let active = true;
    api<{ email: string }>("/auth/account")
      .then((r) => {
        if (active) setEmail(r.email);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const [pendingSection, setPendingSection] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const dirty =
    JSON.stringify(profile) !== JSON.stringify(store.profile) ||
    JSON.stringify(settings) !== JSON.stringify(store.settings);
  useEffect(() => {
    try {
      if (dirty)
        sessionStorage.setItem(
          "noctis-settings-draft",
          JSON.stringify({ profile, settings }),
        );
      else sessionStorage.removeItem("noctis-settings-draft");
    } catch {
      /* The unload guard still protects drafts when browser storage is unavailable. */
    }
  }, [profile, settings, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const toggle = (key: string, value: boolean) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const save = async () => {
    if (getStore().pending) return;
    if (!profile.name.trim() || !profile.handle.trim()) {
      setError("Add a display name and username before saving.");
      form.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    if (!/^[a-z0-9._]{3,30}$/i.test(profile.handle)) {
      setError(
        "Use 3–30 letters, numbers, dots, or underscores for your username.",
      );
      return;
    }
    setError("");
    try {
      await updateStore((s) => ({
        ...s,
        profile: {
          ...profile,
          name: profile.name.trim(),
          handle: profile.handle.trim(),
        },
        settings,
      }));
      setProfile(getStore().profile);
      setSettings(getStore().settings);
      toast(t("Changes saved"));
    } catch (e) {
      setError(securityError(e, t));
    }
  };
  const switchSection = (id: string) => {
    if (dirty) setPendingSection(id);
    else navigate(`settings/${id}`);
  };
  const settingRow = (key: string, title: string, description: string) => (
    <div className="setting-row" key={key}>
      <div>
        <strong>{t(title)}</strong>
        <p>{t(description)}</p>
      </div>
      <Toggle
        label={t(title)}
        value={!!settings[key]}
        onChange={(value) => toggle(key, value)}
      />
    </div>
  );
  return (
    <div className="settings-layout">
      <aside className="settings-nav">
        <span className="eyebrow">{t("YOUR NOCTIS")}</span>
        <h2>{t("Settings")}</h2>
        {settingsSections.map((s) => (
          <button
            className={section === s.id ? "active" : ""}
            key={s.id}
            onClick={() => switchSection(s.id)}
          >
            <Icon name={s.icon} size={17} />
            {t(s.label)}
          </button>
        ))}
        <div className="sidebar-divider" />
        <button onClick={() => open({ type: "shortcuts" })}>
          <Icon name="Command" size={17} />
          {t("Keyboard shortcuts")}
        </button>
        <button
          className="danger-text"
          onClick={() => open({ type: "sign-out" })}
        >
          <Icon name="LogOut" size={17} />
          Sign out
        </button>
        <span className="settings-version">
          NOCTIS · VERSION 1.0
          <br />A space for your people.
        </span>
      </aside>
      <div className="settings-content">
        <PageHeading
          title={t(
            settingsSections.find((s) => s.id === section)?.label ||
              "My account",
          )}
          description={
            section === "account"
              ? t("A little about you. Make it feel like home.")
              : t("Set things up the way you like them.")
          }
        />
        {section === "security" ? (
          <SecuritySettings />
        ) : section === "devices" ? (
          <DeviceSessions />
        ) : (
          <form
            noValidate
            aria-busy={store.pending}
            ref={form}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {section === "account" && (
              <>
                <div className="profile-settings-banner">
                  <span className="profile-banner-orbit" />
                  <div>
                    <Avatar user={profile} size={76} />
                    <div>
                      <h2>{profile.name}</h2>
                      <span>@{profile.handle}</span>
                    </div>
                    <label className="button secondary" htmlFor="avatar-upload">
                      <Icon name="Camera" size={16} />
                      {t("Change avatar")}
                    </label>
                    <input
                      id="avatar-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="visually-hidden"
                      disabled={store.pending}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setError("");
                        if (
                          !/^image\/(png|jpeg|webp)$/.test(file.type) ||
                          file.size > AVATAR_MAX_BYTES
                        ) {
                          setError(
                            t(
                              "Choose a JPG, PNG, or WebP no larger than {size} KB.",
                              { size: AVATAR_MAX_KB },
                            ),
                          );
                          e.currentTarget.value = "";
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () =>
                          setProfile((p) => ({
                            ...p,
                            avatarUrl: String(reader.result),
                          }));
                        reader.onerror = () =>
                          setError(
                            "Your image could not be read. Try another file.",
                          );
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                </div>
                <div className="form-grid">
                  <Field
                    label={t("Email address")}
                    type="email"
                    value={email}
                    readOnly
                    autoComplete="email"
                  />
                  <Field
                    label={t("Display name")}
                    value={profile.name}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, name: e.target.value }))
                    }
                    maxLength={40}
                    error={!profile.name.trim() && error ? error : undefined}
                  />
                  <Field
                    label={t("Username")}
                    value={profile.handle}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, handle: e.target.value }))
                    }
                    maxLength={30}
                    hint={t("This is how your people find you.")}
                  />
                </div>
                <Field label={t("About me")} id="profile-bio">
                  <textarea
                    id="profile-bio"
                    className="resize-none"
                    rows={4}
                    value={profile.bio}
                    maxLength={300}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, bio: e.target.value }))
                    }
                  />
                </Field>
                <div className="form-grid">
                  <Field
                    label={t("Custom status")}
                    value={profile.activity}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, activity: e.target.value }))
                    }
                    maxLength={70}
                  />
                  <Field label={t("Presence")} id="presence">
                    <select
                      id="presence"
                      value={profile.status}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          status: e.target.value as typeof profile.status,
                        }))
                      }
                    >
                      <option value="online">{t("Online")}</option>
                      <option value="idle">{t("Away")}</option>
                      <option value="offline">{t("Invisible")}</option>
                    </select>
                  </Field>
                </div>
                <div className="settings-info">
                  <Icon name="Info" size={17} />
                  <p>
                    {t(
                      "Your profile is saved to your account and follows you across devices.",
                    )}
                  </p>
                </div>
              </>
            )}
            {section === "privacy" && (
              <>
                <h3>{t("Choose your comfort zone.")}</h3>
                <PrivacyControls
                  settings={settings}
                  onChange={(key, value) =>
                    setSettings((s) => ({ ...s, [key]: value }))
                  }
                />
                {settingRow(
                  "direct",
                  "Direct messages",
                  "Allow conversations with people in your communities.",
                )}
                {settingRow(
                  "friendRequests",
                  "Friend requests",
                  "Let other members find you and send a friend request.",
                )}
                {settingRow(
                  "activity",
                  "Activity status",
                  "Share what you’re playing, listening to, or working on.",
                )}
                <div className="settings-info">
                  <Icon name="ShieldCheck" size={20} />
                  <p>
                    {t("Your privacy settings control access across Noctis.")}
                  </p>
                </div>
              </>
            )}
            {section === "appearance" && (
              <>
                <h3>{t("Find your shade of night.")}</h3>
                <div className="theme-options">
                  {["midnight", "graphite"].map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      className={`theme-option ${theme} ${settings.theme === theme ? "selected" : ""}`}
                      aria-pressed={settings.theme === theme}
                      onClick={() => setSettings((s) => ({ ...s, theme }))}
                    >
                      <span className="theme-preview">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>
                        {theme === "midnight" ? "Midnight" : "Graphite"}
                      </strong>
                      {settings.theme === theme && (
                        <Icon name="CircleCheck" size={17} />
                      )}
                    </button>
                  ))}
                </div>
                {settingRow(
                  "motion",
                  "Smooth motion",
                  "Subtle transitions that make your space feel a little more alive. Your system’s reduced-motion preference always takes priority.",
                )}
                <div className="settings-info">
                  <Icon name="Palette" size={18} />
                  <p>
                    {t(
                      "Your appearance preference follows you throughout Noctis on this browser.",
                    )}
                  </p>
                </div>
              </>
            )}
            {section === "language" && (
              <>
                <h3>{t("Choose how Noctis speaks to you.")}</h3>
                <div
                  className="language-options"
                  role="group"
                  aria-label={t("Language & region")}
                >
                  {[
                    ["en-US", "EN", "English", "United States"],
                    ["pt-BR", "PT", "Portuguese", "Brazil"],
                  ].map(([value, code, name, region]) => (
                    <button
                      type="button"
                      key={value}
                      className={`language-option ${settings.language === value ? "selected" : ""}`}
                      aria-pressed={settings.language === value}
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          language: value,
                        }))
                      }
                    >
                      <span className="language-code">{code}</span>
                      <span>
                        <strong>{t(name)}</strong>
                        <small>{t(region)}</small>
                      </span>
                      {settings.language === value && (
                        <Icon name="CircleCheck" size={17} />
                      )}
                    </button>
                  ))}
                </div>
                <div className="settings-info">
                  <Icon name="Languages" size={18} />
                  <p>
                    {t(
                      "Language changes after you save and follows your account on every device.",
                    )}
                  </p>
                </div>
              </>
            )}
            {section === "notifications" && (
              <>
                <h3>{t("Stay in the loop. Keep your peace.")}</h3>
                {settingRow(
                  "desktop",
                  "In-app notifications",
                  "Show activity in your notification center.",
                )}
                {settingRow(
                  "mentions",
                  "Mentions & replies",
                  "Get a heads-up when the conversation includes you.",
                )}
                {settingRow(
                  "sounds",
                  "Notification sounds",
                  "Play a subtle sound for new message notifications.",
                )}
                <div className="settings-info">
                  <Icon name="Bell" size={18} />
                  <p>
                    {t(
                      "Your notification preferences are saved to your account.",
                    )}
                  </p>
                </div>
              </>
            )}
            {section === "integrations" && (
              <>
                <h3>{t("A little more of your world.")}</h3>
                {integrations
                  .filter((i) => store.connected.includes(i.id))
                  .map((i) => (
                    <div className="setting-row" key={i.id}>
                      <span
                        className="integration-logo"
                        style={{ color: i.color }}
                      >
                        <Icon name={i.icon} size={24} />
                      </span>
                      <div>
                        <strong>{i.name}</strong>
                        <p>{t("Account connected")}</p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => open({ type: "integration", id: i.id })}
                      >
                        {t("Manage")}
                      </Button>
                    </div>
                  ))}
                {!store.connected.length && (
                  <p className="muted">
                    {t("You haven't connected any external accounts yet.")}
                  </p>
                )}
                <Button
                  type="button"
                  icon="Blocks"
                  onClick={() => navigate("integrations")}
                >
                  {t("Explore integrations")}
                </Button>
              </>
            )}
            {error && (
              <p className="field-error" role="alert">
                {t(error)}
              </p>
            )}
            {!["devices", "integrations"].includes(section) && (
              <div className="settings-save">
                <span>
                  {dirty
                    ? t("You have unsaved changes.")
                    : t("You're all set.")}
                </span>
                <Button
                  type="button"
                  onClick={() => {
                    setProfile(store.profile);
                    setSettings(store.settings);
                    setError("");
                  }}
                  disabled={!dirty}
                >
                  {t("Reset")}
                </Button>
                <Button variant="primary" type="submit" disabled={!dirty}>
                  {t(store.pending ? "Saving changes…" : "Save changes")}
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
      {pendingSection && (
        <Dialog
          title={t("Leave these changes behind?")}
          onClose={() => setPendingSection("")}
        >
          <p>
            You have unsaved changes in{" "}
            {settingsSections
              .find((s) => s.id === section)
              ?.label.toLowerCase()}
            . Save them here, or discard them before moving on.
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setPendingSection("")}>
              {t("Keep editing")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setProfile(store.profile);
                setSettings(store.settings);
                navigate(`settings/${pendingSection}`);
                setPendingSection("");
              }}
            >
              {t("Discard changes")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export { Admin } from "./ServerAdmin";
