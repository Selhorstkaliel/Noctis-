import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type Ref,
} from "react";
import { iconSet } from "./icons";
import { getUser, type User } from "./data";
import { useStore } from "./store";

export function Icon({
  name,
  size = 18,
  ...props
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = iconSet[name] || iconSet.Circle;
  return (
    <Component size={size} strokeWidth={1.7} aria-hidden="true" {...props} />
  );
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`logo ${compact ? "compact" : ""}`}>
      <img src="/noctis.svg" alt="" width="35" height="35" />
      {!compact && <span>NOCTIS</span>}
    </span>
  );
}
export function Button({
  children,
  variant = "secondary",
  icon,
  className = "",
  onClick,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  icon?: string;
}) {
  const store = useStore();
  return (
    <button
      className={`button ${variant} ${className}`}
      type={type}
      onClick={onClick}
      {...props}
      disabled={store.pending || props.disabled}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}
export function IconButton({
  name,
  label,
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  name: string;
  label: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
      onClick={onClick}
      {...props}
    >
      <Icon name={name} />
    </button>
  );
}
export function Avatar({
  user,
  size = 36,
  status = true,
  onClick,
}: {
  user: string | User;
  size?: number;
  status?: boolean;
  onClick?: () => void;
}) {
  const store = useStore();
  const person =
    typeof user === "string"
      ? user === store.profile.id
        ? store.profile
        : getUser(user)
      : user;
  const content = (
    <>
      <span className="avatar-image" style={{ background: person.color }}>
        {person.name
          .split(" ")
          .map((x) => x[0])
          .slice(0, 2)
          .join("")}
        <img
          src={person.avatarUrl || `/images/avatar-${person.avatar}.jpg`}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </span>
      {status && (
        <span className={`presence ${person.status}`} title={person.status} />
      )}
    </>
  );
  return onClick ? (
    <button
      className="avatar"
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-label={`View ${person.name}'s profile`}
    >
      {content}
    </button>
  ) : (
    <span
      className="avatar"
      style={{ width: size, height: size }}
      aria-label={`${person.name}${status ? `, ${person.status}` : ""}`}
    >
      {content}
    </span>
  );
}
export function AvatarStack({
  ids = ["sophie", "james", "maya"],
  count,
  total,
  size = 23,
}: {
  ids?: string[];
  count?: number;
  total?: number;
  size?: number;
}) {
  const store = useStore();
  ids = ids.filter((id) => store.users.some((u) => u.id === id));
  const visibleIds =
    typeof total === "number" ? ids.slice(0, Math.max(0, total)) : ids;
  const remaining =
    typeof total === "number"
      ? Math.max(0, total - visibleIds.length)
      : Math.max(0, count || 0);
  return (
    <span className="avatar-stack">
      {visibleIds.map((id) => (
        <Avatar key={id} user={id} size={size} status={false} />
      ))}
      {remaining > 0 && <span className="stack-count">+{remaining}</span>}
    </span>
  );
}
export function Badge({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: string;
  icon?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="search-input">
      <Icon name="Search" size={17} />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
      />
      {value && (
        <IconButton
          name="X"
          label={`Clear ${label.toLowerCase()}`}
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        />
      )}
    </div>
  );
}
export function Field({
  label,
  error,
  hint,
  children,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={props.id || id}>{label}</label>
      {children || (
        <input
          {...props}
          id={props.id || id}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
      )}
      {(error || hint) && (
        <p
          id={`${id}-help`}
          className={error ? "field-error" : "field-hint"}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}
export function Toggle({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${value ? "on" : ""}`}
      disabled={disabled}
      aria-label={label}
      aria-pressed={value}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  );
}
export function EmptyState({
  icon = "Search",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export type ModalState = { type: string; id?: string; extra?: string } | null;
export type ToastState = {
  message: string;
  action?: () => void;
  actionLabel?: string;
} | null;
export const UIContext = createContext<{
  open: (modal: ModalState) => void;
  toast: (message: string, action?: () => void, actionLabel?: string) => void;
}>({ open: () => {}, toast: () => {} });
export const useUI = () => useContext(UIContext);
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  closeLabel = "Close dialog",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    dialog.showModal();
    const firstInput = dialog.querySelector<HTMLInputElement>(
      "input:not([type=hidden]), textarea",
    );
    firstInput?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""} ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <IconButton name="X" label={closeLabel} onClick={onClose} />
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Toast({
  value,
  close,
}: {
  value: ToastState;
  close: () => void;
}) {
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(close, value.action ? 8000 : 4500);
    return () => clearTimeout(timer);
  }, [value, close]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {value && (
        <div className="toast">
          <span className="toast-check">
            <Icon name="Check" size={16} />
          </span>
          <span>{value.message}</span>
          {value.action && (
            <button
              onClick={() => {
                value.action?.();
                close();
              }}
            >
              {value.actionLabel || "Undo"}
            </button>
          )}
          <IconButton name="X" label="Dismiss notification" onClick={close} />
        </div>
      )}
    </div>
  );
}
