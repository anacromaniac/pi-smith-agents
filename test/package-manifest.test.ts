import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const hostProvidedPackages = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "@sinclair/typebox", "typebox"];

describe("extension package dependencies", () => {
  it.each(hostProvidedPackages)("declares %s as a host-provided peer", (packageName) => {
    expect(manifest.peerDependencies[packageName]).toBe("*");
    expect(manifest.dependencies).not.toHaveProperty(packageName);
    expect(manifest.devDependencies).toHaveProperty(packageName);
  });
});
