// The target list a campaign is created from (#67): CSV in, rows TurnCall
// would refuse reported by row before anything is sent.
import { expect, it } from "vitest";
import { parseTargets } from "./campaignTargets";

it("reads a number column, an optional timezone, and every other column as a variable", () => {
  const { targets, errors } = parseTargets(
    "number,timezone,name,plan\n+15552223333,America/Chicago,Jane,gold\n+15554445555,,Sam,silver\n",
    "America/New_York",
  );
  expect(errors).toEqual([]);
  expect(targets).toEqual([
    { number: "+15552223333", timezone: "America/Chicago", variables: { name: "Jane", plan: "gold" } },
    { number: "+15554445555", variables: { name: "Sam", plan: "silver" } },
  ]);
});

it("keeps a quoted comma inside its value and drops empty variables", () => {
  const { targets } = parseTargets('number,name,note\n+15552223333,"Doe, Jane",\n', "UTC");
  expect(targets[0].variables).toEqual({ name: "Doe, Jane" });
});

it("a bare list of numbers needs no header", () => {
  const { targets, errors } = parseTargets("+15552223333\n+15554445555", "UTC");
  expect(errors).toEqual([]);
  expect(targets.map((t) => t.number)).toEqual(["+15552223333", "+15554445555"]);
});

it("names each row TurnCall would refuse", () => {
  const many = Array.from({ length: 51 }, (_, i) => `v${i}`);
  const csv = [
    ["number", ...many].join(","),
    ["555-1234", ...many.map(() => "x")].join(","),
    ["+15552223333", ...many.map(() => "x")].join(","),
    ["+15554445555", ...many.map(() => "")].join(","),
    ["+15554445555", ...many.map(() => "")].join(","),
  ].join("\n");
  const { errors } = parseTargets(csv, "UTC");
  expect(errors).toEqual([
    { row: 2, message: "555-1234 is not an E.164 number (e.g. +15551234567)" },
    { row: 3, message: "51 variables; a target takes at most 50" },
    { row: 5, message: "+15554445555 is listed twice" },
  ]);
});

it("a target with no timezone needs the campaign's", () => {
  const { errors } = parseTargets("+15552223333", "");
  expect(errors).toEqual([{ row: 1, message: "no timezone, and the campaign sets none" }]);
});

it("a timezone the browser does not know is named", () => {
  const { errors } = parseTargets("number,timezone\n+15552223333,Mars/Olympus", "UTC");
  expect(errors).toEqual([{ row: 2, message: "Mars/Olympus is not an IANA timezone (e.g. America/New_York)" }]);
});

it("remembers each target's CSV line, to name a row TurnCall refuses", () => {
  const { rows } = parseTargets("number\n+15552223333\n\n+15554445555", "UTC");
  expect(rows).toEqual([2, 4]);
});

it("counts the characters TurnCall counts, names included", () => {
  const { errors } = parseTargets(`number,note\n+15552223333,${"x".repeat(4093)}`, "UTC");
  expect(errors).toEqual([{ row: 2, message: "variables total 4097 characters; the most is 4096" }]);
});
