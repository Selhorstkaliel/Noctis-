export type User = {
  badges?: { id: string; name: string; icon: string }[];
  createdAt?: string;
  id: string;
  name: string;
  handle: string;
  avatar: number;
  avatarUrl?: string;
  status: "online" | "idle" | "offline";
  activity: string;
  role: string;
  bio: string;
  xp: number;
  color: string;
};

export type Server = {
  ownerId?: string;
  isPublic?: boolean;
  permissions?: string[];
  id: string;
  name: string;
  description: string;
  mark: string;
  image: string;
  color: string;
  members: number;
  online: number;
  category: string;
  joined: boolean;
  unread: number;
};

export type Message = {
  replyTo?: string;
  attachments?: { id: string; name: string; url: string; type: string }[];
  id: string;
  room: string;
  user: string;
  text: string;
  time: string;
  reactions: Record<string, number>;
  mine?: string[];
  reply?: string;
  image?: string;
  file?: { name: string; data: string };
  edited?: boolean;
  pinned?: boolean;
};

export type Mission = {
  memberIds?: string[];
  dueAt?: string;
  id: string;
  title: string;
  description: string;
  category: string;
  server: string;
  xp: number;
  icon: string;
  color: string;
  objectives: {
    id?: string;
    text: string;
    done: boolean;
    verification?: "self" | "moderator";
  }[];
  joined: boolean;
  claimed: boolean;
  due: string;
  badge: string;
  people: number;
};

export type Event = {
  memberIds?: string[];
  startsAt?: string;
  year?: number;
  id: string;
  title: string;
  server: string;
  day: string;
  month: string;
  time: string;
  description: string;
  attendees: number;
  rsvp: boolean;
  icon: string;
};

export const integrations = [
  {
    id: "github",
    name: "GitHub",
    icon: "Github",
    color: "#dedee5",
    category: "Development",
    description:
      "Keep your team in the loop with commits, pull requests, and releases.",
    detail: "Pull request #128 merged · Refine the navigation experience",
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "Youtube",
    color: "#ec8b8d",
    category: "Entertainment",
    description:
      "Share new uploads and make every premiere a community moment.",
    detail: "New upload · A week in the studio",
  },
  {
    id: "twitch",
    name: "Twitch",
    icon: "Twitch",
    color: "#b29af7",
    category: "Entertainment",
    description:
      "Go live with your community. Stream alerts, right where you hang out.",
    detail: "Leo is live · Friday night with the crew",
  },
  {
    id: "spotify",
    name: "Spotify",
    icon: "Music2",
    color: "#81c49a",
    category: "Entertainment",
    description:
      "Put your listening activity on your profile and discover new favorites.",
    detail: "Listening to Awake · Tycho",
  },
  {
    id: "calendar",
    name: "Google Calendar",
    icon: "CalendarDays",
    color: "#91b2ec",
    category: "Productivity",
    description:
      "Bring your schedule into your community. Never miss a moment.",
    detail: "Upcoming · Design, unfiltered · Thursday 7:00 PM",
  },
  {
    id: "webhooks",
    name: "Webhooks",
    icon: "Webhook",
    color: "#d9ba90",
    category: "Development",
    description:
      "Bring updates from your favorite tools into any text channel.",
    detail: "Sample webhook · Deployment completed successfully",
  },
];

export const formatNumber = (n: number) =>
  new Intl.NumberFormat("en-US").format(n);
export let users: User[] = [];
export const unavailableUser: User = {
  id: "unavailable",
  name: "Community member",
  handle: "unavailable",
  avatar: 0,
  status: "offline",
  activity: "",
  role: "Member",
  bio: "This profile is private or unavailable.",
  xp: 0,
  color: "#6b6d78",
};
export function setUsers(next: User[]) {
  users = next;
}
export const getUser = (id: string) =>
  users.find((u) => u.id === id) || { ...unavailableUser, id };
