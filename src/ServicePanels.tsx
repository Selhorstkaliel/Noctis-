import { useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  PageHeading,
  Toggle,
  useUI,
} from "./components";
import { integrations, getUser } from "./data";
import { api } from "./api";
import { command, navigate, refresh, signOut, useStore } from "./store";
import { useI18n } from "./i18n";
export function InvitePage({ token }: { token: string }) {
  const [invite, setInvite] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/invites/${encodeURIComponent(token)}`)
      .then((value) => {
        if (active) setInvite(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <div className="page-content standard-page invite-page">
      {error ? (
        <EmptyState
          title="This invitation is unavailable"
          description={error}
          action={
            <Button onClick={() => navigate("discover")}>
              Discover servers
            </Button>
          }
        />
      ) : invite ? (
        <section className="panel">
          <img className="invite-cover" src={invite.image} alt="" />
          <Badge>YOU’RE INVITED</Badge>
          <h1>{invite.name}</h1>
          <p>{invite.description}</p>
          <Button
            variant="primary"
            onClick={async () => {
              const joined = await command(
                `/invites/${encodeURIComponent(token)}/join`,
              );
              navigate(`server/${joined.id}/general`);
            }}
          >
            Accept invitation
            <Icon name="ArrowRight" size={16} />
          </Button>
        </section>
      ) : (
        <p role="status">Checking your invitation…</p>
      )}
    </div>
  );
}
export function InvitePanel({ serverId }: { serverId: string }) {
  const store = useStore();
  const [recipient, setRecipient] = useState("");
  const [invite, setInvite] = useState<{
    id: string;
    token: string;
    expiresAt: string;
  }>();
  const [hours, setHours] = useState("24");
  const [uses, setUses] = useState("25");
  const [copied, setCopied] = useState(false);
  const { toast } = useUI();
  const url = invite ? `${location.origin}/#/invite/${invite.token}` : "";
  return (
    <div>
      <p className="modal-intro">
        Make room for your people. Set how long this invitation lasts and how
        many people can use it.
      </p>
      <Field label="Expires after" id="invite-expiry">
        <select
          id="invite-expiry"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        >
          <option value="1">1 hour</option>
          <option value="24">24 hours</option>
          <option value="168">7 days</option>
        </select>
      </Field>
      <Field
        label="Maximum uses"
        type="number"
        min="1"
        max="1000"
        value={uses}
        onChange={(e) => setUses(e.target.value)}
      />
      {invite ? (
        <>
          <Field label="Invitation link" readOnly value={url} />
          <Field label="Invite someone" id="invite-recipient">
            <select
              id="invite-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            >
              <option value="">Choose a person</option>
              {store.users
                .filter((u) => u.id !== store.profile.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            disabled={!recipient}
            onClick={async () => {
              await command(
                `/servers/${serverId}/invites/${invite.id}/send`,
                "POST",
                { userId: recipient, token: invite.token },
              );
              setRecipient("");
              toast("Invitation sent");
            }}
          >
            Send invitation
          </Button>
          <div className="dialog-actions">
            <Button
              onClick={async () => {
                await command(
                  `/servers/${serverId}/invites/${invite.id}`,
                  "DELETE",
                  undefined,
                );
                setInvite(undefined);
                toast("Invitation revoked");
              }}
            >
              Revoke invitation
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy invitation"}
            </Button>
          </div>
          <small className="muted">
            Expires {new Date(invite.expiresAt).toLocaleString()}
          </small>
        </>
      ) : (
        <div className="dialog-actions">
          <Button
            variant="primary"
            onClick={async () => {
              setInvite(
                await command(`/servers/${serverId}/invites`, "POST", {
                  maxUses: Number(uses),
                  expiresHours: Number(hours),
                }),
              );
            }}
          >
            Create invitation
          </Button>
        </div>
      )}
    </div>
  );
}
export function IntegrationPanel({ provider }: { provider: string }) {
  const store = useStore();
  const { toast } = useUI();
  const integration = integrations.find((i) => i.id === provider);
  if (!integration)
    return (
      <EmptyState
        title="Integration unavailable"
        description="Choose an integration from the marketplace."
      />
    );
  const available = store.providers.some((p) => p.id === provider && p.enabled);
  const connected = store.connected.includes(provider);
  return (
    <div>
      <div className="integration-modal-brand">
        <Icon name={integration.icon} size={36} />
        <h2>{integration.name}</h2>
      </div>
      <p className="modal-intro">{integration.description}</p>
      {provider === "webhooks" ? (
        <>
          <p>
            Signed webhooks deliver verified updates to a channel you manage.
          </p>
          <Button
            variant="primary"
            onClick={() =>
              navigate(
                `admin/${store.servers.find((s) => s.permissions?.includes("MANAGE_SERVER"))?.id || ""}`,
              )
            }
          >
            Manage server webhooks
          </Button>
        </>
      ) : (
        <>
          <div className="settings-info">
            <Icon name="ShieldCheck" />
            <p>
              {available
                ? "Your provider credentials stay on the server. You choose the access granted on the provider’s consent screen."
                : "This provider has not been enabled by the Noctis administrator."}
            </p>
          </div>
          {store.integrationItems
            .filter((i) => i.provider === provider)
            .map((i, index) => (
              <div className="setting-row" key={index}>
                <div>
                  <strong>{i.title}</strong>
                  <p>{new Date(i.occurredAt).toLocaleString()}</p>
                </div>
                {i.url && (
                  <a
                    href={i.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="subtle-link"
                  >
                    Open
                    <Icon name="ArrowUpRight" size={14} />
                  </a>
                )}
              </div>
            ))}
          <div className="dialog-actions">
            {connected ? (
              <Button
                onClick={async () => {
                  await command(
                    `/integrations/${provider}`,
                    "DELETE",
                    undefined,
                  );
                  toast(
                    "Connection removed from Noctis. You can also revoke access in the provider account.",
                  );
                }}
              >
                Disconnect {integration.name}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!available}
                onClick={async () => {
                  const r = await api(
                    `/integrations/${provider}/connect`,
                    "POST",
                    {},
                  );
                  location.assign(r.url);
                }}
              >
                {available ? `Connect ${integration.name}` : "Not configured"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
export function DeviceSessions() {
  const { t } = useI18n();
  const [devices, setDevices] = useState<any[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    api<any[]>("/auth/devices")
      .then(setDevices)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <h2>Active devices</h2>
      <p className="muted">
        Review where you’re signed in and end sessions you no longer use.
      </p>
      {devices.map((d) => (
        <div className="setting-row" key={d.id}>
          <div>
            <strong>
              {d.label} {d.current && <Badge>This device</Badge>}
            </strong>
            <p>Last active {new Date(d.lastSeen).toLocaleString()}</p>
          </div>
          <Button
            onClick={async () => {
              await api(`/auth/devices/${d.id}`, "DELETE");
              await load();
              if (d.current) await refresh();
            }}
          >
            Sign out
          </Button>
        </div>
      ))}
      <Button variant="danger" onClick={() => signOut(true)}>
        Sign out all devices
      </Button>
      <hr />
      <Button onClick={() => navigate("settings/security")}>
        {t("Account security")}
      </Button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function PrivacyControls({
  settings,
  onChange,
}: {
  settings: Record<string, boolean | string>;
  onChange: (key: string, value: string | boolean) => void;
}) {
  const store = useStore();
  return (
    <>
      <Field label="Who can see your profile?" id="profile-visibility">
        <select
          id="profile-visibility"
          value={String(settings.profileVisibility)}
          onChange={(e) => onChange("profileVisibility", e.target.value)}
        >
          <option value="community">People in my communities</option>
          <option value="friends">Friends only</option>
          <option value="private">Only me</option>
        </select>
      </Field>
      <Field label="Who can start a direct conversation?" id="dm-policy">
        <select
          id="dm-policy"
          value={String(settings.dmPolicy)}
          onChange={(e) => onChange("dmPolicy", e.target.value)}
        >
          <option value="community">People in my communities</option>
          <option value="friends">Friends only</option>
          <option value="nobody">Nobody</option>
        </select>
      </Field>
      <div className="setting-row">
        <div>
          <strong>Community invitations</strong>
          <p>Allow people to send you server invitations.</p>
        </div>
        <Toggle
          label="Allow community invitations"
          value={!!settings.invites}
          onChange={(v) => onChange("invites", v)}
        />
      </div>
      <h3>Blocked people</h3>
      {store.blocks.length ? (
        store.blocks.map((id) => (
          <div className="setting-row" key={id}>
            <span>Blocked account · {id.slice(0, 8)}</span>
            <Button
              onClick={() =>
                command(`/blocks/${id}`, "PUT", { blocked: false })
              }
            >
              Unblock
            </Button>
          </div>
        ))
      ) : (
        <p className="muted">You haven’t blocked anyone.</p>
      )}
    </>
  );
}
