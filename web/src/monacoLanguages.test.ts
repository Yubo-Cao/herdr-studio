import { describe, expect, test } from "bun:test";
import { monacoLanguageForPath } from "./monacoLanguages";

describe("monacoLanguageForPath", () => {
  test("maps extensions, special filenames, and unknown files", () => {
    expect(monacoLanguageForPath("src/App.tsx")).toBe("typescript");
    expect(monacoLanguageForPath("/etc/nginx/site.conf")).toBe("ini");
    expect(monacoLanguageForPath("docs/README.MD")).toBe("markdown");
    expect(monacoLanguageForPath("package.json")).toBe("json");
    expect(monacoLanguageForPath("Dockerfile")).toBe("dockerfile");
    expect(monacoLanguageForPath("dockerfile.dev")).toBe("dockerfile");
    expect(monacoLanguageForPath("~/.zshrc")).toBe("shell");
    expect(monacoLanguageForPath("LICENSE")).toBe("plaintext");
    expect(monacoLanguageForPath("C:\\work\\main.rs")).toBe("rust");
  });
});
