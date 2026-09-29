import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";

describe("RootLayout", () => {
  it("html 要素の lang が ja である", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>本文</p>
      </RootLayout>,
    );
    expect(html).toMatch(/^<html lang="ja"/);
  });
});
