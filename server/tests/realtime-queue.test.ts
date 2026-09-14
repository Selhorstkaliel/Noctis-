import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { RealtimeQueue } from "../realtime-queue.js";

test("burst delivery coalesces per peer and keeps concurrency bounded", async () => {
  const delivered: number[][] = [];
  const queue = new RealtimeQueue<number[]>(
    3,
    100,
    (a, b) => [...a, ...b],
    async (ids) => {
      await delay(5);
      delivered.push(ids);
    },
    () => assert.fail("Unexpected overload"),
  );
  for (let i = 0; i < 1000; i++) queue.push(String(i % 20), [i]);
  while (queue.metrics.completed < 20) await delay(10);
  queue.close();
  assert.equal(delivered.length, 20);
  assert.equal(delivered.flat().length, 1000);
  assert.equal(queue.metrics.coalesced, 980);
  assert.ok(queue.metrics.peakActive <= 3);
});

test("slow peer cannot overlap itself or hold the other peers; overflow is explicit", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received: string[] = [];
  let rejected = 0;
  const queue = new RealtimeQueue<string>(
    2,
    2,
    (_, next) => next,
    async (key) => {
      if (key === "slow") await blocked;
      received.push(key);
    },
    () => {
      rejected++;
    },
  );
  queue.push("slow", "slow");
  await delay(40);
  queue.push("slow", "next");
  queue.push("fast", "fast");
  assert.equal(queue.push("overflow", "overflow"), false);
  await delay(40);
  assert.deepEqual(received, ["fast"]);
  release();
  while (queue.metrics.completed < 3) await delay(10);
  queue.close();
  assert.deepEqual(received, ["fast", "slow", "next"]);
  assert.equal(rejected, 1);
});
