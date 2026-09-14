export type User = {
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
export const users: User[] = [
  {
    id: "alex",
    name: "Alex Morgan",
    handle: "alexmorgan",
    avatar: 12,
    status: "online",
    activity: "Making things that matter",
    role: "Owner",
    bio: "Designer, night owl, and collector of good ideas. Building a little corner of the internet for creative people.",
    xp: 2450,
    color: "#a79bea",
  },
  {
    id: "sophie",
    name: "Sophie Chen",
    handle: "sophie.design",
    avatar: 47,
    status: "online",
    activity: "Designing in Figma",
    role: "Admin",
    bio: "Finding the extraordinary in the everyday. Product designer at Studio North. Probably adjusting the kerning.",
    xp: 3820,
    color: "#c5a886",
  },
  {
    id: "james",
    name: "James Wilson",
    handle: "jamesw",
    avatar: 13,
    status: "online",
    activity: "Listening to Tycho",
    role: "Moderator",
    bio: "Frontend engineer. Weekend photographer. Here for the details and the good conversations.",
    xp: 3240,
    color: "#82a9b4",
  },
  {
    id: "maya",
    name: "Maya Patel",
    handle: "mayap",
    avatar: 44,
    status: "online",
    activity: "In The Lounge",
    role: "Member",
    bio: "Creative developer exploring the space between art and technology. Let’s make something unexpected.",
    xp: 2890,
    color: "#8ab9a0",
  },
  {
    id: "leo",
    name: "Leo Park",
    handle: "leopark",
    avatar: 11,
    status: "online",
    activity: "Playing VALORANT",
    role: "Member",
    bio: "Motion design by day. One more game by night. Always down to share a new discovery.",
    xp: 2120,
    color: "#9aafe0",
  },
  {
    id: "emma",
    name: "Emma Davis",
    handle: "emma.d",
    avatar: 49,
    status: "idle",
    activity: "Be right back",
    role: "Member",
    bio: "Brand strategist with a soft spot for film photography and well-made things.",
    xp: 1890,
    color: "#d09fbc",
  },
  {
    id: "noah",
    name: "Noah Kim",
    handle: "noahk",
    avatar: 14,
    status: "online",
    activity: "Exploring new ideas",
    role: "Member",
    bio: "Building tools for people who build things. Coffee always welcome.",
    xp: 1750,
    color: "#b6ad82",
  },
  {
    id: "olivia",
    name: "Olivia Reed",
    handle: "olivia.r",
    avatar: 45,
    status: "offline",
    activity: "Last seen 2 hours ago",
    role: "Member",
    bio: "Illustration, interfaces, and everything in between. Based in London.",
    xp: 1560,
    color: "#aaa6cd",
  },
];
export type Server = {
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
export const servers: Server[] = [
  {
    id: "studio",
    name: "Studio Collective",
    description:
      "A space for curious minds, meaningful work, and everything in between.",
    mark: "sc",
    image: "/images/architecture.jpg",
    color: "#b7a9d3",
    members: 1284,
    online: 128,
    category: "Design & creativity",
    joined: true,
    unread: 8,
  },
  {
    id: "afterhours",
    name: "After Hours",
    description:
      "Good games. Better company. Your late-night people are right here.",
    mark: "a/h",
    image: "/images/night.jpg",
    color: "#9dace0",
    members: 846,
    online: 64,
    category: "Gaming",
    joined: true,
    unread: 3,
  },
  {
    id: "frequency",
    name: "Frequency",
    description: "For the tracks on repeat and the ones you haven’t found yet.",
    mark: "ƒ",
    image: "/images/music.jpg",
    color: "#c49e7e",
    members: 2136,
    online: 216,
    category: "Music",
    joined: true,
    unread: 0,
  },
  {
    id: "offgrid",
    name: "Off Grid",
    description:
      "Take the scenic route. A community for life a little further outside.",
    mark: "△",
    image: "/images/mountains.jpg",
    color: "#8aada1",
    members: 956,
    online: 82,
    category: "Lifestyle",
    joined: false,
    unread: 0,
  },
  {
    id: "buildspace",
    name: "Build Space",
    description:
      "Small experiments. Ambitious projects. Build something with us.",
    mark: "b_",
    image: "/images/architecture.jpg",
    color: "#b7bacc",
    members: 3450,
    online: 312,
    category: "Technology",
    joined: false,
    unread: 0,
  },
  {
    id: "frames",
    name: "Frames",
    description:
      "See the world differently. Photography, filmmaking, and visual stories.",
    mark: "fr",
    image: "/images/night.jpg",
    color: "#ba9eac",
    members: 728,
    online: 48,
    category: "Design & creativity",
    joined: false,
    unread: 0,
  },
];
export type Message = {
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
export const messages: Message[] = [
  {
    id: "m1",
    room: "studio/general",
    user: "sophie",
    text: "Morning, everyone! A little reminder to make something just for the joy of it today. No brief, no deadline. Just you and an idea. ✨",
    time: "9:41 AM",
    reactions: { "🤍": 8, "✨": 4 },
    pinned: true,
  },
  {
    id: "m2",
    room: "studio/general",
    user: "james",
    text: "Needed this today. I spent the weekend putting together a few shots from Copenhagen. The light there is something else.",
    time: "9:43 AM",
    reactions: { "🔥": 5 },
    image: "/images/architecture.jpg",
  },
  {
    id: "m3",
    room: "studio/general",
    user: "maya",
    text: "The way the shadows frame the building… so good. This belongs in #inspiration.",
    time: "9:45 AM",
    reactions: { "🙌": 3 },
    reply: "James Wilson: The light there is something else.",
  },
  {
    id: "m4",
    room: "studio/general",
    user: "alex",
    text: "That’s going straight into my reference folder. Also, who’s joining the design session later?",
    time: "9:48 AM",
    reactions: { "✋": 4 },
  },
  {
    id: "m5",
    room: "studio/general",
    user: "sophie",
    text: "I’m in! Bringing a first look at the new identity. @Alex Morgan would love your take on the typography.",
    time: "9:50 AM",
    reactions: { "👀": 2 },
  },
  {
    id: "m6",
    room: "studio/design-talk",
    user: "sophie",
    text: "A tiny detail that makes a big difference: optical alignment. Your eyes are usually a better judge than the grid.",
    time: "10:02 AM",
    reactions: { "✨": 6 },
  },
  {
    id: "m7",
    room: "studio/design-talk",
    user: "noah",
    text: "Yes! I’ve been revisiting the spacing in our component library. Happy to share a before and after in the session.",
    time: "10:04 AM",
    reactions: { "🙌": 3 },
  },
  {
    id: "m8",
    room: "studio/inspiration",
    user: "emma",
    text: "A quiet little reminder that nature still has the best color palettes.",
    time: "Yesterday",
    reactions: { "🤍": 12 },
    image: "/images/mountains.jpg",
  },
  {
    id: "m9",
    room: "studio/announcements",
    user: "sophie",
    text: "Welcome to Studio Collective. Start with the First Steps mission, introduce yourself, and make yourself at home. Our next community session is Thursday at 7 PM.",
    time: "Yesterday",
    reactions: { "👋": 24 },
    pinned: true,
  },
  {
    id: "m10",
    room: "dm/sophie",
    user: "sophie",
    text: "Hey Alex! Just sent over the new concepts. Would love to hear what you think when you have a moment.",
    time: "10:24 AM",
    reactions: {},
  },
  {
    id: "m11",
    room: "dm/sophie",
    user: "alex",
    text: "These are looking really good. The second direction feels right — it has that quiet confidence we were going for.",
    time: "10:26 AM",
    reactions: { "🤍": 1 },
  },
  {
    id: "m12",
    room: "dm/sophie",
    user: "sophie",
    text: "Exactly what I was thinking! Want to jump into The Lounge and go through the details later?",
    time: "10:28 AM",
    reactions: {},
  },
  {
    id: "m13",
    room: "dm/james",
    user: "james",
    text: "That playlist you shared is on repeat. Perfect soundtrack for a focused afternoon 🎧",
    time: "9:52 AM",
    reactions: {},
  },
  {
    id: "m14",
    room: "dm/leo",
    user: "leo",
    text: "We’ve got a spot for tonight. You in? The usual crew, 8 PM.",
    time: "Yesterday",
    reactions: {},
  },
  {
    id: "m15",
    room: "afterhours/general",
    user: "leo",
    text: "The lobby is open. Bring your best terrible strategy. 🎮",
    time: "10:12 AM",
    reactions: { "🔥": 4 },
  },
  {
    id: "m16",
    room: "frequency/general",
    user: "james",
    text: "Today’s listening: Tycho — Awake. Some records just make the world feel a little better.",
    time: "9:30 AM",
    reactions: { "🎧": 8 },
  },
];
export type Mission = {
  id: string;
  title: string;
  description: string;
  category: string;
  server: string;
  xp: number;
  icon: string;
  color: string;
  objectives: { text: string; done: boolean }[];
  joined: boolean;
  claimed: boolean;
  due: string;
  badge: string;
  people: number;
};
export const missions: Mission[] = [
  {
    id: "creative",
    title: "The creative spark",
    description:
      "Good ideas get better when you share them. Show the community what’s been inspiring you and start a conversation.",
    category: "Weekly challenge",
    server: "studio",
    xp: 350,
    icon: "Sparkles",
    color: "violet",
    objectives: [
      { text: "Share an inspiration in #inspiration", done: true },
      { text: "Give thoughtful feedback to two members", done: true },
      { text: "Share a work in progress in #showcase", done: false },
    ],
    joined: true,
    claimed: false,
    due: "3 days left",
    badge: "Creative spark",
    people: 42,
  },
  {
    id: "firststeps",
    title: "Make yourself at home",
    description:
      "Your people are here. Set up your profile, say hello, and find your corner of the Collective.",
    category: "Getting started",
    server: "studio",
    xp: 150,
    icon: "Flag",
    color: "mint",
    objectives: [
      { text: "Add a bio to your profile", done: true },
      { text: "Introduce yourself in #introductions", done: true },
      { text: "Join your first voice conversation", done: false },
    ],
    joined: true,
    claimed: false,
    due: "At your own pace",
    badge: "First steps",
    people: 128,
  },
  {
    id: "squad",
    title: "Better together",
    description:
      "Bring your crew together for a game night. The best wins are the ones you share.",
    category: "Community goal",
    server: "afterhours",
    xp: 500,
    icon: "Users",
    color: "amber",
    objectives: [
      { text: "Join a squad in the community", done: true },
      { text: "Attend Friday game night", done: false },
      { text: "Share your favorite moment", done: false },
    ],
    joined: true,
    claimed: false,
    due: "5 days left",
    badge: "Team player",
    people: 26,
  },
  {
    id: "design",
    title: "One prompt. Infinite possibilities.",
    description:
      "Design a poster around the word “connection.” Any medium, any style. Show us your interpretation.",
    category: "Design challenge",
    server: "studio",
    xp: 750,
    icon: "PenTool",
    color: "violet",
    objectives: [
      { text: "Create your poster", done: false },
      { text: "Share the final work in #showcase", done: false },
      { text: "Tell the story behind your design", done: false },
    ],
    joined: false,
    claimed: false,
    due: "6 days left",
    badge: "Original thinker",
    people: 64,
  },
  {
    id: "listening",
    title: "A soundtrack for the season",
    description:
      "Help us put together our community’s next shared playlist. Five tracks, one feeling.",
    category: "Community goal",
    server: "frequency",
    xp: 250,
    icon: "Music2",
    color: "mint",
    objectives: [
      { text: "Pick five tracks that belong together", done: false },
      { text: "Share your selection in #general", done: false },
    ],
    joined: false,
    claimed: false,
    due: "4 days left",
    badge: "Tastemaker",
    people: 87,
  },
  {
    id: "welcome",
    title: "A warm welcome",
    description:
      "Small gestures make great communities. Help someone new feel like they belong.",
    category: "Onboarding",
    server: "studio",
    xp: 100,
    icon: "Heart",
    color: "amber",
    objectives: [
      { text: "Welcome three new members", done: true },
      { text: "Recommend a channel they’ll enjoy", done: true },
    ],
    joined: true,
    claimed: true,
    due: "Completed",
    badge: "Community heart",
    people: 93,
  },
];
export type Event = {
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
export const events: Event[] = [
  {
    id: "design-session",
    title: "Design, unfiltered",
    server: "studio",
    day: "10",
    month: "SEP",
    time: "Thursday · 7:00 PM",
    description:
      "Bring your work in progress. An open conversation about ideas, process, and the details that make a difference.",
    attendees: 24,
    rsvp: false,
    icon: "PenTool",
  },
  {
    id: "game-night",
    title: "Friday night, squad up",
    server: "afterhours",
    day: "11",
    month: "SEP",
    time: "Friday · 8:00 PM",
    description:
      "Your end-of-week reset. A few games, the usual crew, and absolutely no pressure to be good.",
    attendees: 18,
    rsvp: true,
    icon: "Gamepad2",
  },
  {
    id: "listening-party",
    title: "The listening room",
    server: "frequency",
    day: "13",
    month: "SEP",
    time: "Sunday · 6:00 PM",
    description:
      "An album from start to finish. This week, we’re exploring ambient worlds together.",
    attendees: 36,
    rsvp: false,
    icon: "Headphones",
  },
];
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
export const getUser = (id: string) =>
  users.find((u) => u.id === id) || users[0];
export const formatNumber = (n: number) =>
  new Intl.NumberFormat("en-US").format(n);
