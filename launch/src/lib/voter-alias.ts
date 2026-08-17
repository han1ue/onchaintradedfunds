import { createHash } from "node:crypto";

const adjectives = [
  "Bouncy", "Cosmic", "Dapper", "Disco", "Fizzy", "Jolly", "Mighty", "Nifty",
  "Peppy", "Quirky", "Sleepy", "Sneaky", "Spicy", "Turbo", "Velvet", "Wobbly",
] as const;

const creatures = [
  "Badger", "Capybara", "Ferret", "Gecko", "Lobster", "Mango", "Noodle", "Otter",
  "Penguin", "Pigeon", "Raccoon", "Turnip", "Walrus", "Wombat", "Yak", "Zebra",
] as const;

export function generatedVoterAlias(userId: string) {
  const digest = createHash("sha256").update(`otf-voter-alias-v1:${userId}`).digest();
  const adjective = adjectives[digest[0] % adjectives.length];
  const creature = creatures[digest[1] % creatures.length];
  const suffix = 100 + digest.readUInt16BE(2) % 900;
  return `${adjective} ${creature} ${suffix}`;
}

export function publicVoterName(input: { userId: string; username: string; allowRealUsername: boolean }) {
  return input.allowRealUsername ? `@${input.username}` : generatedVoterAlias(input.userId);
}
