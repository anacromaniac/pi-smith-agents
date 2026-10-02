import { readFileSync } from "node:fs";

export const exampleAgentFiles = {
  Explore: readFileSync(new URL("../../examples/agents/Explore.md", import.meta.url), "utf-8"),
  Plan: readFileSync(new URL("../../examples/agents/Plan.md", import.meta.url), "utf-8"),
};
