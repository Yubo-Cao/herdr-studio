import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reloadApplicationPage, TerminalFontSelect } from "./ConfigMenu";

describe("application menu actions", () => {
  test("reloads the current page", () => {
    let reloadCount = 0;

    reloadApplicationPage({
      reload() {
        reloadCount += 1;
      },
    });

    expect(reloadCount).toBe(1);
  });

  test("renders terminal font presets as an accessible select", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalFontSelect, {
        value: "fira-code",
        onChange: () => {},
      }),
    );

    expect(markup).toContain('<select id="terminal-font-family"');
    expect(markup).toContain('aria-label="Terminal font"');
    expect(markup).toContain('<option value="">Default (system)</option>');
    expect(markup).toContain(
      '<option value="fira-code" selected="">Fira Code</option>',
    );
    expect(markup).not.toContain("<input");
  });

  test("selects the default for an unsupported legacy custom font", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalFontSelect, {
        value: '"Custom Corporate Mono"',
        onChange: () => {},
      }),
    );

    expect(markup).toContain(
      '<option value="" selected="">Default (system)</option>',
    );
  });
});
