import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf-8"));
const projectRepository = "https://github.com/anacromaniac/pi-smith-agents";
const hostProvidedPackages = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "@sinclair/typebox", "typebox"];

describe("extension package identity", () => {
  it("uses the new project name in the manifest and lockfile", () => {
    expect(manifest.name).toBe("pi-smith-agents");
    expect(lockfile.name).toBe(manifest.name);
    expect(lockfile.packages[""].name).toBe(manifest.name);
  });

  it("links project metadata and previews to the maintained fork", () => {
    expect(manifest.repository.url).toBe(`${projectRepository}.git`);
    expect(manifest.homepage).toBe(`${projectRepository}#readme`);
    expect(manifest.bugs.url).toBe(`${projectRepository}/issues`);
    expect(manifest.pi.image).toBe(`${projectRepository}/raw/master/media/screenshot.png`);
    expect(manifest.pi.video).toBe(`${projectRepository}/raw/master/media/demo.mp4`);
  });

  it("credits the current maintainer and original author", () => {
    expect(manifest.author).toBe("anacromaniac");
    expect(manifest.contributors).toContain("tintinweb");
    expect(manifest.license).toBe("MIT");
  });
});

describe("extension package dependencies", () => {
  it.each(hostProvidedPackages)("declares %s as a host-provided peer", (packageName) => {
    expect(manifest.peerDependencies[packageName]).toBe("*");
    expect(manifest.dependencies).not.toHaveProperty(packageName);
    expect(manifest.devDependencies).toHaveProperty(packageName);
  });
});
