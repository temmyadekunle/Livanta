import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ANDROID_VERSION_CODE,
  APK_FILE_NAME,
  APK_SIZE_BYTES,
  APP_VERSION,
  DIRECT_APK_URL,
} from "../lib/appVersion.ts";
import { apkSizeLabel } from "../lib/landing/store.ts";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const gradle = read("android/app/build.gradle");
const gradleVersionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
const gradleVersionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);

test("appVersion.ts agrees with package.json", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(APP_VERSION, pkg.version);
});

test("appVersion.ts agrees with package-lock.json", () => {
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(APP_VERSION, lock.version);
  assert.equal(APP_VERSION, lock.packages[""].version);
});

test("appVersion.ts agrees with android/app/build.gradle", () => {
  assert.equal(APP_VERSION, gradleVersionName);
  assert.equal(ANDROID_VERSION_CODE, gradleVersionCode);
});

test("a new release never reuses or lowers the shipped version code", () => {
  if (APP_VERSION === "0.1.1") {
    assert.equal(ANDROID_VERSION_CODE, 5);
    return;
  }
  assert.ok(
    ANDROID_VERSION_CODE > 5,
    `version ${APP_VERSION} must use a version code above 5, found ${ANDROID_VERSION_CODE}`,
  );
});

test("the APK file name and URL follow the version", () => {
  assert.equal(APK_FILE_NAME, `livanta-${APP_VERSION}-release.apk`);
  assert.equal(
    DIRECT_APK_URL,
    `https://github.com/temmyadekunle/Livanta/releases/download/v${APP_VERSION}/${APK_FILE_NAME}`,
  );
  assert.doesNotThrow(() => new URL(DIRECT_APK_URL));
});

test("the advertised size matches the released artifact", (t) => {
  const path = fileURLToPath(
    new URL(`../output/android/${APK_FILE_NAME}`, import.meta.url),
  );
  if (!existsSync(path)) {
    t.skip("output/android artifact is not present in this checkout");
    return;
  }
  assert.equal(statSync(path).size, APK_SIZE_BYTES);
  assert.equal(apkSizeLabel(), "7.0 MB");
});
