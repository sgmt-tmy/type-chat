import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";

function renderLayout() {
  // html 要素は document 直下に描画できないため、文字列にしてから解析する
  const html = renderToStaticMarkup(
    <RootLayout>
      <p>本文</p>
    </RootLayout>,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { html, doc };
}

describe("RootLayout", () => {
  it("html 要素の lang が ja である", () => {
    const { html } = renderLayout();
    expect(html).toMatch(/^<html lang="ja"/);
  });

  it("共通ヘッダーのリンクがある", () => {
    const { doc } = renderLayout();
    const link = doc.querySelector("header a");
    expect(link?.textContent).toBe("type-chat");
    expect(link?.getAttribute("href")).toBe("/");
  });

  it("children が main の中に描画され、main に共通レイアウトのクラスが付く", () => {
    const { doc } = renderLayout();
    const main = doc.querySelector("main");
    expect(main?.textContent).toBe("本文");
    for (const name of ["mx-auto", "max-w-2xl", "px-4"]) {
      expect(main?.classList.contains(name)).toBe(true);
    }
  });

  it("トーストの表示領域（Toaster）がある", () => {
    const { doc } = renderLayout();
    expect(doc.querySelector("section[aria-label^='Notifications']")).not.toBeNull();
  });
});
